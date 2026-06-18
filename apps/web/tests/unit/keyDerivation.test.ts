import { describe, it, expect } from 'vitest'
import { deriveBn254PrivKey, deriveX25519, parseEmployeeKey } from '../../lib/zk/keyDerivation'
import { encryptNote, decryptNote, BN254_FIELD_MODULUS } from 'viewkey'

// 32-byte test seed (0x43 x 32), matches EMPLOYEE_TEST_SEED_HEX in employeeFixtures.ts
const TEST_SEED = new Uint8Array(32).fill(0x43)
const ALT_SEED = new Uint8Array(32).fill(0x7a)

describe('deriveBn254PrivKey', () => {
  it('is deterministic: same seed produces same result', () => {
    const a = deriveBn254PrivKey(TEST_SEED)
    const b = deriveBn254PrivKey(TEST_SEED)
    expect(a).toBe(b)
  })

  it('produces a bigint < BN254_FIELD_MODULUS', () => {
    const priv = deriveBn254PrivKey(TEST_SEED)
    expect(priv >= BigInt(0)).toBe(true)
    expect(priv < BN254_FIELD_MODULUS).toBe(true)
  })

  it('different seeds produce different private keys', () => {
    const a = deriveBn254PrivKey(TEST_SEED)
    const b = deriveBn254PrivKey(ALT_SEED)
    expect(a).not.toBe(b)
  })

  it('throws when seed is not 32 bytes', () => {
    expect(() => deriveBn254PrivKey(new Uint8Array(16))).toThrow('expected 32 bytes')
  })
})

describe('deriveX25519', () => {
  it('is deterministic: same seed produces same keypair', () => {
    const a = deriveX25519(TEST_SEED)
    const b = deriveX25519(TEST_SEED)
    expect(a.priv).toEqual(b.priv)
    expect(a.pub).toEqual(b.pub)
  })

  it('priv and pub are both 32 bytes', () => {
    const { priv, pub } = deriveX25519(TEST_SEED)
    expect(priv.length).toBe(32)
    expect(pub.length).toBe(32)
  })

  it('different seeds produce different keypairs', () => {
    const a = deriveX25519(TEST_SEED)
    const b = deriveX25519(ALT_SEED)
    expect(a.pub).not.toEqual(b.pub)
  })

  it('throws when seed is not 32 bytes', () => {
    expect(() => deriveX25519(new Uint8Array(8))).toThrow('expected 32 bytes')
  })

  it('X25519 pubkey is consistent with the private key (round-trip ECIES decrypt)', () => {
    const { priv, pub } = deriveX25519(TEST_SEED)
    const payload = { amount: BigInt(1_0000000), blinding: BigInt(9999) }
    const blob = encryptNote(pub, payload)
    const result = decryptNote(priv, blob)
    expect(result.amount).toBe(payload.amount)
    expect(result.blinding).toBe(payload.blinding)
  })
})

describe('X25519 key separation', () => {
  it('decryptNote throws when the wrong seed key is used', () => {
    const { pub: correctPub } = deriveX25519(TEST_SEED)
    const { priv: wrongPriv } = deriveX25519(ALT_SEED)
    const blob = encryptNote(correctPub, { amount: BigInt(42), blinding: BigInt(1) })
    expect(() => decryptNote(wrongPriv, blob)).toThrow()
  })
})

describe('parseEmployeeKey', () => {
  it('parses a 64-char hex string without 0x prefix', () => {
    const hex = '43'.repeat(32)
    const result = parseEmployeeKey(hex)
    expect(result.length).toBe(32)
    expect(result[0]).toBe(0x43)
    expect(result[31]).toBe(0x43)
  })

  it('parses a 64-char hex string with 0x prefix', () => {
    const hex = '0x' + '43'.repeat(32)
    const result = parseEmployeeKey(hex)
    expect(result.length).toBe(32)
    expect(result[0]).toBe(0x43)
  })

  it('parses url-safe base64 and produces the same bytes as the hex form', () => {
    // Build base64 from known bytes
    const bytes = new Uint8Array(32).fill(0x43)
    const b64 = Buffer.from(bytes).toString('base64url')
    const fromHex = parseEmployeeKey('43'.repeat(32))
    const fromB64 = parseEmployeeKey(b64)
    expect(fromHex).toEqual(fromB64)
  })

  it('throws on malformed input (too short hex)', () => {
    expect(() => parseEmployeeKey('abcd')).toThrow()
  })

  it('throws on malformed input (non-hex, non-base64)', () => {
    expect(() => parseEmployeeKey('this-is-not-a-key!!!!')).toThrow()
  })
})

describe('BN254 domain separation', () => {
  it('bn254Priv and x25519Priv are different even for the same seed', () => {
    const bn254 = deriveBn254PrivKey(TEST_SEED)
    const { priv: x25519 } = deriveX25519(TEST_SEED)
    // Convert bn254 to bytes for comparison
    const bn254Bytes = new Uint8Array(32)
    let v = bn254
    for (let i = 0; i < 32; i++) {
      bn254Bytes[i] = Number(v & BigInt(0xff))
      v >>= BigInt(8)
    }
    // They should not be the same bytes (different HKDF info labels)
    expect(bn254Bytes).not.toEqual(x25519)
  })
})
