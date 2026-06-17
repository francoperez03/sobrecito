/**
 * withdrawTransactionBuilder.test.ts
 * Scaffold from 06.3-01 Wave 0. Plans 02/03/04 implement these.
 *
 * This file reserves the CAP grep strings for the withdraw transaction builder
 * unit tests. Plan 04 (claim wiring) implements the buildWithdrawInputs helper
 * and the Freighter submit flow; plan 02 provides the Merkle path reconstruction
 * helper that feeds into it.
 */
import { describe, it } from 'vitest'

describe('buildWithdrawInputs', () => {
  it.todo('builds a valid N-to-1 withdraw input shape for policy_tx_1_8')
  it.todo('sets public_amount to -denomination (negative, field-reduced)')
  it.todo('uses bn254Priv to compute the nullifier via computeNullifier')
  it.todo('includes a reconstructed Merkle path in pathElements / pathIndices')
  it.todo('throws when the note is already spent (nullifier status = spent)')
})

describe('buildWithdrawTx (Soroban XDR builder)', () => {
  it.todo('encodes the pool.transact call with the proof and ExtData for withdraw')
  it.todo('sets ext_amount = -denomination in the ExtData')
  it.todo('sets recipient to the Freighter account address')
})

describe('withdrawal flow integration', () => {
  it.todo('claim stepper: full prove + submit round-trip with mock Freighter')
  it.todo('shows receipt with txHash + explorer link after successful submit')
  it.todo('edge states: tx rejected by pool (already spent note)')
  it.todo('disclosure: amber banner shown before CTA with linkability warning')
})
