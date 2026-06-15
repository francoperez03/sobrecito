'use client'

import { motion } from 'motion/react'
import { RevealGroup } from '@/components/motion/Reveal'
import { revealItem } from '@/lib/motion'

export function ProblemSection() {
  return (
    <section className="pt-24 md:pt-32 pb-14 md:pb-16 px-5 md:px-8">
      <RevealGroup className="max-w-5xl mx-auto">
        <motion.p
          variants={revealItem}
          className="font-mono text-xs uppercase tracking-[0.2em] text-ink-muted text-center"
        >
          Until now, you had to choose
        </motion.p>

        {/* The two mutually exclusive options, with an explicit "or" between them */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-8 md:gap-0 items-stretch border-y border-hairline">
          <motion.div variants={revealItem} className="py-8 md:py-10 md:pr-12">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
              Pay on-chain
            </p>
            <p className="mt-4 font-sans text-h3 text-ink leading-[1.3] tracking-[-0.01em]">
              Every salary is{' '}
              <span className="text-accent-warm">public forever.</span>
            </p>
          </motion.div>

          {/* "or" rail — vertical hairline + label on desktop, inline on mobile */}
          <motion.div
            variants={revealItem}
            className="flex md:flex-col items-center justify-center md:px-12 md:border-x border-hairline"
          >
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">
              or
            </span>
          </motion.div>

          <motion.div variants={revealItem} className="py-8 md:py-10 md:pl-12">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
              Stay private
            </p>
            <p className="mt-4 font-sans text-h3 text-ink leading-[1.3] tracking-[-0.01em]">
              Abandon programmable{' '}
              <span className="text-accent-warm">USDC rails.</span>
            </p>
          </motion.div>
        </div>

        {/* Resolution — the synthesis, in ink Fraunces (consistent with the hero) */}
        <motion.div variants={revealItem} className="mt-14 md:mt-20">
          <p className="font-display font-light text-ink text-display leading-[1.05] tracking-[-0.02em] text-balance">
            Sobrecito holds both.
          </p>
          <p className="mt-6 font-sans text-lead text-ink-muted leading-[1.6] max-w-[46ch]">
            On-chain USDC payroll with every amount private, and the batch total proven to your
            auditor.
          </p>
        </motion.div>
      </RevealGroup>
    </section>
  )
}
