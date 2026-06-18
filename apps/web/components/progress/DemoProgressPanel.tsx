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
 * lib/progressStore). It teaches the flow and tracks progress at once. Collapsed
 * by default; auto-opens briefly when a step ticks. Reduced-motion = instant.
 */

// `cta` names the exact button to click on the destination tab.
const STEPS: { label: string; role: string; href: string; icon: Icon; cta: string }[] = [
  { label: 'Generate', role: 'Employee', href: '/employee', icon: Key, cta: 'Generate a new key' },
  { label: 'View-key', role: 'Auditor', href: '/auditor', icon: ShieldCheck, cta: 'Generate keypair' },
  { label: 'Pay', role: 'Employer', href: '/employer', icon: PaperPlaneTilt, cta: 'Send payroll' },
  { label: 'Claim', role: 'Employee', href: '/employee', icon: HandCoins, cta: 'Scan pool, then Claim' },
  { label: 'Audit', role: 'Auditor', href: '/auditor', icon: MagnifyingGlass, cta: 'Reconstruct batch' },
]

const AUTO_CLOSE_MS = 2800

export function DemoProgressPanel() {
  const completed = useDemoProgress()
  const reduce = useReducedMotion()
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const hovering = useRef(false)
  const prev = useRef(completed)
  // Armed only after the hydration settle (server snapshot 0 -> real value) so the
  // initial localStorage read is not mistaken for a fresh tick on page load.
  const armed = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setMounted(true)
    const t = setTimeout(() => {
      armed.current = true
    }, 200)
    return () => clearTimeout(t)
  }, [])

  // Auto-open for a moment whenever a new step ticks (only after arming).
  useEffect(() => {
    if (armed.current && completed > prev.current && completed > 0) {
      setOpen(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        if (!hovering.current) setOpen(false)
      }, AUTO_CLOSE_MS)
    }
    prev.current = completed
  }, [completed])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  if (!mounted) return null

  const done = completed >= TOTAL_STEPS

  return (
    <div
      className="fixed left-4 top-6 z-30 w-[min(20rem,calc(100vw-2rem))]"
      onMouseEnter={() => {
        hovering.current = true
      }}
      onMouseLeave={() => {
        hovering.current = false
      }}
    >
      {/* Launcher */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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
            className="mt-2 origin-top-left rounded-2xl bg-surface/95 ring-1 ring-hairline backdrop-blur-md shadow-xl shadow-black/40 overflow-hidden"
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
                      {/* check / circle */}
                      <span
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
                      </span>

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
                  </li>
                )
              })}
            </ol>

            <div className="border-t border-hairline px-3 py-2.5 flex items-start justify-between gap-3">
              {completed < TOTAL_STEPS ? (
                <Link
                  href={STEPS[completed].href}
                  onClick={() => setOpen(false)}
                  className="group flex flex-col gap-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded"
                >
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs text-accent-soft transition-colors group-hover:text-accent">
                    Go to {STEPS[completed].href}
                    <ArrowRight
                      size={12}
                      weight="bold"
                      className="transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5"
                    />
                  </span>
                  <span className="font-mono text-[0.625rem] text-ink-muted">
                    click &ldquo;{STEPS[completed].cta}&rdquo;
                  </span>
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-mono text-xs text-accent-soft">
                  <Check size={12} weight="bold" aria-hidden />
                  All steps done
                </span>
              )}

              {completed > 0 && (
                <button
                  type="button"
                  onClick={() => resetProgress()}
                  className="shrink-0 mt-0.5 inline-flex items-center gap-1.5 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded"
                >
                  <ArrowCounterClockwise size={12} weight="bold" />
                  Reset
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
