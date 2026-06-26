/**
 * lib/chain/stellar/wallet.ts — Freighter WalletAdapter.
 *
 * Encapsulates @stellar/freighter-api. Freighter v6 returns errors in the result
 * object rather than throwing, so every call is unwrapped. The network guard
 * asserts testnet (the pool lives on testnet).
 */

import {
  getAddress,
  getNetwork,
  requestAccess,
  signTransaction,
  WatchWalletChanges,
} from '@stellar/freighter-api'
import type { ChainConfig, WalletAdapter } from '../types'

/** Unwrap a Freighter v6 result: either a value field or an `error`. */
function unwrap<T extends Record<string, unknown>>(res: T & { error?: unknown }, what: string): T {
  if (res.error) {
    throw new Error(`Freighter ${what} failed: ${String(res.error)}`)
  }
  return res
}

export function createFreighterWallet(config: ChainConfig): WalletAdapter {
  const expectedNetwork = config.networkId

  async function getNetworkId(): Promise<string> {
    const { networkPassphrase } = unwrap(await getNetwork(), 'getNetwork')
    return networkPassphrase
  }

  async function assertExpectedNetwork(): Promise<void> {
    if ((await getNetworkId()) !== expectedNetwork) {
      throw new Error('Switch Freighter to Testnet to continue.')
    }
  }

  return {
    getNetworkId,
    assertExpectedNetwork,

    async getAddress(): Promise<string> {
      const { address } = unwrap(await getAddress(), 'getAddress')
      if (!address) {
        throw new Error('Freighter returned no address. Unlock the wallet and retry.')
      }
      return address
    },

    async connect(): Promise<string> {
      unwrap(await requestAccess(), 'requestAccess')
      const { address } = unwrap(await getAddress(), 'getAddress')
      if (!address) {
        throw new Error('Freighter returned no address. Unlock the wallet and retry.')
      }
      await assertExpectedNetwork()
      return address
    },

    async signXdr(xdr: string, address: string): Promise<string> {
      const signed = unwrap(
        await signTransaction(xdr, { networkPassphrase: expectedNetwork, address }),
        'signTransaction',
      )
      return signed.signedTxXdr
    },

    watchChanges(cb): () => void {
      // Freighter polls every `timeout` ms and fires the callback only when the
      // active account or network changes (it tracks the current values itself).
      const watcher = new WatchWalletChanges(2000)
      watcher.watch(({ address, networkPassphrase, error }) => {
        if (error) return
        cb({ address: address ?? '', networkPassphrase: networkPassphrase ?? '' })
      })
      return () => watcher.stop()
    },
  }
}
