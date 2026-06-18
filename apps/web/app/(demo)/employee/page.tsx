'use client'

import { useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import {
  Seal,
  Eye,
  KeyReturn,
  ArrowsClockwise,
  MagnifyingGlass,
  WifiSlash,
} from '@phosphor-icons/react'
import { Reveal } from '@/components/motion/Reveal'
import { DoubleBezel } from '@/components/ui/DoubleBezel'
import { EmployeeKeyInput } from '@/components/employee/EmployeeKeyInput'
import { KeyGenerator } from '@/components/employee/KeyGenerator'
import { DashboardSummary } from '@/components/employee/DashboardSummary'
import { EmployeeNotesTable } from '@/components/employee/EmployeeNotesTable'
import { ClaimStepper, type ClaimStep } from '@/components/employee/ClaimStepper'
import { parseEmployeeKey, deriveEmployeeKeys } from '@/lib/zk/keyDerivation'
import {
  scanEmployeeNotes,
  reconstructMerklePathFromEvents,
  type EmployeeNote,
} from '@/lib/employee-scan'
import { getChainAdapter } from '@/lib/chain'
import { computeNullifier } from '@/lib/zk/proverClient'
import { claimNote } from '@/lib/employee-claim'
import { markStep } from '@/lib/progressStore'
import { type ScannedEvent } from 'viewkey'

// ---------------------------------------------------------------------------
// Dashboard state machine
// ---------------------------------------------------------------------------

type DashboardState = 'idle' | 'scanning' | 'done' | 'empty' | 'invalid' | 'error'

type NoteStatus = 'pending' | 'claimed' | 'unknown'

interface EmployeeNoteWithStatus extends EmployeeNote {
  status: NoteStatus
  receiptTxHash?: string
}

// ---------------------------------------------------------------------------
// StatusChip
// ---------------------------------------------------------------------------

const EASE_BRAND = [0.32, 0.72, 0, 1] as const

type ChipTone = 'muted' | 'accent' | 'warn'

function StatusChip({ state }: { state: DashboardState }) {
  // The chip is a calm status marker, not an alarm. invalid/error stay muted
  // (the input ring + the panel below already carry the corrective signal), so
  // the header never shouts a red "Invalid key" over the whole page.
  const map: Record<DashboardState, { label: string; tone: ChipTone; icon: ReactNode }> = {
    idle:     { label: 'Sealed',        tone: 'muted',  icon: <Seal size={13} weight="fill" /> },
    scanning: { label: 'Scanning pool', tone: 'accent', icon: <Eye size={13} /> },
    done:     { label: 'Notes found',   tone: 'accent', icon: <Eye size={13} weight="fill" /> },
    empty:    { label: 'No notes',      tone: 'muted',  icon: <Seal size={13} /> },
    invalid:  { label: 'Check key',     tone: 'muted',  icon: <KeyReturn size={13} /> },
    error:    { label: 'Retry',         tone: 'muted',  icon: <ArrowsClockwise size={13} /> },
  }
  const { label, tone, icon } = map[state]
  const toneClass =
    tone === 'accent' ? 'text-accent-soft' : tone === 'warn' ? 'text-accent-warm' : 'text-ink-muted'
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-3 h-7 ring-1 ring-hairline text-xs ${toneClass}`}
    >
      <span className={state === 'scanning' ? 'animate-pulse' : ''} aria-hidden>
        {icon}
      </span>
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// StatePanel — editorial empty/invalid/error surface (icon medallion + copy)
// ---------------------------------------------------------------------------

/**
 * A single visual language for the non-result states so they read as part of the
 * dashboard, not a generic gray alert box. Each state gets a themed medallion
 * (icon in a tinted ring), a short title, and one calm explanatory line.
 *
 * tone:
 *   'warm' — corrective/transient (invalid key, network error): amber accent.
 *   'calm' — valid key, nothing yet (empty): neutral accent, no alarm. A valid
 *            key with no notes is the sealed model working, not an error.
 */
function StatePanel({
  testId,
  tone,
  icon,
  title,
  body,
}: {
  testId: string
  tone: 'warm' | 'calm'
  icon: ReactNode
  title: string
  body: string
}) {
  const medallion =
    tone === 'warm'
      ? 'bg-accent-warm/10 text-accent-warm ring-accent-warm/25'
      : 'bg-accent/10 text-accent-soft ring-hairline'
  return (
    <div className="flex items-start gap-4" data-testid={testId}>
      <span
        className={`mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1 ${medallion}`}
        aria-hidden
      >
        {icon}
      </span>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-base font-[700] tracking-[-0.01em] text-ink leading-snug">
          {title}
        </h3>
        <p className="text-sm text-ink-muted leading-relaxed max-w-[54ch]">{body}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// EmployeePage
// ---------------------------------------------------------------------------

/**
 * Employee dashboard (/employee, CAP-1/2/3/5/6/7/8).
 *
 * The employee identifies with their key (32-byte seed, hex or base64), scans
 * the pool, decrypts their notes, views balance summary and per-note status,
 * and claims each note via in-browser ZK proof + Freighter. The key can be
 * generated in-browser (KeyGenerator) when the employee does not have one yet.
 *
 * The key NEVER leaves the browser: no server action, no API route, no form.
 * `handleScan` runs entirely client-side. On claim, the amount becomes publicly
 * visible on-chain (amber-warned in NoteCard BEFORE the CTA, A1 / T-063-11).
 */
export default function EmployeePage() {
  const [key, setKey] = useState('')
  const [state, setState] = useState<DashboardState>('idle')
  const [notes, setNotes] = useState<EmployeeNoteWithStatus[]>([])
  const [scannedEvents, setScannedEvents] = useState<ScannedEvent[]>([])
  const [claimingIndex, setClaimingIndex] = useState<number | null>(null)
  const [claimStep, setClaimStep] = useState<ClaimStep>({ phase: 'idle' })
  const [bn254PrivKey, setBn254PrivKey] = useState<bigint | null>(null)

  async function handleScan() {
    setState('scanning')
    setNotes([])

    // Step 1: validate key shape (mirrors auditor page lines 130-137).
    let seed: Uint8Array
    try {
      seed = parseEmployeeKey(key)
    } catch {
      setState('invalid')
      return
    }

    // Step 2: scan with a known-valid key (browser-only; proverClient is called inside).
    try {
      const { bn254Priv, x25519Priv } = await deriveEmployeeKeys(seed)
      setBn254PrivKey(bn254Priv)

      const events = getChainAdapter().events
      // Scan the pool ONCE; reuse the raw events for both note discovery and the
      // claim-time Merkle path reconstruction (a single RPC round-trip).
      const allEvents = await events.scanCommitments()
      const found = await scanEmployeeNotes(x25519Priv, { events: allEvents })

      if (found.length === 0) {
        setState('empty')
        return
      }

      // Determine claimed status from the pool's spent-nullifier event log.
      // pool.is_spent is a PRIVATE contract fn (not invocable via simulate), so we
      // read the set of burned nullifiers from the NewNullifierEvent log instead.
      const spentNullifiers = await events.scanSpentNullifiers()

      const withStatus: EmployeeNoteWithStatus[] = await Promise.all(
        found.map(async (n) => {
          let status: NoteStatus = 'pending'
          try {
            // The spent nullifier is bound to the note's REAL amount and Merkle
            // path index (see claimNote: computeNullifier with path.pathIndices +
            // note.amount). Recompute it the SAME way — rebuilding the same path
            // the claim uses from the full event history — so the value matches
            // the nullifier the pool recorded on claim.
            const { pathIndices } = await reconstructMerklePathFromEvents(allEvents, n.index)
            const nullifier = await computeNullifier(
              bn254Priv,
              n.blinding,
              BigInt(pathIndices),
              n.amount,
            )
            status = spentNullifiers.has(nullifier.toString()) ? 'claimed' : 'pending'
          } catch {
            status = 'pending' // A1: degrade gracefully on error
          }
          return { ...n, status }
        }),
      )

      setNotes(withStatus)
      // The claim reconstructs the pool's Merkle path client-side (A2 fallback:
      // pool.get_proof is absent). It MUST use the FULL pool commitment history so
      // the rebuilt root matches the on-chain root — not just the employee's notes.
      setScannedEvents(allEvents)
      setState('done')
    } catch {
      setState('error')
    }
  }

  async function handleClaim(noteIndex: number) {
    if (!bn254PrivKey) return
    setClaimingIndex(noteIndex)
    setClaimStep({ phase: 'fetching-proof' })

    const note = notes.find((n) => n.index === noteIndex)
    if (!note) return

    try {
      // Freighter provides the recipient address; claimNote calls requestAccess internally.
      // We pass an empty recipient here; unshieldNote fetches the address from Freighter.
      const result = await claimNote(
        note,
        bn254PrivKey,
        '', // unshieldNote resolves the Freighter address
        scannedEvents,
        (step) => setClaimStep(step),
      )

      // Flip the note to 'claimed' and attach the receipt tx hash.
      setNotes((prev) =>
        prev.map((n) =>
          n.index === noteIndex
            ? { ...n, status: 'claimed', receiptTxHash: result.hash }
            : n,
        ),
      )
      markStep('claim')
    } catch (err) {
      setClaimStep({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Claim failed. Try again.',
      })
    } finally {
      setClaimingIndex(null)
    }
  }

  function handleDismissStepper() {
    setClaimStep({ phase: 'idle' })
  }

  const invalid = state === 'invalid' || state === 'error'
  const processing = state === 'scanning'

  return (
    <main className="min-h-dvh">
      {/* max-w-4xl (vs the auditor's 3xl) so a 64-char hex key fits one mono line. */}
      <section className="py-24 px-4 max-w-4xl mx-auto">
        <Reveal delay={0}>
          <header className="mb-8">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-h2 font-[900] tracking-[-0.01em] leading-[1.15]">
                Employee dashboard
              </h2>
              <StatusChip state={state} />
            </div>
            <p className="mt-3 text-lead text-ink-muted max-w-[52ch]">
              Paste your employee key to scan the pool and claim your salary. No key
              yet? Generate one below.
            </p>
          </header>
        </Reveal>

        {/* Primary action: key input + scan CTA, with the in-browser key generator below. */}
        <Reveal delay={0.05}>
          <DoubleBezel radius="2rem" className="p-5 sm:p-6">
            <EmployeeKeyInput
              value={key}
              onChange={(v) => {
                setKey(v)
                if (state === 'invalid' || state === 'empty' || state === 'error')
                  setState('idle')
              }}
              onScan={handleScan}
              processing={processing}
              invalid={invalid}
            />
            <div className="mt-5 pt-5 border-t border-hairline">
              <KeyGenerator />
            </div>
          </DoubleBezel>
        </Reveal>

        {/* State-driven batch surface */}
        <div className="mt-6">
          {state === 'idle' && null}

          {state === 'scanning' && (
            <DoubleBezel radius="2rem" className="px-6 py-6">
              <div className="flex flex-col gap-3" aria-label="Scanning pool">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-5 rounded bg-ink/10 animate-pulse"
                    style={{ width: `${88 - i * 9}%` }}
                  />
                ))}
              </div>
            </DoubleBezel>
          )}

          {state === 'invalid' && (
            <DoubleBezel radius="2rem" className="px-6 py-7">
              <StatePanel
                testId="employee-invalid"
                tone="warm"
                icon={<KeyReturn size={20} weight="bold" aria-hidden />}
                title="That key didn't parse"
                body="An employee key is a 64-character hex string (or the base64 key from Generate one). Check for a missing or extra character and paste it again."
              />
            </DoubleBezel>
          )}

          {state === 'error' && (
            <DoubleBezel radius="2rem" className="px-6 py-7">
              <StatePanel
                testId="employee-error"
                tone="warm"
                icon={<WifiSlash size={20} weight="bold" aria-hidden />}
                title="Couldn't reach the pool"
                body="A network or pool error interrupted the scan. Your key never left the browser. Click Scan pool to try again."
              />
            </DoubleBezel>
          )}

          {state === 'empty' && (
            <DoubleBezel radius="2rem" className="px-6 py-7">
              <StatePanel
                testId="employee-empty"
                tone="calm"
                icon={<MagnifyingGlass size={20} weight="bold" aria-hidden />}
                title="Key is valid, nothing sealed to it yet"
                body="No notes in the pool decrypt under this key. If your employer just ran payroll, wait for the deposit to confirm on-chain, then scan again."
              />
            </DoubleBezel>
          )}

          {state === 'done' && notes.length > 0 && (
            <div className="flex flex-col gap-4">
              <Reveal delay={0}>
                <DashboardSummary notes={notes} />
              </Reveal>

              {/* ClaimStepper: shown when a claim is in progress */}
              {claimStep.phase !== 'idle' && (
                <Reveal delay={0.06}>
                  <div>
                    <ClaimStepper step={claimStep} />
                    {(claimStep.phase === 'done' || claimStep.phase === 'error') && (
                      <motion.button
                        type="button"
                        onClick={handleDismissStepper}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3, ease: EASE_BRAND }}
                        className="mt-3 text-sm text-ink-muted hover:text-ink transition-colors"
                      >
                        Close
                      </motion.button>
                    )}
                  </div>
                </Reveal>
              )}

              {/* Compact payments table (auditor-style): one row per payment, per-row
                  Claim, amount revealed inline once the withdraw confirms. */}
              <Reveal delay={0.12}>
                <EmployeeNotesTable
                  notes={notes}
                  onClaim={handleClaim}
                  claimingIndex={claimingIndex}
                />
              </Reveal>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
