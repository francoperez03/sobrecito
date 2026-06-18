/**
 * employer-deposit.ts — employer pay-batch facade over the ChainAdapter.
 *
 * The Freighter connect + pool.transact build/sign/submit logic moved into
 * lib/chain (StellarAdapter writer + wallet). This module keeps the names
 * PayrollComposer imports (connectFreighter, submitDeposit) and delegates.
 *
 * DEMO NOTE (MEMORY testnet-usdc-cap-1.md): pass totalBaseUnits to move real USDC
 * (testnet cap 1 USDC), or BigInt(0) for the field-only PoC.
 */
'use client'

import { getChainAdapter } from './chain'
import type { DepositArgs, DepositResult, ProofPublicInputs } from './chain'

export type { ProofPublicInputs, DepositResult }
/** Historical name for the deposit arguments (= DepositArgs). */
export type DepositParams = DepositArgs

/**
 * Connect to Freighter and return the employer's Stellar address.
 * Guards: installed, unlocked, on testnet. Throws a user-friendly message.
 */
export function connectFreighter(): Promise<string> {
  return getChainAdapter().wallet.connect()
}

/**
 * Build, sign (Freighter), and submit the employer deposit (pool.transact).
 * The caller generates the proof + frozen blobs BEFORE calling this.
 */
export function submitDeposit(params: DepositParams): Promise<DepositResult> {
  return getChainAdapter().writer.deposit(params)
}
