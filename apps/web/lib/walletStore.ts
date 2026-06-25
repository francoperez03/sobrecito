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
