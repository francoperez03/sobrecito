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
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-6 pb-2">
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
      <span className="font-mono text-xs text-ink-muted">
        {noteCount} payments · subtotal {formatUsdc(subSum)} USDC
      </span>
    </div>
  )
}
