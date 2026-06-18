/**
 * proverClient.ts — typed, SSR-safe wrapper around /zk/prover-client.js.
 *
 * The underlying prover-client.js is a browser ES module that creates a Web
 * Worker; it CANNOT be imported at the top level in Next.js App Router (the
 * module executes during SSR, worker creation fails). This wrapper:
 *   1. Guards every exported function with `typeof window === 'undefined'`.
 *   2. Dynamically imports prover-client.js only in the browser (not SSR).
 *   3. Calls `configure()` with the policy_tx_1_8 artifact URLs before any
 *      initProver / prove call.
 *
 * Usage (Wave 3 / ProvingStepper):
 *   await configureProver()   // once, before initProver
 *   await initProver()        // downloads proving key + r1cs, sets up WASM
 *   const unsub = onProgress((loaded, total, msg, pct) => …)
 *   const { proof, publicInputs } = await prove(inputs)
 *   unsub()
 *
 * RESEARCH Q7: the import must be dynamic (`import(...)`, never top-level
 * `import ... from '/zk/prover-client.js'`). Worker construction happens
 * inside prover-client.js; the dynamic import defers that to the browser.
 */
'use client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProveResult {
  proof: Uint8Array
  publicInputs: Uint8Array
  sorobanFormat: boolean
  timings?: Record<string, number>
}

export type ProgressCallback = (
  loaded: number,
  total: number,
  message: string,
  percent: number,
) => void

// ---------------------------------------------------------------------------
// Bridge config for policy_tx_1_8
// ---------------------------------------------------------------------------

const CIRCUIT_CONFIG = {
  circuitName: 'policy_tx_1_8',
  circuitWasmUrl: '/zk/circuits/policy_tx_1_8.wasm',
  provingKeyUrl: '/zk/keys/policy_tx_1_8_proving_key.bin',
  r1csUrl: '/zk/circuits/policy_tx_1_8.r1cs',
  cacheName: 'sobre-proving-artifacts-v1',
} as const

// ---------------------------------------------------------------------------
// Dynamic import helper (SSR-safe)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProverClientModule = Record<string, any>

let _module: ProverClientModule | null = null

async function getModule(): Promise<ProverClientModule> {
  if (typeof window === 'undefined') {
    throw new Error('proverClient: browser-only, cannot use during SSR')
  }
  if (!_module) {
    // Dynamic import of the browser-only prover-client.js served from /public/zk/.
    // TypeScript cannot resolve the /zk/ URL at build time (it is served as a static
    // asset, not a compiled module). We use Function() to bypass the TS module check
    // while keeping the dynamic import semantics at runtime.
    // eslint-disable-next-line no-new-func
    const dynamicImport = new Function('url', 'return import(url)') as (url: string) => Promise<ProverClientModule>
    _module = await dynamicImport('/zk/prover-client.js')
  }
  return _module
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Configure the prover bridge for policy_tx_1_8 artifacts.
 * Call once before initProver(). No-op during SSR.
 */
export async function configureProver(): Promise<void> {
  if (typeof window === 'undefined') return
  const pc = await getModule()
  // The worker falls back to its DEFAULT_CONFIG (policy_tx_1_8 URLs) when the
  // bundle does not export a `configure` hook, so a missing function is not a
  // failure — guard it instead of throwing into the claim/deposit flow.
  if (typeof pc.configure === 'function') {
    pc.configure(CIRCUIT_CONFIG)
  }
}

/**
 * Initialize the prover: download/cache proving key + r1cs, load WASM modules.
 * No-op during SSR. Subscribe to progress via onProgress() before calling this.
 */
export async function initProver(): Promise<void> {
  if (typeof window === 'undefined') return
  const pc = await getModule()
  await pc.initializeProver()
}

/**
 * Generate a Groth16 proof for the provided circuit inputs.
 * Returns proof as a 256-byte Uint8Array (Soroban format) + public inputs.
 * Throws if called during SSR or if the prover is not initialized.
 */
export async function prove(inputs: Record<string, unknown>): Promise<ProveResult> {
  if (typeof window === 'undefined') {
    throw new Error('proverClient.prove: browser-only')
  }
  const pc = await getModule()
  return pc.prove(inputs, { sorobanFormat: true }) as ProveResult
}

/**
 * Compute a Poseidon2 commitment via the WASM bridge.
 * Returns the commitment as a bigint (BN254 scalar field element).
 *
 * Used by PayrollComposer (Wave 3) to resolve the pure-JS stub in
 * buildDepositInputs (precomputedCommitments param).
 *
 * Parameters are bigint field elements. They are sent as decimal strings so
 * the worker can convert them to little-endian bytes (as required by the WASM
 * via from_le_bytes_mod_order) without byte-order confusion.
 */
export async function computeCommitment(
  amount: bigint,
  pubkey: bigint,
  blinding: bigint,
): Promise<bigint> {
  if (typeof window === 'undefined') {
    throw new Error('proverClient.computeCommitment: browser-only')
  }
  const pc = await getModule()
  const decResult: string = await pc.computeCommitment(
    amount.toString(10),
    pubkey.toString(10),
    blinding.toString(10),
  )
  return BigInt(decResult)
}

/**
 * Compute the Poseidon2 nullifier for a dummy input note via the WASM bridge.
 * Returns a 32-byte Uint8Array (field element, big-endian) decoded to bigint.
 *
 * For the dummy input (inAmount=0), the full chain is:
 *   1. derive_public_key(privKey)
 *   2. compute_commitment(0, pubkey, blinding)
 *   3. compute_signature(privKey, commitment, pathIndices)
 *   4. compute_nullifier(commitment, pathIndices, signature)
 *
 * This satisfies policyTransaction.circom line 105:
 *   inNullifierHasher[tx].out === inputNullifier[tx]
 *
 * Parameters:
 *   privKey     — BN254 scalar; DUMMY_PRIVKEY=1n for the deposit dummy input
 *   blinding    — Fresh random BN254 blinding for the dummy note (per proof run)
 *   pathIndices — Merkle path indices for the dummy input (default: 0n = deposit path)
 */
export async function computeNullifier(
  privKey: bigint,
  blinding: bigint,
  pathIndices: bigint = BigInt(0),
): Promise<bigint> {
  if (typeof window === 'undefined') {
    throw new Error('proverClient.computeNullifier: browser-only')
  }
  const pc = await getModule()
  const decResult: string = await pc.computeNullifier(
    privKey.toString(10),
    blinding.toString(10),
    pathIndices.toString(10),
  )
  return BigInt(decResult)
}

/**
 * Reconstruct the Merkle path for a leaf via the WASM MerkleTree (real Poseidon2
 * hash, the same one the circuit uses). A2 fallback for the employee claim when
 * pool.get_proof is absent. The returned pathElements/pathIndices are decimal
 * strings the withdraw witness builder consumes directly.
 *
 * Browser-only: the MerkleTree lives in the prover WASM bridge.
 */
export async function reconstructMerklePath(
  leaves: bigint[],
  targetIndex: number,
  depth = 10,
): Promise<{ pathElements: string[]; pathIndices: string }> {
  if (typeof window === 'undefined') {
    throw new Error('proverClient.reconstructMerklePath: browser-only')
  }
  const pc = await getModule()
  return pc.reconstructMerklePath(
    leaves.map((l) => l.toString(10)),
    targetIndex,
    depth,
  ) as Promise<{ pathElements: string[]; pathIndices: string }>
}

/**
 * Derive the BN254 public key from a BN254 private key via the WASM bridge.
 * Computes Poseidon2(privKey, 0) with domain separation 0x03, exactly as the
 * circuit's Keypair() template does. This is the source of truth for bn254Pub
 * throughout the codebase: never derive it client-side without going through here.
 *
 * The bridge derivePublicKey(bytes, asHex=false) takes LE field bytes and returns
 * LE field bytes. We convert bigint to/from LE bytes to match that convention.
 *
 * Browser-only: throws during SSR.
 */
export async function derivePublicKey(privKey: bigint): Promise<bigint> {
  if (typeof window === 'undefined') throw new Error('proverClient.derivePublicKey: browser-only')
  const pc = await getModule()
  // Convert bigint to 32-byte LE field bytes (the WASM expects LE encoding)
  const privBytes = bigintToFieldBytesLE(privKey)
  const pubBytes: Uint8Array = await pc.derivePublicKey(privBytes, false)
  return fieldBytesLEToBigint(pubBytes)
}

/**
 * Subscribe to download/init progress events.
 * Returns an unsubscribe function.
 * No-op during SSR (returns a no-op unsubscribe).
 */
export function onProgress(callback: ProgressCallback): () => void {
  if (typeof window === 'undefined') return () => {}
  // The prover-client.js module may not be loaded yet; register after module load.
  let unsubscribe: (() => void) | null = null
  getModule().then(pc => {
    unsubscribe = pc.onProgress(callback)
  })
  return () => {
    unsubscribe?.()
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Encode a bigint as a 32-byte big-endian Uint8Array (BN254 field element). */
function bigintToFieldBytes(v: bigint): Uint8Array {
  const hex = v.toString(16).padStart(64, '0')
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/** Encode a bigint as a 32-byte little-endian Uint8Array (WASM LE field convention). */
function bigintToFieldBytesLE(v: bigint): Uint8Array {
  const out = new Uint8Array(32)
  let val = v
  for (let i = 0; i < 32; i++) {
    out[i] = Number(val & BigInt(0xff))
    val >>= BigInt(8)
  }
  return out
}

/** Decode a 32-byte little-endian Uint8Array to a bigint. */
function fieldBytesLEToBigint(bytes: Uint8Array): bigint {
  let result = BigInt(0)
  for (let i = 31; i >= 0; i--) result = (result << BigInt(8)) | BigInt(bytes[i])
  return result
}
