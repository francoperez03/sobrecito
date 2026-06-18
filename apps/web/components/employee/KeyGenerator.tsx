'use client'

import { useState } from 'react'
import { Copy, Check, Key } from '@phosphor-icons/react'
import { deriveEmployeeKeys } from '@/lib/zk/keyDerivation'

/** 32-byte Uint8Array as a 64-char lowercase hex string. */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** BN254 field element (bigint) as a 64-char zero-padded lowercase hex string. */
function bigintToHex(v: bigint): string {
  return v.toString(16).padStart(64, '0')
}

/**
 * In-browser key generator for the employee (06.3-04 deviation: onboarding gap).
 *
 * Mirrors the auditor KeygenCard layout: one Generate CTA, the PUBLIC key shown
 * in a mono chip with a copy button, and the PRIVATE key (the seed) handed out
 * via a prominent "Copy private key" button rather than a large text box.
 *
 *   1. The SEED is the private key. Copy it here and paste it deliberately into
 *      the private-key field above to scan and claim. It is NOT auto-filled (the
 *      employee copies it on purpose) and is never written to browser storage.
 *   2. The PUBLIC key (x25519Pub || bn254Pub, 128 hex) goes to the employer, who
 *      deposits the salary note against it: the bn254 half keys the commitment,
 *      the x25519 half is what the note is encrypted to for discovery.
 *
 * Privacy model: pure client-side, generated with the OS CSPRNG. Generation is
 * deterministic from the random seed via the same HKDF + Poseidon2 the circuit
 * uses, so the public key shown here is exactly the one the deposit must target.
 */
export function KeyGenerator() {
  const [seedHex, setSeedHex] = useState<string | null>(null)
  const [pubHex, setPubHex] = useState<string | null>(null)
  const [seedCopied, setSeedCopied] = useState(false)
  const [pubCopied, setPubCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleGenerate() {
    setBusy(true)
    try {
      const seed = new Uint8Array(32)
      crypto.getRandomValues(seed)
      const hex = bytesToHex(seed)
      // deriveEmployeeKeys computes BOTH public keys from the seed: the X25519 key
      // the note is encrypted to (discovery) and the bn254Pub the commitment uses
      // (withdraw ownership). The shared key concatenates them: x25519Pub || bn254Pub.
      const { bn254Pub, x25519Pub } = await deriveEmployeeKeys(seed)
      setSeedHex(hex)
      setPubHex(bytesToHex(x25519Pub) + bigintToHex(bn254Pub))
      setSeedCopied(false)
      setPubCopied(false)
    } finally {
      setBusy(false)
    }
  }

  async function handleCopySeed() {
    if (!seedHex) return
    await navigator.clipboard.writeText(seedHex)
    setSeedCopied(true)
  }

  async function handleCopyPub() {
    if (!pubHex) return
    await navigator.clipboard.writeText(pubHex)
    setPubCopied(true)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted leading-relaxed">
        No key yet? Generate one in your browser. The public key goes to your
        employer; the private key stays with you to scan and claim.
      </p>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={busy}
        data-testid="keygen-generate"
        className={[
          'inline-flex items-center gap-2 bg-surface text-ink font-[700] text-sm px-5 h-[44px] rounded-full w-fit',
          'ring-1 ring-white/30 hover:bg-white/5 hover:ring-white/50 active:scale-[0.98] transition-all',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          'focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
          busy ? 'opacity-80 animate-pulse cursor-wait' : '',
        ].join(' ')}
      >
        <Key size={16} weight="bold" aria-hidden />
        {pubHex ? 'Regenerate key' : 'Generate a new key'}
      </button>

      {seedHex && pubHex && (
        <div className="flex flex-col gap-4 pt-1">
          {/* Public key — shown in a mono chip, given to the employer. */}
          <div className="flex flex-col gap-2">
            <span className="text-xs text-ink-muted uppercase tracking-widest">
              Public key
            </span>
            <div className="flex items-stretch gap-2">
              <code
                data-testid="keygen-pubkey"
                className="font-mono text-sm text-accent-soft break-all bg-bg rounded-2xl px-4 py-3 ring-1 ring-hairline flex-1"
              >
                {pubHex}
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
            <p className="text-xs text-ink-muted">
              Give this to your employer (the public-key column of the payroll CSV).
            </p>
          </div>

          {/* Private key (the seed) — prominent copy button, not shown as text. */}
          <div className="flex flex-col gap-2">
            <span className="text-xs text-ink-muted uppercase tracking-widest">
              Private key (seed)
            </span>
            {/* Value kept out of the visible layout (the employee copies it via
                the button) but present for tests / assistive tooling. */}
            <span data-testid="keygen-seed" className="sr-only">
              {seedHex}
            </span>
            <button
              type="button"
              onClick={handleCopySeed}
              data-testid="keygen-copy-seed"
              className={[
                'inline-flex items-center justify-center gap-2 w-fit px-5 h-[44px] rounded-full font-[700] text-sm transition-all',
                'ring-1 ring-hairline text-ink hover:bg-white/5 active:scale-[0.98]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                'focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              ].join(' ')}
            >
              {seedCopied ? (
                <Check size={16} weight="bold" aria-hidden />
              ) : (
                <Key size={16} weight="bold" aria-hidden />
              )}
              {seedCopied ? 'Private key copied' : 'Copy private key'}
            </button>
            <p className="text-xs text-ink-muted leading-relaxed">
              Copy it and paste it into the private key field above to scan and
              claim. It is your key, never shared and never stored on this site.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
