'use client'

import { Wallet, Code, ShieldCheck, type Icon } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { RevealGroup } from '@/components/motion/Reveal'
import { revealItem } from '@/lib/motion'
import { IconBadge } from '@/components/ui/IconBadge'
import { Eyebrow } from '@/components/ui/Eyebrow'

const points: { label: string; copy: string; icon: Icon }[] = [
  {
    label: 'Non-custodial',
    copy: 'Sobrecito never touches your funds or your keys.',
    icon: Wallet,
  },
  {
    label: 'Open source',
    copy: 'The circuit and the Soroban verifier are public. Check the math yourself.',
    icon: Code,
  },
  {
    label: 'Independent',
    copy: 'Every proof verifies on-chain. If Crisol disappears tomorrow, they still hold.',
    icon: ShieldCheck,
  },
]

export function TrustModel() {
  return (
    <section className="py-24 md:py-32 px-5 md:px-8">
      <RevealGroup className="max-w-5xl mx-auto">
        <motion.div variants={revealItem}>
          <Eyebrow>Trust model</Eyebrow>
        </motion.div>

        <motion.h2
          variants={revealItem}
          className="mt-4 font-display font-light text-ink text-h2 leading-[1.1] tracking-[-0.02em] text-balance max-w-[20ch]"
        >
          Verifiable by anyone. Owned by no one.
        </motion.h2>

        <motion.p
          variants={revealItem}
          className="mt-5 font-sans text-lead text-ink-muted leading-[1.6] text-pretty max-w-[58ch]"
        >
          Trust lives in the ledger and in open code. The proofs hold on their own.
        </motion.p>

        <div className="mt-12 md:mt-16 grid grid-cols-1 md:grid-cols-3 border-t border-l border-hairline rounded-2xl overflow-hidden">
          {points.map(({ label, copy, icon }) => (
            <motion.div
              key={label}
              variants={revealItem}
              className="border-r border-b border-hairline p-6 md:p-8"
            >
              <IconBadge icon={icon} />
              <p className="mt-4 font-mono text-xs uppercase tracking-[0.18em] text-accent-soft">
                {label}
              </p>
              <p className="mt-2 font-sans text-base text-ink leading-[1.6]">{copy}</p>
            </motion.div>
          ))}
        </div>
      </RevealGroup>
    </section>
  )
}
