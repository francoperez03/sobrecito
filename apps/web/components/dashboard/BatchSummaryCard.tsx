'use client'

import { DoubleBezel } from '@/components/ui/DoubleBezel'
import { explorerTxUrl } from '@/lib/rpc'

/**
 * BatchSummaryCard — one batch in the payroll timeline.
 *
 * Shows the proven predicate for a single batch: sealed-note count, date, and
 * a real block-explorer link to the batch transaction. No individual amount is
 * ever rendered — only the note count and the total T (public predicate).
 *
 * IMPORTANT: txHash must be the real batch transaction hash from the
 * ScannedEvent, NOT the pool contract ID. (Bug fixed in plan mutable-brewing-dragon.)
 */

export interface BatchSummaryCardProps {
  /** Declared total T (already formatted, e.g. "800 USDC"). */
  total: string
  /**
   * Real batch transaction hash (from ScannedEvent.txHash).
   * Used to build the block-explorer link.
   */
  txHash: string
  /** Ledger sequence the batch committed at. */
  ledgerSeq: number | string
  /** Number of sealed notes in this batch. */
  noteCount?: number
  /** Human date string for the batch (e.g. "ledger 3107053"). */
  dateLabel?: string
}

export function BatchSummaryCard({
  total,
  txHash,
  ledgerSeq,
  noteCount,
  dateLabel,
}: BatchSummaryCardProps) {
  const txUrl = explorerTxUrl(txHash)

  return (
    <DoubleBezel radius="2rem" className="overflow-hidden">
      <div className="px-6 py-5">
        {/* Predicate line — real USDC funded, total proven on-chain. */}
        <p className="font-mono text-sm text-accent-soft">
          {total} funded · total proven on-chain ✓
        </p>

        {/* Note count line */}
        {noteCount !== undefined && (
          <p className="mt-1.5 text-sm text-ink-muted">
            {noteCount} sealed {noteCount === 1 ? 'note' : 'notes'} · amounts sealed
          </p>
        )}

        {/* Batch metadata strip */}
        <div className="mt-4 pt-3 border-t border-white/5 flex flex-col gap-1.5">
          <p className="font-mono text-sm text-ink-muted">
            <span className="uppercase tracking-widest text-xs mr-2">Batch tx</span>
            <a
              href={txUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all underline underline-offset-4 decoration-white/20 hover:text-ink hover:decoration-current transition-colors"
            >
              {txHash.length > 16 ? `${txHash.slice(0, 8)}…${txHash.slice(-8)}` : txHash} ↗
            </a>
          </p>
          <p className="font-mono text-sm text-ink-muted">
            <span className="uppercase tracking-widest text-xs mr-2">Ledger</span>
            {dateLabel ?? ledgerSeq}
          </p>
        </div>
      </div>
    </DoubleBezel>
  )
}
