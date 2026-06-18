/**
 * employeeRoster.test.ts — validation + SSR-safety of the employee roster store.
 *
 * The full localStorage round-trip is covered by the Playwright e2e suite (runs in
 * a real browser). This unit suite runs in the node environment (no window), so it
 * asserts pure validation and SSR guards, mirroring auditorKeyStore.test.ts.
 */

import { describe, it, expect } from 'vitest'
import {
  isValidEmployeePublicKey,
  loadRoster,
  saveEntry,
  removeEntry,
  clearRoster,
  EMPLOYEE_ROSTER_STORAGE_KEY,
} from '@/lib/employeeRoster'

const VALID_PUBKEY = 'ab'.repeat(64) // 128 hex chars

describe('isValidEmployeePublicKey', () => {
  it('accepts a 128-char hex key', () => {
    expect(isValidEmployeePublicKey(VALID_PUBKEY)).toBe(true)
  })

  it('accepts 128 hex with leading 0x', () => {
    expect(isValidEmployeePublicKey('0x' + VALID_PUBKEY)).toBe(true)
  })

  it('accepts with surrounding whitespace', () => {
    expect(isValidEmployeePublicKey('  ' + VALID_PUBKEY + '  ')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidEmployeePublicKey('')).toBe(false)
  })

  it('rejects whitespace-only', () => {
    expect(isValidEmployeePublicKey('   ')).toBe(false)
  })

  it('rejects 64-char hex (too short)', () => {
    expect(isValidEmployeePublicKey('ab'.repeat(32))).toBe(false)
  })

  it('rejects 127-char hex (one char short)', () => {
    expect(isValidEmployeePublicKey('a'.repeat(127))).toBe(false)
  })

  it('rejects 129-char hex (one char over)', () => {
    expect(isValidEmployeePublicKey('a'.repeat(129))).toBe(false)
  })

  it('rejects non-hex strings', () => {
    expect(isValidEmployeePublicKey('not-a-key')).toBe(false)
    expect(isValidEmployeePublicKey('z'.repeat(128))).toBe(false)
  })
})

describe('EMPLOYEE_ROSTER_STORAGE_KEY', () => {
  it('is the stable namespaced key', () => {
    expect(EMPLOYEE_ROSTER_STORAGE_KEY).toBe('sobre.employeeRoster')
  })
})

describe('roster SSR-safety (node, no window)', () => {
  it('loadRoster returns [] without window', () => {
    expect(typeof window).toBe('undefined')
    expect(loadRoster()).toEqual([])
  })

  it('saveEntry is a no-op and does not throw without window', () => {
    expect(() => saveEntry('alice', VALID_PUBKEY)).not.toThrow()
  })

  it('removeEntry is a no-op and does not throw without window', () => {
    expect(() => removeEntry('alice')).not.toThrow()
  })

  it('clearRoster is a no-op and does not throw without window', () => {
    expect(() => clearRoster()).not.toThrow()
  })

  it('loadRoster still returns [] after no-op save (no window)', () => {
    saveEntry('alice', VALID_PUBKEY)
    expect(loadRoster()).toEqual([])
  })
})
