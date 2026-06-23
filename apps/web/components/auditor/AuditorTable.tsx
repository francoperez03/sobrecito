'use client'

import { useState } from 'react'
import { motion } from 'motion/react'
import { CaretRight } from '@phosphor-icons/react'
import type { AuditorNote } from 'viewkey'
import { formatUsdc } from '@/lib/rpc'

const EASE_BRAND = [0.32, 0.72, 0, 1] as const

interface AuditorTableProps {
  /** The reconstructed per-note breakdown (BatchSummary.notes). */
  notes: AuditorNote[]
  /** Whether the view-key reconstruction has resolved (drives the reveal). */
  reconstructed: boolean
}

/**
 * Auditor breakdown table (UX-03 — the product's signature interaction).
 *
 * The policy_tx_1_8 circuit always emits 8 output notes; the real recipients are
 * the non-zero ones, the rest are zero-value padding that raises the on-chain
 * anonymity set (D2). The table gives the real payments the full reveal (sealed
 * bar → decrypted amount, Centerpiece choreography, staggered i × 0.06) and folds
 * the padding into one muted, expandable aside — honest about the padding without
 * letting six 0-USDC rows drown the two that matter. Verification is shown once at
 * the batch level (the proof attests the whole run), not per row.
 *
 * Amounts are real USDC (base units → decimal), shielded until the auditor decrypts.
 */
export function AuditorTable({ notes, reconstructed }: AuditorTableProps) {
  const sorted = [...notes].sort((a, b) => a.index - b.index)
  const real = sorted.filter((n) => n.amount > BigInt(0))
  const padding = sorted.filter((n) => n.amount === BigInt(0))
  const [showPadding, setShowPadding] = useState(false)

  return (
    <div className="w-full">
      {/* Table header — Centerpiece pattern: weight 400, uppercase tracking. */}
      <div className="grid grid-cols-[auto_1fr] gap-4 px-6 pb-2 border-b border-white/5">
        <span className="text-xs text-ink-muted uppercase tracking-widest">#</span>
        <span className="text-xs text-ink-muted uppercase tracking-widest">Amount</span>
      </div>

      <div className="px-6 py-2">
        {real.map((note, i) => (
          <AuditorRow
            key={note.index}
            note={note}
            reconstructed={reconstructed}
            i={i}
            label={i + 1}
          />
        ))}

        {padding.length > 0 && (
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowPadding((v) => !v)}
              className="flex w-full items-center gap-2 py-2 text-left text-xs text-ink-muted/70 hover:text-ink-muted transition-colors"
              aria-expanded={showPadding}
              data-testid="padding-toggle"
            >
              <motion.span
                animate={{ rotate: showPadding ? 90 : 0 }}
                transition={{ duration: 0.18, ease: EASE_BRAND }}
                className="inline-flex"
                aria-hidden
              >
                <CaretRight size={12} weight="bold" />
              </motion.span>
              {padding.length} padding {padding.length === 1 ? 'note' : 'notes'} · 0 USDC
              <span className="text-ink-muted/50">— anonymity-set fillers, not recipients</span>
            </button>

            {showPadding && (
              <div className="pb-1">
                {padding.map((note) => (
                  <div
                    key={note.index}
                    className="grid grid-cols-[auto_1fr] gap-4 py-1.5 text-ink-muted/50 border-b border-white/5 last:border-0"
                  >
                    <span className="text-xs self-center">{note.index + 1}</span>
                    <span className="font-mono text-xs self-center">0 USDC</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function AuditorRow({
  note,
  reconstructed,
  i,
  label,
}: {
  note: AuditorNote
  reconstructed: boolean
  i: number
  label: number
}) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-4 py-3 border-b border-white/5 last:border-0">
      {/* Index column — sequential recipient number, not the raw note slot. */}
      <span className="text-sm text-ink-muted self-center">{label}</span>

      {/* Amount column — sealed bar → revealed amount (Centerpiece exact). */}
      <div className="relative overflow-hidden h-5 self-center">
        {/* Bar slides away to the right when reconstructed. Always in the DOM so
            SSR renders the sealed state. */}
        <motion.div
          data-testid="amount-bar"
          className="absolute inset-0 rounded bg-ink/30"
          initial={{ scaleX: 1 }}
          animate={{ scaleX: reconstructed ? 0 : 1 }}
          transition={{ duration: 0.6, ease: EASE_BRAND, delay: i * 0.06 }}
          style={{ transformOrigin: 'right' }}
        />

        {/* Amount — conditionally rendered (not opacity-0) so getByText fails in
            the sealed state. Real USDC value (base units → decimal). */}
        {reconstructed && (
          <motion.span
            className="absolute inset-0 font-mono text-sm text-accent-soft flex items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, ease: EASE_BRAND, delay: i * 0.06 + 0.1 }}
          >
            {formatUsdc(note.amount)} USDC
          </motion.span>
        )}
      </div>
    </div>
  )
}
