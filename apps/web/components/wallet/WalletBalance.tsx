'use client'

import { useWallet } from '@/lib/walletStore'

/**
 * Prominent USDC balance for the connected wallet, read from the shared store.
 * Used on /pay (in place of the old connect/address/disconnect chip) and on
 * /receive (between the intro and the access-key card). Connect/disconnect live
 * in the global navbar chip; this is balance only.
 *
 * Renders nothing when no wallet is linked.
 */
export function WalletBalance({ className }: { className?: string }) {
  const { address, usdcBalance } = useWallet()
  if (!address) return null

  // Trim formatUsdc's trailing zeros: "3.0000000" → "3", "2.5000000" → "2.5".
  const label =
    usdcBalance === null ? '…' : usdcBalance.replace(/\.?0+$/, '') || '0'
  const isZero = label === '0'

  return (
    <div className={`flex flex-col gap-1 self-start ${className ?? ''}`}>
      <span className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-ink-muted">
        USDC balance
      </span>
      <span
        className={`font-mono tabular-nums text-4xl font-[500] leading-none ${
          isZero ? 'text-accent-warm' : 'text-ink'
        }`}
        title="USDC available"
      >
        {label}
        <span
          className={`ml-2 text-xl ${isZero ? 'text-accent-warm/70' : 'text-ink-muted'}`}
        >
          USDC
        </span>
      </span>
    </div>
  )
}
