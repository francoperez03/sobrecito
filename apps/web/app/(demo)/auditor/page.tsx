'use client'

import { useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import {
  reconstructBatch,
  keyFromBase64,
  type BatchSummary,
  type AuditorNote,
} from 'viewkey'
import { CaretDown, Seal, Eye, Warning } from '@phosphor-icons/react'
import { Reveal } from '@/components/motion/Reveal'
import { DoubleBezel } from '@/components/ui/DoubleBezel'
import { ViewKeyInput } from '@/components/auditor/ViewKeyInput'
import { AuditorTable } from '@/components/auditor/AuditorTable'
import { ReconciliationFooter } from '@/components/auditor/ReconciliationFooter'
import { KeygenCard } from '@/components/auditor/KeygenCard'
import { BatchGroupHeader } from '@/components/auditor/BatchGroupHeader'
import { SealedState } from '@/components/auditor/SealedState'
import { readDeployments, fetchBatchExtAmount } from '@/lib/rpc'
import { markStep } from '@/lib/progressStore'

// The on-chain total T is the sum of the public per-batch deposit amounts
// (ext_amount), an independent on-chain source the ZK proof attests. The
// reconciliation footer asserts the auditor's decrypted detail equals that proven
// deposit total. It is withdrawal-invariant: employee claims drain the live pool
// balance but never change what was deposited (and proven) per batch.

// 'invalid' = the pasted string is not a well-formed view-key (parse threw).
// 'empty'   = the key is valid but no notes in the pool decrypt under it.
// 'error'   = the reconstruct itself failed (RPC / unexpected). Three distinct
// situations that must read differently to the auditor.
type ConsoleState = 'idle' | 'loading' | 'done' | 'empty' | 'invalid' | 'error'

const EASE_BRAND = [0.32, 0.72, 0, 1] as const

/** Hex (or 0x-prefixed hex) → bytes. Throws nothing; malformed input yields a
 * wrong-length array that `reconstructBatch` rejects downstream. */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/, '')
  const out = new Uint8Array(Math.floor(clean.length / 2))
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/**
 * Parse a pasted view-key into 32 bytes, auto-detecting hex vs base64. A trimmed
 * string that is exactly 64 hex chars (optionally 0x-prefixed) is hex; anything
 * else is tried as base64 (the KeygenCard emits 43-char url-safe base64). Both
 * throw on a non-32-byte result, which handleReconstruct turns into the 'invalid'
 * state rather than a crash.
 */
function parseViewKey(input: string): Uint8Array {
  const clean = input.trim().replace(/^0x/, '')
  if (/^[0-9a-fA-F]{64}$/.test(clean)) {
    return hexToBytes(clean)
  }
  return keyFromBase64(input.trim())
}

type BatchGroup = { ledger: number; txHash: string; notes: AuditorNote[] }

function groupByLedger(notes: AuditorNote[]): BatchGroup[] {
  const map = new Map<number, BatchGroup>()
  for (const note of notes) {
    if (!map.has(note.ledger)) {
      map.set(note.ledger, { ledger: note.ledger, txHash: note.txHash, notes: [] })
    }
    map.get(note.ledger)!.notes.push(note)
  }
  return [...map.values()].sort((a, b) => a.ledger - b.ledger)
}

type ChipTone = 'muted' | 'accent' | 'warn'

function StatusChip({ state }: { state: ConsoleState }) {
  const map: Record<
    ConsoleState,
    { label: string; tone: ChipTone; icon: ReactNode }
  > = {
    idle: { label: 'Sealed', tone: 'muted', icon: <Seal size={13} weight="fill" /> },
    loading: { label: 'Unsealing', tone: 'accent', icon: <Eye size={13} /> },
    done: { label: 'Revealed', tone: 'accent', icon: <Eye size={13} weight="fill" /> },
    empty: { label: 'Valid key · nothing sealed', tone: 'muted', icon: <Seal size={13} /> },
    invalid: { label: 'Invalid key', tone: 'warn', icon: <Warning size={13} weight="fill" /> },
    error: { label: 'Couldn’t reveal', tone: 'warn', icon: <Warning size={13} weight="fill" /> },
  }
  const { label, tone, icon } = map[state]
  const toneClass =
    tone === 'accent'
      ? 'text-accent-soft'
      : tone === 'warn'
        ? 'text-accent-warm'
        : 'text-ink-muted'
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-3 h-7 ring-1 ring-hairline text-xs ${toneClass}`}
    >
      <span className={state === 'loading' ? 'animate-pulse' : ''} aria-hidden>
        {icon}
      </span>
      {label}
    </span>
  )
}

/**
 * Auditor console (`/auditor`, UX-03, D-09 / D-10 / A2).
 *
 * The product's signature interaction, reframed around one beat: sealed → revealed.
 * One primary action (paste the view-key, reconstruct) owns the surface; keygen is
 * a secondary drawer. The batch surface is always present: it teaches the sealed
 * state up front, then reveals the per-employee amounts and reconciles their sum
 * against the on-chain total T.
 *
 * D-09 / A2 / T-06-12: the key NEVER leaves the browser. No form, no server action,
 * no API route — reconstructBatch runs in this onClick handler.
 */
export default function AuditorPage() {
  const [viewKey, setViewKey] = useState('')
  const [state, setState] = useState<ConsoleState>('idle')
  const [summary, setSummary] = useState<BatchSummary | null>(null)
  const [onChainTotal, setOnChainTotal] = useState<bigint>(BigInt(0))
  const [showKeygen, setShowKeygen] = useState(false)

  async function handleReconstruct() {
    setState('loading')

    // Step 1 — validate the key shape FIRST. A parse failure means the pasted
    // string is malformed, distinct from a valid key that decrypts nothing.
    let auditorPrivkey: Uint8Array
    try {
      auditorPrivkey = parseViewKey(viewKey)
    } catch {
      setSummary(null)
      setState('invalid')
      return
    }

    // Step 2 — reconstruct with a known-valid key.
    try {
      const { rpcUrl, poolContractId, deploymentLedger } = readDeployments()
      const result = await reconstructBatch({
        auditorPrivkey,
        source: {
          rpcUrl,
          poolContractId,
          // L6 / T-06-14: scan floor is the deployment ledger, never 0.
          fromLedger: deploymentLedger,
        },
        poolAddress: poolContractId,
        periodStart: deploymentLedger,
      })
      if (result.notes.length === 0) {
        // Valid key, zero matching notes — NOT an input error.
        setSummary(null)
        setState('empty')
        return
      }
      // On-chain total = Σ of the public per-batch deposit amounts (ext_amount),
      // which the ZK proof attests for each batch. This is withdrawal-INVARIANT:
      // employee claims drain the live pool USDC balance but never change the
      // proven deposit totals the decrypted detail must reconcile against. (Using
      // the live balance here caused a false "doesn't add up" once anyone cashed
      // out, since balance = deposits − withdrawals < Σ deposits.)
      try {
        const batches = groupByLedger(result.notes)
        const extAmounts = await Promise.all(
          batches.map((b) => fetchBatchExtAmount(b.txHash)),
        )
        const provenTotal = extAmounts.reduce<bigint>(
          (acc, v) => acc + (v ?? BigInt(0)),
          BigInt(0),
        )
        setOnChainTotal(provenTotal)
      } catch {
        setOnChainTotal(BigInt(0))
      }
      setSummary(result)
      setState('done')
      markStep('audit')
    } catch {
      setSummary(null)
      setState('error')
    }
  }

  // Amber ring = a genuine input/operation problem (malformed key or failed
  // reconstruct). 'empty' is NOT amber: the key is valid, so flagging it as a
  // mistake would be wrong.
  const invalid = state === 'invalid' || state === 'error'
  const processing = state === 'loading'
  const reconstructed = state === 'done'

  const sumDecrypted = summary
    ? summary.notes.reduce((acc, n) => acc + n.amount, BigInt(0))
    : BigInt(0)
  const match = summary ? sumDecrypted === onChainTotal : false
  const groups = summary ? groupByLedger(summary.notes) : []

  return (
    <main className="min-h-dvh">
      <section className="py-24 px-4 max-w-3xl mx-auto">
        <Reveal delay={0}>
          <header className="mb-8">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-h2 font-[900] tracking-[-0.01em] leading-[1.15]">
                Auditor console
              </h2>
              <StatusChip state={state} />
            </div>
            <p className="mt-3 text-lead text-ink-muted max-w-[52ch]">
              Hold the one key that turns a publicly sealed payroll into the ledger
              you are entitled to read.
            </p>
          </header>
        </Reveal>

        {/* Primary action — one panel owns the surface. */}
        <Reveal delay={0.05}>
          <DoubleBezel radius="2rem" className="p-5 sm:p-6">
            <ViewKeyInput
              value={viewKey}
              onChange={(v) => {
                setViewKey(v)
                if (state === 'invalid' || state === 'empty' || state === 'error')
                  setState('idle')
              }}
              onReconstruct={handleReconstruct}
              processing={processing}
              invalid={invalid}
            />

            <div className="mt-5 border-t border-hairline pt-4">
              <button
                type="button"
                onClick={() => setShowKeygen((v) => !v)}
                aria-expanded={showKeygen}
                aria-controls="keygen-drawer"
                className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md"
              >
                <CaretDown
                  size={14}
                  weight="bold"
                  aria-hidden
                  className={`transition-transform ${showKeygen ? 'rotate-180' : ''}`}
                />
                No view-key yet? Generate one
              </button>

              {showKeygen && (
                <motion.div
                  id="keygen-drawer"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, ease: EASE_BRAND }}
                  className="mt-5"
                >
                  <KeygenCard />
                </motion.div>
              )}
            </div>
          </DoubleBezel>
        </Reveal>

        {/* Batch surface — always present, state-driven. The focal point. */}
        <div className="mt-6">
          {state === 'idle' && (
            <DoubleBezel radius="2rem">
              <SealedState />
            </DoubleBezel>
          )}

          {state === 'loading' && (
            <DoubleBezel radius="2rem" className="px-6 py-6">
              <div className="flex flex-col gap-3" aria-label="Reading the ledger">
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
            <DoubleBezel radius="2rem" className="px-6 py-6">
              <p
                className="flex items-start gap-2.5 text-ink"
                data-testid="auditor-invalid"
              >
                <Warning
                  size={18}
                  weight="fill"
                  aria-hidden
                  className="mt-0.5 shrink-0 text-accent-warm"
                />
                <span>
                  That doesn&apos;t look like a valid view-key. Paste a 64-character
                  hex key, or the base64 key from Generate one.
                </span>
              </p>
            </DoubleBezel>
          )}

          {state === 'error' && (
            <DoubleBezel radius="2rem" className="px-6 py-6">
              <p
                className="flex items-start gap-2.5 text-ink"
                data-testid="auditor-error"
              >
                <Warning
                  size={18}
                  weight="fill"
                  aria-hidden
                  className="mt-0.5 shrink-0 text-accent-warm"
                />
                <span>
                  Couldn&apos;t reveal the payroll (network or pool error). Try
                  again.
                </span>
              </p>
            </DoubleBezel>
          )}

          {state === 'empty' && (
            <DoubleBezel radius="2rem" className="px-6 py-6">
              <p className="text-ink-muted leading-relaxed" data-testid="auditor-empty">
                This view-key is valid, but no payroll is encrypted to it. In this
                demo the sample payroll is sealed to a fixed key, so a freshly
                generated key won&apos;t decrypt it.
              </p>
            </DoubleBezel>
          )}

          {state === 'done' && summary && (
            <div className="flex flex-col gap-4">
              {groups.map((group, gi) => (
                <Reveal key={group.ledger} delay={gi * 0.06}>
                  <DoubleBezel radius="2rem" className="py-4">
                    <BatchGroupHeader
                      ledger={group.ledger}
                      txHash={group.txHash}
                      paymentCount={group.notes.filter((n) => n.amount > BigInt(0)).length}
                      paddingCount={group.notes.filter((n) => n.amount === BigInt(0)).length}
                      subSum={group.notes.reduce((a, n) => a + n.amount, BigInt(0))}
                    />
                    <AuditorTable notes={group.notes} reconstructed={reconstructed} />
                  </DoubleBezel>
                </Reveal>
              ))}

              <Reveal delay={groups.length * 0.06}>
                <ReconciliationFooter
                  sumDecrypted={sumDecrypted}
                  total={onChainTotal}
                  match={match}
                />
              </Reveal>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
