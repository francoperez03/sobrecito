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
  pc.configure(CIRCUIT_CONFIG)
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
