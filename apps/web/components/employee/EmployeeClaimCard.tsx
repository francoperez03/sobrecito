'use client'

import { useState } from 'react'
import { motion } from 'motion/react'
import { DoubleBezel } from '@/components/ui/DoubleBezel'
import { unshieldNote, type NoteMeta } from '@/lib/employee-unshield'
import { formatUsdc } from '@/lib/rpc'

const EASE_BRAND = [0.32, 0.72, 0, 1] as const

interface EmployeeClaimCardProps {
  /** Note metadata decoded from the claim link token (bearer credential). */
  noteMeta: NoteMeta
}

type ClaimState = 'idle' | 'claiming' | 'claimed' | 'error'

/**
 * Employee claim card (UI-SPEC Surface 4, STRETCH, RESEARCH D-12 fallback #1).
 *
 * The visible face of "employee gets paid" without re-linking the amount to
 * identity (A1). A single DoubleBezel card: the note amount sits SEALED behind the
 * Centerpiece bar (the same `scaleX: 1 → 0` reveal `AuditorTable` uses, Plan 04);
 * an amber warning chip fires BEFORE the CTA — claiming makes the amount public
 * on-chain (T-06-16, by design); the "Claim salary" CTA signs a pool unshield with
 * Freighter (`unshieldNote`, the employee pays their own gas) and, on success,
 * slides the bar away to reveal the amount and shows "Salary claimed." + the tx
 * hash.
 *
 * `MotionConfig reducedMotion="user"` (inherited from the (demo) layout) degrades
 * the bar reveal to an instant crossfade.
 */
export function EmployeeClaimCard({ noteMeta }: EmployeeClaimCardProps) {
  const [state, setState] = useState<ClaimState>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const claimed = state === 'claimed'
  const claiming = state === 'claiming'

  async function handleClaim() {
    setState('claiming')
    setErrorMsg(null)
    try {
      const result = await unshieldNote(noteMeta)
      setTxHash(result.hash)
      setState('claimed')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not claim. Try again.')
      setState('error')
    }
  }

  return (
    <DoubleBezel radius="2rem" className="overflow-hidden">
      <div className="px-8 py-10 flex flex-col gap-6">
        {/* Heading — H2, weight 900. Becomes "Salary claimed." on success. */}
        <div>
          <h2 className="text-h2 font-[900] tracking-[-0.01em] leading-[1.15]">
            {claimed ? 'Salary claimed.' : 'Your salary is waiting.'}
          </h2>
          {claimed && txHash && (
            <p className="mt-3 text-lead text-ink-muted">
              USDC sent to your wallet. Tx:{' '}
              <span className="font-mono text-sm text-accent-soft break-all">
                {txHash}
              </span>
            </p>
          )}
        </div>

        {/* Amount — SEALED behind the Centerpiece bar; revealed after claim.
            Mirrors AuditorTable's bar→amount choreography exactly. */}
        <div className="relative overflow-hidden h-8 w-40 self-start">
          <motion.div
            data-testid="amount-bar"
            className="absolute inset-0 rounded bg-ink/30"
            initial={{ scaleX: 1 }}
            animate={{ scaleX: claimed ? 0 : 1 }}
            transition={{ duration: 0.6, ease: EASE_BRAND }}
            style={{ transformOrigin: 'right' }}
          />
          {/* Conditionally rendered (not opacity-0) so the amount is absent while
              sealed. Real USDC value (base units → decimal). */}
          {claimed && (
            <motion.span
              className="absolute inset-0 font-mono text-2xl text-accent-soft flex items-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, ease: EASE_BRAND, delay: 0.1 }}
            >
              {formatUsdc(BigInt(noteMeta.amount))} USDC
            </motion.span>
          )}
        </div>

        {/* Pre-claim flow: amber warning chip FIRST, then the CTA. */}
        {!claimed && (
          <>
            {/* Amber warning chip — fires BEFORE the CTA (UI-SPEC Surface 4). The
                only amber on the page: the exposure signal (A1 / T-06-16). */}
            <div className="bg-accent-warm/10 text-accent-warm text-xs px-3 py-2 rounded-full self-start">
              Once claimed, this amount is visible on-chain.
            </div>

            <button
              type="button"
              onClick={handleClaim}
              disabled={claiming}
              className="bg-accent-fill text-white font-[900] text-base px-6 h-[52px] rounded-full hover:opacity-90 active:scale-[0.98] transition-all self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-70"
            >
              {claiming ? 'Claiming…' : 'Claim salary'}
            </button>

            {state === 'error' && errorMsg && (
              <p className="text-sm text-ink-muted">{errorMsg}</p>
            )}
          </>
        )}
      </div>
    </DoubleBezel>
  )
}
