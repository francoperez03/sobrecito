import { describe, it, expect } from 'vitest'
import {
  decompose,
  DENOMS,
  MAX_NOTES,
} from '../../lib/zk/denominationBuilder'
import { USDC_SCALE } from '../../lib/csvParser'

const VALID_HEX =
  'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'
const VALID_HEX2 =
  '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'

describe('decompose', () => {
  it('decomposes 110 USDC into [100,10] and pads to exactly 8 slots', () => {
    const rows = [{ name: 'A', amountUsdc: BigInt(110) * USDC_SCALE, pubkeyHex: VALID_HEX }]
    const notes = decompose(rows)
    expect(notes).not.toBeNull()
    expect(notes!.length).toBe(8)
    const real = notes!.filter((n) => n.denomination > BigInt(0))
    expect(real.length).toBe(2)
    expect(real[0].denomination).toBe(BigInt(100) * USDC_SCALE)
    expect(real[1].denomination).toBe(BigInt(10) * USDC_SCALE)
  })

  it('returns null when total notes exceed 8', () => {
    // A: 120 USDC = 100+10+10 (3 notes), B: 80 USDC = 10×8 (8 notes) → 11 total > 8
    const rows = [
      { name: 'A', amountUsdc: BigInt(120) * USDC_SCALE, pubkeyHex: VALID_HEX },
      { name: 'B', amountUsdc: BigInt(80) * USDC_SCALE, pubkeyHex: VALID_HEX2 },
    ]
    expect(decompose(rows)).toBeNull()
  })

  it('returns null for an amount not a multiple of 1 USDC (e.g. 0.5 USDC)', () => {
    // 0.5 USDC = BigInt(5_000_000) base units — not decomposable into {1,10,100}
    const rows = [{ name: 'C', amountUsdc: BigInt(5000000), pubkeyHex: VALID_HEX }]
    expect(decompose(rows)).toBeNull()
  })

  it('always returns exactly 8 slots when non-null', () => {
    // Single employee with 1 USDC → 1 real note + 7 dummies
    const rows = [{ name: 'D', amountUsdc: BigInt(1) * USDC_SCALE, pubkeyHex: VALID_HEX }]
    const notes = decompose(rows)
    expect(notes).not.toBeNull()
    expect(notes!.length).toBe(8)
  })

  it('pads with zero-amount dummies (denomination=0, recipientPubkeyHex=00×32, employeeName="")', () => {
    const rows = [{ name: 'E', amountUsdc: BigInt(1) * USDC_SCALE, pubkeyHex: VALID_HEX }]
    const notes = decompose(rows)!
    const dummies = notes.filter((n) => n.denomination === BigInt(0))
    expect(dummies.length).toBe(7)
    for (const d of dummies) {
      expect(d.recipientPubkeyHex).toBe('00'.repeat(32))
      expect(d.employeeName).toBe('')
      expect(d.outPubkey).toBe(BigInt(0))
    }
  })

  it('real notes carry the correct recipientPubkeyHex and employeeName', () => {
    const rows = [{ name: 'Alice', amountUsdc: BigInt(100) * USDC_SCALE, pubkeyHex: VALID_HEX }]
    const notes = decompose(rows)!
    const real = notes.filter((n) => n.denomination > BigInt(0))
    expect(real[0].recipientPubkeyHex).toBe(VALID_HEX)
    expect(real[0].employeeName).toBe('Alice')
  })

  it('returns 8 notes for 8 employees each getting 1 USDC (boundary case)', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      name: `E${i}`,
      amountUsdc: BigInt(1) * USDC_SCALE,
      pubkeyHex: VALID_HEX,
    }))
    const notes = decompose(rows)
    expect(notes).not.toBeNull()
    expect(notes!.length).toBe(8)
    expect(notes!.filter((n) => n.denomination > BigInt(0)).length).toBe(8)
  })

  it('returns null for 9 employees each getting 1 USDC (one over MAX_NOTES)', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({
      name: `E${i}`,
      amountUsdc: BigInt(1) * USDC_SCALE,
      pubkeyHex: VALID_HEX,
    }))
    expect(decompose(rows)).toBeNull()
  })

  it('outPubkey is a positive bigint for a valid pubkey', () => {
    const rows = [{ name: 'F', amountUsdc: BigInt(1) * USDC_SCALE, pubkeyHex: VALID_HEX }]
    const notes = decompose(rows)!
    const real = notes.filter((n) => n.denomination > BigInt(0))
    expect(typeof real[0].outPubkey).toBe('bigint')
    // BN254 scalar is always non-negative
    expect(real[0].outPubkey >= BigInt(0)).toBe(true)
  })
})

describe('DENOMS', () => {
  it('contains [100, 10, 1] as bigints in base units', () => {
    expect(DENOMS).toHaveLength(3)
    expect(DENOMS[0]).toBe(BigInt(100) * USDC_SCALE)
    expect(DENOMS[1]).toBe(BigInt(10) * USDC_SCALE)
    expect(DENOMS[2]).toBe(BigInt(1) * USDC_SCALE)
  })
})

describe('MAX_NOTES', () => {
  it('is 8', () => {
    expect(MAX_NOTES).toBe(8)
  })
})
