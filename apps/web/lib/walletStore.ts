'use client'

/**
 * Wallet store — shared Freighter connection state across surfaces.
 *
 * Connection used to be local to each page (PayrollComposer had its own
 * `address`; the employee page connected implicitly inside `claimNote`). That
 * made the navbar unable to show or drive the wallet, and connecting on /pay did
 * not unlock anything on /receive. This external store (subscribe + getSnapshot,
 * same house pattern as `progressStore.ts`) lifts the connection so the global
 * navbar chip and every surface read and drive ONE source of truth.
 *
 * The app stays stateless with respect to Freighter itself: `connect()` always
 * calls the adapter (Freighter is the real source of truth, idempotent per
 * origin); the store only caches the resulting address for the UI.
 */

import { useSyncExternalStore } from 'react'
import { getChainAdapter } from '@/lib/chain'

export interface WalletState {
  address: string | null
  connecting: boolean
  error: string | null
}

// Stable references: getSnapshot must return the same object until a real change,
// and getServerSnapshot must be constant, or useSyncExternalStore loops.
const SERVER_STATE: WalletState = { address: null, connecting: false, error: null }
let state: WalletState = { address: null, connecting: false, error: null }

const listeners = new Set<() => void>()

function setState(patch: Partial<WalletState>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

/**
 * Connect via Freighter (prompts on first grant; idempotent afterwards). Sets the
 * shared address on success or a human message on failure.
 */
export async function connectWallet(): Promise<void> {
  setState({ connecting: true, error: null })
  try {
    const address = await getChainAdapter().wallet.connect()
    setState({ address, connecting: false })
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
    if (address && address !== state.address) setState({ address })
  } catch {
    // not connected / no extension — leave state untouched
  }
}

/**
 * Clear the app's cached connection. Freighter has no programmatic revoke, so
 * this only drops the local view; a later connect re-grants instantly.
 */
export function disconnectWallet(): void {
  setState({ address: null, error: null })
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
