import { Hero } from '@/components/landing/Hero'
import { ProblemSection } from '@/components/landing/ProblemSection'
import { Centerpiece } from '@/components/landing/Centerpiece'
import { NamedSalaryAnchor } from '@/components/landing/NamedSalaryAnchor'
import { ThreeLevels } from '@/components/landing/ThreeLevels'
import { WhyStellar } from '@/components/landing/WhyStellar'
import { Differentiation } from '@/components/landing/Differentiation'
import { Reveal } from '@/components/motion/Reveal'

// Landing page — narrative order:
// Hero → Problem → Centerpiece + NamedSalaryAnchor → ThreeLevels → WhyStellar → Differentiation
// (FloatingNav + Footer come from the marketing layout)

export default function Landing() {
  return (
    <main>
      {/* Hero: page-load entrance animation handled inside Hero.tsx */}
      <Hero />

      {/* Problem section */}
      <Reveal>
        <ProblemSection />
      </Reveal>

      {/* Centerpiece — deepest Z-axis layer (UI-SPEC: Z-Axis Cascade).
          Manages its own visibility + MotionConfig; Reveal wraps the section shell. */}
      <Reveal delay={0.05}>
        <section className="py-24 px-4">
          <div className="max-w-5xl mx-auto flex flex-col items-center gap-12">
            <Centerpiece />
            <NamedSalaryAnchor />
          </div>
        </section>
      </Reveal>

      {/* Three Levels of Revelation */}
      <Reveal>
        <ThreeLevels />
      </Reveal>

      {/* Why Stellar */}
      <Reveal delay={0.05}>
        <WhyStellar />
      </Reveal>

      {/* Differentiation */}
      <Reveal>
        <Differentiation />
      </Reveal>
    </main>
  )
}
