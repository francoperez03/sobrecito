'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import {
  Key,
  ShieldCheck,
  PaperPlaneTilt,
  HandCoins,
  MagnifyingGlass,
  ArrowRight,
  type Icon,
} from '@phosphor-icons/react'
import { RevealGroup } from '@/components/motion/Reveal'
import { revealItem, EASE_OUT } from '@/lib/motion'
import { Eyebrow } from '@/components/ui/Eyebrow'

/**
 * How it works, as a guided walkthrough that advances over time. Five steps that
 * trace the real product, with the recurring theme that each role holds its own
 * private key: generate -> view-key -> pay -> claim -> audit. A big "Step N" on
 * the left cycles while the matching panel crossfades on the right. Autoplay
 * pauses on hover/focus; reduced motion renders all five steps statically so
 * nothing is hidden. Each step links to the live tab that runs it on testnet.
 */

const STEP_MS = 5000

const steps: {
  action: string
  role: string
  href: string
  icon: Icon
  headline: string
  body: string
  keyTag: string
}[] = [
  {
    action: 'Generate',
    role: 'Employee',
    href: '/receive',
    icon: Key,
    headline: 'Create your key.',
    body: 'Generate it in the browser. Keep the private key, share only the public one.',
    keyTag: 'private key stays with you',
  },
  {
    action: 'View-key',
    role: 'Auditor',
    href: '/audit',
    icon: ShieldCheck,
    headline: 'Mint the view-key.',
    body: 'The auditor generates a keypair and keeps the private view-key. The public key goes to the employer.',
    keyTag: 'private view-key never leaves the browser',
  },
  {
    action: 'Pay',
    role: 'Employer',
    href: '/pay',
    icon: PaperPlaneTilt,
    headline: 'Send the payroll.',
    body: 'Paste each public key and amount, up to 8 notes per batch, optionally add the auditor’s key, and prove it in your browser.',
    keyTag: 'amounts sealed, total proven',
  },
  {
    action: 'Claim',
    role: 'Employee',
    href: '/receive',
    icon: HandCoins,
    headline: 'Claim your pay.',
    body: 'Paste your private key, find the one note that is yours, and withdraw it.',
    keyTag: 'uses your private key',
  },
  {
    action: 'Audit',
    role: 'Auditor',
    href: '/audit',
    icon: MagnifyingGlass,
    headline: 'Reconstruct the detail.',
    body: 'Paste the private view-key to rebuild every amount for that period. Nothing outside it.',
    keyTag: 'uses the private view-key',
  },
]

export function HowItWorks() {
  const reduce = useReducedMotion()
  // Render the full static list on the server and the first client paint so SSR
  // and hydration agree (and no-JS keeps every step). After mount, non-reduced
  // users get upgraded to the interactive auto-advancing stepper.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <section className="py-24 md:py-32 px-5 md:px-8">
      <RevealGroup className="max-w-5xl mx-auto">
        <motion.div variants={revealItem}>
          <Eyebrow>How it works</Eyebrow>
        </motion.div>

        <motion.h2
          variants={revealItem}
          className="mt-4 font-display font-light text-ink text-h2 leading-[1.1] tracking-[-0.02em] text-balance max-w-[22ch]"
        >
          Generate, view-key, pay, claim, audit.
        </motion.h2>

        <motion.div variants={revealItem} className="mt-12 md:mt-16">
          {!mounted || reduce ? <StaticSteps /> : <Stepper />}
        </motion.div>
      </RevealGroup>
    </section>
  )
}

/** Animated, auto-advancing single-step view (default). */
function Stepper() {
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)

  // The bar IS the timer: when not paused, advance every STEP_MS. Re-arms on a
  // manual jump (active change) and on resume; pausing freezes the countdown.
  useEffect(() => {
    if (paused) return
    const t = setTimeout(() => setActive((a) => (a + 1) % steps.length), STEP_MS)
    return () => clearTimeout(t)
  }, [active, paused])

  const step = steps[active]
  const StepIcon = step.icon

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-[15rem_1fr] gap-10 lg:gap-16"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {/* Left rail: big step number + progress + action ticks */}
      <div className="lg:sticky lg:top-28 self-start">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">
          Step
        </span>

        <div className="mt-1 h-[clamp(3.5rem,8vw,6rem)] overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.4, ease: EASE_OUT }}
              className="font-display font-light text-ink tabular-nums leading-none text-[clamp(3.5rem,8vw,6rem)] tracking-[-0.02em]"
            >
              {active + 1}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Progress bar — fills over the autoplay interval; restarts each step. */}
        <div className="mt-4 h-px w-full bg-hairline overflow-hidden">
          <motion.div
            key={`${active}-${paused}`}
            className="h-full bg-accent origin-left"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: paused ? 0 : 1 }}
            transition={{ duration: paused ? 0 : STEP_MS / 1000, ease: 'linear' }}
          />
        </div>

        {/* Action ticks */}
        <ul className="mt-6 flex flex-col gap-0.5">
          {steps.map((s, i) => {
            const on = i === active
            return (
              <li key={s.action + i}>
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  aria-current={on ? 'step' : undefined}
                  aria-label={`Step ${i + 1}: ${s.action}`}
                  className="group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 -mx-2 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-accent"
                >
                  <span
                    className={`font-mono text-xs tabular-nums transition-colors ${
                      on ? 'text-accent-soft' : 'text-ink-muted group-hover:text-ink'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span
                    className={`font-mono text-xs uppercase tracking-[0.16em] transition-colors ${
                      on ? 'text-ink' : 'text-ink-muted group-hover:text-ink'
                    }`}
                  >
                    {s.action}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Right panel: active step content */}
      <div className="min-h-[16rem] md:min-h-[14rem]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 16, filter: 'blur(5px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -12, filter: 'blur(5px)' }}
            transition={{ duration: 0.42, ease: EASE_OUT }}
          >
            <div className="flex items-center gap-2.5">
              <StepIcon size={16} weight="bold" className="text-accent" aria-hidden />
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-ink">
                {step.action}
              </span>
              <span className="size-1 rounded-full bg-ink-muted" aria-hidden />
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
                {step.role}
              </span>
              <Link
                href={step.href}
                className="group ml-auto inline-flex items-center gap-1.5 font-mono text-xs text-accent-soft transition-colors hover:text-accent outline-none focus-visible:ring-1 focus-visible:ring-accent rounded"
              >
                <span className="border-b border-accent-soft/30 group-hover:border-accent/60">
                  Open {step.href}
                </span>
                <ArrowRight
                  size={13}
                  weight="bold"
                  className="transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5"
                />
              </Link>
            </div>

            <h3 className="mt-4 font-sans text-h3 text-ink leading-[1.3] tracking-[-0.01em]">
              {step.headline}
            </h3>
            <p className="mt-3 font-sans text-lead text-ink-muted leading-[1.6] text-pretty max-w-[48ch]">
              {step.body}
            </p>
            <span className="mt-5 inline-flex items-center gap-2 font-mono text-xs text-accent-soft">
              <span className="size-1.5 rounded-[2px] bg-accent-soft" aria-hidden />
              {step.keyTag}
            </span>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

/** Reduced-motion fallback: every step visible at once, no autoplay. */
function StaticSteps() {
  return (
    <ol className="max-w-3xl">
      {steps.map((s, i) => {
        const StepIcon = s.icon
        return (
          <li key={s.action + i} className="grid grid-cols-[2.25rem_1fr] gap-x-4 md:gap-x-6">
            <div className="flex flex-col items-center">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface ring-1 ring-hairline font-mono text-sm tabular-nums text-accent-soft">
                {i + 1}
              </span>
              {i < steps.length - 1 && (
                <span aria-hidden className="mt-2 w-px flex-1 bg-hairline" />
              )}
            </div>
            <div className="pb-10">
              <div className="flex items-center gap-2.5">
                <StepIcon size={16} weight="bold" className="text-accent" aria-hidden />
                <span className="font-mono text-xs uppercase tracking-[0.18em] text-ink">
                  {s.action}
                </span>
                <span className="size-1 rounded-full bg-ink-muted" aria-hidden />
                <span className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
                  {s.role}
                </span>
                <Link
                  href={s.href}
                  className="group ml-auto inline-flex items-center gap-1.5 font-mono text-xs text-accent-soft transition-colors hover:text-accent"
                >
                  <span className="border-b border-accent-soft/30 group-hover:border-accent/60">
                    Open {s.href}
                  </span>
                  <ArrowRight size={13} weight="bold" />
                </Link>
              </div>
              <h3 className="mt-3 font-sans text-h3 text-ink leading-[1.3] tracking-[-0.01em]">
                {s.headline}
              </h3>
              <p className="mt-2 font-sans text-base text-ink-muted leading-[1.6] max-w-[52ch]">
                {s.body}
              </p>
              <span className="mt-4 inline-flex items-center gap-2 font-mono text-xs text-accent-soft">
                <span className="size-1.5 rounded-[2px] bg-accent-soft" aria-hidden />
                {s.keyTag}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
