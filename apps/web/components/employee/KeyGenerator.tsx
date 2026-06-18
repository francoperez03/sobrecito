'use client'

import { useState } from 'react'
import { Copy, Check, Key, Warning } from '@phosphor-icons/react'
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
        No key yet? Generate one in your browser. Save the seed and give the public
        key to your employer so they can deposit your salary against it.
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
        {seedHex ? 'Generate another key' : 'Generate a new key'}
      </button>

      {seedHex && pubHex && (
        <div className="flex flex-col gap-4 pt-1">
          {/* Seed: the employee's key. Shown, copyable, and autofilled into the input. */}
          <div className="flex flex-col gap-2">
            <span className="text-xs text-ink-muted uppercase tracking-widest">
              Your key (seed)
            </span>
            <div className="flex items-stretch gap-2">
              <code
                data-testid="keygen-seed"
                className="font-mono text-sm text-accent-soft break-all bg-bg rounded-2xl px-4 py-3 ring-1 ring-hairline flex-1"
              >
                {seedHex}
              </code>
              <button
                type="button"
                onClick={handleCopySeed}
                aria-label={seedCopied ? 'Seed copied' : 'Copy seed'}
                data-testid="keygen-copy-seed"
                className="shrink-0 inline-flex items-center justify-center w-[46px] rounded-2xl ring-1 ring-hairline text-ink-muted hover:text-ink hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {seedCopied ? (
                  <Check size={16} weight="bold" aria-hidden />
                ) : (
                  <Copy size={16} aria-hidden />
                )}
              </button>
            </div>
            <p className="flex items-start gap-1.5 text-xs text-accent-warm">
              <Warning size={14} weight="fill" aria-hidden className="mt-0.5 shrink-0" />
              Save this seed. It is your key to scan and claim. Do not share it; it
              is never stored on this site.
            </p>
          </div>

          {/* BN254 public key: handed to the employer for the deposit. */}
          <div className="flex flex-col gap-2">
            <span className="text-xs text-ink-muted uppercase tracking-widest">
              Public key (give to your employer)
            </span>
            <div className="flex items-stretch gap-2">
              <code
                data-testid="keygen-pubkey"
                className="font-mono text-sm text-ink break-all bg-bg rounded-2xl px-4 py-3 ring-1 ring-hairline flex-1"
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
              Pass this public key to your employer (the bn254Pub column of the
              payroll CSV). They deposit your salary against it.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
