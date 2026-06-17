'use client'

import { useState } from 'react'
import { reconstructBatch, keyFromBase64, type BatchSummary, type AuditorNote } from 'viewkey'
import { Reveal } from '@/components/motion/Reveal'
import { ViewKeyInput } from '@/components/auditor/ViewKeyInput'
import { AuditorTable } from '@/components/auditor/AuditorTable'
import { ReconciliationFooter } from '@/components/auditor/ReconciliationFooter'
import { KeygenCard } from '@/components/auditor/KeygenCard'
import { BatchGroupHeader } from '@/components/auditor/BatchGroupHeader'
import { readDeployments, readPoolUsdcBalance } from '@/lib/rpc'

// The on-chain total T is the REAL USDC balance of the pool (independent source),
// not a demo constant. The reconciliation footer asserts that the sum of the
// auditor's decrypted amounts equals the USDC actually held by the pool — a real
// soundness check, not sum === sum.

// 'invalid' = the pasted string is not a well-formed view-key (parse threw).
// 'empty'   = the key is valid but no notes in the pool decrypt under it.
// 'error'   = the reconstruct itself failed (RPC / unexpected). These are three
// distinct situations and must read differently to the auditor.
type ConsoleState = 'idle' | 'loading' | 'done' | 'empty' | 'invalid' | 'error'

/** Hex (or 0x-prefixed hex) → bytes. Throws nothing; malformed input yields a
 * wrong-length / NaN array that `reconstructBatch` rejects downstream (T-06-15:
 * the caller wraps this in try/catch, so a bad key never crashes the page). */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/, '')
  const out = new Uint8Array(Math.floor(clean.length / 2))
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/**
 * Parse a pasted view-key into 32 bytes, auto-detecting hex vs base64.
 *
 * The existing flow + Playwright fixture use 64-char hex (0x42 x 32); the new
 * KeygenCard emits URL-safe base64 (43 chars for 32 bytes). Detection rule: a
 * trimmed string that is exactly 64 hex chars (optionally 0x-prefixed) is hex;
 * anything else is tried as base64. Both throw downstream if the bytes are not a
 * valid 32-byte key, and handleReconstruct wraps this in try/catch (T-06-15: a
 * bad key sets the amber-ring error state, never crashes).
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

/**
 * Auditor console (`/auditor`, UX-03, D-09 / D-10 / A2).
 *
 * The product's signature interaction. The auditor pastes their X25519 view-key;
 * the browser reconstructs the batch via `reconstructBatch` (reusing the viewkey
 * engine, D-10) entirely client-side; the sealed amount bars slide away to reveal
 * per-employee amounts (Centerpiece, made real); the footer reconciles
 * sum(decrypted) against the on-chain total T.
 *
 * D-09 / A2 / T-06-12: the key NEVER leaves the browser. There is NO form action,
 * NO server action, NO API route — `reconstructBatch` runs in this `onClick`
 * handler. T-06-13: the key lives in component state only (never localStorage,
 * never logged, never in the URL).
 */
export default function AuditorPage() {
  const [viewKey, setViewKey] = useState('')
  const [state, setState] = useState<ConsoleState>('idle')
  const [summary, setSummary] = useState<BatchSummary | null>(null)
  const [onChainTotal, setOnChainTotal] = useState<bigint>(BigInt(0))

  async function handleReconstruct() {
    setState('loading')

    // Step 1 — validate the key shape FIRST, separately from reconstruction.
    // A parse failure means the pasted string is malformed (not 32 bytes); that is
    // a different situation from a well-formed key that simply decrypts nothing.
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
          // L6 / T-06-14: scan floor is the deployment ledger, never 0, to avoid
          // replaying stale events and bound the range to the live batch.
          fromLedger: deploymentLedger,
        },
        poolAddress: poolContractId,
        periodStart: deploymentLedger,
      })
      if (result.notes.length === 0) {
        // Valid key, zero matching notes. NOT an input error — the key is fine,
        // there is just nothing encrypted to it (e.g. a freshly generated key
        // against a batch sealed to a different key).
        setSummary(null)
        setState('empty')
        return
      }
      // Real reconciliation source: the USDC actually held by the pool on-chain.
      try {
        setOnChainTotal(await readPoolUsdcBalance())
      } catch {
        setOnChainTotal(BigInt(0))
      }
      setSummary(result)
      setState('done')
    } catch {
      // T-06-15: a reconstruction failure (RPC / unexpected) never crashes the page.
      setSummary(null)
      setState('error')
    }
  }

  // Amber ring = a genuine input/operation problem: a malformed key or a failed
  // reconstruct. The 'empty' state is NOT amber — the key is valid, so signalling
  // it as a mistake would be wrong (the bug the auditor flagged).
  const invalid = state === 'invalid' || state === 'error'
  const processing = state === 'loading'
  const reconstructed = state === 'done'

  const sumDecrypted = summary
    ? summary.notes.reduce((acc, n) => acc + n.amount, BigInt(0))
    : BigInt(0)
  const total = onChainTotal
  const match = summary ? sumDecrypted === onChainTotal : false

  return (
    <main className="min-h-dvh">
      <section className="py-24 px-4 max-w-5xl mx-auto">
        {/* Heading block — UI-SPEC Surface 3 copy. */}
        <Reveal delay={0}>
          <div className="mb-10">
            <h2 className="text-h2 font-[900] tracking-[-0.01em] leading-[1.15]">
              Auditor console
            </h2>
            <p className="mt-3 text-lead text-ink-muted">
              Paste your view-key to reconstruct the payroll batch.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.05}>
          <div className="mb-8">
            <KeygenCard />
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <ViewKeyInput
            value={viewKey}
            onChange={(v) => {
              setViewKey(v)
              // Clear any prior result signal as soon as the auditor edits.
              if (state === 'invalid' || state === 'empty' || state === 'error')
                setState('idle')
            }}
            onReconstruct={handleReconstruct}
            processing={processing}
            invalid={invalid}
          />
        </Reveal>

        {/* Malformed key — input error (amber ring fires on the textarea). */}
        {state === 'invalid' && (
          <p className="mt-6 text-lead text-ink-muted" data-testid="auditor-invalid">
            That doesn&apos;t look like a valid view-key. Paste a 64-character hex
            key, or the base64 key from Generate keypair above.
          </p>
        )}

        {/* Valid key, no notes — informational, NOT an error (no amber ring). */}
        {state === 'empty' && (
          <p className="mt-6 text-lead text-ink-muted" data-testid="auditor-empty">
            This view-key is valid, but no payroll notes are encrypted to it. In
            this demo the sample batch is sealed to a fixed key, so a freshly
            generated key won&apos;t decrypt it.
          </p>
        )}

        {/* Reconstruct failed (RPC / unexpected) — operation error (amber ring). */}
        {state === 'error' && (
          <p className="mt-6 text-lead text-ink-muted" data-testid="auditor-error">
            Couldn&apos;t reconstruct the batch (network or pool error). Try again.
          </p>
        )}

        {/* Done — reveal + reconciliation. */}
        {state === 'done' && summary && (
          <>
            <Reveal delay={0.1}>
              <div className="mt-10 mb-8">
                <h2 className="text-h2 font-[900] tracking-[-0.01em] leading-[1.15]">
                  Batch reconstructed.
                </h2>
                <p className="mt-3 text-lead text-ink-muted">
                  Individual amounts decrypted client-side from encrypted_outputs.
                </p>
              </div>
            </Reveal>

            <Reveal delay={0.15}>
              <div>
                {groupByLedger(summary.notes).map((group) => (
                  <div key={group.ledger} className="mb-6">
                    <BatchGroupHeader
                      ledger={group.ledger}
                      txHash={group.txHash}
                      noteCount={group.notes.length}
                      subSum={group.notes.reduce((a, n) => a + n.amount, 0n)}
                    />
                    <AuditorTable notes={group.notes} reconstructed={reconstructed} />
                  </div>
                ))}
              </div>
            </Reveal>

            <Reveal delay={0.2}>
              <ReconciliationFooter
                sumDecrypted={sumDecrypted}
                total={total}
                match={match}
              />
            </Reveal>
          </>
        )}

      </section>
    </main>
  )
}
