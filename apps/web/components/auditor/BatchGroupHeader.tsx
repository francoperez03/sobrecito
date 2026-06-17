'use client'

import { formatUsdc } from '@/lib/rpc'

interface BatchGroupHeaderProps {
  ledger: number
  txHash: string
  noteCount: number
  subSum: bigint
}

/**
 * Per-batch group header (AUD-02).
 *
 * Shows the ledger number as the batch identifier, the transaction hash as a
 * display label (truncated for readability, full hash in title attribute), and
 * an informational note count + sub-sum. One page-level ReconciliationFooter
 * covers the pool total; this is informational only.
 */
export function BatchGroupHeader({ ledger, txHash, noteCount, subSum }: BatchGroupHeaderProps) {
  const tx = txHash ?? ''
  const shortTx = tx.length > 16 ? tx.slice(0, 8) + '...' + tx.slice(-8) : tx

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-6 pb-2">
      <h3 className="text-sm font-[900] tracking-[-0.01em]">Batch · ledger {ledger}</h3>
      <span
        className="font-mono text-xs text-ink-muted"
        title={txHash}
        data-testid="batch-txhash"
      >
        tx {shortTx}
      </span>
      <span className="font-mono text-xs text-ink-muted">
        {noteCount} notes · sub-sum {formatUsdc(subSum)} USDC
      </span>
    </div>
  )
}
