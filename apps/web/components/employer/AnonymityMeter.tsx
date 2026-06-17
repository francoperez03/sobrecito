'use client'

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
 * Amber ExposureNote: withdraw-side unlinkability depends on the employee's
 * behavior (fresh address, independent timing). This caveat is REQUIRED by
 * DESIGN.md and the threat model (T-06.2-17 / A1). Amber is RESERVED for
 * exposure/danger signals only.
 */
export function AnonymityMeter({ noteCount, groupCount }: AnonymityMeterProps) {
  return (
    <DoubleBezel radius="2rem" className="overflow-hidden">
      <div className="px-6 py-5 flex flex-col gap-3">
        {/* Blue anonymity meter line */}
        <p className="font-mono text-sm text-accent-soft">
          {noteCount} notes · {groupCount} indistinguishable groups
        </p>

        {/* Amber ExposureNote — mandatory A1 / D2 withdraw-side caveat */}
        <div className="bg-accent-warm/10 text-accent-warm text-xs px-3 py-2 rounded-full self-start">
          Unlinkability of withdrawal depends on the employee choosing a fresh
          address and timing their claim independently.
        </div>
      </div>
    </DoubleBezel>
  )
}
