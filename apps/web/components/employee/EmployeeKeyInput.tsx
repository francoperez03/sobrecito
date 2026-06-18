'use client'

import { LockKey } from '@phosphor-icons/react'

interface EmployeeKeyInputProps {
  value: string
  onChange: (v: string) => void
  onScan: () => void
  processing: boolean
  invalid: boolean
}

/**
 * Primary action: paste the employee key and scan the pool (CAP-1, D-09).
 *
 * Renders bare (no DoubleBezel of its own) so the page can wrap the whole primary
 * panel in a single bezel. The key NEVER leaves the browser: there is NO <form>,
 * NO action, NO server action. `onChange` updates local state only; the CTA's
 * `onClick` runs `handleScan` client-side. When `invalid`, the field ring swaps
 * to amber (`ring-accent-warm`). Mirrors `ViewKeyInput` with `onScan` instead
 * of `onReconstruct`.
 */
export function EmployeeKeyInput({
  value,
  onChange,
  onScan,
  processing,
  invalid,
}: EmployeeKeyInputProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <input
          aria-label="Employee key (hex or base64)"
          placeholder="Paste your employee key (hex or base64)"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !processing) onScan()
          }}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          className={[
            'flex-1 min-w-0 bg-bg text-ink font-mono text-sm rounded-full h-[52px] px-5',
            'ring-1 focus:outline-none transition-all placeholder:text-ink-muted',
            invalid
              ? 'ring-accent-warm focus:ring-accent-warm'
              : 'ring-hairline focus:ring-2 focus:ring-accent',
          ].join(' ')}
        />
        <button
          type="button"
          onClick={onScan}
          disabled={processing}
          className={[
            'shrink-0 bg-accent-fill text-white font-[900] text-base px-7 h-[52px] rounded-full',
            'hover:opacity-90 active:scale-[0.98] transition-all',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            'focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            processing ? 'opacity-80 animate-pulse cursor-wait' : '',
          ].join(' ')}
        >
          {processing ? 'Scanning…' : 'Scan pool'}
        </button>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-ink-muted">
        <LockKey size={14} weight="fill" aria-hidden className="text-ink-muted/80" />
        Used in this browser only. Decryption runs client-side; the key is never
        sent.
      </p>
    </div>
  )
}
