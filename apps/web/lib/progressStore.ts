'use client'

/**
 * Demo-progress store — tracks how far the visitor has walked the 5-step product
 * flow (generate -> view-key -> pay -> claim -> audit) as they perform the real
 * actions across the tabs. Strict order: a step only counts if every prior step
 * is already done, so progress is a single contiguous count 0..5. Persisted to
 * localStorage, mirrored on the same house pattern as `auditorKeyStore.ts`.
 *
 * It is an external store (subscribe + getSnapshot) so the global panel can react
 * to `markStep(...)` calls fired from unrelated components, without a React
 * context (none exists in this app).
 */

import { useSyncExternalStore } from 'react'

export const STEP_KEYS = ['generate', 'viewkey', 'pay', 'claim', 'audit'] as const
export type StepKey = (typeof STEP_KEYS)[number]
export const TOTAL_STEPS = STEP_KEYS.length

const STORAGE_KEY = 'sobre.demoProgress'

function readInitial(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw == null) return 0
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n)) return 0
    return Math.min(Math.max(n, 0), TOTAL_STEPS)
  } catch {
    return 0
  }
}

let completed = readInitial()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function persist() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, String(completed))
  } catch {
    // best-effort: private mode / quota can throw
  }
}

/**
 * Record that the user performed `key`. Strict order: ignored unless all prior
 * steps are already complete. Idempotent.
 */
export function markStep(key: StepKey): void {
  const i = STEP_KEYS.indexOf(key)
  if (i < 0) return
  if (completed < i) return // a prior step is missing — do not tick (strict)
  const next = Math.max(completed, i + 1)
  if (next === completed) return // already done
  completed = next
  persist()
  emit()
}

export function resetProgress(): void {
  if (completed === 0) {
    // still clear storage in case it held a stale value
  }
  completed = 0
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }
  emit()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function getSnapshot(): number {
  return completed
}

function getServerSnapshot(): number {
  return 0
}

/** Reactive read of the contiguous completed-step count (0..5). */
export function useDemoProgress(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

// Dev affordance: drive ticks from the browser console without Freighter/testnet,
// e.g. `__sobreProgress.markStep('pay')`, `__sobreProgress.reset()`.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as { __sobreProgress?: unknown }).__sobreProgress = {
    markStep,
    reset: resetProgress,
    get: () => completed,
    keys: STEP_KEYS,
  }
}
