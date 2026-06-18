/**
 * lib/chain/stellar/adapter.ts — assemble the StellarAdapter.
 *
 * Wires the Stellar implementations of every chain seam (config, reader, wallet,
 * writer, events, encoding) into one ChainAdapter. The writer is given the wallet
 * so it can sign internally.
 */

import type { ChainAdapter } from '../types'
import { explorerTxUrl, stellarConfig } from './config'
import { hashExtData } from './encoding'
import { createStellarReader } from './reader'
import { createFreighterWallet } from './wallet'
import { createStellarWriter } from './writer'
import { createStellarEventScanner } from './events'

export function createStellarAdapter(): ChainAdapter {
  const config = stellarConfig()
  const wallet = createFreighterWallet(config)
  const reader = createStellarReader(config)
  const writer = createStellarWriter(config, wallet)
  const events = createStellarEventScanner(config)

  return {
    config,
    wallet,
    reader,
    writer,
    events,
    encoding: { hashExtData },
    explorerTxUrl,
  }
}
