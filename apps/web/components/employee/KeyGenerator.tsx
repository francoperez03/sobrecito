'use client'

import { useState } from 'react'
import { Copy, Check, Key } from '@phosphor-icons/react'
import { deriveEmployeeKeys, parseEmployeeKey } from '@/lib/zk/keyDerivation'
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
 * In-browser key generator for the employee (06.3-04 deviation: onboarding gap).
 *
 * One secret, one copy: the SEED is the only thing to back up. The public key
 * derives from the seed and can be recovered any time by pasting the seed again.
 *
 *   1. The SEED is the private key. Copy it here and paste it deliberately into
 *      the private-key field to scan and claim. It is NOT auto-filled and is
 *      never written to browser storage.
 *   2. The PUBLIC key (x25519Pub || bn254Pub, 128 hex) goes to the employer, who
 *      deposits the salary note against it. The bn254 half keys the commitment;
 *      the x25519 half is what the note is encrypted to for discovery.
 *
 * Privacy model: pure client-side, generated with the OS CSPRNG. Generation is
 * deterministic from the random seed via the same HKDF + Poseidon2 the circuit
 * uses, so the public key shown here is exactly the one the deposit must target.
 */
export function KeyGenerator() {
  // --- Generate section ---
  const [seedHex, setSeedHex] = useState<string | null>(null)
  const [pubHex, setPubHex] = useState<string | null>(null)
  const [seedCopied, setSeedCopied] = useState(false)
  const [pubCopied, setPubCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  // --- Recover section ---
  const [recoverInput, setRecoverInput] = useState('')
  const [recoveredPub, setRecoveredPub] = useState<string | null>(null)
  const [recoverError, setRecoverError] = useState<string | null>(null)
  const [recoverCopied, setRecoverCopied] = useState(false)
  const [recoverBusy, setRecoverBusy] = useState(false)

  // --- Save to roster section ---
  const [alias, setAlias] = useState('')
  const [saved, setSaved] = useState(false)

  // The "active" public key: the recovered one takes priority if available,
  // otherwise the generated one.
  const activePub = recoveredPub ?? pubHex

  async function handleGenerate() {
    setBusy(true)
    try {
      const seed = new Uint8Array(32)
      crypto.getRandomValues(seed)
      const hex = bytesToHex(seed)
      const { bn254Pub, x25519Pub } = await deriveEmployeeKeys(seed)
      setSeedHex(hex)
      setPubHex(bytesToHex(x25519Pub) + bigintToHex(bn254Pub))
      setSeedCopied(false)
      setPubCopied(false)
      // Reset recover section when a new key is generated
      setRecoveredPub(null)
      setRecoverInput('')
      setRecoverError(null)
      setRecoverCopied(false)
      setSaved(false)
      setAlias('')
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

  async function handleRecoverInputChange(value: string) {
    setRecoverInput(value)
    setRecoverError(null)
    setRecoveredPub(null)
    setRecoverCopied(false)
    setSaved(false)
    if (!value.trim()) return
    setRecoverBusy(true)
    try {
      const seed = parseEmployeeKey(value)
      const { bn254Pub, x25519Pub } = await deriveEmployeeKeys(seed)
      setRecoveredPub(bytesToHex(x25519Pub) + bigintToHex(bn254Pub))
    } catch {
      setRecoverError('Invalid seed — expected 64 hex chars or base64.')
    } finally {
      setRecoverBusy(false)
    }
  }

  async function handleCopyRecovered() {
    if (!recoveredPub) return
    await navigator.clipboard.writeText(recoveredPub)
    setRecoverCopied(true)
  }

  function handleSave() {
    if (!activePub || !alias.trim()) return
    saveEntry(alias.trim(), activePub)
    setSaved(true)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted leading-relaxed">
        Generate a keypair in your browser. The seed is the only secret to back up —
        your public key derives from it and can be recovered any time by pasting the
        seed again. Give the public key to your employer.
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

          {/* Private key (the seed) — the only thing to back up. */}
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
              This is your single secret. Back it up securely. Your public key
              derives from it and can be recovered any time by pasting it below.
              It is never saved to this site.
            </p>
          </div>
        </div>
      )}

      {/* Recover public key from an existing seed */}
      <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
        <span className="text-xs text-ink-muted uppercase tracking-widest">
          Already have a seed?
        </span>
        <p className="text-xs text-ink-muted leading-relaxed">
          Paste your seed to derive and copy your public key — without generating a
          new one.
        </p>
        <input
          type="text"
          placeholder="Paste your seed (64 hex or base64)"
          value={recoverInput}
          onChange={(e) => handleRecoverInputChange(e.target.value)}
          data-testid="keygen-recover-seed-input"
          className={[
            'font-mono text-sm bg-transparent border-b outline-none py-1 w-full',
            recoverError
              ? 'border-accent-warm/70 text-accent-warm focus:border-accent-warm'
              : 'border-white/10 text-ink-muted focus:border-accent',
          ].join(' ')}
        />
        {recoverBusy && (
          <p className="text-xs text-ink-muted animate-pulse">Deriving…</p>
        )}
        {recoverError && (
          <p className="text-xs text-accent-warm">{recoverError}</p>
        )}
        {recoveredPub && (
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex items-stretch gap-2">
              <code
                data-testid="keygen-recovered-pub"
                className="font-mono text-sm text-accent-soft break-all bg-bg rounded-2xl px-4 py-3 ring-1 ring-hairline flex-1"
              >
                {recoveredPub}
              </code>
              <button
                type="button"
                onClick={handleCopyRecovered}
                aria-label={recoverCopied ? 'Recovered public key copied' : 'Copy recovered public key'}
                className="shrink-0 inline-flex items-center justify-center w-[46px] rounded-2xl ring-1 ring-hairline text-ink-muted hover:text-ink hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {recoverCopied ? (
                  <Check size={16} weight="bold" aria-hidden />
                ) : (
                  <Copy size={16} aria-hidden />
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Save to roster — shown whenever there is an active public key */}
      {activePub && (
        <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
          <span className="text-xs text-ink-muted uppercase tracking-widest">
            Save on this device
          </span>
          <p className="text-xs text-ink-muted leading-relaxed">
            Saves your alias + public key in this browser. Your seed is never stored.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Alias / name"
              value={alias}
              onChange={(e) => { setAlias(e.target.value); setSaved(false) }}
              data-testid="keygen-alias-input"
              className="text-sm bg-transparent border-b border-white/10 focus:border-accent outline-none py-1 flex-1 text-ink min-w-0"
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={!alias.trim()}
              data-testid="keygen-save-roster"
              className={[
                'inline-flex items-center gap-1.5 px-4 h-[36px] rounded-full text-sm font-[700] transition-all',
                'ring-1 ring-hairline text-ink hover:bg-white/5 active:scale-[0.98]',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              ].join(' ')}
            >
              {saved ? (
                <>
                  <Check size={14} weight="bold" aria-hidden />
                  Saved
                </>
              ) : (
                'Save'
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
