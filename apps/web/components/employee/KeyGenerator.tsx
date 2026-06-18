'use client'

import { useState } from 'react'
import { Copy, Check, Key } from '@phosphor-icons/react'
import { deriveEmployeeKeys } from '@/lib/zk/keyDerivation'

interface KeyGeneratorProps {
  /**
   * Called with the freshly generated seed (64-char hex) so the page can
   * autofill the key input and let the employee scan immediately.
   */
  onGenerated: (seedHex: string) => void
}

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
 *   1. The SEED is the private key. It is autofilled into the key input above so
 *      the employee can scan straight away, and is copyable here to save it. It
 *      is never written to browser storage.
 *   2. The PUBLIC key (bn254Pub) goes to the employer, who deposits the salary
 *      note against it (the bn254Pub column of the payroll CSV).
 *
 * Privacy model: pure client-side, generated with the OS CSPRNG. Generation is
 * deterministic from the random seed via the same HKDF + Poseidon2 the circuit
 * uses, so the public key shown here is exactly the one the deposit must target.
 */
export function KeyGenerator({ onGenerated }: KeyGeneratorProps) {
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
      // deriveEmployeeKeys computes bn254Pub via the WASM bridge (Poseidon2),
      // matching the circuit's Keypair() template. Browser-only.
      const { bn254Pub } = await deriveEmployeeKeys(seed)
      setSeedHex(hex)
      setPubHex(bigintToHex(bn254Pub))
      setSeedCopied(false)
      setPubCopied(false)
      // Autofill the key input so the employee can scan immediately.
      onGenerated(hex)
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
          'inline-flex items-center gap-2 bg-accent-fill text-white font-[900] text-sm px-5 h-[44px] rounded-full',
          'hover:opacity-90 active:scale-[0.98] transition-all w-fit',
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
              Give this to your employer (the bn254Pub column of the payroll CSV).
            </p>
          </div>

          {/* Private key (the seed) — prominent copy button, not shown as text. */}
          <div className="flex flex-col gap-2">
            <span className="text-xs text-ink-muted uppercase tracking-widest">
              Private key (seed)
            </span>
            {/* Value kept out of the visible layout (it is autofilled into the
                key input above) but present for tests / assistive tooling. */}
            <span data-testid="keygen-seed" className="sr-only">
              {seedHex}
            </span>
            <button
              type="button"
              onClick={handleCopySeed}
              data-testid="keygen-copy-seed"
              className={[
                'inline-flex items-center justify-center gap-2 w-fit px-5 h-[44px] rounded-full font-[900] text-sm transition-all',
                'active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                'focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                seedCopied
                  ? 'bg-accent-soft/15 text-accent-soft ring-1 ring-accent-soft/30'
                  : 'bg-ink text-bg hover:opacity-90',
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
              Filled into the field above. Save it to scan and claim later. It is
              your key, never shared and never stored on this site.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
