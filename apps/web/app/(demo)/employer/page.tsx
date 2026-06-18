'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CaretDown, CaretLeft, CaretRight } from '@phosphor-icons/react'
import { type ScannedEvent } from 'viewkey'
import { Reveal } from '@/components/motion/Reveal'
import {
  PayrollTable,
  type PayrollRow,
} from '@/components/dashboard/PayrollTable'
import {
  readPoolUsdcBalance,
  formatUsdc,
  explorerTxUrl,
  fetchBatchExtAmount,
} from '@/lib/rpc'
import { getChainAdapter } from '@/lib/chain'
import { PayrollComposer } from '@/components/employer/PayrollComposer'
import { DoubleBezel } from '@/components/ui/DoubleBezel'

/** Brand easing curve (matches ProvingStepper / ClaimStepper). */
const EASE_BRAND = [0.32, 0.72, 0, 1] as const

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
        const events = await getChainAdapter().events.scanCommitments()
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

        {/* Loading exits (fade down) before the loaded block enters (fade up). */}
        <AnimatePresence mode="wait">
          {state.phase === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 28 }}
              transition={{ duration: 0.5, ease: EASE_BRAND }}
            >
              <LoadingBatches />
            </motion.div>
          )}

          {state.phase === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 28 }}
              transition={{ duration: 0.5, ease: EASE_BRAND }}
            >
              <ErrorState />
            </motion.div>
          )}

          {state.phase === 'empty' && (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 28 }}
              transition={{ duration: 0.5, ease: EASE_BRAND }}
            >
              <EmptyState />
            </motion.div>
          )}

          {state.phase === 'ready' && (
            <motion.div
              key="ready"
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE_BRAND }}
            >
              <ReadyView events={state.events} totalBase={state.totalBase} />
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Ready view — hero total + batch timeline + sealed-notes table + footer
// ---------------------------------------------------------------------------

const BATCHES_PER_PAGE = 10

function ReadyView({ events, totalBase }: { events: ScannedEvent[]; totalBase: bigint }) {
  const batches = useMemo(() => groupByBatch(events), [events])

  // Per-batch funded amount: sealed in the commitment events, so read each batch's
  // deposit ext_amount from its transaction (txHash → base units; null = unknown).
  const [amounts, setAmounts] = useState<Map<string, bigint | null>>(new Map())
  const [openTx, setOpenTx] = useState<string | null>(null)
  const [batchPage, setBatchPage] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const entries = await Promise.all(
        batches.map(async (b) => [b.txHash, await fetchBatchExtAmount(b.txHash)] as const),
      )
      if (!cancelled) setAmounts(new Map(entries))
    })()
    return () => {
      cancelled = true
    }
  }, [batches])

  // Clamp batchPage when the batch count changes (e.g. after a new payroll lands).
  const batchPageCount = Math.max(1, Math.ceil(batches.length / BATCHES_PER_PAGE))
  const currentBatchPage = Math.min(batchPage, batchPageCount - 1)
  const visibleBatches = batches.slice(
    currentBatchPage * BATCHES_PER_PAGE,
    currentBatchPage * BATCHES_PER_PAGE + BATCHES_PER_PAGE,
  )

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
                The pool balance is the public predicate; per-note amounts are sealed.
              </p>
            </div>
          </DoubleBezel>
        </div>
      </Reveal>

      {/* Batches — one collapsible table; each row expands to its sealed notes */}
      <Reveal delay={0.15}>
        <div className="mb-10">
          <h3 className="text-h3 font-[600] tracking-[-0.01em] leading-[1.15] mb-4">
            Batches
          </h3>
          <DoubleBezel radius="2rem" className="overflow-hidden">
            {/* Column header */}
            <div className="flex items-center gap-4 px-6 py-3 text-xs uppercase tracking-widest text-ink-muted/60 border-b border-white/5">
              <span className="flex-1">Amount</span>
              <span className="w-16 text-right">Notes</span>
              <span className="w-44 text-right">Tx</span>
              <span className="w-5" aria-hidden />
            </div>

            <div className="divide-y divide-white/5">
              {visibleBatches.map((batch) => {
                const amount = amounts.get(batch.txHash)
                const isOpen = openTx === batch.txHash
                return (
                  <Fragment key={batch.txHash || batch.ledger}>
                    <button
                      type="button"
                      onClick={() => setOpenTx(isOpen ? null : batch.txHash)}
                      aria-expanded={isOpen}
                      className="w-full flex items-center gap-4 px-6 py-4 text-left hover:bg-surface/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                    >
                      <span className="flex-1 font-mono text-sm text-accent-soft">
                        {amount != null ? `${formatUsdc(amount)} USDC` : '—'}
                      </span>
                      <span className="w-16 text-right font-mono text-xs text-ink-muted">
                        {batch.events.length}
                      </span>
                      {batch.txHash ? (
                        <a
                          href={explorerTxUrl(batch.txHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="w-44 text-right font-mono text-xs text-ink-muted hover:text-accent-soft transition-colors"
                        >
                          {`${batch.txHash.slice(0, 8)}…${batch.txHash.slice(-6)} ↗`}
                        </a>
                      ) : (
                        <span className="w-44 text-right font-mono text-xs text-ink-muted/40">—</span>
                      )}
                      <CaretDown
                        size={14}
                        weight="bold"
                        aria-hidden
                        className={`w-5 shrink-0 text-ink-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {isOpen && (
                      <div className="px-6 pb-5 pt-1 bg-surface/20">
                        <p className="text-xs text-ink-muted/60 mb-2">
                          {batch.events.length} sealed notes · amounts sealed · ledger {batch.ledger}
                        </p>
                        <PayrollTable rows={toRows(batch.events)} />
                      </div>
                    )}
                  </Fragment>
                )
              })}
            </div>

            {/* Batch pager — shown only when there are more than BATCHES_PER_PAGE batches */}
            {batchPageCount > 1 && (
              <div className="flex items-center justify-between gap-4 px-6 py-3 border-t border-white/5">
                <span className="font-mono text-xs text-ink-muted tabular-nums">
                  {currentBatchPage * BATCHES_PER_PAGE + 1}–{Math.min((currentBatchPage + 1) * BATCHES_PER_PAGE, batches.length)} of {batches.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Previous batch page"
                    disabled={currentBatchPage === 0}
                    onClick={() => setBatchPage(currentBatchPage - 1)}
                    className="inline-flex items-center justify-center size-8 rounded-full text-ink-muted transition-colors hover:text-ink hover:bg-white/5 disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <CaretLeft size={15} weight="bold" />
                  </button>
                  <span className="font-mono text-xs text-ink-muted tabular-nums px-1.5">
                    {currentBatchPage + 1} / {batchPageCount}
                  </span>
                  <button
                    type="button"
                    aria-label="Next batch page"
                    disabled={currentBatchPage >= batchPageCount - 1}
                    onClick={() => setBatchPage(currentBatchPage + 1)}
                    className="inline-flex items-center justify-center size-8 rounded-full text-ink-muted transition-colors hover:text-ink hover:bg-white/5 disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <CaretRight size={15} weight="bold" />
                  </button>
                </div>
              </div>
            )}
          </DoubleBezel>
        </div>
      </Reveal>
    </>
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

function LoadingBatches() {
  return (
    <div
      className="flex items-center justify-center py-28"
      aria-busy="true"
      aria-label="Loading batches"
    >
      <motion.p
        className="text-lead font-mono text-ink-muted text-center"
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        Loading batches
      </motion.p>
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
