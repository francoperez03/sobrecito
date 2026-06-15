'use client'

import { motion } from 'motion/react'
import { RevealGroup } from '@/components/motion/Reveal'
import { revealItem } from '@/lib/motion'

const points = [
  {
    label: 'Non-custodial',
    copy: 'Sobrecito never touches your funds or your keys.',
  },
  {
    label: 'Open source',
    copy: 'The circuit and the Soroban verifier are public. Check the math yourself.',
  },
  {
    label: 'Independent',
    copy: 'Every proof verifies on-chain. If Crisol disappears tomorrow, they still hold.',
  },
]

export function TrustModel() {
  return (
    <section className="py-24 md:py-32 px-5 md:px-8">
      <RevealGroup className="max-w-5xl mx-auto">
        <motion.h2
          variants={revealItem}
          className="font-display font-light text-ink text-h2 leading-[1.1] tracking-[-0.02em] text-balance max-w-[20ch]"
        >
          Verifiable by anyone. Owned by no one.
        </motion.h2>

        <motion.p
          variants={revealItem}
          className="mt-5 font-sans text-lead text-ink-muted leading-[1.6] text-pretty max-w-[58ch]"
        >
          Trust lives in the ledger and in open code. The proofs hold on their own.
        </motion.p>

        <div className="mt-12 md:mt-16 border-t border-hairline">
          {points.map(({ label, copy }) => (
            <motion.div
              key={label}
              variants={revealItem}
              className="grid grid-cols-1 md:grid-cols-[12rem_1fr] gap-x-8 gap-y-2 py-7 md:py-9 border-b border-hairline"
            >
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-accent-soft md:pt-1">
                {label}
              </span>
              <p className="font-sans text-h3 text-ink leading-[1.3] tracking-[-0.01em] max-w-[40ch]">
                {copy}
              </p>
            </motion.div>
          ))}
        </div>
      </RevealGroup>
    </section>
  )
}
