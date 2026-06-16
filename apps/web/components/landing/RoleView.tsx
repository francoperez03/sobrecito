import type { ReactElement, ReactNode } from 'react'
import { LockSimple } from '@phosphor-icons/react'
import { DEMO_ROWS } from '@/lib/demo-data'

/** Per-row visibility for a given role's view of the batch. */
export type RowState = 'revealed' | 'sealed'

interface RoleViewProps {
  /** One state per DEMO_ROWS entry (length 4). */
  rows: RowState[]
  /** Hide employee names (Employee's colleagues, Public). */
  redactNames?: boolean
  /** The single row the viewer owns (Employee) — labelled "You", highlighted. */
  ownIndex?: number
  /** Optional footer (e.g. the proven total for Public, or the view-key note). */
  footer?: ReactNode
  /** Accessible description of what this view shows (the table is decorative). */
  label: string
}

/**
 * Compact mini-table of one role's view of the payroll batch. Unlike the
 * Centerpiece (whose drama IS the sealing), this view inverts the emphasis: what
 * the role CAN see is the hero (the owned row, the proven total), and sealed rows
 * recede quietly — static, dim, no shimmer competing for attention.
 */
export function RoleView({
  rows,
  redactNames = false,
  ownIndex,
  footer,
  label,
}: RoleViewProps): ReactElement {
  return (
    <div
      role="img"
      aria-label={label}
      className="rounded-xl bg-surface ring-1 ring-hairline shadow-[inset_0_1px_1px_rgba(255,255,255,0.04)] p-2"
    >
      <div className="flex flex-col gap-0.5">
        {DEMO_ROWS.map((row, i) => {
          const revealed = rows[i] === 'revealed'
          const isOwn = ownIndex === i
          const showName = revealed && (!redactNames || isOwn)

          return (
            <div
              key={row.employee}
              className={`grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg px-3 py-2.5 ${
                isOwn ? 'bg-accent/[0.08] ring-1 ring-accent/20' : ''
              }`}
            >
              {/* Name (or a quiet Sealed chip when redacted). */}
              <span className="min-w-0 truncate">
                {showName ? (
                  <span
                    className={`text-sm ${isOwn ? 'text-accent-soft font-medium' : 'text-ink'}`}
                  >
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

              {/* Amount: the real value (hero) or a quiet static redaction bar. */}
              {revealed ? (
                <span
                  className={`font-mono tabular-nums text-right ${
                    isOwn ? 'text-sm text-accent-soft font-medium' : 'text-xs text-accent-soft'
                  }`}
                >
                  {row.amount}
                </span>
              ) : (
                <span aria-hidden className="h-2.5 w-16 rounded-full bg-ink/[0.12]" />
              )}
            </div>
          )
        })}
      </div>

      {footer && <div className="mt-1 px-3 pt-3 border-t border-hairline">{footer}</div>}
    </div>
  )
}
