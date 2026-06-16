'use client'

import { useState } from 'react'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'

/**
 * PayrollTable — read-only employer view of a committed batch.
 *
 * A1 (sealed-for-the-public) by construction: there is NO Amount column. The
 * employer dashboard deliberately matches what the public sees — status +
 * commitment — without ever exposing an individual amount. The grid is
 * grid-cols-[auto_1fr_auto_auto]: #, Employee, Status, Date.
 *
 * Long batches paginate at PAGE_SIZE rows per page so the dashboard never dumps
 * the whole ledger at once.
 */

const PAGE_SIZE = 10

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
    return <span className="text-sm text-accent-soft self-center">✓ proven</span>
  }
  if (status === 'pending') {
    return <span className="text-sm text-ink-muted italic self-center">pending</span>
  }
  return <span className="text-sm text-ink-muted self-center">committed</span>
}

export function PayrollTable({ rows }: { rows: PayrollRow[] }) {
  const [page, setPage] = useState(0)

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const start = current * PAGE_SIZE
  const visible = rows.slice(start, start + PAGE_SIZE)

  return (
    <div className="w-full">
      {/* Table header — one span per column, weight 400 (Centerpiece pattern).
          Columns: #, Employee, Status, Date. Amount is ABSENT by design (A1). */}
      <div className="grid grid-cols-[auto_1fr_auto_auto] gap-4 px-6 pb-2 border-b border-white/5">
        <span className="text-xs text-ink-muted uppercase tracking-widest">#</span>
        <span className="text-xs text-ink-muted uppercase tracking-widest">Employee</span>
        <span className="text-xs text-ink-muted uppercase tracking-widest">Status</span>
        <span className="text-xs text-ink-muted uppercase tracking-widest">Date</span>
      </div>

      {/* Table rows (current page) */}
      <div className="px-6 py-2">
        {visible.map((row) => (
          <div
            key={row.index}
            className="grid grid-cols-[auto_1fr_auto_auto] gap-4 py-3 border-b border-white/5 last:border-0"
          >
            <span className="text-sm text-ink-muted self-center tabular-nums">{row.index}</span>
            <span className="text-sm text-ink-muted self-center">{row.employeeLabel}</span>
            <StatusCell status={row.status} />
            <span className="text-sm text-ink-muted self-center font-mono tabular-nums">
              {row.date}
            </span>
          </div>
        ))}
      </div>

      {/* Pagination — only when the batch exceeds one page */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-4 px-6 pt-3 border-t border-white/5">
          <span className="font-mono text-xs text-ink-muted tabular-nums">
            {start + 1}–{Math.min(start + PAGE_SIZE, rows.length)} of {rows.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous page"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
              className="inline-flex items-center justify-center size-8 rounded-full text-ink-muted transition-colors hover:text-ink hover:bg-white/5 disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <CaretLeft size={15} weight="bold" />
            </button>
            <span className="font-mono text-xs text-ink-muted tabular-nums px-1.5">
              {current + 1} / {pageCount}
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={current >= pageCount - 1}
              onClick={() => setPage(current + 1)}
              className="inline-flex items-center justify-center size-8 rounded-full text-ink-muted transition-colors hover:text-ink hover:bg-white/5 disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <CaretRight size={15} weight="bold" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
