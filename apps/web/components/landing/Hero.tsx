'use client'

import { motion } from 'motion/react'
import { ArrowRight, GithubLogo } from '@phosphor-icons/react'
import { EASE_OUT } from '@/lib/motion'

const GITHUB_REPO_URL = 'https://github.com/francoperez03/sobrecito'
const DEMO_VIDEO_URL = '#demo'

// Hero entrance: eyebrow → H1 → subhead → CTAs, staggered.
// H1 and the subhead <p> stay adjacent siblings (the a11y test reads
// h1.nextElementSibling to wait for the entrance to settle).

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-hairline">
      {/* Electric glow — the one warm-to-cool identity note on the black canvas. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[480px] w-[820px] max-w-[120vw] rounded-full opacity-60 blur-[120px]"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in oklch, var(--color-accent) 26%, transparent), transparent)',
        }}
      />

      <div className="relative max-w-5xl mx-auto px-5 md:px-8 pt-28 pb-24 md:pt-36 md:pb-32">
        {/* Eyebrow — the single deliberate kicker on the page */}
        <motion.p
          className="font-mono text-xs uppercase tracking-[0.22em] text-ink-muted"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
        >
          Confidential payroll · Stellar
        </motion.p>

        {/* H1 — Fraunces display, light weight, editorial */}
        <motion.h1
          className="mt-5 font-display font-light text-ink text-display leading-[1.04] tracking-[-0.02em] text-balance max-w-[18ch]"
          initial={{ opacity: 0, y: 28, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.8, ease: EASE_OUT, delay: 0.08 }}
        >
          Payroll that doesn't dox your team.
        </motion.h1>

        {/* Subhead */}
        <motion.p
          className="mt-7 font-sans font-normal text-ink-muted text-lead leading-[1.65] text-pretty max-w-[58ch]"
          initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.8, ease: EASE_OUT, delay: 0.24 }}
        >
          Pay salaries in USDC on-chain. Keep every amount private. Still prove the totals to your auditor.
        </motion.p>

        {/* CTAs */}
        <motion.div
          className="mt-11 flex flex-wrap items-center gap-4"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.4 }}
        >
          <a
            href={DEMO_VIDEO_URL}
            className="group flex items-center gap-2 pl-6 pr-2 h-[52px] bg-accent-fill text-white font-sans font-medium text-base rounded-full transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-accent active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            Watch the demo
            <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white/15 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5">
              <ArrowRight size={16} weight="bold" />
            </span>
          </a>

          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-6 h-[52px] text-ink font-sans text-base rounded-full border border-hairline-strong transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-surface active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg focus-visible:outline-none"
          >
            <GithubLogo size={18} weight="light" />
            View on GitHub
          </a>
        </motion.div>
      </div>
    </section>
  )
}
