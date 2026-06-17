'use client'

import { DoubleBezel } from '@/components/ui/DoubleBezel'

export interface NoteBudgetMeterProps {
  /** Total notes used across all employees in the current batch. */
  usedNotes: number
}

/**
 * NoteBudgetMeter — hard X/8 note-budget bar for the employer pay flow.
 *
 * 8 fixed segments: filled slots show accent-fill (blue) when within budget;
 * all filled slots turn amber when usedNotes > 8 (overflow). The caption
 * also turns amber and signals the overflow condition.
 *
 * Per DESIGN.md: amber (text-accent-warm / bg-accent-warm) is RESERVED for
 * exposure/danger signals only. The overflow state qualifies because it blocks
 * the batch (T-06.2-18 / A3 defense).
 */
export function NoteBudgetMeter({ usedNotes }: NoteBudgetMeterProps) {
  const isOverflow = usedNotes > 8

  return (
    <DoubleBezel radius="2rem" className="overflow-hidden">
      <div className="px-6 py-5">
        {/* 8 fixed segments */}
        <div className="flex gap-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className={`h-2 flex-1 rounded-full ${
                i < usedNotes
                  ? isOverflow
                    ? 'bg-accent-warm'
                    : 'bg-accent-fill'
                  : 'bg-white/10'
              }`}
            />
          ))}
        </div>

        {/* Caption */}
        <p
          className={`mt-2 font-mono text-xs ${
            isOverflow ? 'text-accent-warm' : 'text-ink-muted'
          }`}
        >
          {usedNotes}/8 notes
          {isOverflow && ' — reduce salaries to fit in one batch'}
        </p>
      </div>
    </DoubleBezel>
  )
}
