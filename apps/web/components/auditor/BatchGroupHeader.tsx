'use client'

import { formatUsdc, explorerTxUrl } from '@/lib/rpc'

interface BatchGroupHeaderProps {
  ledger: number
  txHash: string
  noteCount: number
  subSum: bigint
}

/**
 * Per-pay-run group header (AUD-02).
 *
 * Identifies the run by its on-chain transaction (linked to Stellar Expert so the
 * auditor can inspect it), with an informational payment count + subtotal. One
 * page-level ReconciliationFooter covers the pool total; this is informational
 * only. The raw ledger number is intentionally not surfaced — the tx link is the
 * auditor-facing anchor.
 */
export function BatchGroupHeader({ txHash, noteCount, subSum }: BatchGroupHeaderProps) {
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

      {/* Right: the batch total is the hero figure of the run — the proven sum the
          per-payment detail reconciles to. The payment count is a quiet caption. */}
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-lg font-[900] tracking-[-0.01em] text-ink tabular-nums leading-none">
          {formatUsdc(subSum)}{' '}
          <span className="text-xs font-[600] text-ink-muted">USDC</span>
        </span>
        <span className="font-mono text-[11px] text-ink-muted/70">· {noteCount} payments</span>
      </div>
    </div>
  )
}
