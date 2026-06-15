import { DoubleBezel } from '@/components/ui/DoubleBezel'

export function Differentiation() {
  return (
    <section className="py-24 px-4">
      <div className="max-w-5xl mx-auto flex flex-col gap-8">
        {/* Row 1 — vs transparent payroll */}
        <DoubleBezel>
          <div className="p-8 md:p-10">
            <p className="font-sans font-[900] text-ink text-h3 leading-[1.15] tracking-[-0.01em]">
              Prove the total without showing a single salary.
            </p>
            <p className="mt-4 font-sans font-[400] text-ink-muted text-base leading-[1.6] max-w-[65ch]">
              The public sees one verified number: the batch adds up. Every individual amount stays sealed.
            </p>
          </div>
        </DoubleBezel>

        {/* Row 2 — vs Zarf, offset depth layer */}
        <DoubleBezel outerClassName="md:ml-8 ring-1 ring-white/12">
          <div className="p-8 md:p-10">
            <p className="font-sans font-[900] text-ink text-h3 leading-[1.15] tracking-[-0.01em]">
              Only the auditor can open it.
            </p>
            <p className="mt-4 font-sans font-[400] text-ink-muted text-base leading-[1.6] max-w-[65ch]">
              A view-key scoped to one period rebuilds the per-employee detail. Everyone else gets the proof, never the amounts.
            </p>
          </div>
        </DoubleBezel>
      </div>
    </section>
  )
}
