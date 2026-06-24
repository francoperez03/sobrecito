'use client'

import { useState } from 'react'
import { motion, MotionConfig } from 'motion/react'
import { LockSimple } from '@phosphor-icons/react'
import { DoubleBezel } from '@/components/ui/DoubleBezel'
import { PillToggle } from '@/components/ui/PillToggle'
import { DEMO_ROWS, PREDICATE_LABEL, type DemoRow } from '@/lib/demo-data'

type ViewMode = 'public' | 'auditor'

const EASE_BRAND = [0.32, 0.72, 0, 1] as const

export function Centerpiece() {
  const [view, setView] = useState<ViewMode>('public')
  const isAuditor = view === 'auditor'

  return (
    <MotionConfig reducedMotion="user">
      <div data-testid="centerpiece" className="w-full max-w-3xl mx-auto">
        <DoubleBezel radius="2rem" className="overflow-hidden">
          {/* Header row */}
          <div className="flex items-center justify-between px-6 pt-5 pb-3">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
              {isAuditor ? 'Auditor view' : 'Public view'}
            </p>
            <PillToggle value={view} onChange={setView} />
          </div>

          {/* Table header */}
          <div className="grid grid-cols-[1fr_1fr_auto] gap-4 px-6 pb-2 border-b border-hairline">
            <span className="text-xs text-ink-muted uppercase tracking-widest">Employee</span>
            <span className="text-xs text-ink-muted uppercase tracking-widest">Amount</span>
            <span className="text-xs text-ink-muted uppercase tracking-widest">Status</span>
          </div>

          {/* Table rows */}
          <div className="px-6 py-2">
            {DEMO_ROWS.map((row, i) => (
              <TableRow
                key={row.employee}
                row={row}
                revealed={isAuditor}
                delay={i * 0.06}
              />
            ))}
          </div>

          {/* Predicate footer */}
          <div className="px-6 pb-5 pt-3 border-t border-hairline">
            <p className="font-mono text-sm text-accent-soft tabular-nums">
              {PREDICATE_LABEL} ✓
            </p>
            {isAuditor ? (
              <p className="mt-1 text-xs text-ink-muted">
                Reconstructed from the view-key — amounts keyed by employee pubkey, never a name.
              </p>
            ) : (
              <p className="mt-1 text-xs text-ink-muted">
                Amounts and headcount stay sealed: padding hides who got paid, and how many.
              </p>
            )}
          </div>
        </DoubleBezel>
      </div>
    </MotionConfig>
  )
}

function TableRow({
  row,
  revealed,
  delay,
}: {
  row: DemoRow
  revealed: boolean
  delay: number
}) {
  return (
    <div className="grid grid-cols-[1fr_1fr_auto] gap-4 py-3 border-b border-hairline last:border-0">
      {/* Employee column */}
      <span className="self-center">
        {revealed ? (
          <span className="font-mono text-sm text-ink">{row.employee}</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-ink-muted">
            <LockSimple size={13} weight="bold" />
            <span className="font-mono text-xs uppercase tracking-[0.12em]">Sealed</span>
          </span>
        )}
      </span>

      {/* Amount column */}
      <div className="relative overflow-hidden h-5 self-center">
        {/* Bar — public state. data-testid="amount-bar" for test selectors.
            scaleX animates from 1→0 when revealed (origin: right, bar slides away).
            Bar is always in the DOM so SSR renders it visible (Pitfall 6 guard). */}
        <motion.div
          data-testid="amount-bar"
          className="absolute inset-0 rounded bg-ink/25 overflow-hidden"
          animate={{ scaleX: revealed ? 0 : 1 }}
          initial={{ scaleX: 1 }}
          transition={{ duration: 0.6, ease: EASE_BRAND, delay }}
          style={{ transformOrigin: 'right' }}
        >
          {/* Periodic shimmer sweep — signals "sealed/redacted" while shielded */}
          {!revealed && (
            <motion.div
              aria-hidden
              className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent"
              initial={{ x: '-130%' }}
              animate={{ x: '430%' }}
              transition={{
                duration: 1.3,
                ease: 'easeInOut',
                repeat: Infinity,
                repeatDelay: 2.4,
                delay: delay + 0.6,
              }}
            />
          )}
        </motion.div>

        {/* Amount — only rendered in auditor state.
            Conditional render ensures `getByText('$34,200').not.toBeVisible()` passes
            in public state even in reduced-motion mode (no motion opacity to rely on).
            The motion entrance animates from opacity-0 when first mounted. */}
        {revealed && (
          <motion.span
            className="absolute inset-0 font-mono text-sm text-accent-soft tabular-nums flex items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, ease: EASE_BRAND, delay: delay + 0.1 }}
          >
            {row.amount}
          </motion.span>
        )}
      </div>

      {/* Status column */}
      <span className="text-xs text-ink-muted self-center">
        {revealed ? row.status.auditor : row.status.public}
      </span>
    </div>
  )
}
