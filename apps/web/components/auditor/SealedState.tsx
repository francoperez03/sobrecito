'use client'

import { Seal } from '@phosphor-icons/react'

/**
 * Teaching state shown before reconstruction (UX-03 empty state).
 *
 * Carries the page's whole point in one line: publicly only `sum = T` is visible;
 * the auditor's key reveals the amounts.
 */
export function SealedState() {
  return (
    <div className="flex flex-col items-center text-center px-6 py-14">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface ring-1 ring-hairline">
        <Seal size={26} weight="fill" aria-hidden className="text-ink-muted" />
      </div>

      <h3 className="mt-5 text-h3 font-[900] tracking-[-0.01em]">
        The batch is sealed
      </h3>
      <p className="mt-2 max-w-[34ch] text-ink-muted leading-relaxed">
        Publicly, only{' '}
        <span className="font-mono text-accent-soft">sum = T</span> is visible.
        Your view-key reveals the amounts.
      </p>

      <p className="mt-6 text-sm text-ink-muted">Nothing to show yet.</p>
    </div>
  )
}
