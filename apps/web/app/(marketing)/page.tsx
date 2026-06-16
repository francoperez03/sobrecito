import { Hero } from '@/components/landing/Hero'
import { ProblemSection } from '@/components/landing/ProblemSection'
import { Centerpiece } from '@/components/landing/Centerpiece'
import { NamedSalaryAnchor } from '@/components/landing/NamedSalaryAnchor'
import { ThreeLevels } from '@/components/landing/ThreeLevels'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { TrustModel } from '@/components/landing/TrustModel'
import { ClosingCTA } from '@/components/landing/ClosingCTA'
import { Reveal } from '@/components/motion/Reveal'

// Landing page — narrative order:
// Hero → Problem → Centerpiece + NamedSalaryAnchor → ThreeLevels → HowItWorks → TrustModel
// (FloatingNav + Footer come from the marketing layout). Each section manages its
// own scroll entrance internally (RevealGroup); only the showcase group is wrapped.

export default function Landing() {
  return (
    <main>
      <Hero />

      <ProblemSection />

      {/* The proof, problem-first (PAS): the exposed salary today, then Sobrecito sealing it */}
      <section className="pt-6 md:pt-8 pb-24 md:pb-32 px-5 md:px-8">
        <div className="max-w-3xl mx-auto flex flex-col gap-14">
          <Reveal className="text-center">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">
              What everyone else can see
            </p>
            <h2 className="mt-4 font-display font-light text-ink text-h2 leading-[1.1] tracking-[-0.02em] text-balance">
              Every on-chain salary is public. Sobrecito seals it.
            </h2>
          </Reveal>

          <Reveal delay={0.05}>
            <p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-accent-warm">
              Without Sobrecito · a salary on-chain today
            </p>
            <NamedSalaryAnchor />
          </Reveal>

          <Reveal delay={0.05}>
            <p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-accent-soft">
              With Sobrecito
            </p>
            <Centerpiece />
          </Reveal>
        </div>
      </section>

      <ThreeLevels />

      <HowItWorks />

      <TrustModel />

      <ClosingCTA />
    </main>
  )
}
