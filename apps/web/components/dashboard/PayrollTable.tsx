'use client'

/**
 * PayrollTable — read-only employer view of a committed batch.
 *
 * A1 (sealed-for-the-public) by construction: there is NO Amount column. The
 * employer dashboard deliberately matches what the public sees — status +
 * commitment — without ever exposing an individual amount. The grid is
 * grid-cols-[auto_1fr_auto_auto]: #, Employee, Status, Date. There is no
 * per-amount render path here (that pattern lives only in the auditor table).
 *
 * Structure mirrors Centerpiece.tsx exactly (table header lines 30-34, rows
 * lines 75-116): header cells are text-xs text-ink-muted uppercase
 * tracking-widest weight 400, rows are grid ... gap-4 py-3 border-b
 * border-white/5 last:border-0.
 */

export type PayrollStatus = 'committed' | 'proven' | 'pending'

export interface PayrollRow {
  /** 1-based position in the batch. */
  index: number
  /** Human label or placeholder — never a wallet address, never an amount. */
  employeeLabel: string
  status: PayrollStatus
  /** Commitment date/time label. */
  date: string
}

/** Status cell — color + symbol, no destructive palette (UI-SPEC Surface 2). */
function StatusCell({ status }: { status: PayrollStatus }) {
  if (status === 'proven') {
    return (
      <span className="text-sm text-accent-soft self-center">✓ proven</span>
    )
  }
  if (status === 'pending') {
    return (
      <span className="text-sm text-ink-muted italic self-center">pending</span>
    )
  }
  return <span className="text-sm text-ink-muted self-center">committed</span>
}

export function PayrollTable({ rows }: { rows: PayrollRow[] }) {
  return (
    <div className="w-full">
      {/* Table header — one span per column, weight 400 (Centerpiece pattern).
          Columns: #, Employee, Status, Date. Amount is ABSENT by design (A1). */}
      <div className="grid grid-cols-[auto_1fr_auto_auto] gap-4 px-6 pb-2 border-b border-white/5">
        <span className="text-xs text-ink-muted uppercase tracking-widest">#</span>
        <span className="text-xs text-ink-muted uppercase tracking-widest">
          Employee
        </span>
        <span className="text-xs text-ink-muted uppercase tracking-widest">
          Status
        </span>
        <span className="text-xs text-ink-muted uppercase tracking-widest">Date</span>
      </div>

      {/* Table rows */}
      <div className="px-6 py-2">
        {rows.map((row) => (
          <div
            key={row.index}
            className="grid grid-cols-[auto_1fr_auto_auto] gap-4 py-3 border-b border-white/5 last:border-0"
          >
            <span className="text-sm text-ink-muted self-center tabular-nums">
              {row.index}
            </span>
            <span className="text-sm text-ink-muted self-center">
              {row.employeeLabel}
            </span>
            <StatusCell status={row.status} />
            <span className="text-sm text-ink-muted self-center font-mono tabular-nums">
              {row.date}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
