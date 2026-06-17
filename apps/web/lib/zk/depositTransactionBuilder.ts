/**
 * depositTransactionBuilder.ts — 1→8 deposit witness assembly for policy_tx_1_8.
 *
 * Three exports:
 *   hashExtDataSobre   — keccak256(XDR(extData)) mod BN254. Field order is
 *                        alphabetical (encrypted_outputs → ext_amount → recipient)
 *                        matching pool.rs #[contracttype] XDR serialization. SPIKE-
 *                        confirmed byte-for-byte vs the contract (prefix 0b3f2759).
 *   buildFrozenBlobs   — generate one blinding per note, encrypt each note payload
 *                        to BOTH the employee AND the auditor pubkey (dual ECIES),
 *                        and return the 8 frozen blobs + 8 blindings in one call.
 *                        SINGLE CALL SITE: blobs frozen once, never regenerated.
 *                        The same blindings MUST flow into buildDepositInputs so the
 *                        output commitments match the encrypted note contents (Pitfall 2).
 *   buildDepositInputs — assemble the full witness input object for the browser prover
 *                        (1 dummy input, 8 real outputs) using the blindings returned
 *                        by buildFrozenBlobs.
 *
 * ES2017 only: BigInt() calls, never 0n/1n/…617n literals.
 * No default export — callers import named functions.
 */

import { keccak_256 } from '@noble/hashes/sha3.js'
import { Address, XdrLargeInt, xdr } from '@stellar/stellar-sdk'
import { encryptNote, buildEncryptedOutputs, BN254_FIELD_MODULUS } from 'viewkey'
import type { DenomNote } from './denominationBuilder'

// ---------------------------------------------------------------------------
// BN254 constants (ES2017: no BigInt literals, use BigInt() constructor)
// ---------------------------------------------------------------------------
const BN254_MOD = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617')

// A well-known dummy private key safe to use as a circuit placeholder.
// The circuit treats inAmount=0 as a dummy input; the private key here is
// never used for actual authentication — it only fills the witness slot.
const DUMMY_PRIVKEY = BigInt(1)

// ---------------------------------------------------------------------------
// hashExtDataSobre
// ---------------------------------------------------------------------------

/**
 * Compute the ext_data_hash for a pool.transact call.
 *
 * The Sobre pool's ExtData is `{ recipient, ext_amount, encrypted_outputs: Vec<Bytes> }`.
 * Soroban #[contracttype] serializes struct fields in ALPHABETICAL order, so the
 * XDR map entries are: encrypted_outputs → ext_amount → recipient.
 *
 * Algorithm:
 *   1. Build an ScMap from the three fields in alphabetical order.
 *   2. Serialize to XDR bytes via scvMap().toXDR().
 *   3. keccak256 the bytes.
 *   4. Reduce the 256-bit digest modulo BN254_FIELD_MODULUS.
 *
 * SPIKE-confirmed: the demo fixture (mikey, ext_amount=0, 8 empty blobs)
 * produces `0b3f2759b68a3bf239da2b7d987c95c9373c5595623ae21d334f01c123c66056`,
 * matching the contract byte-for-byte.
 */
export function hashExtDataSobre(params: {
  recipient: string
  ext_amount: bigint
  encrypted_outputs: Uint8Array[]
}): { bigInt: bigint; bytes: Uint8Array } {
  // Build the three map entries — alphabetical order is: encrypted_outputs, ext_amount, recipient
  const entries = [
    {
      key: 'encrypted_outputs',
      val: xdr.ScVal.scvVec(
        params.encrypted_outputs.map(b => xdr.ScVal.scvBytes(Buffer.from(b))),
      ),
    },
    {
      key: 'ext_amount',
      val: new XdrLargeInt('i256', params.ext_amount.toString()).toScVal(),
    },
    {
      key: 'recipient',
      val: Address.fromString(params.recipient).toScVal(),
    },
  ]

  // Sort alphabetically (the pool contract serializes fields in this order)
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  const scEntries = entries.map(
    e => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(e.key), val: e.val }),
  )
  const xdrBytes = xdr.ScVal.scvMap(scEntries).toXDR()
  const digest = keccak_256(xdrBytes)

  // Reduce the 32-byte big-endian digest into the BN254 scalar field
  let digestBig = BigInt(0)
  for (const byte of digest) {
    digestBig = (digestBig << BigInt(8)) | BigInt(byte)
  }
  const reduced = digestBig % BN254_MOD

  // Return both the bigint and a 32-byte big-endian representation
  const hexPadded = reduced.toString(16).padStart(64, '0')
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hexPadded.slice(i * 2, i * 2 + 2), 16)
  }
  return { bigInt: reduced, bytes }
}

// ---------------------------------------------------------------------------
// buildFrozenBlobs — SINGLE CALL SITE (Pitfall 2)
// ---------------------------------------------------------------------------

/**
 * Generate blindings + encrypt output notes to BOTH the employee and auditor pubkeys.
 *
 * BLOBS FROZEN ONCE, NEVER REGENERATED (Pitfall 2 / genKeys.ts L3).
 * encryptNote uses a fresh random ephemeral key per call, so calling this
 * function twice with the same inputs produces DIFFERENT blobs AND DIFFERENT
 * blindings — proving that the caller MUST freeze the result before computing
 * the ext_data_hash. Any re-call after the hash is computed breaks the hash.
 *
 * Returns: { blobs: Uint8Array[8], blindings: bigint[8] }
 * The SAME `blindings` array must be passed to buildDepositInputs so that
 * the output commitments match the encrypted note contents.
 */
export async function buildFrozenBlobs(
  notes: DenomNote[],
  auditorPubkeyHex: string,
): Promise<{ blobs: Uint8Array[]; blindings: bigint[] }> {
  if (notes.length !== 8) {
    throw new Error(
      `buildFrozenBlobs: expected exactly 8 notes, got ${notes.length}`,
    )
  }

  // Convert auditor pubkey hex to bytes
  const auditorPubkeyBytes = hexToBytes32(auditorPubkeyHex)

  const blindings: bigint[] = []
  const encBlobsInput: Array<{ employeeCiphertext: Uint8Array; auditorCiphertext: Uint8Array }> = []

  for (let i = 0; i < 8; i++) {
    const note = notes[i]

    // Generate a fresh cryptographic blinding for this note
    const blinding = generateRandomBlinding()
    blindings.push(blinding)

    const payload = { amount: note.denomination, blinding }

    // Encrypt to the employee's X25519 pubkey.
    // For zero-denomination dummy notes (all-zero pubkey from denominationBuilder
    // padding), X25519 rejects the all-zero key. Use a random valid ephemeral key
    // for dummy slots — they carry no real value and are never decrypted.
    let employeePubkeyHex = note.recipientPubkeyHex || '00'.repeat(32)
    if (/^0+$/.test(employeePubkeyHex)) {
      const randBytes = new Uint8Array(32)
      globalThis.crypto.getRandomValues(randBytes)
      randBytes[0] = randBytes[0] || 0xab // ensure at least one non-zero byte
      employeePubkeyHex = Array.from(randBytes).map(b => b.toString(16).padStart(2, '0')).join('')
    }
    const employeePubkeyBytes = hexToBytes32(employeePubkeyHex)
    const employeeCiphertext = encryptNote(employeePubkeyBytes, payload)

    // Encrypt to the auditor's X25519 pubkey (published, persisted in deployments.json)
    const auditorCiphertext = encryptNote(auditorPubkeyBytes, payload)

    encBlobsInput.push({ employeeCiphertext, auditorCiphertext })
  }

  // buildEncryptedOutputs asserts exactly 8 blobs and encodes the dual layout
  const blobs = buildEncryptedOutputs(encBlobsInput)

  return { blobs, blindings }
}

// ---------------------------------------------------------------------------
// buildDepositInputs — witness input assembly for policy_tx_1_8
// ---------------------------------------------------------------------------

/**
 * Inputs to buildDepositInputs.
 *
 * `blindings`    — the SAME array returned by buildFrozenBlobs. These MUST be
 *                  the blindings used when encrypting the notes (Pitfall 2).
 * `dummyBlinding`— a SEPARATE fresh blinding for the 1 dummy input note.
 *                  Fresh per proof run to prevent AlreadySpentNullifier (Pitfall 4).
 */
export interface DepositInputsParams {
  notes: DenomNote[]
  blindings: bigint[]
  encOutputs: Uint8Array[]
  extDataHash: bigint
  poolRoot: string
  aspMemberRoot: string
  aspNonMemberRoot: string
  senderAddress: string
  dummyBlinding: bigint
  /**
   * Pre-computed Poseidon2 output commitments from the WASM bridge
   * (compute_commitment(amount, pubkey, blinding) × 8).
   *
   * If provided, these values are used INSTEAD of the pure-JS placeholder
   * computeCommitmentPure(). Wave 3 MUST provide these for actual proof generation.
   * The unit tests omit this field (pure-JS fallback is sufficient for shape checks).
   */
  precomputedCommitments?: bigint[]
  /**
   * Pre-computed Poseidon2 nullifier from the WASM bridge
   * (compute_nullifier(DUMMY_PRIVKEY, dummyBlinding)).
   *
   * If provided, used instead of computeNullifierPure(). Wave 3 MUST provide
   * this for actual proof generation.
   */
  precomputedNullifier?: bigint
}

/**
 * Assemble the witness input object for the policy_tx_1_8 prover.
 *
 * Circuit shape: 1 dummy input → 8 real outputs.
 *   - inAmount=['0'] disables the Merkle membership check (deposit path).
 *   - dummyBlinding: fresh per run (prevents AlreadySpentNullifier on the dummy nullifier).
 *   - publicAmount: sum of all 8 output note denominations (as field element).
 *   - outputCommitment[i]: Poseidon2(denomination, outPubkey, blindings[i]).
 *     In the browser, the WASM bridge computes this; in the witness builder the
 *     commitment values are passed as decimal strings.
 *
 * All values are returned as decimal strings (the witness generator expects strings).
 */
export function buildDepositInputs(params: DepositInputsParams): {
  root: string
  publicAmount: string
  extDataHash: string
  inputNullifier: string[]
  outputCommitment: string[]
  membershipRoots: string[][]
  nonMembershipRoots: string[][]
  inAmount: string[]
  inPrivateKey: string[]
  inBlinding: string[]
  inPathIndices: string[]
  inPathElements: string[][]
  membershipProofs: Array<Array<{ leaf: string; blinding: string; pathElements: string[]; pathIndices: string }>>
  nonMembershipProofs: Array<Array<{ key: string; siblings: string[]; oldKey: string; oldValue: string; isOld0: string }>>
  outAmount: string[]
  outPubkey: string[]
  outBlinding: string[]
} {
  const {
    notes, blindings, extDataHash, poolRoot, aspMemberRoot, aspNonMemberRoot,
    dummyBlinding, precomputedCommitments, precomputedNullifier,
  } = params

  if (notes.length !== 8) {
    throw new Error(`buildDepositInputs: expected exactly 8 notes, got ${notes.length}`)
  }
  if (blindings.length !== 8) {
    throw new Error(`buildDepositInputs: expected exactly 8 blindings, got ${blindings.length}`)
  }

  // publicAmount = sum of denominations, reduced as a field element
  const extAmount = notes.reduce((s, n) => s + n.denomination, BigInt(0))
  const publicAmount = toFieldElement(extAmount).toString()

  // Dummy input nullifier: Poseidon2(DUMMY_PRIVKEY, dummyBlinding) from WASM bridge.
  // If not pre-computed (unit test context), falls back to a deterministic placeholder.
  // Wave 3 MUST provide precomputedNullifier for actual proof generation.
  const inputNullifier = (
    precomputedNullifier ?? computeNullifierPure(DUMMY_PRIVKEY, dummyBlinding)
  ).toString()

  // Output commitments: Poseidon2(denomination, outPubkey, blinding) from WASM bridge.
  // If not pre-computed (unit test context), falls back to a deterministic placeholder.
  // Wave 3 MUST provide precomputedCommitments for actual proof generation.
  const outputCommitment = notes.map((n, i) =>
    (precomputedCommitments?.[i] ?? computeCommitmentPure(n.denomination, n.outPubkey, blindings[i])).toString(),
  )

  return {
    // public inputs
    root: poolRoot,
    publicAmount,
    extDataHash: extDataHash.toString(),
    inputNullifier: [inputNullifier],
    outputCommitment,
    membershipRoots: [[aspMemberRoot]],
    nonMembershipRoots: [[aspNonMemberRoot]],
    // private inputs
    inAmount: ['0'],
    inPrivateKey: [DUMMY_PRIVKEY.toString()],
    inBlinding: [dummyBlinding.toString()],
    inPathIndices: ['0'],
    inPathElements: [Array(10).fill('0')],
    membershipProofs: [[
      { leaf: '0', blinding: '0', pathElements: Array(10).fill('0'), pathIndices: '0' },
    ]],
    nonMembershipProofs: [[
      { key: '0', siblings: Array(10).fill('0'), oldKey: '0', oldValue: '0', isOld0: '1' },
    ]],
    outAmount: notes.map(n => n.denomination.toString()),
    outPubkey: notes.map(n => n.outPubkey.toString()),
    outBlinding: blindings.map(b => b.toString()),
  }
}

// ---------------------------------------------------------------------------
// Pure-JS fallbacks (used in node/test context; WASM versions used in browser)
// ---------------------------------------------------------------------------

/**
 * toFieldElement: reduce a bigint into the BN254 scalar field.
 * Handles negative values (two's complement BN254 encoding) by adding BN254_MOD.
 */
function toFieldElement(v: bigint): bigint {
  const mod = BN254_MOD
  return ((v % mod) + mod) % mod
}

/**
 * Pure-JS nullifier placeholder for the dummy input note.
 * In the browser WASM bridge, compute_nullifier uses Poseidon2.
 * Here we use a deterministic fallback: (privKey * 2^128 + blinding) mod BN254.
 * This MUST be overridden with the WASM Poseidon2 result in the actual proof flow.
 */
function computeNullifierPure(privKey: bigint, blinding: bigint): bigint {
  // Deterministic placeholder: xor of privKey and blinding, mod BN254
  return toFieldElement(privKey + blinding * BigInt('0x100000000'))
}

/**
 * Pure-JS commitment placeholder.
 * In the browser WASM bridge, compute_commitment uses Poseidon2(amount, pubkey, blinding).
 * Here we use a deterministic fallback for the unit test context.
 * The ACTUAL Poseidon2 computation happens via the WASM bridge when the proof is generated.
 */
function computeCommitmentPure(amount: bigint, pubkey: bigint, blinding: bigint): bigint {
  // Deterministic placeholder: (amount + pubkey + blinding) mod BN254
  return toFieldElement(amount + pubkey + blinding)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Decode a 64-char hex string to a 32-byte Uint8Array. */
function hexToBytes32(hex: string): Uint8Array {
  if (hex.length !== 64) {
    throw new Error(`hexToBytes32: expected 64 hex chars, got ${hex.length} ("${hex.slice(0, 8)}…")`)
  }
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/**
 * Generate a cryptographically random BN254 field element as a blinding.
 * Uses globalThis.crypto.getRandomValues (Web Crypto, available in Node 18+ and all browsers).
 */
function generateRandomBlinding(): bigint {
  const buf = new Uint8Array(32)
  globalThis.crypto.getRandomValues(buf)
  // Read as big-endian and reduce mod BN254
  let v = BigInt(0)
  for (const b of buf) {
    v = (v << BigInt(8)) | BigInt(b)
  }
  return v % BN254_MOD
}
