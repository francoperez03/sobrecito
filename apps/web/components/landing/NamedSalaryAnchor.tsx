'use client'

import { Eye } from '@phosphor-icons/react'
import { DoubleBezel } from '@/components/ui/DoubleBezel'
import { DEMO_ROWS } from '@/lib/demo-data'

/**
 * The "today" half of the comparison: the SAME payroll the Centerpiece seals,
 * but fully exposed on-chain. Mirrors Centerpiece's structure exactly (header row,
 * table header, 4 rows, footer) so the two columns share the same height and the
 * contrast reads as one payroll, exposed vs sealed — not two unrelated artifacts.
 *
 * No toggle, no reveal: everything is already public. Amounts render in the warm
 * "exposed" accent and the employee pubkeys are shown in mono — anyone can read
 * each salary, which is the problem Sobrecito solves.
 */
export function NamedSalaryAnchor() {
  return (
    <div className="w-full max-w-3xl mx-auto flex-1 min-h-0 flex flex-col">
      <DoubleBezel
        radius="2rem"
        outerClassName="flex-1 flex flex-col"
        className="flex-1 flex flex-col overflow-hidden"
      >
        {/* Header row — mirrors the Centerpiece header height (label + a static
            "public" chip where the WITH side has its Public/Auditor toggle). */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
            On-chain today
          </p>
          <span className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full ring-1 ring-accent-warm/30 text-accent-warm text-sm font-medium">
            <Eye size={14} weight="fill" aria-hidden />
            Public to all
          </span>
        </div>

        {/* Table header — same grid as Centerpiece. Today the chain exposes the
            recipient ACCOUNT address, so this column is "Account", not "Employee". */}
        <div className="grid grid-cols-[1fr_1fr_auto] gap-4 px-6 pb-2 border-b border-hairline">
          <span className="text-xs text-ink-muted uppercase tracking-widest">Account</span>
          <span className="text-xs text-ink-muted uppercase tracking-widest">Amount</span>
          <span className="text-xs text-ink-muted uppercase tracking-widest">Status</span>
        </div>

        {/* Rows — fully exposed: account address + amount readable by anyone. */}
        <div className="px-6 py-2">
          {DEMO_ROWS.map((row) => (
            <div
              key={row.address}
              className="grid grid-cols-[1fr_1fr_auto] gap-4 py-3 border-b border-hairline last:border-0"
            >
              <span className="font-mono text-sm text-ink self-center">{row.address}</span>
              <span className="font-mono text-sm text-accent-warm tabular-nums self-center">
                {row.amount}
              </span>
              <span className="text-xs text-ink-muted self-center">readable</span>
            </div>
          ))}
        </div>

        {/* Spacer — absorbs any height difference so the footer anchors to the
            bottom and the card matches the WITH column exactly. */}
        <div className="flex-1" />

        {/* Footer — mirrors the Centerpiece predicate footer (line + sub-caption). */}
        <div className="px-6 pb-5 pt-3 border-t border-hairline">
          <p className="font-mono text-sm text-accent-warm tabular-nums">
            every amount public · permanent
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Anyone can read each salary, and it stays on the ledger forever.
          </p>
        </div>
      </DoubleBezel>
    </div>
  )
}
