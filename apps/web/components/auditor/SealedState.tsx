'use client'

import { Seal } from '@phosphor-icons/react'

/**
 * Teaching state shown before reconstruction (UX-03 empty state).
 *
 * Carries the page's whole point: publicly the batch is sealed and only the
 * predicate `sum = T` is visible; the auditor's key is what reveals the amounts.
 * The muted bars echo the AuditorTable reveal so the sealed → revealed beat reads
 * visually. They are decorative (aria-hidden), not fabricated data.
 */
export function SealedState() {
  return (
    <div className="flex flex-col items-center text-center px-6 py-12">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface ring-1 ring-hairline">
        <Seal size={26} weight="fill" aria-hidden className="text-ink-muted" />
      </div>

      <h3 className="mt-5 text-h3 font-[900] tracking-[-0.01em]">
        The batch is sealed
      </h3>
      <p className="mt-2 max-w-[42ch] text-ink-muted leading-relaxed">
        Publicly, only the predicate is visible: every amount sums to the on-chain
        total. Paste your view-key to reveal the per-employee amounts you are
        entitled to see.
      </p>

      <div aria-hidden className="mt-8 flex w-full max-w-sm flex-col gap-2.5">
        {[0.92, 0.74, 0.86, 0.6].map((w, i) => (
          <div
            key={i}
            className="h-5 rounded bg-ink/12"
            style={{ width: `${w * 100}%` }}
          />
        ))}
      </div>
    </div>
  )
}
