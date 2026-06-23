/**
 * depositTransactionBuilder.ts — 1→8 deposit witness assembly for sobre_slim (Noir ABI).
 *
 * Two exports (chain-agnostic domain logic — the ext_data_hash encoding moved to
 * lib/chain/stellar/encoding.ts, reached via getChainAdapter().encoding.hashExtData):
 *   buildFrozenBlobs   — generate one blinding per note, encrypt each note payload
 *                        to BOTH the employee AND the auditor pubkey (dual ECIES),
 *                        and return the 8 frozen blobs + 8 blindings in one call.
 *                        SINGLE CALL SITE: blobs frozen once, never regenerated.
 *                        The same blindings MUST flow into buildDepositInputs so the
 *                        output commitments match the encrypted note contents (Pitfall 2).
 *   buildDepositInputs — assemble the full witness input object for the Noir prover
 *                        (1 dummy in, 8 real out) using the pool-aligned Poseidon2
 *                        from poseidon2Pool.ts. Returns the exact sobre_slim Noir ABI
 *                        with snake_case keys and NO ASP fields.
 *
 * Noir ABI (sobre_slim/src/main.nr):
 *   Public (12 flat scalar strings):
 *     root, public_amount, ext_data_hash, input_nullifier,
 *     output_commitment_0..output_commitment_7
 *   Private:
 *     in_amount: string           (scalar, '0' for dummy deposit)
 *     in_private_key: string      (scalar, DUMMY_PRIVKEY=424242)
 *     in_blinding: string         (scalar)
 *     in_path_indices: string     (scalar bitmask)
 *     in_path_elements: string[10] (flat, not nested)
 *     in_path_bits: string[10]    (bit-decomposition of in_path_indices)
 *     out_amount: string[8]
 *     out_pub_key: string[8]
 *     out_blinding: string[8]
 *
 * ES2017 only: BigInt() calls, never 0n/1n/…617n literals.
 * No default export — callers import named functions.
 */

import { encryptNote, buildEncryptedOutputs, BN254_FIELD_MODULUS } from 'viewkey'
import type { DenomNote } from './denominationBuilder'
import { hash1WithSep, hash3WithSep } from './poseidon2Pool'

// ---------------------------------------------------------------------------
// BN254 constants (ES2017: no BigInt literals, use BigInt() constructor)
// ---------------------------------------------------------------------------
const BN254_MOD = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617')

// The employer (deposit) private key. For sobre_slim (Noir ABI, D2 scope): the
// ASP policy checks are intentionally dropped. The deposit uses in_amount=0 (dummy
// input), so the Merkle membership check is skipped by the circuit (main.nr:81-84).
// DUMMY_PRIVKEY=424242 is aligned with the Rust payroll-proof-gen reference.
const DUMMY_PRIVKEY = BigInt(424242)

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

  // Convert auditor pubkey hex to bytes.
  // Zero-key guard: if auditorPubkeyHex is all zeros (placeholder from deployments.json
  // before the Phase 06.1 keygen fills in the real value), generate a random valid
  // X25519 key. Dual-blob encryption still works; the auditor simply cannot decrypt
  // until the real key is configured.
  let resolvedAuditorHex = auditorPubkeyHex
  if (/^0+$/.test(auditorPubkeyHex)) {
    const randBytes = new Uint8Array(32)
    globalThis.crypto.getRandomValues(randBytes)
    randBytes[0] = randBytes[0] || 0xab
    resolvedAuditorHex = Array.from(randBytes).map(b => b.toString(16).padStart(2, '0')).join('')
  }
  const auditorPubkeyBytes = hexToBytes32(resolvedAuditorHex)

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
// buildDepositInputs — Noir ABI witness for sobre_slim (1 dummy in, 8 real out)
// ---------------------------------------------------------------------------

/**
 * Inputs to buildDepositInputs (Noir ABI shape — no ASP fields).
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
  senderAddress: string
  dummyBlinding: bigint
}

/**
 * Return type of buildDepositInputs: the exact sobre_slim Noir ABI witness.
 *
 * Public inputs (12 flat scalar strings — bb 0.87 returns them as 12 fields):
 *   root, public_amount, ext_data_hash, input_nullifier, output_commitment_0..7
 * Private inputs:
 *   in_amount, in_private_key, in_blinding, in_path_indices (scalar strings)
 *   in_path_elements (string[10] flat), in_path_bits (string[10] bit-decomposed)
 *   out_amount, out_pub_key, out_blinding (string[8])
 */
export interface DepositWitness {
  // Public
  root: string
  public_amount: string
  ext_data_hash: string
  input_nullifier: string
  output_commitment_0: string
  output_commitment_1: string
  output_commitment_2: string
  output_commitment_3: string
  output_commitment_4: string
  output_commitment_5: string
  output_commitment_6: string
  output_commitment_7: string
  // Private
  in_amount: string
  in_private_key: string
  in_blinding: string
  in_path_indices: string
  in_path_elements: string[]
  in_path_bits: string[]
  out_amount: string[]
  out_pub_key: string[]
  out_blinding: string[]
}

/**
 * Assemble the witness input object for the sobre_slim Noir prover.
 *
 * Circuit shape: 1 dummy input → 8 real outputs.
 *   - in_amount='0' disables the Merkle membership check (deposit path, main.nr:81-84).
 *   - DUMMY_PRIVKEY=424242 as in_private_key for the dummy input.
 *   - dummyBlinding: fresh per run (prevents AlreadySpentNullifier on the dummy nullifier).
 *   - public_amount: sum of all 8 output note denominations (as field element).
 *   - output_commitment_i: hash3WithSep(denomination, outPubKey, blindings[i], 1).
 *   - input_nullifier: the circuit hash chain for in_amount=0:
 *       pub_key = hash1WithSep(DUMMY_PRIVKEY, 3n)
 *       in_commitment = hash3WithSep(0n, pub_key, dummyBlinding, 1n)
 *       sig = hash3WithSep(DUMMY_PRIVKEY, in_commitment, 0n, 4n)
 *       input_nullifier = hash3WithSep(in_commitment, 0n, sig, 2n)
 *
 * All values are returned as decimal strings (the witness generator expects strings).
 * No ASP fields — D2 scope, sobre_slim intentionally drops the allowlist proofs.
 */
export function buildDepositInputs(params: DepositInputsParams): DepositWitness {
  const {
    notes, blindings, extDataHash, poolRoot, dummyBlinding,
  } = params

  if (notes.length !== 8) {
    throw new Error(`buildDepositInputs: expected exactly 8 notes, got ${notes.length}`)
  }
  if (blindings.length !== 8) {
    throw new Error(`buildDepositInputs: expected exactly 8 blindings, got ${blindings.length}`)
  }

  // public_amount = sum of denominations, reduced as a BN254 field element
  const extAmount = notes.reduce((s, n) => s + n.denomination, BigInt(0))
  const public_amount = toFieldElement(extAmount).toString()

  // Dummy input nullifier via the circuit's exact hash chain (main.nr:64-74):
  //   pub_key = hash1WithSep(DUMMY_PRIVKEY, 3n)
  //   in_commitment = hash3WithSep(0n, pub_key, dummyBlinding, 1n)
  //   sig = hash3WithSep(DUMMY_PRIVKEY, in_commitment, 0n, 4n)
  //   input_nullifier = hash3WithSep(in_commitment, 0n, sig, 2n)
  // in_path_indices=0 for the deposit dummy input (Merkle check skipped).
  const pub_key = hash1WithSep(DUMMY_PRIVKEY, BigInt(3))
  const in_commitment = hash3WithSep(BigInt(0), pub_key, dummyBlinding, BigInt(1))
  const sig = hash3WithSep(DUMMY_PRIVKEY, in_commitment, BigInt(0), BigInt(4))
  const input_nullifier = hash3WithSep(in_commitment, BigInt(0), sig, BigInt(2)).toString()

  // Output commitments: hash3WithSep(denomination, outPubKey, blinding, 1) (main.nr:93)
  const outputCommitments = notes.map((n, i) =>
    hash3WithSep(n.denomination, n.outPubkey, blindings[i], BigInt(1)).toString(),
  )

  // in_path_bits: bit-decomposition of in_path_indices (0 for deposit).
  // For dummy deposit, all bits are '0'.
  const in_path_bits = Array(10).fill('0')

  return {
    // 12 public inputs (flat scalar strings)
    root: poolRoot,
    public_amount,
    ext_data_hash: extDataHash.toString(),
    input_nullifier,
    output_commitment_0: outputCommitments[0],
    output_commitment_1: outputCommitments[1],
    output_commitment_2: outputCommitments[2],
    output_commitment_3: outputCommitments[3],
    output_commitment_4: outputCommitments[4],
    output_commitment_5: outputCommitments[5],
    output_commitment_6: outputCommitments[6],
    output_commitment_7: outputCommitments[7],
    // Private inputs (scalar strings)
    in_amount: '0',
    in_private_key: DUMMY_PRIVKEY.toString(),
    in_blinding: dummyBlinding.toString(),
    in_path_indices: '0',
    in_path_elements: Array(10).fill('0'),
    in_path_bits,
    // 8 output notes
    out_amount: notes.map(n => n.denomination.toString()),
    out_pub_key: notes.map(n => n.outPubkey.toString()),
    out_blinding: blindings.map(b => b.toString()),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * toFieldElement: reduce a bigint into the BN254 scalar field.
 * Handles negative values (two's complement BN254 encoding) by adding BN254_MOD.
 */
function toFieldElement(v: bigint): bigint {
  const mod = BN254_MOD
  return ((v % mod) + mod) % mod
}

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

// Suppress unused import warning — BN254_FIELD_MODULUS is imported for
// any callers that may have previously relied on this re-export.
void BN254_FIELD_MODULUS
