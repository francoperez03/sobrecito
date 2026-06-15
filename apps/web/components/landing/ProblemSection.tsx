import { DoubleBezel } from '@/components/ui/DoubleBezel'

export function ProblemSection() {
  return (
    <section className="py-24 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Two-column asymmetric split — stacks on mobile */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left card — exposure state, dimmer */}
          <DoubleBezel outerClassName="opacity-70">
            <div className="p-8">
              <p className="font-sans text-base text-ink leading-[1.6]">
                {/* "every salary is public forever" — amber signals exposure */}
                Pay on-chain → <span>every salary is </span><span className="text-accent-warm font-[500]">public forever.</span>
              </p>
            </div>
          </DoubleBezel>

          {/* Right card — abandonment state, dimmer */}
          <DoubleBezel outerClassName="opacity-70">
            <div className="p-8">
              <p className="font-sans text-base text-ink leading-[1.6]">
                Don't pay on-chain → abandon programmable USDC rails.
              </p>
            </div>
          </DoubleBezel>
        </div>

        {/* Resolution — brightest element */}
        <div className="mt-8 flex justify-center">
          <DoubleBezel outerClassName="ring-1 ring-accent/30">
            <div className="px-12 py-6">
              <p className="font-sans font-[900] text-accent text-center leading-[1.15] tracking-[-0.01em]"
                style={{ fontSize: 'clamp(1.75rem, 3.5vw, 2.75rem)' }}
              >
                Sobre holds both.
              </p>
            </div>
          </DoubleBezel>
        </div>
      </div>
    </section>
  )
}
