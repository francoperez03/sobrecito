'use client'

import { DoubleBezel } from '@/components/ui/DoubleBezel'

interface ViewKeyInputProps {
  value: string
  onChange: (value: string) => void
  onReconstruct: () => void
  processing: boolean
  invalid: boolean
}

/**
 * View-key paste card (UX-03, D-09 / A2).
 *
 * The auditor's X25519 private key is entered here and NEVER leaves the browser:
 * there is NO <form>, NO `action`, NO server action. `onChange` updates local
 * state only; the CTA is a plain button whose `onClick` runs `reconstructBatch`
 * client-side (D-09, T-06-12 mitigation). When `invalid`, the textarea ring swaps
 * to amber (`ring-accent-warm`) — the only invalid-input signal, no red.
 */
export function ViewKeyInput({
  value,
  onChange,
  onReconstruct,
  processing,
  invalid,
}: ViewKeyInputProps) {
  return (
    <DoubleBezel radius="2rem" className="p-6">
      <textarea
        aria-label="View-key (X25519 private key, base64)"
        placeholder="Paste view-key (X25519 private key, base64)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={[
          'bg-bg text-ink font-mono text-sm rounded-[calc(1.5rem-0.5rem)] p-4',
          'ring-1 resize-none w-full min-h-[80px] focus:outline-none transition-all',
          invalid
            ? 'ring-accent-warm focus:ring-accent-warm'
            : 'ring-white/8 focus:ring-accent',
        ].join(' ')}
      />

      <div className="mt-4 flex flex-col gap-3">
        <button
          type="button"
          onClick={onReconstruct}
          disabled={processing}
          className={[
            'bg-accent-fill text-white font-[900] text-base px-6 h-[52px] rounded-full',
            'hover:opacity-90 active:scale-[0.98] transition-all w-fit',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            'focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            processing ? 'opacity-80 animate-pulse cursor-wait' : '',
          ].join(' ')}
        >
          {processing ? 'Reconstructing…' : 'Reconstruct batch'}
        </button>

        {/* Privacy disclosure — D-09 / A2: the key stays client-side. */}
        <p className="text-xs text-ink-muted">
          Your key never leaves this browser. Decryption happens client-side.
        </p>
      </div>
    </DoubleBezel>
  )
}
