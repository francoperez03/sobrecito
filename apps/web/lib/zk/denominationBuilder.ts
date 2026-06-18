/**
 * denominationBuilder.ts — greedy {1,10,100} USDC denomination decomposition.
 *
 * Turns a list of employee salary rows into a fixed-length (8) array of
 * denomination notes for the pool.transact circuit (policy_tx_1_8).
 * Notes of equal denomination are indistinguishable on-chain, which raises the
 * anonymity set on the deposit side (D2 / T-06.2-07).
 *
 * BigInt literals use BigInt() calls, not 0n/1n syntax, for ES2017 compat.
 *
 * Denomination constants (DENOMS) are exported in USDC base units (7 decimals)
 * so callers can compare them against note.denomination directly.
 */

import { USDC_SCALE } from '../csvParser'
import { BN254_FIELD_MODULUS } from 'viewkey'

/** Maximum number of output notes the circuit supports (policy_tx_1_8). */
export const MAX_NOTES = 8

/**
 * Supported note denominations in USDC base units (7 decimals), largest first.
 * Exported in base units so callers can compare against DenomNote.denomination.
 */
export const DENOMS: readonly bigint[] = [
  BigInt(100) * USDC_SCALE,
  BigInt(10) * USDC_SCALE,
  BigInt(1) * USDC_SCALE,
]

/**
 * Count how many {100,10,1} USDC notes an amount decomposes into, UNCAPPED.
 * Used to surface the true batch size for the 8-note budget from the amount
 * alone (no pubkey needed), even when the amount already exceeds the budget
 * (decompose() returns null in that case and would otherwise hide the count).
 */
export function countNotes(amountUsdc: bigint): number {
  let remaining = amountUsdc
  let count = 0
  for (const denomBase of DENOMS) {
    while (remaining >= denomBase) {
      count += 1
      remaining -= denomBase
    }
  }
  return count
}

/** One denomination note ready to be committed on-chain. */
export interface DenomNote {
  /** Note value in USDC base units (7 decimals). 0 for zero-amount padding dummies. */
  denomination: bigint
  /** X25519 employee public key as 64 hex chars. Empty string for dummies. */
  recipientPubkeyHex: string
  /** Display-only employee name. Never reaches a shell. */
  employeeName: string
  /**
   * BN254 pubkey used as the circuit output key for this note.
   *
   * New payroll runs (06.3 onward) use the seed-derived bn254Pub (= Poseidon2(bn254Priv, 0),
   * domain 0x03), so the withdraw proof of 06.3 can verify against the circuit's Keypair()
   * template. Pass bn254Pub from deriveEmployeeKeys() via the row's optional bn254Pub field.
   *
   * Legacy rows (06.2 and earlier, deposited with pubkeyToBn254) use the fallback path.
   * Those notes are deposit-only and cannot be withdrawn live (per CONTEXT.md Option B).
   */
  outPubkey: bigint
}

/**
 * Convert a 64-char hex X25519 public key to a BN254 scalar.
 *
 * DEMO-GRADE: interprets 32 bytes little-endian → bigint, reduced mod BN254.
 * See DenomNote.outPubkey doc comment for the production caveat.
 */
export function pubkeyToBn254(hex: string): bigint {
  // Interpret 32 bytes as little-endian scalar
  let scalar = BigInt(0)
  for (let i = 31; i >= 0; i--) {
    scalar = (scalar << BigInt(8)) | BigInt(parseInt(hex.slice(i * 2, i * 2 + 2), 16))
  }
  return scalar % BN254_FIELD_MODULUS
}

/**
 * Decompose a list of salary rows into exactly 8 denomination notes
 * using a greedy largest-first algorithm over {100, 10, 1} USDC.
 *
 * Returns null when:
 *   - Any salary amount is not a multiple of 1 USDC (non-decomposable residual)
 *   - Total note count across all employees exceeds MAX_NOTES (8)
 *
 * When non-null, the returned array always has exactly 8 entries; slots beyond
 * the real notes are zero-amount dummies:
 *   { denomination: 0, recipientPubkeyHex: '00'.repeat(32), employeeName: '', outPubkey: 0 }
 *
 * Row shape: name, amountUsdc, pubkeyHex are required.
 * bn254Pub is optional. When present (seed-derived via deriveEmployeeKeys, = Poseidon2(bn254Priv, 0)),
 * it is used as the circuit outPubkey so the withdraw proof can verify. When absent,
 * the legacy pubkeyToBn254 fallback applies (deposit-only, not withdrawable live).
 */
export function decompose(
  rows: { name: string; amountUsdc: bigint; pubkeyHex: string; bn254Pub?: bigint }[],
): DenomNote[] | null {
  const notes: DenomNote[] = []
  const outPubkey0 = pubkeyToBn254('00'.repeat(32))

  for (const row of rows) {
    let remaining = row.amountUsdc
    // Prefer the seed-derived bn254Pub (= Poseidon2(bn254Priv, 0)) when the caller
    // supplies it. This aligns the circuit outPubkey with the Keypair() template so
    // the withdraw proof can verify. The legacy pubkeyToBn254 fallback is for rows
    // that pre-date 06.3 and are deposit-only (per CONTEXT.md Option B).
    const outPubkey = row.bn254Pub !== undefined ? row.bn254Pub : pubkeyToBn254(row.pubkeyHex)
    for (const denomBase of DENOMS) {
      while (remaining >= denomBase) {
        notes.push({
          denomination: denomBase,
          recipientPubkeyHex: row.pubkeyHex,
          employeeName: row.name,
          outPubkey,
        })
        remaining -= denomBase
      }
    }
    if (remaining > BigInt(0)) return null // amount not decomposable into {1,10,100}
  }

  if (notes.length > MAX_NOTES) return null

  // Pad to exactly 8 notes with zero-amount dummies
  const dummy: DenomNote = {
    denomination: BigInt(0),
    recipientPubkeyHex: '00'.repeat(32),
    employeeName: '',
    outPubkey: outPubkey0,
  }
  while (notes.length < MAX_NOTES) {
    notes.push(dummy)
  }

  return notes
}
