'use client'

import { motion } from 'motion/react'
import { Check } from '@phosphor-icons/react'
import { RevealGroup } from '@/components/motion/Reveal'
import { revealItem } from '@/lib/motion'
import { DoubleBezel } from '@/components/ui/DoubleBezel'

const steps = [
  '8 salaries shielded',
  'batch total proven on-chain',
  'view-key issued to the auditor',
]

export function HowItWorks() {
  return (
    <section className="py-24 md:py-32 px-5 md:px-8">
      <RevealGroup className="max-w-5xl mx-auto">
        <motion.p
          variants={revealItem}
          className="font-mono text-xs uppercase tracking-[0.2em] text-ink-muted"
        >
          How it works
        </motion.p>

        <motion.h2
          variants={revealItem}
          className="mt-4 font-display font-light text-ink text-h2 leading-[1.1] tracking-[-0.02em] text-balance max-w-[18ch]"
        >
          Your whole payroll, in one command.
        </motion.h2>

        <motion.p
          variants={revealItem}
          className="mt-5 font-sans text-lead text-ink-muted leading-[1.6] text-pretty max-w-[56ch]"
        >
          Drop in a CSV of names and amounts. Sobrecito shields every payment, proves the
          total, and issues the auditor's view-key.
        </motion.p>

        <motion.div variants={revealItem} className="mt-10 md:mt-12 max-w-2xl">
          <DoubleBezel radius="1.5rem" className="px-6 py-6 md:px-7 md:py-7">
            <p className="font-mono text-sm">
              <span className="text-ink-muted select-none">$ </span>
              <span className="text-ink">sobre pay payroll.csv</span>
            </p>

            <div className="mt-5 space-y-2.5">
              {steps.map((s) => (
                <p key={s} className="flex items-center gap-2 font-mono text-sm text-accent-soft">
                  <Check size={14} weight="bold" />
                  <span>{s}</span>
                </p>
              ))}
            </div>

            <p className="mt-5 pt-4 border-t border-hairline font-mono text-xs text-ink-muted">
              no amount ever leaves in the clear
            </p>
          </DoubleBezel>
        </motion.div>
      </RevealGroup>
    </section>
  )
}
