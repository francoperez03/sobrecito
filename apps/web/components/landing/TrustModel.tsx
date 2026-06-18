'use client'

import { motion, useReducedMotion } from 'motion/react'
import { ArrowUpRight, ShieldCheck } from '@phosphor-icons/react'
import { RevealGroup } from '@/components/motion/Reveal'
import { revealItem, EASE_BRAND } from '@/lib/motion'

const REPO_URL = 'https://github.com/francoperez03/sobrecito'
const VERIFIER_URL =
  'https://stellar.expert/explorer/testnet/contract/CD4KDJTSCD2RMS7JMCY3N7RWLAN2QYO2BYT7DXHFX2GXVBDSBYXQ77PN'

type Kind = 'math' | 'policy'

interface Guarantee {
  property: string
  kind: Kind
  heldBy: string
  verify: { label: string; href?: string; vanish?: boolean }
}

/**
 * The honest ledger. Instead of "trust us" cards, every property is a row that
 * states what holds it up (a math proof vs. an operational policy) and hands you
 * a real way to check it. The last row enacts its own claim: "Sobrecito" is
 * struck out as the section enters view, while "still verifies on-chain" stays
 * lit, making "holds without us" literal.
 */
const guarantees: Guarantee[] = [
  {
    property: 'Individual amounts stay private',
    kind: 'math',
    heldBy: 'a zero-knowledge proof',
    verify: { label: 'the circuit, on GitHub', href: REPO_URL },
  },
  {
    property: 'The batch total is correct',
    kind: 'math',
    heldBy: 'verified on-chain',
    verify: { label: 'the verifier contract', href: VERIFIER_URL },
  },
  {
    property: 'You keep your own funds',
    kind: 'math',
    heldBy: 'non-custodial by design',
    verify: { label: 'your wallet signs; the pool never custodies' },
  },
  {
    property: 'The auditor reads only its period',
    kind: 'policy',
    heldBy: 'a scoped view-key',
    verify: { label: 'the key model, on GitHub', href: REPO_URL },
  },
  {
    property: 'It holds without us',
    kind: 'math',
    heldBy: 'public circuit and verifier',
    verify: { label: 'still verifies on-chain', href: VERIFIER_URL, vanish: true },
  },
]

export function TrustModel() {
  return (
    <section className="py-24 md:py-32 px-5 md:px-8">
      <RevealGroup className="max-w-4xl mx-auto">
        <motion.h2
          variants={revealItem}
          className="font-display font-light text-ink text-h2 leading-[1.1] tracking-[-0.02em] text-balance max-w-[22ch]"
        >
          What’s guaranteed, and how to check it.
        </motion.h2>

        <motion.p
          variants={revealItem}
          className="mt-5 font-sans text-lead text-ink-muted leading-[1.6] text-pretty max-w-[58ch]"
        >
          We separate what the math proves from what is policy, and hand you a way
          to check each one yourself.
        </motion.p>

        <motion.div
          variants={revealItem}
          className="mt-12 md:mt-16 rounded-[1.75rem] ring-1 ring-hairline bg-surface/40 divide-y divide-hairline overflow-hidden"
        >
          {/* Column header — desktop only; the rows are self-describing on mobile. */}
          <div className="hidden md:grid grid-cols-[1.5fr_1fr_1.2fr] gap-x-8 px-9 py-4">
            <ColHead>What holds</ColHead>
            <ColHead>Guaranteed by</ColHead>
            <ColHead>Check it yourself</ColHead>
          </div>

          {guarantees.map((g) => (
            <div
              key={g.property}
              className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr_1.2fr] gap-x-8 gap-y-3 px-6 md:px-9 py-7 md:py-7"
            >
              {/* What holds */}
              <div className="flex flex-col gap-2.5">
                <p className="font-sans text-base md:text-lg text-ink leading-[1.4] tracking-[-0.01em]">
                  {g.property}
                </p>
                <KindTag kind={g.kind} />
              </div>

              {/* Guaranteed by */}
              <div className="flex md:block items-baseline gap-2">
                <span className="md:hidden font-mono text-[0.625rem] uppercase tracking-[0.16em] text-ink-muted">
                  by
                </span>
                <p className="font-sans text-sm text-ink-muted leading-[1.5] md:pt-0.5">
                  {g.heldBy}
                </p>
              </div>

              {/* Check it yourself */}
              <div className="md:pt-0.5">
                <VerifyHandle verify={g.verify} />
              </div>
            </div>
          ))}
        </motion.div>

        {/* Honest disclosure — PoC line. */}
        <motion.p
          variants={revealItem}
          className="mt-6 flex items-start gap-2.5 font-mono text-xs text-ink-muted leading-[1.6] max-w-[60ch]"
        >
          <ShieldCheck size={15} weight="bold" className="mt-0.5 shrink-0 text-ink-muted" aria-hidden />
          <span>
            Proof of concept on Stellar testnet, not audited. We label what a proof
            guarantees and what is operational policy.
          </span>
        </motion.p>
      </RevealGroup>
    </section>
  )
}

function ColHead({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-ink-muted">
      {children}
    </span>
  )
}

/** math = an on-chain cryptographic guarantee; policy = an operational promise. */
function KindTag({ kind }: { kind: Kind }) {
  const isMath = kind === 'math'
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 h-6 font-mono text-[0.625rem] uppercase tracking-[0.14em] ring-1 ${
        isMath
          ? 'text-accent-soft ring-accent-soft/25'
          : 'text-ink-muted ring-hairline'
      }`}
    >
      <span
        className={`size-1.5 rounded-full ${isMath ? 'bg-accent-soft' : 'bg-ink-muted'}`}
        aria-hidden
      />
      {isMath ? 'on-chain math' : 'policy'}
    </span>
  )
}

function VerifyHandle({ verify }: { verify: Guarantee['verify'] }) {
  const content = verify.vanish ? (
    <>
      <Vanishing>Sobrecito</Vanishing> could vanish; it {verify.label}
    </>
  ) : (
    verify.label
  )

  if (!verify.href) {
    return (
      <span className="font-mono text-xs text-ink-muted leading-[1.5]">{content}</span>
    )
  }

  return (
    <a
      href={verify.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-start gap-1.5 font-mono text-xs text-accent-soft leading-[1.5] transition-colors hover:text-accent w-fit"
    >
      <span className="border-b border-accent-soft/30 group-hover:border-accent/60">
        {content}
      </span>
      <ArrowUpRight
        size={13}
        weight="bold"
        className="mt-0.5 shrink-0 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
      />
    </a>
  )
}

/**
 * "Sobrecito" struck out as it scrolls into view (one-shot): a line wipes across
 * it and the word dims, while the verify handle stays lit. Reduced motion renders
 * the struck state immediately.
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
