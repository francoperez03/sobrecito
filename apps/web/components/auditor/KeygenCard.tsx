'use client'

import { useEffect, useRef, useState } from 'react'
import { generateAuditorKeypair, keyToBase64 } from 'viewkey'
import { Copy, Check, Key } from '@phosphor-icons/react'
import { saveAuditorPublicKey, loadAuditorPublicKey } from '@/lib/auditorKeyStore'

/**
 * In-browser X25519 keypair generator for the auditor (AUD-03, AUD-04).
 *
 * Renders as a lightweight drawer body (no card of its own) — keygen is setup, so
 * it sits secondary to the reconstruct action that owns the surface.
 *
 * Privacy model (T-06.1-01, D-09 / A2):
 * - The PUBLIC key is shown so the auditor can hand it to the employer. It is
 *   persisted to localStorage (public key only) so the employer screen can
 *   autofill it without manual copy/paste in the same browser.
 * - The PRIVATE key is held in a ref, NEVER rendered as text, NEVER logged, NEVER
 *   written to browser storage. It is copyable exactly ONCE (API-key pattern): on
 *   copy it goes to the OS clipboard and is wiped from memory, so copying again
 *   requires regenerating (which rotates the public key).
 */
export function KeygenCard() {
  const [pubBase64, setPubBase64] = useState<string | null>(null)
  const [pubCopied, setPubCopied] = useState(false)
  // privArmed: a freshly generated private key is available to copy exactly once.
  const [privArmed, setPrivArmed] = useState(false)
  const [privCopied, setPrivCopied] = useState(false)
  // The private key (base64) lives here, never in rendered state. Wiped on copy.
  const privRef = useRef<string | null>(null)

  // Pre-fill the public key from a previous session (public key only). The
  // private key is NOT restored — it only ever lives in memory — so privArmed
  // stays false until the auditor regenerates.
  useEffect(() => {
    const stored = loadAuditorPublicKey()
    if (stored) setPubBase64(stored)
  }, [])

  function handleGenerate() {
    const kp = generateAuditorKeypair()
    privRef.current = keyToBase64(kp.privkey)
    const pub = keyToBase64(kp.pubkey)
    setPubBase64(pub)
    // Persist ONLY the public key for cross-screen autofill (never the private).
    saveAuditorPublicKey(pub)
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
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted leading-relaxed">
        Public key goes to the employer. Private key stays as your view-key.
      </p>

      <button
        type="button"
        onClick={handleGenerate}
        className={[
          'inline-flex items-center gap-2 bg-accent-fill text-white font-[900] text-sm px-5 h-[44px] rounded-full',
          'hover:opacity-90 active:scale-[0.98] transition-all w-fit',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          'focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        ].join(' ')}
      >
        <Key size={16} weight="bold" aria-hidden />
        {pubBase64 ? 'Regenerate keypair' : 'Generate keypair'}
      </button>

      {pubBase64 && (
        <div className="flex flex-col gap-4 pt-1">
          <div className="flex flex-col gap-2">
            <span className="text-xs text-ink-muted uppercase tracking-widest">
              Public key
            </span>
            <div className="flex items-stretch gap-2">
              <code
                data-testid="keygen-pubkey"
                className="font-mono text-sm text-accent-soft break-all bg-bg rounded-2xl px-4 py-3 ring-1 ring-hairline flex-1"
              >
                {pubBase64}
              </code>
              <button
                type="button"
                onClick={handleCopyPub}
                aria-label={pubCopied ? 'Public key copied' : 'Copy public key'}
                data-testid="keygen-copy-pub"
                className="shrink-0 inline-flex items-center justify-center w-[46px] rounded-2xl ring-1 ring-hairline text-ink-muted hover:text-ink hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
                'ring-1 ring-hairline text-ink hover:bg-white/5 transition-all',
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
            <p className="text-xs text-ink-muted">
              Never displayed. Copy it once to store it safely; it is never saved
              to this site.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
