'use client'

import { useState } from 'react'
import { Copy, Check, Key } from '@phosphor-icons/react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { deriveEmployeeKeys, parseEmployeeKey } from '@/lib/zk/keyDerivation'
import { saveEntry } from '@/lib/employeeRoster'
import { markStep } from '@/lib/progressStore'
import { EASE_OUT } from '@/lib/motion'

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
  const [recoverOpen, setRecoverOpen] = useState(false)

  // --- Save to roster section ---
  const [alias, setAlias] = useState('')
  const [saved, setSaved] = useState(false)

  // Reduced-motion preference
  const reduce = useReducedMotion()

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

  // Unified copy handler: copies the active public key regardless of path
  async function handleCopyActivePub() {
    if (!activePub) return
    if (recoveredPub) {
      await handleCopyRecovered()
    } else {
      await handleCopyPub()
    }
  }

  // Copied state for the unified copy button
  const activePubCopied = recoveredPub ? recoverCopied : pubCopied

  return (
    <div className="flex flex-col gap-4">
      {/* ZONA B.1 — Fila de acciones en una línea */}
      <div className="flex flex-wrap items-center gap-2">
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

        <button
          type="button"
          onClick={() => setRecoverOpen((o) => !o)}
          aria-expanded={recoverOpen}
          className="inline-flex items-center gap-2 px-4 h-[44px] rounded-full text-sm font-[700] text-ink-muted hover:text-ink hover:bg-white/5 ring-1 ring-hairline transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          I have a seed
        </button>
      </div>

      <p className="text-xs text-ink-muted">
        Your seed is the only secret to back up — your public key derives from it.
      </p>

      {/* ZONA B.2 — Input de recuperación desplegable */}
      <AnimatePresence initial={false}>
        {recoverOpen && (
          <motion.div
            key="recover-input"
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
            style={{ overflow: 'hidden' }}
          >
            <div className="flex flex-col gap-2 pt-1">
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ZONA B.3 — Pozo de resultado unificado */}
      {activePub && (
        <div className="flex flex-col gap-3 rounded-2xl bg-white/[0.02] ring-1 ring-hairline p-4">
          {/* Sub-bloque PUBLIC KEY */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-ink-muted">Public key</span>
            <div className="flex items-stretch gap-2">
              <code
                data-testid="keygen-pubkey"
                className="font-mono text-xs text-accent-soft break-all bg-bg rounded-2xl px-3 py-2.5 ring-1 ring-hairline flex-1"
              >
                {activePub}
              </code>
              <button
                type="button"
                onClick={handleCopyActivePub}
                aria-label={activePubCopied ? 'Public key copied' : 'Copy public key'}
                data-testid="keygen-copy-pub"
                className="shrink-0 inline-flex items-center justify-center w-[40px] rounded-2xl ring-1 ring-hairline text-ink-muted hover:text-ink hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {activePubCopied ? (
                  <Check size={16} weight="bold" aria-hidden />
                ) : (
                  <Copy size={16} aria-hidden />
                )}
              </button>
            </div>
            <span className="text-[11px] text-ink-muted">for your employer</span>
          </div>

          {/* Sub-bloque PRIVATE KEY (seed) — solo en camino generar */}
          {seedHex && pubHex && !recoveredPub && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] text-ink-muted">Private key (seed)</span>
              {/* Valor sr-only para tests y herramientas asistivas */}
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
              <span className="text-[11px] text-ink-muted">back up · never stored</span>
            </div>
          )}
        </div>
      )}

      {/* ZONA C — Save on this device en una sola fila */}
      {activePub && (
        <div className="flex flex-col gap-1.5">
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
          <p className="text-[11px] text-ink-muted">Public key only — never the seed.</p>
        </div>
      )}
    </div>
  )
}
