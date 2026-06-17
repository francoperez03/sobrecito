'use client'

import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { CaretDown } from '@phosphor-icons/react'
import { DenominationChips } from './DenominationChips'
import { parseCsvText } from '@/lib/csvParser'
import { countNotes } from '@/lib/zk/denominationBuilder'
import { usdcToBaseUnits } from '@/lib/csvParser'
import { EASE_BRAND } from '@/lib/motion'

/** A single editable row in the payroll table. Amounts are kept as strings for
 *  live input editing; conversion to bigint happens at submit time.
 *  Only the public key + amount are collected — the public key is the sole
 *  identity that matters on-chain. */
export interface EditableRow {
  /** USDC amount as a human string (e.g. "100", "10.5"). */
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
 * denomination breakdown and CSV import (D4: single surface, CSV fills the table).
 *
 * Columns: # | Public key (60%) | Amount (10%) | Details toggle (30%) | Remove
 *
 * The denomination chips are collapsed by default. When a row has an amount, a
 * "View details" toggle fades in; clicking it expands the chips downward (the
 * input row stays put). CSV import reads the file via FileReader.readAsText,
 * calls parseCsvText, maps PayrollRow[] → EditableRow[] (name ignored), and
 * calls onChange. Parse errors render inline in amber.
 */
export function PayrollEditableTable({ rows, onChange }: PayrollEditableTableProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [csvError, setCsvError] = useState<string | null>(null)
  // Indices of rows whose denomination breakdown is expanded.
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())

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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvError(null)

    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result
      if (typeof text !== 'string') {
        setCsvError('Could not read file.')
        return
      }
      try {
        const parsed = parseCsvText(text)
        const editableRows: EditableRow[] = parsed.map((r) => ({
          // Convert base units back to a human USDC string (name is ignored)
          amount: formatBaseUnitsToDisplay(r.amount),
          // Convert Uint8Array back to 64-char hex
          publicKey: Array.from(r.publicKey)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(''),
        }))
        setExpandedRows(new Set())
        onChange(editableRows)
      } catch (err) {
        setCsvError(err instanceof Error ? err.message : 'CSV parse error.')
      }
    }
    reader.readAsText(file)

    // Reset input so the same file can be re-imported
    e.target.value = ''
  }

  return (
    <div className="w-full flex flex-col gap-4">
      {/* Table header */}
      <div className="grid grid-cols-[auto_6fr_1fr_3fr_auto] gap-4 px-2 pb-2 border-b border-white/5">
        <span className="text-xs text-ink-muted uppercase tracking-widest">#</span>
        <span className="text-xs text-ink-muted uppercase tracking-widest">Public key</span>
        <span className="text-xs text-ink-muted uppercase tracking-widest">Amount</span>
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

          return (
            <div key={i} className="flex flex-col border-b border-white/5 last:border-0">
              {/* Fixed input row — textboxes never move */}
              <div className="grid grid-cols-[auto_6fr_1fr_3fr_auto] gap-4 py-3 items-center">
                <span className="text-sm text-ink-muted tabular-nums">{i + 1}</span>

                <input
                  type="text"
                  placeholder="64-char hex pubkey"
                  value={row.publicKey}
                  onChange={(e) => handleCellChange(i, 'publicKey', e.target.value)}
                  className="font-mono text-sm text-ink-muted bg-transparent border-b border-white/10 focus:border-accent outline-none py-1 w-full min-w-0"
                />

                <input
                  type="text"
                  placeholder="e.g. 100"
                  value={row.amount}
                  onChange={(e) => handleCellChange(i, 'amount', e.target.value)}
                  className="text-sm bg-transparent border-b border-white/10 focus:border-accent outline-none py-1 text-ink w-full min-w-0"
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

                <button
                  type="button"
                  onClick={() => handleRemoveRow(i)}
                  aria-label={`Remove row ${i + 1}`}
                  className="text-ink-muted/40 hover:text-ink-muted transition-colors text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
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

      {/* CSV import — below the table, for bulk fill (manual entry is the default above) */}
      <div className="flex items-center gap-3 pt-2 border-t border-white/5">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="text-sm text-accent-soft border border-accent/30 px-4 py-1.5 rounded-full hover:bg-accent/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Import CSV
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleFileChange}
        />
        <span className="text-xs text-ink-muted">columns: name (optional), amount, public_key</span>
      </div>

      {/* Inline CSV parse error */}
      {csvError && (
        <div className="bg-accent-warm/10 text-accent-warm text-xs px-3 py-2 rounded-full self-start">
          {csvError}
        </div>
      )}
    </div>
  )
}

/**
 * Convert USDC base units back to a human display string (e.g. 10_000_000 → "1").
 * Trims trailing decimal zeros.
 */
function formatBaseUnitsToDisplay(base: bigint): string {
  const SCALE = BigInt(10_000_000)
  const ZERO = BigInt(0)
  const int = base / SCALE
  const frac = base % SCALE
  if (frac === ZERO) return int.toString()
  return int.toString() + '.' + frac.toString().padStart(7, '0').replace(/0+$/, '')
}
