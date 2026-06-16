'use client'

import { useEffect, useState } from 'react'
import { scanCommitmentEvents, type ScannedEvent } from 'viewkey'
import { Reveal } from '@/components/motion/Reveal'
import { BatchSummaryCard } from '@/components/dashboard/BatchSummaryCard'
import {
  PayrollTable,
  type PayrollRow,
} from '@/components/dashboard/PayrollTable'
import { readDeployments, readPoolUsdcBalance, formatUsdc } from '@/lib/rpc'

// The total T shown here is the REAL on-chain USDC balance of the pool (read via
// a read-only SAC `balance` simulation), not a demo constant. It is the public
// predicate value; per-note amounts live only in encrypted_outputs and are NEVER
// decrypted on this page (A1, T-06-09).

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'empty' }
  | { phase: 'ready'; events: ScannedEvent[]; totalBase: bigint }

/**
 * Employer dashboard (`/employer`, UX-02, D-07/D-08).
 *
 * Read-only window into the live pool. Scans `NewCommitmentEvent`s via RPC and
 * renders payroll status WITHOUT ever exposing an individual amount — the
 * employer view matches what the public sees (status + commitment). This is the
 * UX embodiment of A1 ("sealed for the public").
 *
 * Pitfall 2: the viewkey import must be client-side, so this is a Client
 * Component. L6: always scan from `deploymentLedger`, never 0.
 */
export default function EmployerPage() {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function scan() {
      try {
        const { rpcUrl, poolContractId, deploymentLedger } = readDeployments()
        const events = await scanCommitmentEvents({
          rpcUrl,
          poolContractId,
          fromLedger: deploymentLedger,
        })
        if (cancelled) return
        if (events.length === 0) {
          setState({ phase: 'empty' })
        } else {
          // Real total = live pool USDC balance. Fall back to 0n if the read
          // fails so the page still renders the committed batch.
          let totalBase = BigInt(0)
          try {
            totalBase = await readPoolUsdcBalance()
          } catch {
            totalBase = BigInt(0)
          }
          if (cancelled) return
          setState({ phase: 'ready', events, totalBase })
        }
      } catch {
        if (!cancelled) setState({ phase: 'error' })
      }
    }

    scan()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="min-h-dvh">
      <section className="py-24 px-4 max-w-5xl mx-auto">
        {/* Heading block — UI-SPEC Surface 2 copy. */}
        <Reveal delay={0}>
          <div className="mb-10">
            <h2 className="text-h2 font-[900] tracking-[-0.01em] leading-[1.15]">
              Payroll status
            </h2>
            <p className="mt-3 text-lead text-ink-muted">
              Batch committed on-chain — amounts sealed, total proven.
            </p>
          </div>
        </Reveal>

        {state.phase === 'loading' && <LoadingSkeleton />}
        {state.phase === 'error' && <ErrorState />}
        {state.phase === 'empty' && <EmptyState />}

        {state.phase === 'ready' && (
          <>
            <Reveal delay={0.1}>
              <div className="mb-6">
                <BatchSummaryCard
                  total={`${formatUsdc(state.totalBase)} USDC`}
                  txHash={readDeployments().poolContractId}
                  ledgerSeq={batchLedger(state.events)}
                />
              </div>
            </Reveal>

            <Reveal delay={0.2}>
              <PayrollTable rows={toRows(state.events)} />
            </Reveal>
          </>
        )}

      </section>
    </main>
  )
}

/** Map scanned commitment events to read-only payroll rows (no amounts). */
function toRows(events: ScannedEvent[]): PayrollRow[] {
  return events
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((event) => ({
      index: event.index + 1,
      employeeLabel: `Employee #${event.index + 1}`,
      status: 'proven' as const,
      date: `ledger ${event.ledger}`,
    }))
}

/** The ledger the batch committed at (max event ledger). */
function batchLedger(events: ScannedEvent[]): number {
  return events.reduce((max, e) => (e.ledger > max ? e.ledger : max), 0)
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="bg-surface/50 rounded h-[20px] animate-pulse opacity-60"
        />
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="py-12">
      <h2 className="text-h2 font-[900] tracking-[-0.01em] leading-[1.15]">
        No batch on-chain yet.
      </h2>
      <p className="mt-3 text-lead text-ink-muted">
        Run <span className="font-mono">sobre pay nomina.csv</span> to submit the
        first payroll batch.
      </p>
    </div>
  )
}

function ErrorState() {
  return (
    <div className="py-12">
      <p className="text-lead text-ink-muted">
        Could not reach the pool. Check your RPC connection and try again.
      </p>
    </div>
  )
}
