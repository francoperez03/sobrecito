'use client'

import { useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { ArrowUpRight, CaretDown } from '@phosphor-icons/react'
import { RevealGroup } from '@/components/motion/Reveal'
import { revealItem, EASE_OUT, EASE_BRAND } from '@/lib/motion'

// Deep links to the exact source on GitHub (default branch) that backs each claim.
const GH = 'https://github.com/francoperez03/sobrecito/blob/main'
const CIRCUIT_URL = `${GH}/packages/zk/circuits/src/policyTransaction.circom`
const VERIFIER_SRC_URL = `${GH}/packages/zk/contracts/circom-groth16-verifier/src/lib.rs`
const POOL_URL = `${GH}/packages/zk/contracts/pool/src/pool.rs`
const RECONSTRUCTOR_URL = `${GH}/packages/viewkey/src/reconstructor/batchReconstructor.ts`
// The live deployed verifier on testnet — the running proof, not the source.
const VERIFIER_ONCHAIN_URL =
  'https://testnet.stellarchain.io/contracts/CD4KDJTSCD2RMS7JMCY3N7RWLAN2QYO2BYT7DXHFX2GXVBDSBYXQ77PN'

type Kind = 'math' | 'policy'

interface VerifyLink {
  label: string
  href?: string
  vanish?: boolean
}

interface Guarantee {
  property: string
  kind: Kind
  heldBy: string
  verify: VerifyLink[]
}

/**
 * Lead with confidence, back it with receipts on demand. The section states one
 * sure thing ("we don't ask you to trust us") and tucks the proof behind an
 * "Under the hood" disclosure. Expanded, every property is a row that says what
 * holds it up (a math proof vs. an operational policy) and hands you a real way
 * to check it. The last row enacts its own claim: "Sobrecito" is struck out as
 * it enters view while "still verifies on-chain" stays lit.
 */
const guarantees: Guarantee[] = [
  {
    property: 'Individual amounts stay private',
    kind: 'math',
    heldBy: 'a zero-knowledge proof',
    verify: [{ label: 'the circuit, on GitHub', href: CIRCUIT_URL }],
  },
  {
    property: 'The batch total is correct',
    kind: 'math',
    heldBy: 'verified on-chain',
    verify: [
      { label: 'the verifier contract', href: VERIFIER_ONCHAIN_URL },
      { label: 'verifier source, on GitHub', href: VERIFIER_SRC_URL },
    ],
  },
  {
    property: 'You keep your own funds',
    kind: 'math',
    heldBy: 'non-custodial by design',
    verify: [
      { label: 'your wallet signs; the pool never custodies' },
      { label: 'the pool contract, on GitHub', href: POOL_URL },
    ],
  },
  {
    property: 'The auditor reads only its period',
    kind: 'policy',
    heldBy: 'a scoped view-key',
    verify: [{ label: 'the reconstructor, on GitHub', href: RECONSTRUCTOR_URL }],
  },
  {
    property: 'It holds without us',
    kind: 'math',
    heldBy: 'public circuit and verifier',
    verify: [
      { label: 'still verifies on-chain', href: VERIFIER_ONCHAIN_URL, vanish: true },
      { label: 'verifier source, on GitHub', href: VERIFIER_SRC_URL },
    ],
  },
]

export function TrustModel() {
  const [open, setOpen] = useState(false)
  const reduce = useReducedMotion()

  return (
    <section className="py-24 md:py-32 px-5 md:px-8">
      <RevealGroup className="max-w-4xl mx-auto">
        <motion.h2
          variants={revealItem}
          className="font-display font-light text-ink text-h2 leading-[1.1] tracking-[-0.02em] text-balance max-w-[20ch]"
        >
          We don’t ask you to trust us.
        </motion.h2>

        <motion.p
          variants={revealItem}
          className="mt-5 font-sans text-lead text-ink-muted leading-[1.6] text-pretty max-w-[52ch]"
        >
          Every guarantee here is math you can check yourself.
        </motion.p>

        <motion.div variants={revealItem} className="mt-8">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="trust-details"
            className="group inline-flex items-center gap-2.5 h-[44px] pl-5 pr-4 rounded-full bg-surface text-ink font-[700] text-sm ring-1 ring-white/30 hover:bg-white/5 hover:ring-white/50 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span>Under the hood</span>
            <motion.span
              animate={{ rotate: open ? 180 : 0 }}
              transition={{ duration: 0.3, ease: EASE_BRAND }}
              className="flex text-ink-muted group-hover:text-ink"
            >
              <CaretDown size={15} weight="bold" />
            </motion.span>
          </button>
        </motion.div>
      </RevealGroup>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="trust-details"
            key="trust-details"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.45, ease: EASE_OUT }}
            className="max-w-4xl mx-auto overflow-hidden"
          >
            <div className="mt-10 md:mt-12 rounded-[1.75rem] ring-1 ring-hairline bg-surface/40 divide-y divide-hairline overflow-hidden">
              {/* Column header — desktop only; the rows are self-describing on mobile. */}
              <div className="hidden md:grid grid-cols-[1.5fr_1fr_1.2fr] gap-x-8 px-9 py-4">
                <ColHead>What holds</ColHead>
                <ColHead>Guaranteed by</ColHead>
                <ColHead>Check it yourself</ColHead>
              </div>

              {guarantees.map((g) => (
                <div
                  key={g.property}
                  className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr_1.2fr] gap-x-8 gap-y-3 px-6 md:px-9 py-7"
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
                  <div className="md:pt-0.5 flex flex-col gap-2">
                    {g.verify.map((v, i) => (
                      <VerifyHandle key={i} verify={v} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

          </motion.div>
        )}
      </AnimatePresence>
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
        isMath ? 'text-accent-soft ring-accent-soft/25' : 'text-ink-muted ring-hairline'
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

function VerifyHandle({ verify }: { verify: VerifyLink }) {
  const content = verify.vanish ? (
    <>
      <Vanishing>Sobrecito</Vanishing> could vanish; it {verify.label}
    </>
  ) : (
    verify.label
  )

  if (!verify.href) {
    return <span className="font-mono text-xs text-ink-muted leading-[1.5]">{content}</span>
  }

  return (
    <a
      href={verify.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-start gap-1.5 font-mono text-xs text-accent-soft leading-[1.5] transition-colors hover:text-accent w-fit"
    >
      <span className="border-b border-accent-soft/30 group-hover:border-accent/60">{content}</span>
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
