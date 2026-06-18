'use client'

import { useState } from 'react'
import { Copy, Check, Key, Warning, ArrowUp } from '@phosphor-icons/react'
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
 * Click "Generate a new key" to mint a fresh 32-byte seed with the OS CSPRNG
 * (crypto.getRandomValues) and derive the BN254 spending keypair from it. Two
 * values surface, both copyable:
 *   1. The SEED (64-char hex): the employee saves this and pastes it to scan and
 *      claim. This IS the key; it never leaves the browser unless the employee
 *      copies it. The page autofills the input with it so the flow continues
 *      straight to "Scan pool".
 *   2. The BN254 PUBLIC key (64-char hex): the employee hands this to their
 *      employer, who deposits the salary note against it (the bn254Pub column of
 *      the payroll CSV). Without the matching deposit there is nothing to claim.
 *
 * Privacy model: pure client-side. The seed and derived private scalar are never
 * sent anywhere and never written to browser storage. Generation is deterministic
 * from the random seed via the same HKDF + Poseidon2 the circuit uses, so the
 * public key shown here is exactly the one the deposit must target.
 *
 * Visual language mirrors the auditor KeygenCard: a labelled header, numbered
 * steps, mono key chips, and copy buttons with copied-state feedback.
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
    <div className="flex flex-col gap-5">
      {/* Header: identity for the block so the CTA does not read as a stray button. */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent-soft ring-1 ring-hairline">
          <Key size={17} weight="fill" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-[700] text-ink leading-tight">
            No key yet? Generate one
          </h3>
          <p className="text-xs text-ink-muted leading-relaxed max-w-[46ch]">
            Created in your browser. Save the seed and give the public key to your
            employer so they can deposit your salary against it.
          </p>
        </div>
      </div>

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
        {seedHex ? 'Generate another key' : 'Generate a new key'}
      </button>

      {seedHex && pubHex && (
        <div className="flex flex-col gap-3 pt-1">
          {/* Step 1 — Seed: the employee's key. Sensitive: amber-tinted, autofilled. */}
          <div className="rounded-2xl bg-accent-warm/[0.06] ring-1 ring-accent-warm/20 p-4 flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent-warm/15 text-[10px] font-[900] text-accent-warm">
                1
              </span>
              <span className="text-xs font-[700] uppercase tracking-widest text-accent-warm">
                Your key (seed)
              </span>
            </div>
            <div className="flex items-stretch gap-2">
              <code
                data-testid="keygen-seed"
                className="font-mono text-xs sm:text-sm text-ink break-all bg-bg/80 rounded-xl px-3.5 py-2.5 ring-1 ring-hairline flex-1 leading-relaxed"
              >
                {seedHex}
              </code>
              <button
                type="button"
                onClick={handleCopySeed}
                aria-label={seedCopied ? 'Seed copied' : 'Copy seed'}
                data-testid="keygen-copy-seed"
                className={[
                  'shrink-0 inline-flex items-center justify-center gap-1.5 px-3 rounded-xl text-xs font-[700] transition-all',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  seedCopied
                    ? 'bg-accent-warm/15 text-accent-warm ring-1 ring-accent-warm/30'
                    : 'ring-1 ring-hairline text-ink-muted hover:text-ink hover:bg-white/5',
                ].join(' ')}
              >
                {seedCopied ? (
                  <>
                    <Check size={15} weight="bold" aria-hidden />
                    <span className="hidden sm:inline">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy size={15} aria-hidden />
                    <span className="hidden sm:inline">Copy</span>
                  </>
                )}
              </button>
            </div>
            <p className="flex items-start gap-1.5 text-xs text-accent-warm/90">
              <Warning size={13} weight="fill" aria-hidden className="mt-0.5 shrink-0" />
              <span>
                Save this seed. It is your key to scan and claim. Do not share it; it
                is never stored on this site.
              </span>
            </p>
            <p className="flex items-center gap-1.5 text-[11px] text-ink-muted">
              <ArrowUp size={12} weight="bold" aria-hidden />
              Filled into the field above. Click &ldquo;Scan pool&rdquo; when your
              employer has deposited.
            </p>
          </div>

          {/* Step 2 — Public key: shareable. Neutral surface. */}
          <div className="rounded-2xl bg-surface/60 ring-1 ring-hairline p-4 flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent/10 text-[10px] font-[900] text-accent-soft">
                2
              </span>
              <span className="text-xs font-[700] uppercase tracking-widest text-ink-muted">
                Public key
              </span>
            </div>
            <div className="flex items-stretch gap-2">
              <code
                data-testid="keygen-pubkey"
                className="font-mono text-xs sm:text-sm text-ink break-all bg-bg/80 rounded-xl px-3.5 py-2.5 ring-1 ring-hairline flex-1 leading-relaxed"
              >
                {pubHex}
              </code>
              <button
                type="button"
                onClick={handleCopyPub}
                aria-label={pubCopied ? 'Public key copied' : 'Copy public key'}
                data-testid="keygen-copy-pub"
                className={[
                  'shrink-0 inline-flex items-center justify-center gap-1.5 px-3 rounded-xl text-xs font-[700] transition-all',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  pubCopied
                    ? 'bg-accent/15 text-accent-soft ring-1 ring-accent/30'
                    : 'ring-1 ring-hairline text-ink-muted hover:text-ink hover:bg-white/5',
                ].join(' ')}
              >
                {pubCopied ? (
                  <>
                    <Check size={15} weight="bold" aria-hidden />
                    <span className="hidden sm:inline">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy size={15} aria-hidden />
                    <span className="hidden sm:inline">Copy</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              Give this to your employer (the bn254Pub column of the payroll CSV).
              They deposit your salary against it.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
