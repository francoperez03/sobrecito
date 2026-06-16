'use client'

import type { ReactElement, ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { LockSimple } from '@phosphor-icons/react'
import { DEMO_ROWS } from '@/lib/demo-data'

/** Per-row visibility for a given role's view of the batch. */
export type RowState = 'revealed' | 'sealed'

interface RoleViewProps {
  /** One state per DEMO_ROWS entry (length 4). */
  rows: RowState[]
  /** Hide employee names (Employee's colleagues, Public). */
  redactNames?: boolean
  /** The single row the viewer owns (Employee) — labelled "You", accent-tinted. */
  ownIndex?: number
  /** Optional footer (e.g. the proven total for Public, or the view-key note). */
  footer?: ReactNode
  /** Accessible description of what this view shows (the table is decorative). */
  label: string
}

/**
 * Compact, fixed-state mini-table of one role's view of the payroll batch — the
 * landing-page echo of the Centerpiece sealed/revealed visual. Each row is either
 * `revealed` (real amount) or `sealed` (a redacted bar with a periodic shimmer).
 * State is fixed per role (no toggle); the only motion is the looping shimmer,
 * gated on prefers-reduced-motion. Reuses the live DEMO_ROWS so amounts stay in
 * sync with the Centerpiece.
 */
export function RoleView({
  rows,
  redactNames = false,
  ownIndex,
  footer,
  label,
}: RoleViewProps): ReactElement {
  const reduce = useReducedMotion()

  return (
    <div
      role="img"
      aria-label={label}
      className="rounded-xl bg-surface ring-1 ring-hairline shadow-[inset_0_1px_1px_rgba(255,255,255,0.04)] px-4 py-3"
    >
      {DEMO_ROWS.map((row, i) => {
        const revealed = rows[i] === 'revealed'
        const isOwn = ownIndex === i
        const showName = revealed && (!redactNames || isOwn)

        return (
          <div
            key={row.employee}
            className="grid grid-cols-[1fr_auto] items-center gap-3 py-1.5 border-b border-hairline last:border-0"
          >
            {/* Name (or Sealed lock chip when redacted). */}
            <span className="self-center min-w-0">
              {showName ? (
                <span className={`text-xs ${isOwn ? 'text-accent-soft' : 'text-ink'}`}>
                  {isOwn ? 'You' : row.employee}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-ink-muted">
                  <LockSimple size={11} weight="bold" />
                  <span className="font-mono text-[0.625rem] uppercase tracking-[0.12em]">
                    Sealed
                  </span>
                </span>
              )}
            </span>

            {/* Amount: real value (revealed) or a sealed bar (with shimmer). */}
            <div className="relative overflow-hidden h-4 w-20 self-center">
              {revealed ? (
                <span className="absolute inset-0 font-mono text-xs text-accent-soft tabular-nums flex items-center justify-end">
                  {row.amount}
                </span>
              ) : (
                <div className="absolute inset-0 rounded bg-ink/25 overflow-hidden">
                  {!reduce && (
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
                        delay: 0.6 + i * 0.2,
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}

      {footer && <div className="mt-2 pt-2 border-t border-hairline">{footer}</div>}
    </div>
  )
}
