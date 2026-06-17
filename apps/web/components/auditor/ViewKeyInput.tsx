'use client'

import { LockKey } from '@phosphor-icons/react'

interface ViewKeyInputProps {
  value: string
  onChange: (value: string) => void
  onReconstruct: () => void
  processing: boolean
  invalid: boolean
}

/**
 * Primary action: paste the view-key and reconstruct (UX-03, D-09 / A2).
 *
 * Renders bare (no DoubleBezel of its own) so the page can wrap the whole primary
 * panel in a single bezel — no nested cards. The key NEVER leaves the browser:
 * there is NO <form>, NO action, NO server action. `onChange` updates local state
 * only; the CTA's `onClick` runs `reconstructBatch` client-side (T-06-12). When
 * `invalid`, the field ring swaps to amber (`ring-accent-warm`) — the only
 * invalid signal, no red.
 */
export function ViewKeyInput({
  value,
  onChange,
  onReconstruct,
  processing,
  invalid,
}: ViewKeyInputProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <input
          aria-label="View-key (X25519 private key, base64)"
          placeholder="Paste view-key (X25519 private key, base64)"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !processing) onReconstruct()
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
          onClick={onReconstruct}
          disabled={processing}
          className={[
            'shrink-0 bg-accent-fill text-white font-[900] text-base px-7 h-[52px] rounded-full',
            'hover:opacity-90 active:scale-[0.98] transition-all',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            'focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            processing ? 'opacity-80 animate-pulse cursor-wait' : '',
          ].join(' ')}
        >
          {processing ? 'Reconstructing…' : 'Reconstruct batch'}
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
