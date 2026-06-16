'use client'

import { useState } from 'react'
import { reconstructBatch, type BatchSummary } from 'viewkey'
import { Reveal } from '@/components/motion/Reveal'
import { ViewKeyInput } from '@/components/auditor/ViewKeyInput'
import { AuditorTable } from '@/components/auditor/AuditorTable'
import { ReconciliationFooter } from '@/components/auditor/ReconciliationFooter'
import { readDeployments, readPoolUsdcBalance } from '@/lib/rpc'

// The on-chain total T is the REAL USDC balance of the pool (independent source),
// not a demo constant. The reconciliation footer asserts that the sum of the
// auditor's decrypted amounts equals the USDC actually held by the pool — a real
// soundness check, not sum === sum.

type ConsoleState = 'idle' | 'loading' | 'done' | 'empty' | 'error'

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
    try {
      const auditorPrivkey = hexToBytes(viewKey)
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
      // T-06-15: any failure (malformed key, decrypt mismatch, RPC error) sets the
      // error state and the amber ring — never a crash.
      setSummary(null)
      setState('error')
    }
  }

  const invalid = state === 'error'
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

        <Reveal delay={0.1}>
          <ViewKeyInput
            value={viewKey}
            onChange={(v) => {
              setViewKey(v)
              // Clear a prior error (amber ring) as soon as the auditor edits.
              if (state === 'error') setState('idle')
            }}
            onReconstruct={handleReconstruct}
            processing={processing}
            invalid={invalid}
          />
        </Reveal>

        {/* Error (bad key) — UI-SPEC copy. The amber ring lives on the textarea. */}
        {state === 'error' && (
          <p className="mt-6 text-lead text-ink-muted">
            View-key did not decrypt any outputs. Check the key and try again.
          </p>
        )}

        {/* Empty (no batch events on-chain). */}
        {state === 'empty' && (
          <div className="mt-10">
            <h2 className="text-h2 font-[900] tracking-[-0.01em] leading-[1.15]">
              No batch events found.
            </h2>
            <p className="mt-3 text-lead text-ink-muted">
              The pool has no committed batches yet. Run{' '}
              <span className="font-mono">sobre pay nomina.csv</span> first.
            </p>
          </div>
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
              <div className="mb-6">
                <AuditorTable notes={summary.notes} reconstructed={reconstructed} />
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

        {/* Honest-disclosure footnote — Shared copy contract. */}
        <p className="mt-16 text-xs text-ink-muted">
          PoC — not audited. ZK proof is technical; confidentiality is a policy
          guarantee.
        </p>
      </section>
    </main>
  )
}
