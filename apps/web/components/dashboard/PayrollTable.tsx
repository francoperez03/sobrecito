'use client'

import { useState } from 'react'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'

/**
 * PayrollTable — sealed-note view of a committed batch (public lens, A1).
 *
 * Rows are NOTES, not employees. Each commitment is a sealed note with an
 * indistinguishable denomination — showing "Employee #N" would imply identity
 * and leak a per-employee count the protocol deliberately hides (D2).
 *
 * Columns: #, Sealed note (truncated commitment hash), Ledger, Tx.
 * No Amount column — amounts live only in encrypted_output (A1, T-06-09).
 *
 * Long batches paginate at PAGE_SIZE rows per page.
 */

const PAGE_SIZE = 10

export interface PayrollRow {
  /** 1-based position in the batch. */
  index: number
  /** Full commitment hash as a decimal string (from ScannedEvent.commitment). */
  commitmentHex: string
  /** Ledger number as a string, e.g. "3161466". */
  date: string
  /** Block-explorer URL for the note's transaction (optional). */
  explorerUrl?: string
}

/** Truncate a long commitment string for display (first 6 + … + last 4 chars). */
function truncateCommitment(s: string): string {
  if (s.length <= 14) return s
  return `${s.slice(0, 6)}…${s.slice(-4)}`
}


export function PayrollTable({ rows }: { rows: PayrollRow[] }) {
  const [page, setPage] = useState(0)

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const start = current * PAGE_SIZE
  const visible = rows.slice(start, start + PAGE_SIZE)

  return (
    <div className="w-full">
      {/* Privacy note — equal-value notes are indistinguishable on-chain. */}
      <p className="px-6 pb-4 text-xs text-ink-muted/60 italic">
        Equal-value notes look identical on-chain, so the split is unreadable from here.
      </p>

      {/* Table header */}
      <div className="grid grid-cols-[auto_1fr_auto_auto] gap-4 px-6 pb-2 border-b border-white/5">
        <span className="text-xs text-ink-muted uppercase tracking-widest">#</span>
        <span className="text-xs text-ink-muted uppercase tracking-widest">Sealed note</span>
        <span className="text-xs text-ink-muted uppercase tracking-widest">Ledger</span>
        <span className="text-xs text-ink-muted uppercase tracking-widest">Tx</span>
      </div>

      {/* Table rows (current page) */}
      <div className="px-6 py-2">
        {visible.map((row) => (
          <div
            key={row.index}
            className="grid grid-cols-[auto_1fr_auto_auto] gap-4 py-3 border-b border-white/5 last:border-0"
          >
            <span className="text-sm text-ink-muted self-center tabular-nums">{row.index}</span>
            <span
              className="text-sm text-ink-muted self-center font-mono truncate"
              title={row.commitmentHex}
            >
              {truncateCommitment(row.commitmentHex)}
            </span>
            <span className="text-sm text-ink-muted self-center font-mono tabular-nums">
              {row.date}
            </span>
            {row.explorerUrl ? (
              <a
                href={row.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent-soft self-center underline underline-offset-4 decoration-white/20 hover:decoration-current transition-colors"
              >
                view ↗
              </a>
            ) : (
              <span className="text-sm text-ink-muted/40 self-center">—</span>
            )}
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
