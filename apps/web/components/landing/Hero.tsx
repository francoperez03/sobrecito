'use client'

import { motion } from 'motion/react'
import { ArrowRight, GithubLogo } from '@phosphor-icons/react'

const GITHUB_REPO_URL = 'https://github.com/francoperez03/sobrecito'
const DEMO_VIDEO_URL = '#demo'
const EASE_BRAND = [0.32, 0.72, 0, 1] as const

// Hero entrance: H1 at 0ms, subhead at +200ms, CTAs at +400ms.
// initial={false} on wrapper: SSR renders final visible state (no invisible flash at hydration).
// The motion entrance fires on first client render — enhancement over an already-visible default.

export function Hero() {
  return (
    <section className="pt-40 pb-32 px-4">
      <div className="max-w-5xl mx-auto">
        {/* H1 — entrance: translate-y-12 blur-sm opacity-0 → resolved, 800ms */}
        <motion.h1
          className="font-sans font-[900] text-ink leading-[1.05] tracking-[-0.02em] text-balance"
          style={{ fontSize: 'clamp(3rem, 7vw, 5.5rem)' }}
          initial={{ opacity: 0, y: 48, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.8, ease: EASE_BRAND }}
        >
          Payroll that doesn't dox your team.
        </motion.h1>

        {/* Subhead — sub-heading variant: H2 size floor, weight 400, ink-muted; entrance +200ms */}
        <motion.p
          className="mt-6 font-sans font-[400] text-ink-muted leading-[1.6] text-balance max-w-[65ch]"
          style={{ fontSize: 'clamp(1.1rem, 2vw, 1.4rem)' }}
          initial={{ opacity: 0, y: 32, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.8, ease: EASE_BRAND, delay: 0.2 }}
        >
          Pay salaries in USDC on-chain. Keep every amount private. Still prove the totals to your auditor.
        </motion.p>

        {/* CTAs — entrance +400ms */}
        <motion.div
          className="mt-10 flex flex-wrap items-center gap-4"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE_BRAND, delay: 0.4 }}
        >
          {/* Primary CTA */}
          <a
            href={DEMO_VIDEO_URL}
            className="group flex items-center gap-2 px-6 h-[52px] bg-accent text-bg font-sans font-[900] text-base rounded-full transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-90 active:scale-[0.98]"
          >
            Watch the demo
            <ArrowRight
              size={18}
              weight="light"
              className="transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1 group-hover:-translate-y-[1px]"
            />
          </a>

          {/* Secondary CTA */}
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-6 h-[52px] text-ink-muted font-sans text-base rounded-full border border-white/10 transition-opacity duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-70 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <GithubLogo size={18} weight="light" />
            View on GitHub
          </a>
        </motion.div>
      </div>
    </section>
  )
}
