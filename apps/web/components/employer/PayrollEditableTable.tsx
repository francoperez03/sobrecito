'use client'

import { useRef, useState } from 'react'
import { DenominationChips } from './DenominationChips'
import { parseCsvText } from '@/lib/csvParser'
import { decompose } from '@/lib/zk/denominationBuilder'
import { usdcToBaseUnits, isHex64 } from '@/lib/csvParser'

/** A single editable row in the payroll table. Amounts are kept as strings for
 *  live input editing; conversion to bigint happens at submit time. */
export interface EditableRow {
  name: string
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
 * PayrollEditableTable — editable payroll grid with live denomination chips
 * and CSV import (D4: single surface, CSV fills the table).
 *
 * Columns: # | Name | Amount (+ DenomChips live) | Public key | Remove
 *
 * CSV import reads the file via FileReader.readAsText, calls parseCsvText,
 * maps PayrollRow[] → EditableRow[], and calls onChange to fill the table.
 * Parse errors render inline in amber.
 */
export function PayrollEditableTable({ rows, onChange }: PayrollEditableTableProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [csvError, setCsvError] = useState<string | null>(null)

  // Compute total notes across all rows to detect overflow
  function computeTotalNotes(): number {
    const validRows = rows
      .filter((r) => r.amount && r.publicKey && isHex64(r.publicKey))
      .map((r) => {
        try {
          return { name: r.name, amountUsdc: usdcToBaseUnits(r.amount), pubkeyHex: r.publicKey }
        } catch {
          return null
        }
      })
      .filter(Boolean) as { name: string; amountUsdc: bigint; pubkeyHex: string }[]

    if (validRows.length === 0) return 0
    const notes = decompose(validRows)
    if (!notes) return 999 // overflow indicator
    return notes.filter((n) => n.denomination > BigInt(0)).length
  }

  const totalNotes = computeTotalNotes()
  const isOverflow = totalNotes > 8

  function handleCellChange(idx: number, field: keyof EditableRow, value: string) {
    const next = rows.map((row, i) =>
      i === idx ? { ...row, [field]: value } : row
    )
    onChange(next)
  }

  function handleAddRow() {
    onChange([...rows, { name: '', amount: '', publicKey: '' }])
  }

  function handleRemoveRow(idx: number) {
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
          name: r.name,
          // Convert base units back to a human USDC string
          amount: formatBaseUnitsToDisplay(r.amount),
          // Convert Uint8Array back to 64-char hex
          publicKey: Array.from(r.publicKey)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(''),
        }))
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
      <div className="grid grid-cols-[auto_3fr_1fr_6fr_auto] gap-4 px-2 pb-2 border-b border-white/5">
        <span className="text-xs text-ink-muted uppercase tracking-widest">#</span>
        <span className="text-xs text-ink-muted uppercase tracking-widest">Name</span>
        <span className="text-xs text-ink-muted uppercase tracking-widest">Amount</span>
        <span className="text-xs text-ink-muted uppercase tracking-widest">Public key</span>
        <span className="text-xs text-ink-muted uppercase tracking-widest sr-only">Remove</span>
      </div>

      {/* Table rows */}
      <div className="flex flex-col">
        {rows.map((row, i) => {
          // Per-row denomination chips
          let rowAmountUsdc: bigint | null = null
          try {
            if (row.amount && /^\d+(\.\d{1,7})?$/.test(row.amount)) {
              rowAmountUsdc = usdcToBaseUnits(row.amount)
            }
          } catch {
            // invalid amount — no chips rendered
          }

          return (
            <div
              key={i}
              className="grid grid-cols-[auto_3fr_1fr_6fr_auto] gap-4 py-3 border-b border-white/5 last:border-0 items-center"
            >
              <span className="text-sm text-ink-muted tabular-nums">{i + 1}</span>

              <input
                type="text"
                placeholder="Employee name"
                value={row.name}
                onChange={(e) => handleCellChange(i, 'name', e.target.value)}
                className="text-sm bg-transparent border-b border-white/10 focus:border-accent outline-none py-1 text-ink w-full min-w-0"
              />

              {/* Amount column: input + live denomination chips */}
              <div className="flex flex-col gap-1">
                <input
                  type="text"
                  placeholder="e.g. 100"
                  value={row.amount}
                  onChange={(e) => handleCellChange(i, 'amount', e.target.value)}
                  className="text-sm bg-transparent border-b border-white/10 focus:border-accent outline-none py-1 text-ink w-full min-w-0"
                />
                {rowAmountUsdc !== null && rowAmountUsdc > BigInt(0) && (
                  <DenominationChips
                    amountUsdc={rowAmountUsdc}
                    isOverflow={isOverflow}
                  />
                )}
              </div>

              <input
                type="text"
                placeholder="64-char hex pubkey"
                value={row.publicKey}
                onChange={(e) => handleCellChange(i, 'publicKey', e.target.value)}
                className="font-mono text-sm text-ink-muted bg-transparent border-b border-white/10 focus:border-accent outline-none py-1 w-full min-w-0"
              />

              <button
                type="button"
                onClick={() => handleRemoveRow(i)}
                aria-label={`Remove row ${i + 1}`}
                className="text-ink-muted/40 hover:text-ink-muted transition-colors text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
              >
                ✕
              </button>
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
        <span className="text-xs text-ink-muted">columns: name, amount, public_key</span>
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
