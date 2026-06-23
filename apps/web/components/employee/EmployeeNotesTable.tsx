'use client'

import { motion } from 'motion/react'
import { DoubleBezel } from '@/components/ui/DoubleBezel'
import { explorerTxUrl, formatUsdc } from '@/lib/rpc'

const EASE_BRAND = [0.32, 0.72, 0, 1] as const

type NoteStatus = 'pending' | 'claimed' | 'unknown'

interface NoteRow {
  index: number
  amount: bigint
  ledger: number
  txHash: string
  status: NoteStatus
  receiptTxHash?: string
}

interface EmployeeNotesTableProps {
  notes: NoteRow[]
  onClaim: (index: number) => void
  /** Index currently being claimed (drives the per-row Claiming… state), or null. */
  claimingIndex: number | null
}

// ---------------------------------------------------------------------------
// EmployeeNotesTable
//
// Compact, auditor-style breakdown of the employee's payments. One row per note.
// The amount stays HIDDEN (a muted dotted placeholder — no redaction block) while
// pending; clicking the row's Claim button reveals the real amount inline once the
// withdraw confirms. The amber disclosure (A1 / T-06-16, load-bearing) sits ABOVE
// the rows, so it always precedes every Claim CTA.
// ---------------------------------------------------------------------------

export function EmployeeNotesTable({
  notes,
  onClaim,
  claimingIndex,
}: EmployeeNotesTableProps) {
  const rows = [...notes].sort((a, b) => a.index - b.index)
  const anyPending = rows.some((n) => n.status === 'pending')

  return (
    <DoubleBezel radius="2rem" className="overflow-hidden">
      <div className="px-6 sm:px-8 py-6 flex flex-col gap-4">
        {/* Disclosure (A1, load-bearing). Above the rows → precedes every Claim CTA. */}
        {anyPending && (
          <div
            data-testid="claim-disclosure"
            className="self-start rounded-full bg-accent-warm/10 text-accent-warm text-xs px-3 py-1.5"
          >
            Once you cash out, this amount becomes visible on-chain.
          </div>
        )}

        <div className="w-full">
          {/* Header — two columns: amount and a single action/status cell. */}
          <div className="grid grid-cols-[1fr_auto] gap-4 px-1 pb-2 border-b border-white/5">
            <span className="text-xs text-ink-muted uppercase tracking-widest">Amount</span>
            <span className="text-xs text-ink-muted uppercase tracking-widest text-right">
              Cash out
            </span>
          </div>

          {rows.map((note, i) => (
            <EmployeeRow
              key={note.index}
              note={note}
              i={i}
              onClaim={onClaim}
              claiming={claimingIndex === note.index}
            />
          ))}
        </div>
      </div>
    </DoubleBezel>
  )
}

function EmployeeRow({
  note,
  i,
  onClaim,
  claiming,
}: {
  note: NoteRow
  i: number
  onClaim: (index: number) => void
  claiming: boolean
}) {
  const isClaimed = note.status === 'claimed'
  const isPending = note.status === 'pending'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE_BRAND, delay: i * 0.05 }}
      className="grid grid-cols-[1fr_auto] gap-4 items-center px-1 py-3 border-b border-white/5 last:border-0"
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        {/* Amount: hidden dotted placeholder while pending → revealed inline on claim. */}
        {isClaimed ? (
          <motion.span
            key="amount"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, ease: EASE_BRAND }}
            className="font-mono text-base sm:text-lg text-accent-soft leading-tight"
          >
            {formatUsdc(note.amount)} USDC
          </motion.span>
        ) : (
          <span className="font-mono text-base sm:text-lg text-ink-muted/35 leading-tight select-none">
            •••••
          </span>
        )}
        <span className="font-mono text-[11px] text-ink-muted/60 truncate">
          Payment #{i + 1}
        </span>
      </div>

      {/* Single action/status cell: Claim button (pending) → Claimed + receipt (claimed). */}
      <div className="flex justify-end">
        {isPending && (
          <button
            type="button"
            onClick={() => onClaim(note.index)}
            disabled={claiming}
            data-testid="claim-cta"
            aria-label={`Cash out payment ${i + 1}`}
            className="bg-accent-fill text-white font-[900] text-sm px-4 h-9 rounded-full hover:opacity-90 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-70 whitespace-nowrap"
          >
            {claiming ? 'Cashing out…' : 'Cash out'}
          </button>
        )}
        {isClaimed && note.receiptTxHash && (
          <a
            href={explorerTxUrl(note.receiptTxHash)}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="receipt-link"
            title={note.receiptTxHash}
            className="inline-flex items-center gap-1.5 text-xs text-accent-soft hover:text-accent transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            <span aria-hidden>✓</span>
            <span>Cashed out</span>
            <span className="font-mono text-ink-muted/60">
              {note.receiptTxHash.slice(0, 10)}…
            </span>
          </a>
        )}
        {note.status === 'unknown' && (
          <span className="text-xs text-ink-muted">Unknown</span>
        )}
      </div>
    </motion.div>
  )
}
