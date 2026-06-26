'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import {
  useWallet,
  connectWallet,
  disconnectWallet,
  refreshWallet,
  startWalletWatch,
} from '@/lib/walletStore'

/**
 * Global wallet chip, pinned top-right (symmetric to the demo-progress panel
 * top-left). It is the single connect/disconnect control, out of the page flow.
 * Every surface reads the same shared state (lib/walletStore), so connecting here
 * unlocks /pay's form and satisfies /receive's cash-out without an in-flow button.
 *
 * Shown only on the surfaces that actually use Freighter (/pay and /receive). The
 * auditor surface is view-key only — no wallet — so the chip stays hidden there.
 */
const WALLET_ROUTES = ['/pay', '/receive']

export function WalletConnect() {
  const { address, connecting, error } = useWallet()
  const pathname = usePathname() ?? '/'
  const onWalletRoute = WALLET_ROUTES.some((r) => pathname.startsWith(r))

  // Adopt an already-granted Freighter session on mount (no prompt), then watch
  // for the user switching accounts / locking the extension so the app never shows
  // a stale account or its balance.
  useEffect(() => {
    if (!onWalletRoute) return
    void refreshWallet()
    const stop = startWalletWatch()
    return stop
  }, [onWalletRoute])

  if (!onWalletRoute) return null

  const display = address ? `${address.slice(0, 4)}…${address.slice(-4)}` : null

  return (
    <div className="fixed right-4 top-6 z-30 flex flex-col items-end gap-1">
      {address ? (
        <div className="inline-flex items-center h-10 pl-3.5 pr-1.5 gap-2.5 rounded-full bg-surface/90 ring-1 ring-hairline backdrop-blur-md">
          <span
            aria-hidden
            className="size-1.5 rounded-full bg-accent-soft shadow-[0_0_6px] shadow-accent-soft/60"
          />
          <span className="font-mono text-xs text-ink" title={address}>
            {display}
          </span>
          <span aria-hidden className="h-4 w-px bg-white/10" />
          <button
            type="button"
            onClick={disconnectWallet}
            title="Disconnect wallet"
            className="h-7 px-2.5 rounded-full text-xs text-ink-muted hover:text-ink hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={connectWallet}
          disabled={connecting}
          className="inline-flex items-center h-10 px-4 rounded-full bg-accent-fill text-white font-[900] text-sm hover:opacity-90 active:scale-[0.98] transition-all backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-70"
        >
          {connecting ? 'Connecting…' : 'Connect wallet'}
        </button>
      )}
      {error && (
        <p className="max-w-[14rem] text-right text-xs text-accent-warm">{error}</p>
      )}
    </div>
  )
}
