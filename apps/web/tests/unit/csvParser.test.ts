import { describe, it, expect } from 'vitest'
import { parseCsvText, usdcToBaseUnits, isHex64, USDC_SCALE } from '../../lib/csvParser'

const VALID_HEX =
  'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'
const VALID_HEX2 =
  '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'

describe('parseCsvText', () => {
  it('parses a single valid row', () => {
    const text = `name,amount,public_key\nAlice,100,${VALID_HEX}`
    const rows = parseCsvText(text)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Alice')
    expect(rows[0].amount).toBe(BigInt(100) * USDC_SCALE)
    expect(rows[0].publicKey).toBeInstanceOf(Uint8Array)
    expect(rows[0].publicKey).toHaveLength(32)
  })

  it('handles fractional USDC amounts', () => {
    const text = `name,amount,public_key\nBob,100.5,${VALID_HEX}`
    const rows = parseCsvText(text)
    expect(rows[0].amount).toBe(BigInt(100) * USDC_SCALE + BigInt(5000000))
  })

  it('parses multiple rows', () => {
    const text = [
      'name,amount,public_key',
      `Alice,100,${VALID_HEX}`,
      `Bob,200,${VALID_HEX2}`,
    ].join('\n')
    const rows = parseCsvText(text)
    expect(rows).toHaveLength(2)
    expect(rows[1].name).toBe('Bob')
  })

  it('throws for bad hex public key (not 64 hex chars)', () => {
    const text = `name,amount,public_key\nAlice,100,NOTAHEX`
    expect(() => parseCsvText(text)).toThrow()
  })

  it('throws for non-numeric amount', () => {
    const text = `name,amount,public_key\nAlice,abc,${VALID_HEX}`
    expect(() => parseCsvText(text)).toThrow()
  })

  it('tolerates header row (case-sensitive match)', () => {
    const text = `name,amount,public_key\nCarlos,50,${VALID_HEX}`
    const rows = parseCsvText(text)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Carlos')
  })

  it('ignores trailing blank lines', () => {
    const text = `name,amount,public_key\nDave,10,${VALID_HEX}\n\n`
    const rows = parseCsvText(text)
    expect(rows).toHaveLength(1)
  })

  it('correctly converts publicKey hex to bytes', () => {
    const text = `name,amount,public_key\nEve,1,${VALID_HEX}`
    const rows = parseCsvText(text)
    expect(rows[0].publicKey[0]).toBe(0xaa)
    expect(rows[0].publicKey[1]).toBe(0xbb)
    expect(rows[0].publicKey[31]).toBe(0x99)
  })

  it('throws for amount with too many decimal places (>7)', () => {
    const text = `name,amount,public_key\nFrank,1.12345678,${VALID_HEX}`
    expect(() => parseCsvText(text)).toThrow()
  })
})

describe('usdcToBaseUnits', () => {
  it('converts integer amounts', () => {
    expect(usdcToBaseUnits('1')).toBe(BigInt(10000000))
    expect(usdcToBaseUnits('100')).toBe(BigInt(100) * USDC_SCALE)
  })

  it('converts fractional amounts with string math (no float rounding)', () => {
    expect(usdcToBaseUnits('0.0000001')).toBe(BigInt(1))
    expect(usdcToBaseUnits('100.5')).toBe(BigInt(100) * USDC_SCALE + BigInt(5000000))
  })
})

describe('isHex64', () => {
  it('returns true for 64 valid hex chars', () => {
    expect(isHex64(VALID_HEX)).toBe(true)
    expect(isHex64(VALID_HEX.toUpperCase())).toBe(true)
  })

  it('returns false for wrong length', () => {
    expect(isHex64('aabb')).toBe(false)
    expect(isHex64('a'.repeat(63))).toBe(false)
    expect(isHex64('a'.repeat(65))).toBe(false)
  })

  it('returns false for non-hex characters', () => {
    expect(isHex64('g'.repeat(64))).toBe(false)
  })
})
