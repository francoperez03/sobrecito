/**
 * auditorKeyStore.test.ts — validation + SSR-safety of the auditor public-key
 * store. The full localStorage round-trip (save in auditor → autofill in
 * employer) is covered by the Playwright e2e suite, which runs in a real
 * browser; this unit suite runs in the node environment (no window), so it
 * asserts the pure validation and the SSR guards.
 */

import { describe, it, expect } from 'vitest'
import {
  isValidAuditorPublicKey,
  loadAuditorPublicKey,
  saveAuditorPublicKey,
  clearAuditorPublicKey,
  AUDITOR_PUBLIC_KEY_STORAGE_KEY,
} from '@/lib/auditorKeyStore'

describe('isValidAuditorPublicKey', () => {
  it('accepts a 64-char hex key (with and without 0x)', () => {
    const hex = 'ab'.repeat(32)
    expect(isValidAuditorPublicKey(hex)).toBe(true)
    expect(isValidAuditorPublicKey('0x' + hex)).toBe(true)
    expect(isValidAuditorPublicKey('  ' + hex + '  ')).toBe(true)
  })

  it('accepts a base64 key that decodes to 32 bytes', () => {
    // 32 zero bytes as standard base64 (44 chars).
    const b64 = Buffer.alloc(32).toString('base64')
    expect(isValidAuditorPublicKey(b64)).toBe(true)
  })

  it('rejects empty, short, and malformed input', () => {
    expect(isValidAuditorPublicKey('')).toBe(false)
    expect(isValidAuditorPublicKey('   ')).toBe(false)
    expect(isValidAuditorPublicKey('not-a-key')).toBe(false)
    expect(isValidAuditorPublicKey('ab'.repeat(16))).toBe(false) // 32 hex chars = 16 bytes
    // base64 that decodes to the wrong length
    expect(isValidAuditorPublicKey(Buffer.alloc(16).toString('base64'))).toBe(false)
  })
})

describe('store SSR-safety (node, no window)', () => {
  it('exposes a stable namespaced storage key', () => {
    expect(AUDITOR_PUBLIC_KEY_STORAGE_KEY).toBe('sobre.auditorPublicKey')
  })

  it('save/clear are no-ops and load returns null without window', () => {
    expect(typeof window).toBe('undefined')
    // None of these should throw when window is absent.
    expect(() => saveAuditorPublicKey('ab'.repeat(32))).not.toThrow()
    expect(() => clearAuditorPublicKey()).not.toThrow()
    expect(loadAuditorPublicKey()).toBeNull()
  })
})
