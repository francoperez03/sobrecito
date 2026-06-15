import { DoubleBezel } from '@/components/ui/DoubleBezel'
import { NAMED_SALARY_RECEIPT } from '@/lib/demo-data'

export function NamedSalaryAnchor() {
  const { accountHash, amount, timestamp, source } = NAMED_SALARY_RECEIPT

  return (
    <div className="w-full max-w-3xl mx-auto">
      <DoubleBezel
        radius="1.5rem"
        outerClassName="opacity-90"
        className="px-6 py-5"
      >
        {/* Receipt header */}
        <p className="text-xs text-ink-muted font-mono uppercase tracking-widest mb-4">
          On-chain payment record
        </p>

        {/* Receipt rows */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-muted">Account</span>
            <span className="font-mono text-sm text-ink">{accountHash}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-muted">Amount</span>
            <span className="font-mono text-sm text-accent-warm font-medium">
              {amount}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-muted">Timestamp</span>
            <span className="font-mono text-sm text-ink">{timestamp}</span>
          </div>
        </div>

        {/* Divider — source reads: "this is real. It can't be hidden." */}
        <div className="mt-4 pt-4 border-t border-white/5">
          <p className="text-xs text-ink-muted italic">{source}</p>
        </div>
      </DoubleBezel>

      {/* Caption */}
      <p className="mt-4 text-sm text-center text-ink-muted">
        Every on-chain salary without Sobrecito looks like this. Permanently.
      </p>
    </div>
  )
}
