/**
 * lib/chain/index.ts — the chain adapter entry point.
 *
 * `getChainAdapter()` returns the singleton ChainAdapter for the app. Today it is
 * the StellarAdapter; swapping chains means returning a different implementation
 * here (e.g. selected by an env var) with zero changes in the domain or UI.
 *
 * All chain-agnostic types are re-exported so domain code imports them from a
 * single place: `import { type DepositArgs, getChainAdapter } from '@/lib/chain'`.
 */

import type { ChainAdapter } from './types'
import { createStellarAdapter } from './stellar/adapter'

export * from './types'

let adapter: ChainAdapter | null = null

/** Resolve the active ChainAdapter (singleton). */
export function getChainAdapter(): ChainAdapter {
  if (!adapter) {
    adapter = createStellarAdapter()
  }
  return adapter
}
