'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { scanCommitmentEvents, type ScannedEvent } from 'viewkey'
import { Reveal } from '@/components/motion/Reveal'
import { BatchSummaryCard } from '@/components/dashboard/BatchSummaryCard'
import {
  PayrollTable,
  type PayrollRow,
} from '@/components/dashboard/PayrollTable'
import {
  readDeployments,
  readPoolUsdcBalance,
  formatUsdc,
  explorerTxUrl,
} from '@/lib/rpc'
import { PayrollComposer } from '@/components/employer/PayrollComposer'
import { DoubleBezel } from '@/components/ui/DoubleBezel'

// The total T shown here is the REAL on-chain USDC balance of the pool (read via
// a read-only SAC `balance` simulation), not a demo constant. It is the public
// predicate value; per-note amounts live only in encrypted_outputs and are NEVER
// decrypted on this page (A1, T-06-09).

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'empty' }
  | { phase: 'ready'; events: ScannedEvent[]; totalBase: bigint }

/** A batch is a group of ScannedEvents that share the same txHash. */
interface Batch {
  txHash: string
  ledger: number
  events: ScannedEvent[]
}

/**
 * Employer dashboard (`/employer`, UX-02, D-07/D-08).
 *
 * Read-only window into the live pool. Scans `NewCommitmentEvent`s via RPC and
 * renders payroll status WITHOUT ever exposing an individual amount — the
 * employer view matches what the public sees (status + sealed note). This is the
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
      {/* ------------------------------------------------------------------ */}
      {/* Composer section — send a new payroll batch (Wave 3, plan 06.2-06) */}
      {/* Rendered ABOVE the read-only dashboard so the employer can submit  */}
      {/* before seeing prior batch data.                                    */}
      {/* ------------------------------------------------------------------ */}
      <section className="py-24 px-4 max-w-5xl mx-auto border-b border-white/5">
        <Reveal delay={0}>
          <div className="mb-10">
            <h2 className="text-h2 font-[900] tracking-[-0.01em] leading-[1.15]">
              Send payroll
            </h2>
            <p className="mt-3 text-lead text-ink-muted">
              Load the salaries, generate the ZK proof in your browser, and send in one step.
            </p>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <PayrollComposer />
        </Reveal>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* On-chain record — A1 public lens into the sealed pool              */}
      {/* ------------------------------------------------------------------ */}
      <section className="py-24 px-4 max-w-5xl mx-auto">
        {/* Section heading */}
        <Reveal delay={0}>
          <div className="mb-10">
            <h2
              className="text-h2 font-[900] tracking-[-0.01em] leading-[1.15]"
              role="heading"
            >
              Payroll status
            </h2>
            <p className="mt-3 text-lead text-ink-muted">
              Real USDC moved into the pool. Anyone can verify the total; who receives what stays sealed.
            </p>
          </div>
        </Reveal>

        {state.phase === 'loading' && <LoadingSkeleton />}
        {state.phase === 'error' && <ErrorState />}
        {state.phase === 'empty' && <EmptyState />}

        {state.phase === 'ready' && (
          <ReadyView events={state.events} totalBase={state.totalBase} />
        )}
      </section>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Ready view — hero total + batch timeline + sealed-notes table + footer
// ---------------------------------------------------------------------------

function ReadyView({ events, totalBase }: { events: ScannedEvent[]; totalBase: bigint }) {
  const batches = groupByBatch(events)
  // Show all notes across all batches in the table, newest-batch-first
  const allRows = batches.flatMap((batch) => toRows(batch.events))

  return (
    <>
      {/* Proven-total hero */}
      <Reveal delay={0.1}>
        <div className="mb-8">
          <DoubleBezel radius="2rem" className="overflow-hidden">
            <div className="px-6 py-6">
              <p className="font-mono text-sm text-accent-soft">
                {formatUsdc(totalBase)} USDC funded · total proven on-chain ✓
              </p>
              <p className="mt-2 text-xs text-ink-muted/60">
                PoC · testnet. The pool balance is the public predicate; per-note amounts are sealed.
              </p>
            </div>
          </DoubleBezel>
        </div>
      </Reveal>

      {/* Batch timeline — newest first */}
      <Reveal delay={0.15}>
        <div className="mb-8">
          <h3 className="text-h3 font-[900] tracking-[-0.01em] leading-[1.15] mb-4">
            Batch timeline
          </h3>
          <div className="flex flex-col gap-3">
            {batches.map((batch, i) => (
              <BatchSummaryCard
                key={batch.txHash || i}
                total={`${formatUsdc(totalBase)} USDC`}
                txHash={batch.txHash}
                ledgerSeq={batch.ledger}
                noteCount={batch.events.length}
                dateLabel={`ledger ${batch.ledger}`}
              />
            ))}
          </div>
        </div>
      </Reveal>

      {/* Sealed-notes table */}
      <Reveal delay={0.2}>
        <div className="mb-10">
          <h3 className="text-h3 font-[900] tracking-[-0.01em] leading-[1.15] mb-4">
            Sealed notes
          </h3>
          <DoubleBezel radius="2rem" className="overflow-hidden">
            <div className="py-4">
              <PayrollTable rows={allRows} />
            </div>
          </DoubleBezel>
        </div>
      </Reveal>

      {/* Three-lens footer */}
      <Reveal delay={0.25}>
        <ThreeLensFooter />
      </Reveal>
    </>
  )
}

// ---------------------------------------------------------------------------
// Three-lens footer — who sees what
// ---------------------------------------------------------------------------

function ThreeLensFooter() {
  return (
    <div className="border-t border-white/5 pt-8">
      <p className="text-xs text-ink-muted/60 uppercase tracking-widest mb-4">Who sees what</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Public */}
        <div className="rounded-xl ring-1 ring-white/5 p-4 bg-surface/40">
          <p className="text-sm font-[600] text-ink mb-1">Public · this view</p>
          <p className="text-xs text-ink-muted leading-relaxed">
            Real USDC funded. Total proven on-chain. Notes are sealed and indistinguishable.
            Who receives what is unreadable.
          </p>
        </div>

        {/* Auditor */}
        <Link
          href="/auditor"
          className="rounded-xl ring-1 ring-white/5 p-4 bg-surface/40 hover:ring-accent/30 hover:bg-surface/60 transition-all group"
        >
          <p className="text-sm font-[600] text-ink mb-1 group-hover:text-accent-soft transition-colors">
            Auditor · /auditor ↗
          </p>
          <p className="text-xs text-ink-muted leading-relaxed">
            With the view-key, the auditor reconstructs per-employee detail for the
            batches they are authorized to review.
          </p>
        </Link>

        {/* Employee */}
        <Link
          href="/employee"
          className="rounded-xl ring-1 ring-white/5 p-4 bg-surface/40 hover:ring-accent/30 hover:bg-surface/60 transition-all group"
        >
          <p className="text-sm font-[600] text-ink mb-1 group-hover:text-accent-soft transition-colors">
            Employee · /employee ↗
          </p>
          <p className="text-xs text-ink-muted leading-relaxed">
            Each employee claims their own notes. No one else can see which note
            belongs to them.
          </p>
        </Link>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Group scanned events by batch (txHash), newest ledger first.
 * Events with an empty txHash are grouped together as a fallback batch.
 */
function groupByBatch(events: ScannedEvent[]): Batch[] {
  const map = new Map<string, Batch>()

  for (const event of events) {
    const key = event.txHash || '__unknown__'
    const existing = map.get(key)
    if (existing) {
      existing.events.push(event)
      if (event.ledger > existing.ledger) existing.ledger = event.ledger
    } else {
      map.set(key, { txHash: event.txHash, ledger: event.ledger, events: [event] })
    }
  }

  // Sort batches newest first
  return Array.from(map.values()).sort((a, b) => b.ledger - a.ledger)
}

/**
 * Map scanned commitment events to sealed-note payroll rows (no amounts, no identity).
 * Events sorted by index ascending within a batch.
 */
function toRows(events: ScannedEvent[]): PayrollRow[] {
  return events
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((event) => ({
      index: event.index + 1,
      // Display the commitment as a decimal string; truncation handled in PayrollTable.
      commitmentHex: event.commitment.toString(),
      status: 'proven' as const,
      date: `ledger ${event.ledger}`,
      explorerUrl: event.txHash ? explorerTxUrl(event.txHash) : undefined,
      // TODO(06.3): set claimStatus from NullifierSpentEvent scanner once
      // phase 06.3 (plans 02–04) delivers the nullifier scanner. Until then,
      // leave undefined so ClaimCell renders "—" gracefully.
      claimStatus: undefined,
    }))
}

// ---------------------------------------------------------------------------
// Loading / error / empty states
// ---------------------------------------------------------------------------

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
