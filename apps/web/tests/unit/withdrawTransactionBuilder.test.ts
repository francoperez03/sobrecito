/**
 * withdrawTransactionBuilder.test.ts — Unit tests for buildWithdrawInputs.
 * Plan 09.1-02, Task 2 (TDD RED → GREEN).
 *
 * Asserts the Noir ABI witness shape for sobre_slim in withdraw mode:
 *   1 real input (the employee's note), 8 zero change outputs.
 *
 * Key Noir ABI assertions (all compared against plan 09.1-02 spec):
 *   - 12 flat public scalar strings (root, public_amount, ext_data_hash,
 *     input_nullifier, output_commitment_0..7)
 *   - Private scalars: in_amount, in_private_key, in_blinding, in_path_indices
 *   - in_path_elements: string[10] (flat, not nested)
 *   - in_path_bits: string[10] (bit-decomposition of in_path_indices)
 *   - out_amount, out_pub_key, out_blinding: string[8] (all zeros for withdraw)
 *   - NO ASP fields: no membershipRoots, nonMembershipRoots, etc.
 *   - output_commitment_i = hash3WithSep(0n, 0n, 0n, 1n) — zero-note commitment
 *   - input_nullifier recomputed via circuit hash chain (not passed in)
 */
import { describe, it, expect } from 'vitest'
import { buildWithdrawInputs } from '@/lib/zk/withdrawTransactionBuilder'
import { hash3WithSep, hash1WithSep } from '@/lib/zk/poseidon2Pool'
import type { EmployeeNote } from '@/lib/employee-scan'

// BN254 field modulus as a string for range checks.
const BN254_MOD = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617')

// Fixture note (mimics output of scanEmployeeNotes for index 0).
const FIXTURE_NOTE: EmployeeNote = {
  commitment: BigInt(1),
  index: 0,
  amount: BigInt(100_000_000), // 10 USDC in base units
  blinding: BigInt(1000),
  ledger: 3110500,
  txHash: 'a'.repeat(63) + '0',
}

// Fixture Merkle path (10 levels, matching TREE_LEVELS in employee-scan.ts).
const FIXTURE_PATH_ELEMENTS = Array(10).fill('1') // non-zero to be realistic
const FIXTURE_PATH_INDICES = '0'

// Fixture bn254 private key (arbitrary test scalar; no real key material).
const FIXTURE_BN254_PRIV = BigInt('12345678901234567890')

// Pre-computed extDataHash from hashExtDataSobre (mocked as a field element).
const FIXTURE_EXT_DATA_HASH = '42'

// Pool root (decimal string).
const FIXTURE_POOL_ROOT = '1234567890'

// Recipient Stellar address (placeholder).
const FIXTURE_RECIPIENT = 'GDXSRISWM3A7XXLKEF2QY3XK7SVWWCPKUVVNRHBPXP7SCLFKL2CXXX'

function makeArgs() {
  return {
    note: FIXTURE_NOTE,
    bn254Priv: FIXTURE_BN254_PRIV,
    pathElements: FIXTURE_PATH_ELEMENTS,
    pathIndices: FIXTURE_PATH_INDICES,
    recipientAddress: FIXTURE_RECIPIENT,
    poolRoot: FIXTURE_POOL_ROOT,
    extDataHash: FIXTURE_EXT_DATA_HASH,
  }
}

describe('buildWithdrawInputs — Noir ABI (plan 09.1-02)', () => {
  it('builds a defined object', () => {
    const witness = buildWithdrawInputs(makeArgs())
    expect(witness).toBeDefined()
    expect(typeof witness).toBe('object')
  })

  // -- Public input shape --

  it('returns input_nullifier as a scalar string (not an array)', () => {
    const witness = buildWithdrawInputs(makeArgs()) as Record<string, unknown>
    expect(typeof witness.input_nullifier).toBe('string')
    expect(Array.isArray(witness.input_nullifier)).toBe(false)
  })

  it('returns output_commitment_0..7 as flat scalar strings (not outputCommitment array)', () => {
    const witness = buildWithdrawInputs(makeArgs()) as Record<string, unknown>
    for (let i = 0; i < 8; i++) {
      expect(typeof witness[`output_commitment_${i}`]).toBe('string')
    }
    // old Circom array must not exist
    expect(witness.outputCommitment).toBeUndefined()
  })

  it('returns root equal to poolRoot', () => {
    const witness = buildWithdrawInputs(makeArgs()) as Record<string, unknown>
    expect(witness.root).toBe(FIXTURE_POOL_ROOT)
  })

  it('returns ext_data_hash equal to the provided hash string', () => {
    const witness = buildWithdrawInputs(makeArgs()) as Record<string, unknown>
    expect(witness.ext_data_hash).toBe(FIXTURE_EXT_DATA_HASH)
    // old Circom name must not exist
    expect(witness.extDataHash).toBeUndefined()
  })

  it('sets public_amount to the negative field-reduced withdrawal amount', () => {
    const witness = buildWithdrawInputs(makeArgs()) as Record<string, unknown>
    const pubAmt = BigInt(witness.public_amount as string)
    const expected = (((-BigInt(100_000_000)) % BN254_MOD) + BN254_MOD) % BN254_MOD
    expect(pubAmt).toBe(expected)
    // old Circom name must not exist
    expect(witness.publicAmount).toBeUndefined()
  })

  it('sets public_amount to a value in [0, BN254_MOD)', () => {
    const witness = buildWithdrawInputs(makeArgs()) as Record<string, unknown>
    const pubAmt = BigInt(witness.public_amount as string)
    expect(pubAmt).toBeGreaterThanOrEqual(BigInt(0))
    expect(pubAmt).toBeLessThan(BN254_MOD)
  })

  // -- Private input shape --

  it('returns in_amount as a scalar string (not an array), non-zero for real note', () => {
    const witness = buildWithdrawInputs(makeArgs()) as Record<string, unknown>
    expect(typeof witness.in_amount).toBe('string')
    expect(Array.isArray(witness.in_amount)).toBe(false)
    expect(witness.in_amount).toBe(FIXTURE_NOTE.amount.toString())
    expect(witness.in_amount).not.toBe('0')
    // old Circom name must not exist
    expect(witness.inAmount).toBeUndefined()
  })

  it('returns in_private_key as a scalar string', () => {
    const witness = buildWithdrawInputs(makeArgs()) as Record<string, unknown>
    expect(typeof witness.in_private_key).toBe('string')
    expect(Array.isArray(witness.in_private_key)).toBe(false)
    expect(witness.in_private_key).toBe(FIXTURE_BN254_PRIV.toString())
    // old Circom name must not exist
    expect(witness.inPrivateKey).toBeUndefined()
  })

  it('returns in_blinding as a scalar string equal to the note blinding', () => {
    const witness = buildWithdrawInputs(makeArgs()) as Record<string, unknown>
    expect(typeof witness.in_blinding).toBe('string')
    expect(Array.isArray(witness.in_blinding)).toBe(false)
    expect(witness.in_blinding).toBe(FIXTURE_NOTE.blinding.toString())
    // old Circom name must not exist
    expect(witness.inBlinding).toBeUndefined()
  })

  it('returns in_path_indices as a scalar string equal to pathIndices', () => {
    const witness = buildWithdrawInputs(makeArgs()) as Record<string, unknown>
    expect(typeof witness.in_path_indices).toBe('string')
    expect(Array.isArray(witness.in_path_indices)).toBe(false)
    expect(witness.in_path_indices).toBe(FIXTURE_PATH_INDICES)
    // old Circom name must not exist
    expect(witness.inPathIndices).toBeUndefined()
  })

  it('returns in_path_elements as string[10] (flat, not nested)', () => {
    const witness = buildWithdrawInputs(makeArgs()) as Record<string, unknown>
    const elems = witness.in_path_elements as string[]
    expect(Array.isArray(elems)).toBe(true)
    expect(elems).toHaveLength(10)
    // Flat: each element is a string, not an array
    for (const el of elems) {
      expect(typeof el).toBe('string')
    }
    expect(elems).toStrictEqual(FIXTURE_PATH_ELEMENTS)
    // old Circom name must not exist
    expect(witness.inPathElements).toBeUndefined()
  })

  it('returns in_path_bits as string[10] bit-decomposition of pathIndices', () => {
    const witness = buildWithdrawInputs(makeArgs()) as Record<string, unknown>
    const bits = witness.in_path_bits as string[]
    expect(Array.isArray(bits)).toBe(true)
    expect(bits).toHaveLength(10)
    for (const b of bits) {
      expect(['0', '1']).toContain(b)
    }
    // pathIndices='0' → all bits are '0'
    expect(bits).toStrictEqual(Array(10).fill('0'))
  })

  it('correctly decomposes pathIndices=5 → in_path_bits[0]="1", [1]="0", [2]="1", rest "0"', () => {
    const args = { ...makeArgs(), pathIndices: '5' }
    const witness = buildWithdrawInputs(args) as Record<string, unknown>
    const bits = witness.in_path_bits as string[]
    // 5 = 0b0000000101
    expect(bits[0]).toBe('1')
    expect(bits[1]).toBe('0')
    expect(bits[2]).toBe('1')
    for (let k = 3; k < 10; k++) {
      expect(bits[k]).toBe('0')
    }
  })

  it('correctly decomposes pathIndices=7 → in_path_bits[0..2]="1", rest "0"', () => {
    const args = { ...makeArgs(), pathIndices: '7' }
    const witness = buildWithdrawInputs(args) as Record<string, unknown>
    const bits = witness.in_path_bits as string[]
    // 7 = 0b0000000111
    expect(bits[0]).toBe('1')
    expect(bits[1]).toBe('1')
    expect(bits[2]).toBe('1')
    for (let k = 3; k < 10; k++) {
      expect(bits[k]).toBe('0')
    }
  })

  // -- Zero-note output commitments --

  it('out_amount, out_pub_key, out_blinding are string[8] with all "0"', () => {
    const witness = buildWithdrawInputs(makeArgs()) as Record<string, unknown>
    const outAmount = witness.out_amount as string[]
    const outPubKey = witness.out_pub_key as string[]
    const outBlinding = witness.out_blinding as string[]

    expect(outAmount).toHaveLength(8)
    expect(outPubKey).toHaveLength(8)
    expect(outBlinding).toHaveLength(8)

    expect(outAmount.every(v => v === '0')).toBe(true)
    expect(outPubKey.every(v => v === '0')).toBe(true)
    expect(outBlinding.every(v => v === '0')).toBe(true)

    // Old Circom names must not exist
    expect(witness.outAmount).toBeUndefined()
    expect(witness.outPubkey).toBeUndefined()
    expect(witness.outBlinding).toBeUndefined()
  })

  it('output_commitment_i equals hash3WithSep(0n, 0n, 0n, 1n) for all 8 (zero-note commitment)', async () => {
    const witness = buildWithdrawInputs(makeArgs()) as Record<string, unknown>
    const zeroCommitment = hash3WithSep(BigInt(0), BigInt(0), BigInt(0), BigInt(1)).toString()
    for (let i = 0; i < 8; i++) {
      expect(witness[`output_commitment_${i}`]).toBe(zeroCommitment)
    }
  })

  // -- ASP fields must be absent --

  it('has NO ASP fields', () => {
    const witness = buildWithdrawInputs(makeArgs()) as Record<string, unknown>
    expect(witness.membershipRoots).toBeUndefined()
    expect(witness.nonMembershipRoots).toBeUndefined()
    expect(witness.membershipProofs).toBeUndefined()
    expect(witness.nonMembershipProofs).toBeUndefined()
    expect(witness.aspMemberRoot).toBeUndefined()
    expect(witness.aspNonMemberRoot).toBeUndefined()
    expect(witness.zeroOutputCommitment).toBeUndefined()
    expect(witness.precomputedMembership).toBeUndefined()
  })

  // -- input_nullifier computed via circuit hash chain --

  it('input_nullifier is the circuit hash chain (not the passed-in value)', async () => {
    // Circuit chain (main.nr:64-74) for the withdraw note:
    //   pub_key = hash1WithSep(bn254Priv, 3n)
    //   in_commitment = hash3WithSep(note.amount, pub_key, note.blinding, 1n)
    //   sig = hash3WithSep(bn254Priv, in_commitment, BigInt(pathIndices), 4n)
    //   input_nullifier = hash3WithSep(in_commitment, BigInt(pathIndices), sig, 2n)
    const witness = buildWithdrawInputs(makeArgs()) as Record<string, unknown>

    const pub_key = hash1WithSep(FIXTURE_BN254_PRIV, BigInt(3))
    const in_commitment = hash3WithSep(FIXTURE_NOTE.amount, pub_key, FIXTURE_NOTE.blinding, BigInt(1))
    const sig = hash3WithSep(FIXTURE_BN254_PRIV, in_commitment, BigInt(FIXTURE_PATH_INDICES), BigInt(4))
    const expectedNullifier = hash3WithSep(in_commitment, BigInt(FIXTURE_PATH_INDICES), sig, BigInt(2)).toString()

    expect(witness.input_nullifier).toBe(expectedNullifier)
  })

  it('all numeric string scalar fields are in [0, BN254_MOD)', () => {
    const witness = buildWithdrawInputs(makeArgs()) as Record<string, unknown>
    const fieldsToCheck = [
      witness.public_amount as string,
      witness.input_nullifier as string,
      witness.in_amount as string,
      witness.in_private_key as string,
      witness.in_blinding as string,
    ]
    for (const field of fieldsToCheck) {
      const v = BigInt(field)
      expect(v).toBeGreaterThanOrEqual(BigInt(0))
      expect(v).toBeLessThan(BN254_MOD)
    }
  })
})
