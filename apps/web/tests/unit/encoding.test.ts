/**
 * encoding.test.ts — unit tests for the UltraHonk Proof ScMap encoding.
 *
 * TDD RED: written before the implementation is in place.
 * Asserts key order, byte lengths, and absence of legacy Groth16/ASP keys.
 */

import { describe, expect, it } from 'vitest'
import { buildProofScVal } from '../../lib/chain/stellar/encoding'

// minimal 384-byte public_inputs blob (all zeros)
const PUBLIC_INPUTS = new Uint8Array(384)
// minimal 14592-byte proof_bytes blob (all zeros)
const PROOF_BYTES = new Uint8Array(14592)
// minimal 32-byte ext_data_hash
const EXT_DATA_HASH = new Uint8Array(32)

function validArgs() {
  return {
    publicInputsBlob: PUBLIC_INPUTS,
    proofBytes: PROOF_BYTES,
    root: '1',
    publicAmount: '2',
    extDataHash: EXT_DATA_HASH,
    inputNullifiers: ['3'],
    outputCommitments: Array(8).fill('0'),
  }
}

describe('buildProofScVal (UltraHonk)', () => {
  it('returns an scvMap', () => {
    const val = buildProofScVal(validArgs())
    expect(val.switch().name).toBe('scvMap')
  })

  it('has exactly 7 entries in alphabetical Soroban order', () => {
    const val = buildProofScVal(validArgs())
    const map = val.map()
    const keys = map!.map((e) => e.key().sym())
    expect(keys).toEqual([
      'ext_data_hash',
      'input_nullifiers',
      'output_commitments',
      'proof_bytes',
      'public_amount',
      'public_inputs',
      'root',
    ])
  })

  it('public_inputs entry is scvBytes of length 384', () => {
    const val = buildProofScVal(validArgs())
    const map = val.map()!
    const piEntry = map.find((e) => e.key().sym() === 'public_inputs')
    expect(piEntry).toBeDefined()
    expect(piEntry!.val().switch().name).toBe('scvBytes')
    expect(piEntry!.val().bytes().length).toBe(384)
  })

  it('proof_bytes entry is scvBytes of length 14592', () => {
    const val = buildProofScVal(validArgs())
    const map = val.map()!
    const pbEntry = map.find((e) => e.key().sym() === 'proof_bytes')
    expect(pbEntry).toBeDefined()
    expect(pbEntry!.val().switch().name).toBe('scvBytes')
    expect(pbEntry!.val().bytes().length).toBe(14592)
  })

  it('throws when publicInputsBlob.length !== 384', () => {
    expect(() =>
      buildProofScVal({ ...validArgs(), publicInputsBlob: new Uint8Array(100) }),
    ).toThrow()
  })

  it('throws when proofBytes.length !== 14592', () => {
    expect(() =>
      buildProofScVal({ ...validArgs(), proofBytes: new Uint8Array(256) }),
    ).toThrow()
  })

  it('throws when extDataHash.length !== 32', () => {
    expect(() =>
      buildProofScVal({ ...validArgs(), extDataHash: new Uint8Array(16) }),
    ).toThrow()
  })

  it('has no asp_membership_root key', () => {
    const val = buildProofScVal(validArgs())
    const keys = val.map()!.map((e) => e.key().sym())
    expect(keys).not.toContain('asp_membership_root')
    expect(keys).not.toContain('asp_non_membership_root')
  })

  it('has no Groth16 "proof" key', () => {
    const val = buildProofScVal(validArgs())
    const keys = val.map()!.map((e) => e.key().sym())
    expect(keys).not.toContain('proof')
  })
})
