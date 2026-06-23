'use client'

import { motion } from 'motion/react'
import { Check, Warning } from '@phosphor-icons/react'
import { DoubleBezel } from '@/components/ui/DoubleBezel'
import { formatUsdc, explorerContractUrl, readDeployments } from '@/lib/rpc'

const EASE_BRAND = [0.32, 0.72, 0, 1] as const

interface ReconciliationFooterProps {
  /** Sum of the decrypted per-note amounts (USDC base units). */
  sumDecrypted: bigint
  /** On-chain total T = Σ of the public per-batch deposit amounts (ext_amount)
   *  the ZK proof attests. Withdrawal-invariant (NOT the live pool balance). */
  total: bigint
  /** Whether sum(decrypted) reconciles to T. */
  match: boolean
}

/**
 * Reconciliation footer (UX-03, A3 soundness) — the auditor's moment of value:
 * the decrypted detail reconciles against the public on-chain total.
 *
 * Presented as a clean reconciliation statement (two figures + a verdict) rather
 * than an equation, with the on-chain total linked to the pool contract so the
 * auditor can confirm the public figure independently. The verdict pulses in last
 * (delay 0.5s) per the UI-SPEC auditor choreography.
 */
export function ReconciliationFooter({
  sumDecrypted,
  total,
  match,
}: ReconciliationFooterProps) {
  const poolContractId = readDeployments().poolContractId

  return (
    <DoubleBezel radius="2rem" className="px-6 py-5">
      <motion.div
        className="flex flex-col gap-3"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, ease: EASE_BRAND, delay: 0.5 }}
      >
        {/* Two figures, right-aligned tabular numbers for an account-statement feel. */}
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-ink-muted">Decrypted detail</span>
            <span className="font-mono text-sm text-ink tabular-nums">
              {formatUsdc(sumDecrypted)} USDC
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="flex items-center gap-2 text-sm text-ink-muted">
              On-chain total
              {poolContractId && (
                <a
                  href={explorerContractUrl(poolContractId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11px] text-ink-muted/70 hover:text-accent-soft transition-colors"
                >
                  contract ↗
                </a>
              )}
            </span>
            <span className="font-mono text-sm text-ink tabular-nums">
              {formatUsdc(total)} USDC
            </span>
          </div>
        </div>

        {/* Verdict — pulses in last per the auditor choreography. */}
        <div className="border-t border-white/5 pt-3">
          {match ? (
            <p className="flex items-center gap-2 text-sm text-accent-soft">
              <Check size={15} weight="bold" aria-hidden />
              Reconciled — every amount accounts for the total.
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-accent-warm">
              <Warning size={15} weight="fill" aria-hidden />
              The detail doesn&apos;t add up to the on-chain total.
            </p>
          )}
        </div>
      </motion.div>
    </DoubleBezel>
  )
}
