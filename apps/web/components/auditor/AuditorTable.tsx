'use client'

import { motion } from 'motion/react'
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
 * Mirrors `Centerpiece.tsx` `TableRow` bar→amount choreography EXACTLY: each
 * amount starts sealed behind a bar; on reconstruction the bar slides away
 * (`scaleX: 1 → 0`, origin right) and the decrypted amount fades in, per-row
 * staggered at `i × 0.06`. `MotionConfig reducedMotion="user"` (inherited from the
 * (demo) layout) degrades the reveal to an instant crossfade.
 *
 * Amounts render with NO USDC suffix: these are shielded BN254 field values, not
 * real USDC transfers (Pitfall 4).
 */
export function AuditorTable({ notes, reconstructed }: AuditorTableProps) {
  const rows = [...notes].sort((a, b) => a.index - b.index)

  return (
    <div className="w-full">
      {/* Table header — Centerpiece pattern: weight 400, uppercase tracking. */}
      <div className="grid grid-cols-[auto_1fr_auto] gap-4 px-6 pb-2 border-b border-white/5">
        <span className="text-xs text-ink-muted uppercase tracking-widest">#</span>
        <span className="text-xs text-ink-muted uppercase tracking-widest">
          Amount
        </span>
        <span className="text-xs text-ink-muted uppercase tracking-widest">
          Status
        </span>
      </div>

      <div className="px-6 py-2">
        {rows.map((note, i) => (
          <AuditorRow
            key={note.index}
            note={note}
            reconstructed={reconstructed}
            i={i}
          />
        ))}
      </div>
    </div>
  )
}

function AuditorRow({
  note,
  reconstructed,
  i,
}: {
  note: AuditorNote
  reconstructed: boolean
  i: number
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] gap-4 py-3 border-b border-white/5 last:border-0">
      {/* Index column */}
      <span className="text-sm text-ink-muted self-center">{note.index + 1}</span>

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

      {/* Status column — committed → ✓ proven on reconstruct. */}
      <span className="text-xs text-ink-muted self-center">
        {reconstructed ? '✓ proven' : 'committed'}
      </span>
    </div>
  )
}
