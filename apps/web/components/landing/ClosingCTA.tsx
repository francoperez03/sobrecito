'use client'

import { ArrowRight, GithubLogo } from '@phosphor-icons/react'
import { Reveal } from '@/components/motion/Reveal'

const GITHUB_REPO_URL = 'https://github.com/francoperez03/sobrecito'
const DEMO_VIDEO_URL = '#demo'

export function ClosingCTA() {
  return (
    <section className="relative overflow-hidden border-t border-hairline">
      {/* Glow — bookends the hero's opening glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-44 left-1/2 -translate-x-1/2 h-[440px] w-[780px] max-w-[120vw] rounded-full opacity-50 blur-[120px]"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in oklch, var(--color-accent) 24%, transparent), transparent)',
        }}
      />

      <div className="relative max-w-3xl mx-auto px-5 md:px-8 py-28 md:py-36 text-center">
        <Reveal>
          <h2 className="font-display font-light text-ink text-display leading-[1.05] tracking-[-0.02em] text-balance">
            Seal your next payroll.
          </h2>

          <p className="mt-6 mx-auto font-sans text-lead text-ink-muted leading-[1.6] text-pretty max-w-[48ch]">
            Pay in USDC on-chain, keep every amount private, and prove the total to your auditor.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
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
          </div>
        </Reveal>
      </div>
    </section>
  )
}
