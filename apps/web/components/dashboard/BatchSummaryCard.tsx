'use client'

import { DoubleBezel } from '@/components/ui/DoubleBezel'

/**
 * BatchSummaryCard — the predicate footer made a standalone card.
 *
 * Shows the on-chain-verified predicate `sum(payments) = T USDC · verified
 * on-chain ✓`, the batch tx hash, and the ledger sequence. No individual
 * amount is ever rendered: only the total T (the public predicate) appears.
 * Mirrors the Centerpiece.tsx predicate footer (lines 48-58) exactly: font-mono
 * text-sm text-accent-soft, with the ✓ and total T in text-accent-soft.
 */

export interface BatchSummaryCardProps {
  /** Declared total T (already formatted, e.g. "800 USDC"). */
  total: string
  /** Batch transaction hash. */
  txHash: string
  /** Ledger sequence the batch committed at. */
  ledgerSeq: number | string
}

export function BatchSummaryCard({
  total,
  txHash,
  ledgerSeq,
}: BatchSummaryCardProps) {
  return (
    <DoubleBezel radius="2rem" className="overflow-hidden">
      <div className="px-6 py-5">
        {/* Predicate line — the public claim, verified on-chain. */}
        <p className="font-mono text-sm text-accent-soft">
          sum(payments) = {total} · verified on-chain ✓
        </p>

        {/* Batch metadata strip — tx hash + ledger, mirrors the predicate
            footer pattern. */}
        <div className="mt-4 pt-3 border-t border-white/5 flex flex-col gap-1.5">
          <p className="font-mono text-sm text-ink-muted break-all">
            <span className="uppercase tracking-widest text-xs mr-2">
              Batch tx
            </span>
            {txHash}
          </p>
          <p className="font-mono text-sm text-ink-muted">
            <span className="uppercase tracking-widest text-xs mr-2">Ledger</span>
            {ledgerSeq}
          </p>
        </div>
      </div>
    </DoubleBezel>
  )
}
