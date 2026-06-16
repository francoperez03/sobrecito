'use client'

import type { ReactNode } from 'react'
import { ChartBar, UserCircle, Key, Eye, type Icon } from '@phosphor-icons/react'
import { motion, MotionConfig } from 'motion/react'
import { RevealGroup } from '@/components/motion/Reveal'
import { revealItem } from '@/lib/motion'
import { IconBadge } from '@/components/ui/IconBadge'
import { Eyebrow } from '@/components/ui/Eyebrow'
import { DoubleBezel } from '@/components/ui/DoubleBezel'
import { RoleView, type RowState } from './RoleView'
import { PREDICATE_TOTAL } from '@/lib/demo-data'

const R: RowState = 'revealed'
const S: RowState = 'sealed'

const levels: {
  index: string
  label: string
  copy: string
  sub: string
  icon: Icon
  accent: boolean
  rows: RowState[]
  redactNames?: boolean
  ownIndex?: number
  footer?: ReactNode
  viewLabel: string
}[] = [
  {
    index: '01',
    label: 'Employer',
    copy: 'You see the breakdown.',
    sub: 'Every amount, in private, before payroll ever goes on-chain.',
    icon: ChartBar,
    accent: true,
    rows: [R, R, R, R],
    viewLabel: 'Employer view: all four employee amounts visible.',
  },
  {
    index: '02',
    label: 'Employee',
    copy: 'Each employee sees only their own pay.',
    sub: "They can prove their salary on-chain, never a colleague's.",
    icon: UserCircle,
    accent: true,
    rows: [R, S, S, S],
    redactNames: true,
    ownIndex: 0,
    viewLabel: 'Employee view: only their own amount visible, every colleague sealed.',
  },
  {
    index: '03',
    label: 'Auditor',
    copy: 'Auditor reconstructs detail via view-key.',
    sub: "A view-key scoped to one period rebuilds every amount they're entitled to, nothing outside it.",
    icon: Key,
    accent: true,
    rows: [R, R, R, R],
    footer: (
      <p className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-ink-muted">
        reconstructed via view-key
      </p>
    ),
    viewLabel: 'Auditor view: all amounts reconstructed via a scoped view-key.',
  },
  {
    index: '04',
    label: 'Public',
    copy: 'They see the total, proven.',
    sub: 'One number on-chain: the batch adds up. No individual amounts, ever.',
    icon: Eye,
    accent: false,
    rows: [S, S, S, S],
    redactNames: true,
    footer: (
      <p className="font-mono text-xs text-accent-soft tabular-nums">
        sum = {PREDICATE_TOTAL} ✓ verified on-chain
      </p>
    ),
    viewLabel: 'Public view: all amounts sealed, only the proven total shown.',
  },
]

export function ThreeLevels() {
  return (
    <MotionConfig reducedMotion="user">
      <section className="py-24 md:py-32 px-5 md:px-8">
        <RevealGroup className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[minmax(0,22rem)_1fr] gap-12 lg:gap-16">
          {/* Sticky heading */}
          <motion.div variants={revealItem} className="lg:sticky lg:top-28 self-start">
            <Eyebrow>The model</Eyebrow>
            <h2 className="mt-4 font-display font-light text-ink text-h2 leading-[1.1] tracking-[-0.02em] text-balance">
              One payroll. Every role sees only its share.
            </h2>
            <p className="mt-5 font-sans text-lead text-ink-muted leading-[1.6] text-pretty max-w-[40ch]">
              Private by default, auditable on demand.
            </p>
          </motion.div>

          {/* Role cards */}
          <div className="flex flex-col gap-4 md:gap-5">
            {levels.map(
              ({ index, label, copy, sub, icon, accent, rows, redactNames, ownIndex, footer, viewLabel }) => (
                <motion.div key={label} variants={revealItem}>
                  <DoubleBezel radius="1.5rem" className="p-5 md:p-6">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-5 md:gap-7 items-center">
                      <div>
                        <div className="flex items-center gap-3">
                          <IconBadge icon={icon} tone={accent ? 'accent' : 'muted'} />
                          <span className="font-mono text-sm text-ink-muted tabular-nums">{index}</span>
                          <span
                            className={`font-mono text-xs uppercase tracking-[0.18em] ${
                              accent ? 'text-ink' : 'text-ink-muted'
                            }`}
                          >
                            {label}
                          </span>
                        </div>
                        <p className="mt-4 font-sans text-h3 text-ink leading-[1.3] tracking-[-0.01em]">
                          {copy}
                        </p>
                        <p className="mt-2 font-sans text-base text-ink-muted leading-[1.6] max-w-[46ch]">
                          {sub}
                        </p>
                      </div>

                      <div className="md:w-[15rem] shrink-0">
                        <RoleView
                          rows={rows}
                          redactNames={redactNames}
                          ownIndex={ownIndex}
                          footer={footer}
                          label={viewLabel}
                        />
                      </div>
                    </div>
                  </DoubleBezel>
                </motion.div>
              ),
            )}
          </div>
        </RevealGroup>
      </section>
    </MotionConfig>
  )
}
