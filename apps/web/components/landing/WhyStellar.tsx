'use client'

import { motion } from 'motion/react'
import { RevealGroup } from '@/components/motion/Reveal'
import { revealItem } from '@/lib/motion'

export function WhyStellar() {
  return (
    <section className="py-24 md:py-32 px-5 md:px-8 border-y border-hairline bg-surface-deep">
      <RevealGroup className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-[1fr_1.1fr] gap-10 md:gap-16 items-start">
        <motion.h2
          variants={revealItem}
          className="font-display font-light text-ink text-h2 leading-[1.1] tracking-[-0.02em] text-balance"
        >
          Paid in the dollars your treasury already holds.
        </motion.h2>

        <div className="space-y-7 max-w-[60ch]">
          <motion.p
            variants={revealItem}
            className="font-sans font-normal text-ink text-lead leading-[1.65] text-pretty"
          >
            USDC settles natively through Circle's Stellar Asset Contract, with Stellar's
            finality. No bridge, no wrapped token, nothing to reconcile afterward.
          </motion.p>

          <motion.p
            variants={revealItem}
            className="font-sans font-normal text-ink-muted text-lead leading-[1.65] text-pretty"
          >
            The same balance your treasury already holds lands in your team's accounts,
            spendable the moment payroll settles.
          </motion.p>
        </div>
      </RevealGroup>
    </section>
  )
}
