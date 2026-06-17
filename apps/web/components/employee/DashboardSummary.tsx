'use client'

import { motion } from 'motion/react'
import { DoubleBezel } from '@/components/ui/DoubleBezel'
import { formatUsdc } from '@/lib/rpc'

const EASE_BRAND = [0.32, 0.72, 0, 1] as const

interface SummaryNote {
  amount: bigint
  status: 'pending' | 'claimed' | 'unknown'
}

interface DashboardSummaryProps {
  /** All notes belonging to the employee, with their on-chain status. */
  notes: SummaryNote[]
}

/**
 * Dashboard balance header (CAP-3).
 *
 * Shows three figures computed from the note list:
 * - Claimable: sum of pending-note amounts.
 * - Claimed: sum of claimed-note amounts.
 * - Counter: X / N (claimed count out of total).
 *
 * Mirrors the auditor ReconciliationFooter pattern (BigInt reductions +
 * DoubleBezel wrapper). Stable testids allow the plan-04 e2e suite to assert
 * all three figures without querying by text.
 */
export function DashboardSummary({ notes }: DashboardSummaryProps) {
  const sumClaimable = notes
    .filter((n) => n.status === 'pending')
    .reduce((a, n) => a + n.amount, BigInt(0))

  const sumClaimed = notes
    .filter((n) => n.status === 'claimed')
    .reduce((a, n) => a + n.amount, BigInt(0))

  const countDone = notes.filter((n) => n.status === 'claimed').length

  return (
    <DoubleBezel radius="2rem" className="px-6 py-5">
      <motion.div
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, ease: EASE_BRAND, delay: 0.2 }}
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-ink-muted uppercase tracking-widest">Claimable</span>
          <span
            className="font-mono text-2xl text-ink"
            data-testid="summary-claimable"
          >
            {formatUsdc(sumClaimable)} USDC
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-ink-muted uppercase tracking-widest">Claimed</span>
          <span
            className="font-mono text-2xl text-accent-soft"
            data-testid="summary-claimed"
          >
            {formatUsdc(sumClaimed)} USDC
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-ink-muted uppercase tracking-widest">Progress</span>
          <span
            className="font-mono text-2xl text-ink-muted"
            data-testid="summary-counter"
          >
            {countDone} / {notes.length}
          </span>
        </div>
      </motion.div>
    </DoubleBezel>
  )
}
