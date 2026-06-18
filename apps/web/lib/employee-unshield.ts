/**
 * employee-unshield.ts — Freighter-fallback unshield facade over the ChainAdapter.
 *
 * The DEFAULT employee-claim path (RESEARCH D-12 #1): the employee signs the
 * unshield with Freighter and pays their own fee. The pool.transact build/sign/
 * submit logic moved into lib/chain (StellarAdapter writer). This module keeps the
 * NoteMeta contract EmployeeClaimCard depends on and maps it to a WithdrawArgs.
 *
 * Preserves A1 (unlinkability): the note key lives only in the claim link, the
 * employee picks a fresh recipient + the moment to claim. The withdraw IS the
 * single point an individual amount becomes public on-chain (amber-warned).
 */
'use client'

import { getChainAdapter } from './chain'

/**
 * Note metadata decoded from the claim link token. A bearer credential: never
 * persisted server-side, never logged.
 */
export interface NoteMeta {
  /** The pool (Soroban contract C…) holding the shielded note. */
  poolContractId: string
  /** Commitment leaf index of the note being unshielded. */
  commitmentIndex: number
  /** The note's shielded amount (revealed after claim). */
  amount: string
  /** X25519 note private key (hex) — opens the employee half of the dual blob. */
  notePrivkeyHex: string
  /** Note blinding factor (decimal string) bound into the commitment. */
  blinding: string
  /** Pre-generated withdrawal proof (base64 chain-native) embedded by `sobre pay`. */
  withdrawProofXdr?: string
  /** Pre-generated ext_data (base64 chain-native) embedded by `sobre pay`. */
  withdrawExtDataXdr?: string
}

export interface UnshieldResult {
  /** The submitted transaction hash. */
  hash: string
  /** The recipient address the employee chose (their Freighter account). */
  recipient: string
}

/**
 * Build, sign (Freighter), and submit the unshield (pool withdraw) for one note.
 * Returns the tx hash. The employee pays their own fee.
 */
export function unshieldNote(noteMeta: NoteMeta): Promise<UnshieldResult> {
  return getChainAdapter().writer.withdraw({
    poolId: noteMeta.poolContractId,
    commitmentIndex: noteMeta.commitmentIndex,
    amount: noteMeta.amount,
    proofXdr: noteMeta.withdrawProofXdr,
    extDataXdr: noteMeta.withdrawExtDataXdr,
  })
}
