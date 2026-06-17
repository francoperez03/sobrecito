'use client'

import { useRef, useState } from 'react'
import { generateAuditorKeypair, keyToBase64 } from 'viewkey'
import { Copy, Check, Key } from '@phosphor-icons/react'
import { DoubleBezel } from '@/components/ui/DoubleBezel'

/**
 * In-browser X25519 keypair generator for the auditor (AUD-03, AUD-04).
 *
 * Privacy model (T-06.1-01, D-09 / A2):
 * - The PUBLIC key is lifted into state and shown so the auditor can hand it to
 *   the employer (who encrypts each salary amount to it).
 * - The PRIVATE key is held in a ref and is NEVER rendered as text, NEVER logged,
 *   and NEVER written to browser storage. It can be copied to the clipboard
 *   exactly ONCE (API-key / 1Password "copy once" pattern): on copy it is handed
 *   to the OS clipboard and immediately wiped from memory, so to copy again the
 *   auditor must regenerate (which also rotates the public key).
 * - This is the only path by which the private key leaves the page, and it is
 *   explicit, user-initiated, and one-shot. The key is never displayed.
 *
 * The auditor copies the public key to the employer and keeps the private key as
 * their view-key: pasting it into the Reconstruct card below decrypts the batch.
 */
export function KeygenCard() {
  const [pubBase64, setPubBase64] = useState<string | null>(null)
  const [pubCopied, setPubCopied] = useState(false)
  // privArmed: a freshly generated private key is available to copy exactly once.
  const [privArmed, setPrivArmed] = useState(false)
  const [privCopied, setPrivCopied] = useState(false)
  // The private key (base64) lives here, never in rendered state. Wiped on copy.
  const privRef = useRef<string | null>(null)

  function handleGenerate() {
    const kp = generateAuditorKeypair()
    // AUD-04: the public key is shown; the private key goes into a ref that is
    // never rendered. It is held only until the one-shot copy wipes it.
    privRef.current = keyToBase64(kp.privkey)
    setPubBase64(keyToBase64(kp.pubkey))
    setPubCopied(false)
    setPrivArmed(true)
    setPrivCopied(false)
  }

  async function handleCopyPub() {
    if (!pubBase64) return
    await navigator.clipboard.writeText(pubBase64)
    setPubCopied(true)
  }

  async function handleCopyPriv() {
    if (!privArmed || !privRef.current) return
    await navigator.clipboard.writeText(privRef.current)
    // One-shot: wipe the key from memory so it cannot be copied again.
    privRef.current = null
    setPrivArmed(false)
    setPrivCopied(true)
  }

  return (
    <DoubleBezel radius="2rem" className="p-6">
      <h3 className="text-sm font-[900] tracking-[-0.01em]">Generate view-key</h3>
      <p className="mt-1 text-xs text-ink-muted">
        Create an X25519 keypair in your browser. Share the public key with the
        employer so they encrypt each salary amount to you, and keep the private
        key as your view-key to reconstruct the batch.
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
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <span className="text-xs text-ink-muted uppercase tracking-widest">
                Public key (base64)
              </span>
              <div className="flex items-stretch gap-2">
                <code
                  data-testid="keygen-pubkey"
                  className="font-mono text-sm text-accent-soft break-all bg-bg rounded-[calc(1.5rem-0.5rem)] p-3 ring-1 ring-white/8 flex-1"
                >
                  {pubBase64}
                </code>
                <button
                  type="button"
                  onClick={handleCopyPub}
                  aria-label={pubCopied ? 'Public key copied' : 'Copy public key'}
                  data-testid="keygen-copy-pub"
                  className="shrink-0 inline-flex items-center justify-center w-[44px] rounded-[calc(1.5rem-0.5rem)] ring-1 ring-white/12 text-ink-muted hover:text-ink hover:bg-white/5 transition-colors"
                >
                  {pubCopied ? (
                    <Check size={16} weight="bold" aria-hidden />
                  ) : (
                    <Copy size={16} aria-hidden />
                  )}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs text-ink-muted uppercase tracking-widest">
                Private key (view-key)
              </span>
              <button
                type="button"
                onClick={handleCopyPriv}
                disabled={!privArmed}
                data-testid="keygen-copy-priv"
                className={[
                  'inline-flex items-center gap-2 text-xs font-[700] w-fit px-4 h-[40px] rounded-full',
                  'ring-1 ring-white/12 text-ink hover:bg-white/5 transition-all',
                  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                ].join(' ')}
              >
                {privCopied ? (
                  <Check size={14} weight="bold" aria-hidden />
                ) : (
                  <Key size={14} aria-hidden />
                )}
                {privCopied
                  ? 'Private key copied — regenerate to copy again'
                  : 'Copy private key'}
              </button>
            </div>
          </div>
        )}

        <p className="text-xs text-ink-muted">
          The private key is never displayed. Copy it once to store it safely (like
          an API key); after that you must regenerate to copy it again. It is never
          saved to this site.
        </p>
      </div>
    </DoubleBezel>
  )
}
