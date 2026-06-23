'use client'

import { Check } from '@phosphor-icons/react'
import { formatUsdc, explorerTxUrl } from '@/lib/rpc'

interface BatchGroupHeaderProps {
  ledger: number
  txHash: string
  /** Real recipients in the run (notes with a non-zero amount). */
  paymentCount: number
  /** Zero-value padding notes (anonymity-set fillers), shown as a quiet aside. */
  paddingCount: number
  subSum: bigint
}

/**
 * Per-pay-run group header (AUD-02).
 *
 * Identifies the run by its on-chain transaction (linked to Stellar Expert), with
 * the proven batch total as the hero figure and a single batch-level "verified"
 * mark — the ZK proof attests the whole run, so a per-row badge is redundant. The
 * count reports REAL recipients; zero-value padding is a muted aside, never folded
 * into "N payments" (that overstated who actually got paid).
 */
export function BatchGroupHeader({
  txHash,
  paymentCount,
  paddingCount,
  subSum,
}: BatchGroupHeaderProps) {
  const tx = txHash ?? ''
  const shortTx = tx.length > 16 ? tx.slice(0, 8) + '…' + tx.slice(-6) : tx

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-6 pb-2">
      {/* Left: run identity (label + tx link), kept small and secondary. */}
      <div className="flex items-baseline gap-3 min-w-0">
        <h3 className="text-sm font-[900] tracking-[-0.01em]">Pay run</h3>
        {tx ? (
          <a
            href={explorerTxUrl(tx)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-ink-muted hover:text-accent-soft transition-colors"
            title={txHash}
            data-testid="batch-txhash"
          >
            {shortTx} ↗
          </a>
        ) : (
          <span className="font-mono text-xs text-ink-muted/40" data-testid="batch-txhash">
            —
          </span>
        )}
      </div>

      {/* Right: the proven batch total is the hero figure, with a batch-level
          verified mark and a recipient-count caption (padding kept as an aside). */}
      <div className="flex items-baseline gap-2.5">
        <span className="inline-flex items-center gap-1 text-[11px] text-accent-soft self-center">
          <Check size={12} weight="bold" aria-hidden />
          verified
        </span>
        <span className="font-mono text-lg font-[900] tracking-[-0.01em] text-ink tabular-nums leading-none">
          {formatUsdc(subSum)}{' '}
          <span className="text-xs font-[600] text-ink-muted">USDC</span>
        </span>
        <span className="font-mono text-[11px] text-ink-muted/70">
          · {paymentCount} {paymentCount === 1 ? 'payment' : 'payments'}
          {paddingCount > 0 && ` · +${paddingCount} padding`}
        </span>
      </div>
    </div>
  )
}
