'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { CaretDown } from '@phosphor-icons/react'
import { DenominationChips } from './DenominationChips'
import { EmployeeKeyField } from './EmployeeKeyField'
import { countNotes } from '@/lib/zk/denominationBuilder'
import { usdcToBaseUnits, USDC_SCALE } from '@/lib/csvParser'
import { EASE_BRAND } from '@/lib/motion'
import { loadRoster, type RosterEntry } from '@/lib/employeeRoster'

/** A single editable row in the payroll table. Amounts are kept as strings for
 *  live input editing; conversion to bigint happens at submit time.
 *  Only the public key + amount are collected — the public key is the sole
 *  identity that matters on-chain. */
export interface EditableRow {
  /** USDC amount as a human string (e.g. "100", "10"). */
  amount: string
  /** Employee X25519 public key as 64 hex chars. */
  publicKey: string
}

export interface PayrollEditableTableProps {
  rows: EditableRow[]
  onChange: (rows: EditableRow[]) => void
}

/**
 * PayrollEditableTable — editable payroll grid with a collapsible per-row
 * denomination breakdown and a per-row selector for saved employees.
 *
 * Columns: # | Public key (60%) | Amount (10%) | Details toggle (30%) | Remove
 *
 * The denomination chips are collapsed by default. When a row has an amount, a
 * "View details" toggle fades in; clicking it expands the chips downward (the
 * input row stays put).
 *
 * The public-key cell is a single EmployeeKeyField combobox: the employer can
 * paste a 128-hex key directly, or type to search the saved-employee library
 * (loaded on the employee console) and pick an entry. When the value resolves to
 * a saved employee, the field shows that alias inline.
 */
export function PayrollEditableTable({ rows, onChange }: PayrollEditableTableProps) {
  // Indices of rows whose denomination breakdown is expanded.
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())

  // Employee roster — loaded client-side only (SSR returns []).
  const [roster, setRoster] = useState<RosterEntry[]>([])
  useEffect(() => {
    setRoster(loadRoster())
  }, [])

  // Total notes across all rows — counted from the AMOUNTS alone (no public key
  // required) so the 8-note overflow shows the moment a too-large amount is typed.
  function computeTotalNotes(): number {
    return rows.reduce((sum, r) => {
      if (!r.amount || !/^\d+(\.\d{1,7})?$/.test(r.amount)) return sum
      try {
        return sum + countNotes(usdcToBaseUnits(r.amount))
      } catch {
        return sum
      }
    }, 0)
  }

  const totalNotes = computeTotalNotes()
  const isOverflow = totalNotes > 8

  function toggleRow(idx: number) {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  function handleCellChange(idx: number, field: keyof EditableRow, value: string) {
    const next = rows.map((row, i) =>
      i === idx ? { ...row, [field]: value } : row
    )
    onChange(next)
  }

  function handleAddRow() {
    setExpandedRows(new Set())
    onChange([...rows, { amount: '', publicKey: '' }])
  }

  function handleRemoveRow(idx: number) {
    setExpandedRows(new Set())
    onChange(rows.filter((_, i) => i !== idx))
  }

  return (
    <div className="w-full flex flex-col gap-4">
      {/* Table header */}
      <div className="grid grid-cols-[auto_6fr_1fr_3fr_auto] gap-4 px-2 pb-2 border-b border-white/5">
        <span className="text-xs text-ink-muted uppercase tracking-widest">#</span>
        <span className="text-xs text-ink-muted uppercase tracking-widest">Payment address</span>
        <span className="text-xs text-ink-muted uppercase tracking-widest flex flex-col">
          Amount
          <span className="normal-case tracking-normal text-[10px] text-ink-muted/60">(min. 1 USDC)</span>
        </span>
        <span className="text-xs text-ink-muted uppercase tracking-widest" aria-hidden />
        <span className="text-xs text-ink-muted uppercase tracking-widest sr-only">Remove</span>
      </div>

      {/* Table rows */}
      <div className="flex flex-col">
        {rows.map((row, i) => {
          // Per-row amount → denomination breakdown
          let rowAmountUsdc: bigint | null = null
          try {
            if (row.amount && /^\d+(\.\d{1,7})?$/.test(row.amount)) {
              rowAmountUsdc = usdcToBaseUnits(row.amount)
            }
          } catch {
            // invalid amount — no toggle rendered
          }
          const hasAmount = rowAmountUsdc !== null && rowAmountUsdc > BigInt(0)
          const isExpanded = expandedRows.has(i)
          // Invalid when the amount has text but isn't a whole USDC value of at least 1.
          const amountInvalid =
            row.amount.trim() !== '' &&
            (rowAmountUsdc === null ||
              rowAmountUsdc < USDC_SCALE ||
              rowAmountUsdc % USDC_SCALE !== BigInt(0))

          return (
            <div key={i} className="flex flex-col border-b border-white/5 last:border-0">
              {/* Fixed input row — textboxes never move */}
              <div className="grid grid-cols-[auto_6fr_1fr_3fr_auto] gap-4 py-3 items-center">
                <span className="text-sm text-ink-muted tabular-nums">{i + 1}</span>

                {/* Public key column: one field — paste a key, or search the
                    saved-employee library and pick one. */}
                <EmployeeKeyField
                  rowIndex={i}
                  value={row.publicKey}
                  onChange={(v) => handleCellChange(i, 'publicKey', v)}
                  roster={roster}
                />

                <input
                  type="text"
                  placeholder="e.g. 100"
                  value={row.amount}
                  onChange={(e) => handleCellChange(i, 'amount', e.target.value)}
                  aria-invalid={amountInvalid || undefined}
                  className={`text-sm bg-transparent border-b outline-none py-1 text-ink w-full min-w-0 ${
                    amountInvalid
                      ? 'border-accent-warm/70 focus:border-accent-warm'
                      : 'border-white/10 focus:border-accent'
                  }`}
                />

                {/* Details toggle (was the Name slot): fades in only when there's an amount */}
                <div className="min-w-0">
                  <AnimatePresence>
                    {hasAmount && (
                      <motion.button
                        type="button"
                        onClick={() => toggleRow(i)}
                        aria-expanded={isExpanded}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, ease: EASE_BRAND }}
                        className="flex items-center gap-1.5 text-sm text-accent-soft hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                      >
                        View details
                        <motion.span
                          animate={{ rotate: isExpanded ? 180 : 0 }}
                          transition={{ duration: 0.3, ease: EASE_BRAND }}
                          className="flex"
                        >
                          <CaretDown size={14} weight="bold" />
                        </motion.span>
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>

                {/* First row keeps a permanent base row — hide its remove control
                    (kept invisible so the column stays aligned). */}
                <button
                  type="button"
                  onClick={() => handleRemoveRow(i)}
                  aria-label={`Remove row ${i + 1}`}
                  aria-hidden={i === 0 || undefined}
                  tabIndex={i === 0 ? -1 : undefined}
                  className={`text-ink-muted/40 hover:text-ink-muted transition-colors text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded ${
                    i === 0 ? 'invisible pointer-events-none' : ''
                  }`}
                >
                  ✕
                </button>
              </div>

              {/* Collapsible denomination breakdown — expands downward, row above stays put */}
              <AnimatePresence initial={false}>
                {isExpanded && hasAmount && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: EASE_BRAND }}
                    className="overflow-hidden"
                  >
                    {/* Grid mirrors the input row so the vertical chips sit directly under "View details" */}
                    <div className="grid grid-cols-[auto_6fr_1fr_3fr_auto] gap-4 pb-3">
                      <span aria-hidden />
                      <span aria-hidden />
                      <span aria-hidden />
                      <DenominationChips amountUsdc={rowAmountUsdc as bigint} isOverflow={isOverflow} />
                      <span aria-hidden />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>

      {/* Add row */}
      <button
        type="button"
        onClick={handleAddRow}
        className="text-sm text-ink-muted border border-white/10 px-4 py-1.5 rounded-full hover:bg-white/5 transition-colors self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        + Add row
      </button>
    </div>
  )
}
