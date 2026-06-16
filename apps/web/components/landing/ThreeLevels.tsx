'use client'

import { ChartBar, UserCircle, Key, Eye, type Icon } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { RevealGroup } from '@/components/motion/Reveal'
import { revealItem } from '@/lib/motion'

const levels: {
  index: string
  label: string
  copy: string
  sub: string
  icon: Icon
  accent: boolean
}[] = [
  {
    index: '01',
    label: 'Employer',
    copy: 'You see the breakdown.',
    sub: 'Every amount, in private, before payroll ever goes on-chain.',
    icon: ChartBar,
    accent: true,
  },
  {
    index: '02',
    label: 'Employee',
    copy: 'Each employee sees only their own pay.',
    sub: "They can prove their salary on-chain, never a colleague's.",
    icon: UserCircle,
    accent: true,
  },
  {
    index: '03',
    label: 'Auditor',
    copy: 'Auditor reconstructs detail via view-key.',
    sub: "A view-key scoped to one period rebuilds every amount they're entitled to, nothing outside it.",
    icon: Key,
    accent: true,
  },
  {
    index: '04',
    label: 'Public',
    copy: 'They see the total, proven.',
    sub: 'One number on-chain: the batch adds up. No individual amounts, ever.',
    icon: Eye,
    accent: false,
  },
]

export function ThreeLevels() {
  return (
    <section className="py-24 md:py-32 px-5 md:px-8">
      <RevealGroup className="max-w-5xl mx-auto">
        <motion.h2
          variants={revealItem}
          className="font-display font-light text-ink text-h2 leading-[1.1] tracking-[-0.02em] text-balance max-w-[18ch]"
        >
          One payroll. Every role sees only its share.
        </motion.h2>

        <div className="mt-12 md:mt-16 border-t border-hairline">
          {levels.map(({ index, label, copy, sub, icon: Icon, accent }) => (
            <motion.div
              key={label}
              variants={revealItem}
              className="grid grid-cols-[auto_1fr] md:grid-cols-[auto_10rem_1fr] items-baseline gap-x-5 gap-y-2 py-7 md:py-9 border-b border-hairline"
            >
              <span className="font-mono text-sm text-ink-muted tabular-nums">{index}</span>

              <div className="flex items-center gap-2.5">
                <Icon
                  size={20}
                  weight="light"
                  className={accent ? 'text-accent' : 'text-ink-muted'}
                />
                <span className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
                  {label}
                </span>
              </div>

              <div className="col-start-2 md:col-start-3">
                <p className="font-sans text-h3 text-ink leading-[1.3] tracking-[-0.01em]">
                  {copy}
                </p>
                <p className="mt-2 font-sans text-base text-ink-muted leading-[1.6] max-w-[52ch]">
                  {sub}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </RevealGroup>
    </section>
  )
}
