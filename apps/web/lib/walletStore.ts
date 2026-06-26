'use client'

/**
 * Wallet store — shared Freighter connection + USDC balance across surfaces.
 *
 * Connection used to be local to each page (PayrollComposer had its own
 * `address` + balance; the employee page connected implicitly inside `claimNote`).
 * That made the navbar unable to show or drive the wallet, and connecting on /pay
 * did not unlock anything on /receive. This external store (subscribe +
 * getSnapshot, same house pattern as `progressStore.ts`) lifts the connection AND
 * the USDC balance so the global navbar chip, /pay and /receive read ONE source
 * of truth.
 *
 * The app stays stateless with respect to Freighter itself: `connect()` always
 * calls the adapter (Freighter is the real source of truth, idempotent per
 * origin); the store only caches the resulting address + balance for the UI.
 */

import { useSyncExternalStore } from 'react'
import { getChainAdapter } from '@/lib/chain'
import { fetchUsdcBalance, formatUsdc } from '@/lib/rpc'
import { TESTNET_PASSPHRASE } from '@/lib/chain/stellar/config'

export interface WalletState {
  address: string | null
  connecting: boolean
  error: string | null
  /** Connected wallet's USDC balance, formatted (e.g. "3.0000000"), or null. */
  usdcBalance: string | null
  /** Raw USDC balance in base units (7 decimals), or null — for amount checks. */
  usdcBalanceBase: bigint | null
}

// Stable references: getSnapshot must return the same object until a real change,
// and getServerSnapshot must be constant, or useSyncExternalStore loops.
const SERVER_STATE: WalletState = {
  address: null,
  connecting: false,
  error: null,
  usdcBalance: null,
  usdcBalanceBase: null,
}
let state: WalletState = { ...SERVER_STATE }

const listeners = new Set<() => void>()

function setState(patch: Partial<WalletState>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

/**
 * Fetch the USDC balance for the currently connected address and cache it.
 * Best-effort: failures clear the balance rather than surfacing an error.
 */
export async function refreshBalance(): Promise<void> {
  const addr = state.address
  if (!addr) {
    setState({ usdcBalance: null, usdcBalanceBase: null })
    return
  }
  try {
    const base = await fetchUsdcBalance(addr)
    // Ignore if the address changed while the fetch was in flight.
    if (state.address !== addr) return
    setState({ usdcBalance: formatUsdc(base), usdcBalanceBase: base })
  } catch {
    if (state.address === addr) setState({ usdcBalance: null, usdcBalanceBase: null })
  }
}

/**
 * After an action that changes the balance (e.g. a cash-out crediting USDC to
 * `address`), adopt that address into the store and refetch its balance, polling
 * briefly until the value actually changes. This covers two cases the single
 * refreshBalance() misses: the store not yet knowing the address (the claim flow
 * connected Freighter directly), and the RPC's balance simulation lagging a beat
 * behind the just-closed withdraw ledger.
 */
export async function refreshBalanceFor(address: string, attempts = 4): Promise<void> {
  if (address && address !== state.address) setState({ address, error: null })
  if (!state.address) return
  const before = state.usdcBalanceBase
  for (let i = 0; i < attempts; i++) {
    await refreshBalance()
    if (state.usdcBalanceBase !== before) return // changed → done
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500))
  }
}

/**
 * Connect via Freighter (prompts on first grant; idempotent afterwards). Sets the
 * shared address on success or a human message on failure, then loads the balance.
 */
export async function connectWallet(): Promise<void> {
  setState({ connecting: true, error: null })
  try {
    const address = await getChainAdapter().wallet.connect()
    setState({ address, connecting: false })
    void refreshBalance()
  } catch (err) {
    setState({
      connecting: false,
      error: err instanceof Error ? err.message : 'Could not connect.',
    })
  }
}

/**
 * Silently adopt an already-granted Freighter session without prompting. Safe to
 * call on mount: `getAddress` never shows UI; it throws when access was not
 * granted, which we swallow (the user simply is not connected yet).
 */
export async function refreshWallet(): Promise<void> {
  try {
    const address = await getChainAdapter().wallet.getAddress()
    if (address && address !== state.address) {
      setState({ address })
      void refreshBalance()
    }
  } catch {
    // not connected / no extension — leave state untouched
  }
}

/**
 * Clear the app's cached connection. Freighter has no programmatic revoke, so
 * this only drops the local view; a later connect re-grants instantly.
 */
export function disconnectWallet(): void {
  setState({ address: null, error: null, usdcBalance: null, usdcBalanceBase: null })
}

/**
 * Watch Freighter for the active account/network changing while the app is open.
 * Without this the store keeps showing a STALE account (and its balance) after the
 * user switches accounts in the extension. Returns an unsubscribe.
 *
 *  - account switched → adopt the new address + refetch its balance.
 *  - locked / access revoked (empty address) → drop the connection.
 *  - switched off testnet → surface a guard message.
 */
export function startWalletWatch(): () => void {
  try {
    return getChainAdapter().wallet.watchChanges(({ address, networkPassphrase }) => {
      if (networkPassphrase && networkPassphrase !== TESTNET_PASSPHRASE) {
        setState({ error: 'Switch Freighter to Testnet to continue.' })
        return
      }
      if (!address) {
        if (state.address) disconnectWallet()
        return
      }
      if (address !== state.address) {
        setState({ address, error: null })
        void refreshBalance()
      }
    })
  } catch {
    // No extension / watch unsupported — nothing to clean up.
    return () => {}
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function getSnapshot(): WalletState {
  return state
}

function getServerSnapshot(): WalletState {
  return SERVER_STATE
}

/** Reactive read of the shared wallet state. */
export function useWallet(): WalletState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
