'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check } from '@phosphor-icons/react'
import { type ScannedEvent } from 'viewkey'
import { Reveal } from '@/components/motion/Reveal'
import {
  readPoolUsdcBalance,
  formatUsdc,
  explorerTxUrl,
  explorerContractUrl,
  fetchBatchExtAmount,
  readDeployments,
} from '@/lib/rpc'
import { getChainAdapter } from '@/lib/chain'
import { PayrollComposer } from '@/components/employer/PayrollComposer'
import { DoubleBezel } from '@/components/ui/DoubleBezel'

/** Brand easing curve (matches ProvingStepper / ClaimStepper). */
const EASE_BRAND = [0.32, 0.72, 0, 1] as const

// The proven total shown here is the REAL on-chain USDC balance of the pool (read
// via a read-only SAC `balance` simulation), not a demo constant. It is the public
// predicate value; per-run amounts (ext_amount) are public, but the per-employee
// split lives only in encrypted_outputs and is NEVER decrypted on this page
// (A1, T-06-09).

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'empty' }
  | { phase: 'ready'; events: ScannedEvent[]; totalBase: bigint }

/** A pay run is a group of ScannedEvents that share the same txHash. */
interface Batch {
  txHash: string
  ledger: number
  events: ScannedEvent[]
}

/**
 * Employer console (`/employer`, UX-02, D-07/D-08).
 *
 * Two-column work surface on wide screens: the composer (run payroll) owns the
 * main area, and a sticky rail on the right is the read-only payroll record. As
 * the employer sends a batch, the rail refreshes in place (`onSent` → `scan`),
 * so paying flows straight into a sealed, proven record.
 *
 * The record never exposes an individual employee's amount — the employer view
 * matches what the public sees (proven total + per-run totals, the split sealed).
 * This is the UX embodiment of A1 ("sealed for the public").
 *
 * Pitfall 2: the viewkey import must be client-side, so this is a Client
 * Component. L6: always scan from `deploymentLedger`, never 0.
 */
export default function EmployerPage() {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const mountedRef = useRef(true)

  // Scan the live pool. `showLoading` flips the rail to the loading state on the
  // initial mount; a post-send refresh (showLoading=false) updates the record in
  // place, with no loading flash.
  const scan = useCallback(async (showLoading: boolean) => {
    if (showLoading) setState({ phase: 'loading' })
    try {
      const events = await getChainAdapter().events.scanCommitments()
      if (!mountedRef.current) return
      if (events.length === 0) {
        setState({ phase: 'empty' })
        return
      }
      // Real total = live pool USDC balance. Fall back to 0n if the read fails
      // so the rail still renders the committed runs.
      let totalBase = BigInt(0)
      try {
        totalBase = await readPoolUsdcBalance()
      } catch {
        totalBase = BigInt(0)
      }
      if (!mountedRef.current) return
      setState({ phase: 'ready', events, totalBase })
    } catch {
      if (mountedRef.current) setState({ phase: 'error' })
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void scan(true)
    return () => {
      mountedRef.current = false
    }
  }, [scan])

  return (
    <main className="min-h-dvh">
      <section className="py-24 px-4 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-12 lg:gap-16 items-start">
          {/* ---------------------------------------------------------------- */}
          {/* Main column — run payroll (compose + prove + send)               */}
          {/* ---------------------------------------------------------------- */}
          <div>
            <Reveal delay={0}>
              <div className="mb-10">
                <h2 className="text-h2 font-[900] tracking-[-0.01em] leading-[1.15]">
                  Run payroll
                </h2>
                <p className="mt-3 text-lead text-ink-muted">
                  Load the salaries, generate the proof in your browser, and pay in one step.
                </p>
              </div>
            </Reveal>
            <Reveal delay={0.1}>
              <PayrollComposer onSent={() => void scan(false)} />
            </Reveal>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* Sticky rail — payroll record (A1 sealed lens into the pool)      */}
          {/* ---------------------------------------------------------------- */}
          <aside className="lg:sticky lg:top-24">
            <Reveal delay={0.15}>
              <h3
                className="text-h3 font-[600] tracking-[-0.01em] leading-[1.15] mb-4"
                role="heading"
              >
                Payroll record
              </h3>
            </Reveal>

            <Reveal delay={0.2}>
              {/* Loading exits (fade down) before the loaded block enters (fade up). */}
              <AnimatePresence mode="wait">
                {state.phase === 'loading' && (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 16 }}
                    transition={{ duration: 0.4, ease: EASE_BRAND }}
                  >
                    <LoadingRecord />
                  </motion.div>
                )}

                {state.phase === 'error' && (
                  <motion.div
                    key="error"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 16 }}
                    transition={{ duration: 0.4, ease: EASE_BRAND }}
                  >
                    <ErrorState />
                  </motion.div>
                )}

                {state.phase === 'empty' && (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 16 }}
                    transition={{ duration: 0.4, ease: EASE_BRAND }}
                  >
                    <EmptyState />
                  </motion.div>
                )}

                {state.phase === 'ready' && (
                  <motion.div
                    key="ready"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: EASE_BRAND }}
                  >
                    <RailRecord events={state.events} totalBase={state.totalBase} />
                  </motion.div>
                )}
              </AnimatePresence>
            </Reveal>
          </aside>
        </div>
      </section>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Rail record — proven-total hero + per-run list
// ---------------------------------------------------------------------------

function RailRecord({ events, totalBase }: { events: ScannedEvent[]; totalBase: bigint }) {
  const runs = useMemo(() => groupByBatch(events), [events])
  // The pool contract id — the public anchor the proven total lives in. Linked to
  // Stellar Expert so anyone can inspect the on-chain pool directly.
  const poolContractId = readDeployments().poolContractId

  // Per-run funded amount: the deposit ext_amount (public, proven). Read each
  // run's deposit amount from its transaction (txHash → base units; null = unknown).
  const [amounts, setAmounts] = useState<Map<string, bigint | null>>(new Map())

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const entries = await Promise.all(
        runs.map(async (b) => [b.txHash, await fetchBatchExtAmount(b.txHash)] as const),
      )
      if (!cancelled) setAmounts(new Map(entries))
    })()
    return () => {
      cancelled = true
    }
  }, [runs])

  return (
    <div className="flex flex-col gap-4">
      {/* Proven-total hero */}
      <DoubleBezel radius="1.5rem" className="px-5 py-5">
        <p className="text-xs text-ink-muted uppercase tracking-widest">Proven total</p>
        <p className="mt-1.5 font-mono text-2xl text-ink leading-tight">
          {formatUsdc(totalBase)} USDC
        </p>
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent-soft">
          <Check size={13} weight="bold" aria-hidden />
          Proven on-chain
        </p>
        <p className="mt-3 text-[11px] text-ink-muted/70 leading-relaxed">
          Anyone can verify this total. Who got what stays sealed.
        </p>
        {poolContractId && (
          <a
            href={explorerContractUrl(poolContractId)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 font-mono text-[11px] text-ink-muted hover:text-accent-soft transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            View pool contract on Stellar Expert ↗
          </a>
        )}
      </DoubleBezel>

      {/* Per-run list — capped height + internal scroll so the sticky rail always
          fits the viewport (no pager, no virtualization: payroll runs are tens). */}
      <DoubleBezel radius="1.5rem" className="overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-5 py-3 text-xs uppercase tracking-widest text-ink-muted/60 border-b border-white/5">
          <span>Pay runs</span>
          <span className="tabular-nums text-ink-muted/40">{runs.length}</span>
        </div>

        <div className="scrollbar-subtle max-h-[20rem] overflow-y-auto overscroll-contain divide-y divide-white/5">
          {runs.map((run) => {
            const amount = amounts.get(run.txHash)
            return (
              <div
                key={run.txHash || run.ledger}
                className="flex items-center justify-between gap-3 px-5 py-3.5"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="font-mono text-sm text-accent-soft">
                    {amount != null ? `${formatUsdc(amount)} USDC` : '—'}
                  </span>
                  <span className="text-[11px] text-ink-muted/60 inline-flex items-center gap-1">
                    <Check size={10} weight="bold" aria-hidden className="text-accent-soft/70" />
                    Proven on-chain
                  </span>
                </div>
                {run.txHash ? (
                  <a
                    href={explorerTxUrl(run.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 font-mono text-[11px] text-ink-muted hover:text-accent-soft transition-colors"
                  >
                    {`${run.txHash.slice(0, 6)}… ↗`}
                  </a>
                ) : (
                  <span className="shrink-0 font-mono text-[11px] text-ink-muted/40">—</span>
                )}
              </div>
            )
          })}
        </div>
      </DoubleBezel>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Group scanned events by pay run (txHash), newest ledger first.
 * Events with an empty txHash are grouped together as a fallback run.
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

  // Sort runs newest first
  return Array.from(map.values()).sort((a, b) => b.ledger - a.ledger)
}

// ---------------------------------------------------------------------------
// Loading / error / empty states (rail-sized)
// ---------------------------------------------------------------------------

function LoadingRecord() {
  return (
    <DoubleBezel radius="1.5rem" className="px-5 py-6">
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading payroll record">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-4 rounded bg-ink/10 animate-pulse"
            style={{ width: `${82 - i * 14}%` }}
          />
        ))}
      </div>
    </DoubleBezel>
  )
}

function EmptyState() {
  return (
    <DoubleBezel radius="1.5rem" className="px-5 py-6">
      <h4 className="text-base font-[700] tracking-[-0.01em] text-ink">
        No payroll yet
      </h4>
      <p className="mt-2 text-sm text-ink-muted leading-relaxed">
        Run your first payroll and it&apos;ll appear here, sealed and proven.
      </p>
    </DoubleBezel>
  )
}

function ErrorState() {
  return (
    <DoubleBezel radius="1.5rem" className="px-5 py-6">
      <p className="text-sm text-ink-muted leading-relaxed">
        Could not reach the network. Check your connection and try again.
      </p>
    </DoubleBezel>
  )
}
