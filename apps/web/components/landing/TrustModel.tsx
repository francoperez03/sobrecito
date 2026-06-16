'use client'

import { motion, useReducedMotion } from 'motion/react'
import { ArrowUpRight } from '@phosphor-icons/react'
import { RevealGroup } from '@/components/motion/Reveal'
import { revealItem, EASE_BRAND } from '@/lib/motion'

const REPO_URL = 'https://github.com/francoperez03/sobrecito'

/**
 * The trust ledger. Instead of three identical marketing cards, the section is a
 * single inspectable artifact whose three claims are horizontal rows, each with a
 * real, checkable handle. The "Independent" row enacts its own claim: the words
 * "the provider" are struck out as the section enters view, while the on-chain
 * verify stays lit — "owned by no one" made literal.
 */
export function TrustModel() {
  return (
    <section className="py-24 md:py-32 px-5 md:px-8">
      <RevealGroup className="max-w-4xl mx-auto">
        <motion.h2
          variants={revealItem}
          className="font-display font-light text-ink text-h2 leading-[1.1] tracking-[-0.02em] text-balance max-w-[20ch]"
        >
          Verifiable by anyone. Owned by no one.
        </motion.h2>

        <motion.p
          variants={revealItem}
          className="mt-5 font-sans text-lead text-ink-muted leading-[1.6] text-pretty max-w-[56ch]"
        >
          Trust lives in the ledger and in open code. The proofs hold on their own.
        </motion.p>

        <motion.div
          variants={revealItem}
          className="mt-12 md:mt-16 rounded-[1.75rem] ring-1 ring-hairline bg-surface/40 divide-y divide-hairline overflow-hidden"
        >
          {/* 01 — Non-custodial */}
          <Row label="Non-custodial">
            <p className="font-sans text-h3 text-ink leading-[1.35] tracking-[-0.01em]">
              Sobrecito never touches your funds or your keys.
            </p>
            <Handle>your keys, your signature</Handle>
          </Row>

          {/* 02 — Open source (the handle is a real, clickable link) */}
          <Row label="Open source">
            <p className="font-sans text-h3 text-ink leading-[1.35] tracking-[-0.01em]">
              The circuit and the Soroban verifier are public. Check the math yourself.
            </p>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-1.5 font-mono text-xs text-accent-soft transition-colors hover:text-accent w-fit"
            >
              <span className="border-b border-accent-soft/30 group-hover:border-accent/60">
                circuit · verifier · on GitHub
              </span>
              <ArrowUpRight
                size={13}
                weight="bold"
                className="transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </a>
          </Row>

          {/* 03 — Independent (enacts the claim) */}
          <Row label="Independent">
            <p className="font-sans text-h3 text-ink leading-[1.35] tracking-[-0.01em]">
              Every proof verifies on-chain. If <Vanishing>the provider</Vanishing>{' '}
              disappears tomorrow, they still hold.
            </p>
            <span className="inline-flex items-center gap-1.5 w-fit font-mono text-xs text-accent-soft tabular-nums">
              <span className="size-1.5 rounded-full bg-accent-soft" aria-hidden />
              verifies on-chain
            </span>
          </Row>
        </motion.div>
      </RevealGroup>
    </section>
  )
}

/** One ledger row: a mono label rail on the left, the claim + its handle on the right. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[11rem_1fr] gap-x-8 gap-y-4 px-6 md:px-9 py-8 md:py-10">
      <span className="font-mono text-xs uppercase tracking-[0.18em] text-accent-soft md:pt-1.5">
        {label}
      </span>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  )
}

/** Secondary mono evidence handle under a claim. */
function Handle({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs text-ink-muted w-fit">{children}</span>
}

/**
 * The provider name, struck out as it scrolls into view (one-shot): a line wipes
 * across it and the word dims, while the row's "verifies on-chain" chip stays lit.
 * Reduced motion renders the struck state immediately.
 */
function Vanishing({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <span className="relative inline-block whitespace-nowrap text-ink">
      <motion.span
        className="inline-block"
        initial={reduce ? { opacity: 0.5 } : { opacity: 1 }}
        whileInView={{ opacity: 0.5 }}
        viewport={{ once: true, margin: '-15%' }}
        transition={{ duration: 0.5, ease: EASE_BRAND, delay: 0.45 }}
      >
        {children}
      </motion.span>
      <motion.span
        aria-hidden
        className="absolute left-0 top-1/2 h-[1.5px] w-full bg-accent-soft origin-left"
        initial={reduce ? { scaleX: 1 } : { scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true, margin: '-15%' }}
        transition={{ duration: 0.55, ease: EASE_BRAND, delay: 0.35 }}
      />
    </span>
  )
}
