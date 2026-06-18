'use client'

import { motion } from 'motion/react'
import { DoubleBezel } from '@/components/ui/DoubleBezel'
import { explorerTxUrl, formatUsdc } from '@/lib/rpc'

const EASE_BRAND = [0.32, 0.72, 0, 1] as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NoteStatus = 'pending' | 'claimed' | 'unknown'

interface NoteCardProps {
  note: {
    index: number
    amount: bigint
    ledger: number
    txHash: string
  }
  status: NoteStatus
  onClaim: (index: number) => void
  claiming: boolean
  receiptTxHash?: string
}

// ---------------------------------------------------------------------------
// NoteStatusChip
// ---------------------------------------------------------------------------

function NoteStatusChip({ status }: { status: NoteStatus }) {
  const map: Record<NoteStatus, { label: string; toneClass: string }> = {
    pending: { label: 'Pending', toneClass: 'text-ink-muted' },
    claimed: { label: 'Claimed', toneClass: 'text-accent-soft' },
    unknown: { label: 'Unknown', toneClass: 'text-accent-warm' },
  }
  const { label, toneClass } = map[status]
  return (
    <span
      className={`inline-flex items-center rounded-full bg-surface px-3 h-7 ring-1 ring-hairline text-xs ${toneClass}`}
    >
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// NoteCard
//
// Per-note card (CAP-2, CAP-5, CAP-6).
//
// The amount sits SEALED behind the Centerpiece bar while status is 'pending';
// it slides away to reveal the amount once claimed. The amber disclosure chip
// fires BEFORE the Claim CTA (A1 / T-06-16, T-063-11): once claimed, the
// amount is publicly visible on-chain.
// ---------------------------------------------------------------------------

export function NoteCard({
  note,
  status,
  onClaim,
  claiming,
  receiptTxHash,
}: NoteCardProps) {
  const isClaimed = status === 'claimed'
  const isPending = status === 'pending'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_BRAND }}
    >
      <DoubleBezel radius="2rem" className="overflow-hidden">
        <div className="px-8 py-8 flex flex-col gap-5">

          {/* Batch metadata row: ledger + txHash (CAP-2) */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-ink-muted uppercase tracking-widest">
              Payment #{note.index}
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-xs text-ink-muted">
                Ledger {note.ledger}
              </span>
              <span className="font-mono text-xs text-ink-muted/60 break-all">
                {note.txHash.slice(0, 12)}…{note.txHash.slice(-6)}
              </span>
              <NoteStatusChip status={status} />
            </div>
          </div>

          {/* Amount: sealed bar while pending, revealed when claimed */}
          <div className="relative overflow-hidden h-8 w-40 self-start">
            <motion.div
              data-testid="amount-bar"
              className="absolute inset-0 rounded bg-ink/30"
              initial={{ scaleX: 1 }}
              animate={{ scaleX: isClaimed ? 0 : 1 }}
              transition={{ duration: 0.6, ease: EASE_BRAND }}
              style={{ transformOrigin: 'right' }}
            />
            {isClaimed && (
              <motion.span
                className="absolute inset-0 font-mono text-2xl text-accent-soft flex items-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, ease: EASE_BRAND, delay: 0.1 }}
              >
                {formatUsdc(note.amount)} USDC
              </motion.span>
            )}
          </div>

          {/* Pending flow: amber disclosure chip BEFORE the Claim CTA (load-bearing) */}
          {isPending && (
            <>
              {/* Amber disclosure chip (A1 / T-06-16 / T-063-11). Must precede CTA. */}
              <div
                className="bg-accent-warm/10 text-accent-warm text-xs px-3 py-2 rounded-full self-start"
                data-testid="claim-disclosure"
              >
                Once claimed, this amount is visible on-chain.
              </div>

              <button
                type="button"
                onClick={() => onClaim(note.index)}
                disabled={claiming}
                data-testid="claim-cta"
                className="bg-accent-fill text-white font-[900] text-base px-6 h-[52px] rounded-full hover:opacity-90 active:scale-[0.98] transition-all self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-70"
              >
                {claiming ? 'Claiming…' : 'Claim salary'}
              </button>
            </>
          )}

          {/* Receipt row when claimed (CAP-6) */}
          {isClaimed && receiptTxHash && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, ease: EASE_BRAND, delay: 0.3 }}
              className="flex flex-col gap-1"
            >
              <span className="text-xs text-ink-muted uppercase tracking-widest">
                Receipt
              </span>
              <a
                href={explorerTxUrl(receiptTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-accent-soft break-all hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                data-testid="receipt-link"
              >
                {receiptTxHash}
              </a>
            </motion.div>
          )}

        </div>
      </DoubleBezel>
    </motion.div>
  )
}
