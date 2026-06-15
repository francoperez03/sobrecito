import { DoubleBezel } from '@/components/ui/DoubleBezel'

export function Differentiation() {
  return (
    <section className="py-24 px-4">
      <div className="max-w-5xl mx-auto flex flex-col gap-8">
        {/* Row 1 — vs transparent payroll */}
        <DoubleBezel>
          <div className="p-8 md:p-10">
            <p className="font-sans font-[900] text-ink leading-[1.15] tracking-[-0.01em]"
              style={{ fontSize: 'clamp(1.25rem, 2.5vw, 1.75rem)' }}
            >
              Every Stellar payroll tool sells transparency. Sobre is the only one that proves the total without showing a single salary.
            </p>
            <p className="mt-4 font-sans font-[400] text-ink-muted text-base leading-[1.6] max-w-[65ch]">
              The private+provable seat in Stellar's ecosystem has been empty — by accident, not by design.
            </p>
          </div>
        </DoubleBezel>

        {/* Row 2 — vs Zarf, offset depth layer */}
        <DoubleBezel outerClassName="md:ml-8 ring-1 ring-white/12">
          <div className="p-8 md:p-10">
            <p className="font-sans font-[900] text-ink leading-[1.15] tracking-[-0.01em]"
              style={{ fontSize: 'clamp(1.25rem, 2.5vw, 1.75rem)' }}
            >
              Zarf hides payments. Sobre hides payments AND proves the total to the one auditor entitled to see it.
            </p>
            <p className="mt-4 font-sans font-[400] text-ink-muted text-base leading-[1.6] max-w-[65ch]">
              Hiding is easy. Proving what you hid — without showing it — is the hard part.
            </p>
          </div>
        </DoubleBezel>
      </div>
    </section>
  )
}
