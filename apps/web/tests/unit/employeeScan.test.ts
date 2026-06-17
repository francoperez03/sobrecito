/**
 * employeeScan.test.ts — RED phase (06.3-02 Task 1)
 *
 * Tests for scanEmployeeNotes (employee-scan.ts) and
 * reconstructMerklePathFromEvents (employee-scan.ts) and
 * fetchNullifierStatus (rpc.ts).
 */

import { describe, it, expect } from 'vitest'
import { deriveX25519 } from '@/lib/zk/keyDerivation'
import { makeEmployeeFixtureEvents, EMPLOYEE_TEST_SEED_HEX } from '../fixtures/employeeFixtures'
import { scanEmployeeNotes, reconstructMerklePathFromEvents } from '@/lib/employee-scan'
import type { EmployeeNote } from '@/lib/employee-scan'

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

const EMPLOYEE_SEED = hexToBytes(EMPLOYEE_TEST_SEED_HEX)

describe('scanEmployeeNotes', () => {
  it('returns 3 notes decrypted from fixture events with correct amounts', async () => {
    const { priv: employeePrivkey } = deriveX25519(EMPLOYEE_SEED)
    const events = makeEmployeeFixtureEvents([BigInt(1), BigInt(10), BigInt(100)]) as never[]
    const notes = await scanEmployeeNotes(employeePrivkey, { events })
    expect(notes).toHaveLength(3)
    expect(notes[0].amount).toBe(BigInt(1))
    expect(notes[1].amount).toBe(BigInt(10))
    expect(notes[2].amount).toBe(BigInt(100))
  })

  it('captures index, ledger, txHash from fixture events', async () => {
    const { priv: employeePrivkey } = deriveX25519(EMPLOYEE_SEED)
    const events = makeEmployeeFixtureEvents([BigInt(5)]) as never[]
    const notes = await scanEmployeeNotes(employeePrivkey, { events })
    expect(notes).toHaveLength(1)
    expect(notes[0].index).toBe(0)
    expect(notes[0].ledger).toBe(3110500)
    expect(notes[0].txHash).toBe('a'.repeat(63) + '0')
  })

  it('captures blinding from decrypted note payload', async () => {
    const { priv: employeePrivkey } = deriveX25519(EMPLOYEE_SEED)
    const events = makeEmployeeFixtureEvents([BigInt(42)]) as never[]
    const notes = await scanEmployeeNotes(employeePrivkey, { events })
    // blinding for index 0 is 1000 + 0 = 1000 (see employeeFixtures.ts)
    expect(notes[0].blinding).toBe(BigInt(1000))
  })

  it('returns 0 notes when called with wrong key (foreign blobs skipped silently)', async () => {
    // 0x44 seed: a DIFFERENT employee, not the fixture's 0x43
    const wrongSeed = hexToBytes('44'.repeat(32))
    const { priv: wrongPrivkey } = deriveX25519(wrongSeed)
    const events = makeEmployeeFixtureEvents([BigInt(1), BigInt(2)]) as never[]
    const notes = await scanEmployeeNotes(wrongPrivkey, { events })
    expect(notes).toHaveLength(0)
  })

  it('does not throw on foreign blobs (no rethrow)', async () => {
    const wrongSeed = hexToBytes('FF'.repeat(32))
    const { priv: wrongPrivkey } = deriveX25519(wrongSeed)
    const events = makeEmployeeFixtureEvents([BigInt(1), BigInt(10), BigInt(100)]) as never[]
    await expect(scanEmployeeNotes(wrongPrivkey, { events })).resolves.toEqual([])
  })
})

describe('reconstructMerklePathFromEvents', () => {
  it('returns an object with pathElements array and pathIndices string', async () => {
    const events = makeEmployeeFixtureEvents([BigInt(1), BigInt(2), BigInt(3)]) as never[]
    const result = reconstructMerklePathFromEvents(events as never, 0)
    expect(result).toHaveProperty('pathElements')
    expect(result).toHaveProperty('pathIndices')
    expect(Array.isArray(result.pathElements)).toBe(true)
    expect(typeof result.pathIndices).toBe('string')
  })

  it('returns pathElements of the expected tree-depth length', async () => {
    const events = makeEmployeeFixtureEvents([BigInt(1), BigInt(2)]) as never[]
    const result = reconstructMerklePathFromEvents(events as never, 0)
    // Tree depth = 10 levels (from depositTransactionBuilder inPathElements pattern)
    expect(result.pathElements.length).toBe(10)
  })

  it('returns pathIndices as a string of bits (binary chars)', async () => {
    const events = makeEmployeeFixtureEvents([BigInt(1), BigInt(2)]) as never[]
    const result = reconstructMerklePathFromEvents(events as never, 1)
    // pathIndices should be a string (could be a bitmask or direction string)
    expect(typeof result.pathIndices).toBe('string')
  })
})
