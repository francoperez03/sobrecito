'use client'

import { useState } from 'react'
import { Copy, Check } from '@phosphor-icons/react'
import { DoubleBezel } from '@/components/ui/DoubleBezel'

interface PaymentAddressCardProps {
  /** The employee's public key, rendered as their shareable payment address. */
  address: string
}

/**
 * Post-scan account detail: the employee's payment address (their public key),
 * always available once they have identified with their access key. Reframes the
 * public key from a crypto artifact copied during onboarding into a standing
 * account detail — the thing you hand your employer to get paid (like an alias or
 * account number shown after you log in).
 *
 * Display only: derived client-side from the seed during scan, never the secret.
 */
export function PaymentAddressCard({ address }: PaymentAddressCardProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(address)
    setCopied(true)
  }

  return (
    <DoubleBezel radius="2rem" className="px-6 py-5">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-ink-muted uppercase tracking-widest">
          Payment address
        </span>
        <div className="flex items-stretch gap-2">
          <code
            data-testid="employee-payment-address"
            className="font-mono text-xs text-accent-soft break-all bg-bg rounded-2xl px-3 py-2.5 ring-1 ring-hairline flex-1"
          >
            {address}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? 'Payment address copied' : 'Copy payment address'}
            data-testid="employee-copy-payment-address"
            className="shrink-0 inline-flex items-center justify-center w-[40px] rounded-2xl ring-1 ring-hairline text-ink-muted hover:text-ink hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {copied ? (
              <Check size={16} weight="bold" aria-hidden />
            ) : (
              <Copy size={16} aria-hidden />
            )}
          </button>
        </div>
        <span className="text-[11px] text-ink-muted">
          Share with your employer to get paid.
        </span>
      </div>
    </DoubleBezel>
  )
}
