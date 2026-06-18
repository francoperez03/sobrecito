/**
 * lib/chain/stellar/events.ts — pool event scanning (ChainEventScanner).
 *
 * Wraps the viewkey package's Soroban getEvents scanners, injecting the pool id +
 * RPC + default start ledger from ChainConfig. viewkey stays the Stellar-specific
 * implementation; a different chain would supply its own event source here.
 */

import { scanCommitmentEvents, scanSpentNullifiers } from 'viewkey'
import type { ChainConfig, ChainEventScanner, ScanRange, ScannedEvent } from '../types'

export function createStellarEventScanner(config: ChainConfig): ChainEventScanner {
  const { rpcUrl, poolId, deploymentLedger } = config

  function scanOpts(range?: ScanRange) {
    return {
      rpcUrl,
      poolContractId: poolId,
      fromLedger: range?.fromLedger ?? deploymentLedger,
      ...(range?.toLedger !== undefined ? { toLedger: range.toLedger } : {}),
    }
  }

  return {
    scanCommitments(range?: ScanRange): Promise<ScannedEvent[]> {
      return scanCommitmentEvents(scanOpts(range))
    },
    scanSpentNullifiers(range?: ScanRange): Promise<Set<string>> {
      return scanSpentNullifiers(scanOpts(range))
    },
  }
}
