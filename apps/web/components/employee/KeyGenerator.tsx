'use client'

import { useState } from 'react'
import { Copy, Check, Key } from '@phosphor-icons/react'
import { deriveEmployeeKeys } from '@/lib/zk/keyDerivation'
import { saveEntry } from '@/lib/employeeRoster'
import { markStep } from '@/lib/progressStore'

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
 * In-browser key generator for the employee (first-run onboarding).
 *
 * One secret, one copy: the ACCESS KEY (seed) is the only thing to back up. The
 * payment address (public key) derives from it and shows in the dashboard any time
 * the employee enters with their access key — so there is no "recover" path here.
 *
 *   1. The ACCESS KEY is the private key. Copy it here and paste it deliberately
 *      into the access-key field to view payments and cash out. It is NOT
 *      auto-filled and is never written to browser storage.
 *   2. The PAYMENT ADDRESS (x25519Pub || bn254Pub, 128 hex) goes to the employer,
 *      who deposits the salary against it. The bn254 half keys the commitment; the
 *      x25519 half is what the note is encrypted to for discovery.
 *
 * Privacy model: pure client-side, generated with the OS CSPRNG. Generation is
 * deterministic from the random seed via the same HKDF + Poseidon2 the circuit
 * uses, so the payment address shown here is exactly the one the deposit targets.
 */
export function KeyGenerator() {
  const [seedHex, setSeedHex] = useState<string | null>(null)
  const [pubHex, setPubHex] = useState<string | null>(null)
  const [seedCopied, setSeedCopied] = useState(false)
  const [pubCopied, setPubCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  // The name gates creation: a key without an owner has no one to share its
  // address with. On create we save {name → payment address} to the per-device
  // roster so the employer can autofill the recipient (saveEntry stores the
  // PUBLIC key only — never the secret).
  const [name, setName] = useState('')

  const canCreate = name.trim().length > 0 && !busy

  async function handleGenerate() {
    if (!canCreate) return
    setBusy(true)
    try {
      const seed = new Uint8Array(32)
      crypto.getRandomValues(seed)
      const hex = bytesToHex(seed)
      const { bn254Pub, x25519Pub } = await deriveEmployeeKeys(seed)
      const pub = bytesToHex(x25519Pub) + bigintToHex(bn254Pub)
      setSeedHex(hex)
      setPubHex(pub)
      setSeedCopied(false)
      setPubCopied(false)
      saveEntry(name.trim(), pub)
      markStep('generate')
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
      {/* Name → Create: the name gates creation and labels the saved key. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          placeholder="Name your key (e.g. Ana)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canCreate) handleGenerate()
          }}
          data-testid="keygen-alias-input"
          className="flex-1 min-w-0 bg-bg text-ink text-sm rounded-full h-[44px] px-5 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-accent transition-all placeholder:text-ink-muted"
        />
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canCreate}
          data-testid="keygen-generate"
          className={[
            'inline-flex items-center justify-center gap-2 shrink-0 bg-surface text-ink font-[700] text-sm px-5 h-[44px] rounded-full',
            'ring-1 ring-white/30 hover:bg-white/5 hover:ring-white/50 active:scale-[0.98] transition-all',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            'focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface disabled:hover:ring-white/30',
            busy ? 'opacity-80 animate-pulse cursor-wait' : '',
          ].join(' ')}
        >
          <Key size={16} weight="bold" aria-hidden />
          {pubHex ? 'Create a new key' : 'Create my key'}
        </button>
      </div>

      <p className="text-xs text-ink-muted">
        {pubHex
          ? 'Back up your access key now: it’s the only way back in. Creating a new key replaces this one.'
          : 'Name your key to create it. Your access key is the only secret to back up; your payment address derives from it.'}
      </p>

      {/* Result well — payment address (to share) + access key (to back up) */}
      {pubHex && (
        <div className="flex flex-col gap-3 rounded-2xl bg-white/[0.02] ring-1 ring-hairline p-4">
          {/* Payment address (public key) */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-ink-muted">Payment address</span>
            <div className="flex items-stretch gap-2">
              <code
                data-testid="keygen-pubkey"
                className="font-mono text-xs text-accent-soft break-all bg-bg rounded-2xl px-3 py-2.5 ring-1 ring-hairline flex-1"
              >
                {pubHex}
              </code>
              <button
                type="button"
                onClick={handleCopyPub}
                aria-label={pubCopied ? 'Payment address copied' : 'Copy payment address'}
                data-testid="keygen-copy-pub"
                className="shrink-0 inline-flex items-center justify-center w-[40px] rounded-2xl ring-1 ring-hairline text-ink-muted hover:text-ink hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {pubCopied ? (
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

          {/* Access key (seed) — the only secret to back up */}
          {seedHex && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] text-ink-muted">Access key (secret)</span>
              {/* sr-only value for tests and assistive tools */}
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
                {seedCopied ? 'Access key copied' : 'Copy access key'}
              </button>
              <span className="text-[11px] text-ink-muted">back up · never stored</span>
            </div>
          )}

          {/* Auto-saved confirmation: name → payment address (public key only). */}
          <p className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <Check size={13} weight="bold" aria-hidden className="text-accent-soft" />
            Saved as “{name.trim()}” on this device — payment address only, never the secret.
          </p>
        </div>
      )}
    </div>
  )
}
