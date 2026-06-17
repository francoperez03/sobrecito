'use client'

import { DoubleBezel } from '@/components/ui/DoubleBezel'
import { DENOMS } from '@/lib/zk/denominationBuilder'
import { formatUsdc } from '@/lib/rpc'

export interface DenominationChipsProps {
  /** Amount in USDC base units (7 decimals). */
  amountUsdc: bigint
  /** When true, all chips render in amber (overflow signal). */
  isOverflow: boolean
}

/**
 * DenominationChips — renders one "bill" chip per denomination note for a
 * given USDC amount, using the greedy {100, 10, 1} decomposition.
 *
 * Blue chips for a valid within-budget batch; amber chips when isOverflow is
 * true (the total note count exceeds 8). Amber is RESERVED for exposure/danger
 * signals per DESIGN.md — it never appears here for branding.
 */
export function DenominationChips({ amountUsdc, isOverflow }: DenominationChipsProps) {
  // Compute the bill breakdown for this single row amount
  const chips: { denom: bigint; count: number }[] = []
  let remaining = amountUsdc
  for (const denomBase of DENOMS) {
    if (remaining >= denomBase) {
      const count = Number(remaining / denomBase)
      chips.push({ denom: denomBase, count })
      remaining -= denomBase * BigInt(count)
    }
  }

  if (chips.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-1">
      {chips.map(({ denom, count }) =>
        Array.from({ length: count }).map((_, i) => (
          <span
            key={`${denom.toString()}-${i}`}
            data-testid="denom-chip"
            className={`font-mono text-xs px-2 py-0.5 rounded-full border ${
              isOverflow
                ? 'border-accent-warm/40 text-accent-warm bg-accent-warm/10'
                : 'border-accent/30 text-accent-soft bg-accent/10'
            }`}
          >
            {formatUsdc(denom)} USDC
          </span>
        ))
      )}
    </div>
  )
}
