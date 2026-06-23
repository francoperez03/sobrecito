'use client'

import { useState } from 'react'
import { LockKey, Eye, EyeSlash } from '@phosphor-icons/react'

interface EmployeeKeyInputProps {
  value: string
  onChange: (v: string) => void
  onScan: () => void
  processing: boolean
  invalid: boolean
}

/**
 * Primary action: paste the PRIVATE employee key (seed) and scan the pool
 * (CAP-1, D-09).
 *
 * Renders bare (no DoubleBezel of its own) so the page can wrap the whole primary
 * panel in a single bezel. The key NEVER leaves the browser: there is NO <form>,
 * NO action, NO server action. `onChange` updates local state only; the CTA's
 * `onClick` runs `handleScan` client-side. When `invalid`, the field ring swaps
 * to amber (`ring-accent-warm`).
 *
 * The value is a private seed, so the field is MASKED by default (type=password)
 * with an eye toggle to reveal/hide it. Masking does not affect paste or submit.
 */
export function EmployeeKeyInput({
  value,
  onChange,
  onScan,
  processing,
  invalid,
}: EmployeeKeyInputProps) {
  const [revealed, setRevealed] = useState(false)

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs text-ink-muted uppercase tracking-widest">
        Access key
      </span>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        {/* Masked field + eye toggle. The toggle sits inside the field so the
            row layout (field + Scan pool) is unchanged. */}
        <div className="relative flex-1 min-w-0">
          <input
            type={revealed ? 'text' : 'password'}
            aria-label="Access key (hex or base64)"
            placeholder="Paste your access key"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !processing) onScan()
            }}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            className={[
              'w-full min-w-0 bg-bg text-ink font-mono text-sm rounded-full h-[52px] pl-5 pr-14',
              'ring-1 focus:outline-none transition-all placeholder:text-ink-muted',
              invalid
                ? 'ring-accent-warm focus:ring-accent-warm'
                : 'ring-hairline focus:ring-2 focus:ring-accent',
            ].join(' ')}
          />
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? 'Hide key' : 'Show key'}
            aria-pressed={revealed}
            data-testid="employee-key-reveal"
            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:text-ink hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {revealed ? (
              <EyeSlash size={18} aria-hidden />
            ) : (
              <Eye size={18} aria-hidden />
            )}
          </button>
        </div>
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
          {processing ? 'Checking…' : 'View my salary'}
        </button>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-ink-muted">
        <LockKey size={13} weight="fill" aria-hidden className="text-ink-muted/80" />
        Stays in this browser — never sent.
      </p>
    </div>
  )
}
