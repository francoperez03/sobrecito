'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import {
  Key,
  ShieldCheck,
  PaperPlaneTilt,
  HandCoins,
  MagnifyingGlass,
  Check,
  CaretDown,
  ArrowRight,
  ArrowCounterClockwise,
  ListChecks,
  type Icon,
} from '@phosphor-icons/react'
import { useDemoProgress, resetProgress, TOTAL_STEPS } from '@/lib/progressStore'
import { EASE_OUT } from '@/lib/motion'

/**
 * Global demo-progress panel. Slides out from the top-left and shows the 5-step
 * product flow; each step ticks when the visitor performs the real action (see
 * lib/progressStore). It teaches the flow and tracks progress at once.
 *
 * Opens on entry: the panel slides open once the page loads so the visitor sees
 * the flow to run, and stays open until they close it (no auto-close on the
 * entry open). A progress value restored from localStorage is still a silent
 * baseline — it never re-triggers the open/pulse logic. When a step genuinely
 * ticks, the panel opens, the freshly-checked step pulses once, and it closes
 * itself after a beat — deferred until the pointer leaves if you are hovering,
 * so it never demands a manual close. The per-step hint ("Go to … / click …")
 * renders inline under the active step and follows it down the list.
 * Reduced-motion = instant.
 */

// `cta` names the exact button to click on the destination tab.
const STEPS: { label: string; role: string; href: string; icon: Icon; cta: string }[] = [
  { label: 'Generate', role: 'Receive', href: '/receive', icon: Key, cta: 'Generate a new key' },
  { label: 'View-key', role: 'Audit', href: '/audit', icon: ShieldCheck, cta: 'Generate keypair' },
  { label: 'Pay', role: 'Pay', href: '/pay', icon: PaperPlaneTilt, cta: 'Send payroll' },
  { label: 'Claim', role: 'Receive', href: '/receive', icon: HandCoins, cta: 'Scan pool, then Claim' },
  { label: 'Audit', role: 'Audit', href: '/audit', icon: MagnifyingGlass, cta: 'Reconstruct batch' },
]

const AUTO_CLOSE_MS = 2800

export function DemoProgressPanel() {
  const completed = useDemoProgress()
  const reduce = useReducedMotion()
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  // Index of the step whose check should pulse once (the just-completed step).
  const [pulseIdx, setPulseIdx] = useState<number | null>(null)
  const hovering = useRef(false)
  // The first completed value observed after mount is a silent baseline: whatever
  // localStorage restores must NOT auto-open the panel. Only increments past the
  // baseline (genuine ticks) open it.
  const baseline = useRef<number | null>(null)
  const prev = useRef(completed)
  // Set when the auto-close timer fired while the pointer was over the panel —
  // we then close on mouseleave instead, so the panel always closes itself.
  const pendingClose = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The panel root — used to detect clicks/taps outside it so we can close.
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Open on entry. Deferred 2 seconds after mount so the panel animates in
  // (instead of popping open) and gives the visitor a beat to take in the page
  // before it slides out. The tick-driven auto-close never fires for this open,
  // so it stays open until the visitor closes it or navigates away.
  useEffect(() => {
    if (!mounted) return
    const id = setTimeout(() => setOpen(true), 2000)
    return () => clearTimeout(id)
  }, [mounted])

  // Open + pulse + schedule auto-close on a genuine step tick (never on the
  // restored baseline / page load).
  useEffect(() => {
    if (baseline.current === null) {
      baseline.current = completed
      prev.current = completed
      return
    }
    if (completed > prev.current && completed > 0) {
      setPulseIdx(completed - 1)
      setOpen(true)
      pendingClose.current = false
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        if (hovering.current) {
          pendingClose.current = true // defer: close when the pointer leaves
        } else {
          setOpen(false)
        }
      }, AUTO_CLOSE_MS)
    }
    prev.current = completed
  }, [completed])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  // Close on a click/tap anywhere outside the panel while it is open. The
  // launcher and the expanded list both live inside containerRef, so toggling
  // or navigating from within never triggers this.
  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        pendingClose.current = false
        if (timer.current) clearTimeout(timer.current)
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  if (!mounted) return null

  const done = completed >= TOTAL_STEPS

  function handleMouseLeave() {
    hovering.current = false
    if (pendingClose.current) {
      pendingClose.current = false
      setOpen(false)
    }
  }

  // Manual toggle wins: drop any deferred auto-close so it can't yank the panel
  // shut while the user is reading it.
  function toggleOpen() {
    pendingClose.current = false
    if (timer.current) clearTimeout(timer.current)
    setOpen((o) => !o)
  }

  return (
    <div
      ref={containerRef}
      className="fixed left-4 top-6 z-30 w-[min(20rem,calc(100vw-2rem))]"
      onMouseEnter={() => {
        hovering.current = true
      }}
      onMouseLeave={handleMouseLeave}
    >
      {/* Launcher */}
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-controls="demo-progress"
        aria-label={`Demo progress: ${completed} of ${TOTAL_STEPS} steps done`}
        className={`group inline-flex items-center gap-2.5 h-10 pl-3.5 pr-3 rounded-full bg-surface/90 ring-1 backdrop-blur-md transition-colors ${
          done ? 'ring-accent-soft/40' : 'ring-hairline hover:ring-hairline-strong'
        } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
      >
        <ListChecks
          size={16}
          weight="bold"
          className={done ? 'text-accent-soft' : 'text-ink-muted group-hover:text-ink'}
          aria-hidden
        />
        <span className="font-mono text-xs tabular-nums text-ink">
          {completed}
          <span className="text-ink-muted">/{TOTAL_STEPS}</span>
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
          className="flex text-ink-muted group-hover:text-ink"
        >
          <CaretDown size={13} weight="bold" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="demo-progress"
            key="demo-progress"
            initial={reduce ? false : { opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: reduce ? 0 : 0.26, ease: EASE_OUT }}
            className="mt-2 origin-top-left rounded-2xl bg-surface/95 ring-1 ring-white/20 backdrop-blur-md shadow-xl shadow-black/40 overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
              <span className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-ink-muted">
                Run the flow
              </span>
              <span className="font-mono text-[0.625rem] tabular-nums text-ink-muted">
                {completed}/{TOTAL_STEPS}
              </span>
            </div>

            <ol className="px-1.5 pb-1.5">
              {STEPS.map((s, i) => {
                const isDone = i < completed
                const isNext = i === completed
                const StepIcon = s.icon
                return (
                  <li key={s.label + i}>
                    <Link
                      href={s.href}
                      onClick={() => setOpen(false)}
                      className={`group flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                        isNext ? 'bg-white/[0.03]' : ''
                      }`}
                    >
                      {/* check / circle — pulses once when this step just completed */}
                      <motion.span
                        animate={i === pulseIdx ? { scale: [1, 1.15, 1] } : { scale: 1 }}
                        transition={{ duration: reduce ? 0 : 0.3, ease: EASE_OUT }}
                        onAnimationComplete={() => {
                          if (i === pulseIdx) setPulseIdx(null)
                        }}
                        className={`grid size-5 shrink-0 place-items-center rounded-full ${
                          isDone
                            ? 'bg-accent-fill text-white'
                            : isNext
                              ? 'ring-1 ring-accent-soft/50'
                              : 'ring-1 ring-hairline'
                        }`}
                        aria-hidden
                      >
                        {isDone && <Check size={12} weight="bold" />}
                      </motion.span>

                      <StepIcon
                        size={15}
                        weight="bold"
                        className={isDone ? 'text-accent-soft' : isNext ? 'text-ink' : 'text-ink-muted'}
                        aria-hidden
                      />

                      <span
                        className={`font-sans text-sm ${
                          isDone ? 'text-ink' : isNext ? 'text-ink' : 'text-ink-muted'
                        }`}
                      >
                        {s.label}
                      </span>
                      <span className="ml-auto font-mono text-[0.625rem] uppercase tracking-[0.14em] text-ink-muted">
                        {s.role}
                      </span>
                    </Link>

                    {/* Per-step detail, inline under the active step. It moves to a
                        different slot as `completed` advances (isNext follows down). */}
                    <AnimatePresence initial={false}>
                      {isNext && (
                        <motion.div
                          key="step-hint"
                          initial={reduce ? false : { opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                          transition={{ duration: reduce ? 0 : 0.22, ease: EASE_OUT }}
                          className="overflow-hidden"
                        >
                          {/* pl aligns under the label: row px-2.5 + size-5 circle +
                              gap-3 + ~15px icon + gap-3 ≈ 3.6rem. */}
                          <Link
                            href={s.href}
                            onClick={() => setOpen(false)}
                            className="group flex flex-col gap-0.5 pl-[3.6rem] pr-3 pb-2 pt-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded"
                          >
                            <span className="inline-flex items-center gap-1.5 font-mono text-xs text-accent-soft transition-colors group-hover:text-accent">
                              Go to {s.href}
                              <ArrowRight
                                size={12}
                                weight="bold"
                                className="transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5"
                              />
                            </span>
                            <span className="font-mono text-[0.625rem] text-ink-muted">
                              click &ldquo;{s.cta}&rdquo;
                            </span>
                          </Link>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </li>
                )
              })}
            </ol>

            {/* Slim footer: renders only when there is something to show, so an
                empty border-t never appears at completed === 0. */}
            {completed > 0 && (
              <div
                className={`border-t border-hairline px-3 py-2.5 flex items-center gap-3 ${
                  done ? 'justify-between' : 'justify-end'
                }`}
              >
                {done && (
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs text-accent-soft">
                    <Check size={12} weight="bold" aria-hidden />
                    All steps done
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => resetProgress()}
                  className="shrink-0 inline-flex items-center gap-1.5 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded"
                >
                  <ArrowCounterClockwise size={12} weight="bold" />
                  Reset
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
