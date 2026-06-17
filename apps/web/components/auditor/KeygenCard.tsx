'use client'

import { useState } from 'react'
import { generateAuditorKeypair, keyToBase64 } from 'viewkey'
import { DoubleBezel } from '@/components/ui/DoubleBezel'

/**
 * In-browser X25519 keypair generator for the auditor (AUD-03, AUD-04).
 *
 * Privacy model (T-06.1-01, D-09 / A2):
 * - The private key (kp.privkey) is produced inside handleGenerate and
 *   immediately becomes eligible for garbage collection — it is NEVER lifted
 *   into state, NEVER serialized, NEVER rendered, and NEVER logged.
 * - Only keyToBase64(kp.pubkey) is stored in state and shown to the user.
 * - No sessionStorage / localStorage / document.cookie is touched.
 * - No server action, no form action — generation runs entirely in the browser.
 *
 * The auditor copies the base64 public key and hands it to the employer
 * out-of-band so the employer can encrypt each note amount to this key.
 */
export function KeygenCard() {
  const [pubBase64, setPubBase64] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function handleGenerate() {
    const kp = generateAuditorKeypair()
    // AUD-04: only the public key is lifted into state.
    // kp.privkey (Uint8Array) is NOT serialized or stored — it is
    // garbage-collected after this handler returns.
    setPubBase64(keyToBase64(kp.pubkey))
    setCopied(false)
  }

  async function handleCopy() {
    if (!pubBase64) return
    await navigator.clipboard.writeText(pubBase64)
    setCopied(true)
  }

  return (
    <DoubleBezel radius="2rem" className="p-6">
      <h3 className="text-sm font-[900] tracking-[-0.01em]">Generate view-key</h3>
      <p className="mt-1 text-xs text-ink-muted">
        Create an X25519 keypair in your browser. Share the public key with the
        employer so they encrypt each salary amount to you.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <button
          type="button"
          onClick={handleGenerate}
          className={[
            'bg-accent-fill text-white font-[900] text-base px-6 h-[52px] rounded-full',
            'hover:opacity-90 active:scale-[0.98] transition-all w-fit',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            'focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
          ].join(' ')}
        >
          Generate keypair
        </button>

        {pubBase64 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-ink-muted uppercase tracking-widest">
              Public key (base64)
            </span>
            <code
              data-testid="keygen-pubkey"
              className="font-mono text-sm text-accent-soft break-all bg-bg rounded-[calc(1.5rem-0.5rem)] p-3 ring-1 ring-white/8"
            >
              {pubBase64}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="text-xs text-ink-muted underline w-fit hover:text-ink transition-colors"
            >
              {copied ? 'Copied' : 'Copy public key'}
            </button>
          </div>
        )}

        <p className="text-xs text-ink-muted">
          Your private key never leaves this browser. It is held in memory only
          and never displayed, stored, or sent.
        </p>
      </div>
    </DoubleBezel>
  )
}
