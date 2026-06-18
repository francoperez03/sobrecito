'use client'

import { motion } from 'motion/react'
import { DoubleBezel } from '@/components/ui/DoubleBezel'
import { explorerTxUrl } from '@/lib/rpc'

const EASE_BRAND = [0.32, 0.72, 0, 1] as const

// ---------------------------------------------------------------------------
// StepState — discriminated union for the 4-step proving flow
// ---------------------------------------------------------------------------

export type StepState =
  | { phase: 'idle' }
  | { phase: 'preparing' }
  | { phase: 'downloading'; loaded: number; total: number; message: string }
  | { phase: 'proving'; elapsed: number }
  | { phase: 'signing' }
  | { phase: 'submitting' }
  | { phase: 'done'; txHash: string }
  | { phase: 'error'; message: string }

export interface ProvingStepperProps {
  step: StepState
}

// ---------------------------------------------------------------------------
// Step label data
// ---------------------------------------------------------------------------

const STEPS = [
  { key: 'preparing', label: '1. Preparing bills' },
  { key: 'downloading', label: '2. Downloading proving engine' },
  { key: 'proving', label: '3. Generating ZK proof' },
  { key: 'signing', label: '4. Sign in Freighter' },
] as const

function stepIndex(phase: string): number {
  if (phase === 'preparing') return 0
  if (phase === 'downloading') return 1
  if (phase === 'proving') return 2
  if (phase === 'signing' || phase === 'submitting') return 3
  if (phase === 'done') return 4
  return -1
}

// ---------------------------------------------------------------------------
// ProvingStepper — presentational 4-step modal card
//
// Receives `step: StepState` from PayrollComposer and renders the current
// progress. Invisible when step.phase === 'idle'.
// ---------------------------------------------------------------------------

export function ProvingStepper({ step }: ProvingStepperProps) {
  if (step.phase === 'idle') return null

  const active = stepIndex(step.phase)
  const isDone = step.phase === 'done'
  const isError = step.phase === 'error'

  return (
    <motion.div
      data-testid="proving-stepper"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_BRAND }}
    >
      <DoubleBezel radius="2rem" className="overflow-hidden">
        <div className="px-8 py-8 flex flex-col gap-6">

          {/* Header */}
          <div>
            {isDone ? (
              <h3 className="text-h3 font-[900] tracking-[-0.01em] leading-[1.15] text-accent-soft">
                Payroll sent.
              </h3>
            ) : isError ? (
              <h3 className="text-h3 font-[900] tracking-[-0.01em] leading-[1.15] text-accent-warm">
                Something went wrong
              </h3>
            ) : (
              <h3 className="text-h3 font-[900] tracking-[-0.01em] leading-[1.15]">
                Sending payroll
              </h3>
            )}
          </div>

          {/* Step indicators (1–4) */}
          {!isDone && !isError && (
            <div className="flex flex-col gap-3">
              {STEPS.map((s, i) => {
                const completed = i < active
                const current = i === active
                return (
                  <motion.div
                    key={s.key}
                    data-testid={`step-${s.key}`}
                    initial={{ opacity: 0.4 }}
                    animate={{ opacity: current || completed ? 1 : 0.4 }}
                    transition={{ duration: 0.3, ease: EASE_BRAND }}
                    className="flex items-start gap-3"
                  >
                    {/* Dot */}
                    <div
                      className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                        completed
                          ? 'bg-accent-soft'
                          : current
                            ? 'bg-accent animate-pulse'
                            : 'bg-white/20'
                      }`}
                    />
                    <div className="flex flex-col gap-1 min-w-0">
                      <span
                        className={`text-sm font-[500] ${
                          current ? 'text-ink' : completed ? 'text-ink-muted' : 'text-ink-muted/50'
                        }`}
                      >
                        {s.label}
                      </span>

                      {/* Step 2: byte progress bar */}
                      {current && step.phase === 'downloading' && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.25, ease: EASE_BRAND }}
                          className="flex flex-col gap-1.5"
                        >
                          <div className="w-full max-w-xs bg-white/10 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="h-full bg-accent-soft rounded-full transition-all duration-300"
                              style={{
                                width:
                                  step.total > 0
                                    ? `${Math.min(100, Math.round((step.loaded / step.total) * 100))}%`
                                    : '0%',
                              }}
                            />
                          </div>
                          <span className="text-xs text-ink-muted font-mono">
                            {step.total > 0
                              ? `${formatBytes(step.loaded)} / ${formatBytes(step.total)}`
                              : 'Descargando…'}
                            {' · '}
                            <span className="text-accent-soft">se cachea tras la primera vez</span>
                          </span>
                          {step.message && (
                            <span className="text-xs text-ink-muted/60">{step.message}</span>
                          )}
                        </motion.div>
                      )}

                      {/* Step 3: elapsed timer + local-proving disclosure */}
                      {current && step.phase === 'proving' && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.25, ease: EASE_BRAND }}
                          className="flex flex-col gap-1.5"
                        >
                          <span className="font-mono text-xs text-accent-soft">
                            {step.elapsed}s elapsed (~20-40s total)
                          </span>
                          <div className="bg-accent/10 text-accent-soft text-xs px-3 py-1.5 rounded-full self-start">
                            Runs locally, nothing is uploaded.
                          </div>
                        </motion.div>
                      )}

                      {/* Step 4: signing/submitting status */}
                      {current && (step.phase === 'signing' || step.phase === 'submitting') && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.25, ease: EASE_BRAND }}
                        >
                          <span className="text-xs text-ink-muted">
                            {step.phase === 'signing'
                              ? 'Approve the transaction in Freighter…'
                              : 'Submitting to the network…'}
                          </span>
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}

          {/* Done state: tx hash + explorer link */}
          {isDone && (
            <motion.div
              data-testid="stepper-done"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: EASE_BRAND }}
              className="flex flex-col gap-3"
            >
              <p className="text-sm text-ink-muted">
                Transaction confirmed on testnet.
              </p>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-ink-muted uppercase tracking-widest">
                  Tx hash
                </span>
                <a
                  href={explorerTxUrl(step.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-accent-soft break-all hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                  data-testid="explorer-link"
                >
                  {step.txHash}
                </a>
              </div>
              {/* Pending→success indicator */}
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-accent-soft" />
                <span className="text-xs text-accent-soft font-[500]">Confirmed</span>
              </div>
            </motion.div>
          )}

          {/* Error state */}
          {isError && (
            <motion.div
              data-testid="stepper-error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, ease: EASE_BRAND }}
            >
              <div className="bg-accent-warm/10 text-accent-warm text-sm px-4 py-3 rounded-xl">
                {step.message}
              </div>
            </motion.div>
          )}

        </div>
      </DoubleBezel>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
