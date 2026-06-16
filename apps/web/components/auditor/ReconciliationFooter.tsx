'use client'

import { motion } from 'motion/react'
import { DoubleBezel } from '@/components/ui/DoubleBezel'

const EASE_BRAND = [0.32, 0.72, 0, 1] as const

interface ReconciliationFooterProps {
  /** Sum of the decrypted per-note amounts (BN254 field values). */
  sumDecrypted: bigint
  /** Declared on-chain total T. */
  total: bigint
  /** Whether sum(decrypted) reconciles to T. */
  match: boolean
}

/**
 * Reconciliation footer (UX-03, A3 soundness).
 *
 * Mirrors the `Centerpiece.tsx` predicate footer. Shows `sum(decrypted amounts)`
 * against the on-chain total T and a Match / Mismatch verdict. The predicate
 * pulses in last (delay 0.5s) per the UI-SPEC auditor choreography.
 */
export function ReconciliationFooter({
  sumDecrypted,
  total,
  match,
}: ReconciliationFooterProps) {
  return (
    <DoubleBezel radius="2rem" className="px-6 py-5">
      <motion.div
        className="border-t border-white/5 pt-3 flex flex-col gap-1"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, ease: EASE_BRAND, delay: 0.5 }}
      >
        <p className="font-mono text-sm text-ink-muted">
          sum(decrypted amounts) = {sumDecrypted.toString()}
        </p>
        <p className="font-mono text-sm text-ink-muted">
          on-chain total T = {total.toString()}
        </p>
        <p
          className={`font-mono text-sm mt-1 ${
            match ? 'text-accent-soft' : 'text-ink-muted'
          }`}
        >
          {match
            ? '✓ Totals match — batch is sound.'
            : 'Totals do not match. The decrypted amounts differ from the on-chain total.'}
        </p>
      </motion.div>
    </DoubleBezel>
  )
}
