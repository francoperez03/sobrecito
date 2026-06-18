'use client'

import { Info } from '@phosphor-icons/react'
import { DoubleBezel } from '@/components/ui/DoubleBezel'

export interface AnonymityMeterProps {
  /** Total number of denomination notes in the batch. */
  noteCount: number
  /** Number of indistinguishable denomination groups (notes sharing the same denomination). */
  groupCount: number
}

/**
 * AnonymityMeter — shows the deposit-side anonymity level and the mandatory
 * A1 / D2 withdraw-side caveat.
 *
 * Blue meter: note count + indistinguishable group count.
 * Caveat: withdraw-side unlinkability depends on the employee's behavior (fresh
 * address, independent timing). This caveat is REQUIRED by DESIGN.md and the
 * threat model (T-06.2-17 / A1), but it is informational, not an exposure
 * signal, so it reads as a neutral note (amber is reserved for the moment a
 * salary amount actually becomes public on-chain).
 */
export function AnonymityMeter({ noteCount, groupCount }: AnonymityMeterProps) {
  return (
    <DoubleBezel radius="2rem" className="overflow-hidden">
      <div className="px-6 py-5 flex flex-col gap-3">
        {/* Blue anonymity meter line */}
        <p className="font-mono text-sm text-accent-soft">
          {noteCount} notes · {groupCount} indistinguishable groups
        </p>

        {/* Neutral informational caveat (mandatory A1 / D2 withdraw-side note) */}
        <p className="flex items-start gap-2 text-xs text-ink-muted leading-relaxed">
          <Info size={14} weight="regular" aria-hidden className="mt-0.5 shrink-0 text-ink-muted/70" />
          <span>
            Unlinkability of withdrawal depends on the employee choosing a fresh
            address and timing their claim independently.
          </span>
        </p>
      </div>
    </DoubleBezel>
  )
}
