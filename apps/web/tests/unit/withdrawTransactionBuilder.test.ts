/**
 * withdrawTransactionBuilder.test.ts — Unit tests for buildWithdrawInputs.
 * Plan 06.3-02, Task 2 (TDD, replaces Wave 0 scaffold from plan 01).
 *
 * Asserts the witness shape for policy_tx_1_8 reused for withdraw:
 *   1 real input (the employee's note), 8 dummy zero outputs.
 */
import { describe, it, expect } from 'vitest'
import { buildWithdrawInputs } from '@/lib/zk/withdrawTransactionBuilder'
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
const FIXTURE_PATH_ELEMENTS = Array(10).fill('0')
const FIXTURE_PATH_INDICES = '0'

// Fixture bn254 private key (arbitrary test scalar; no real key material).
const FIXTURE_BN254_PRIV = BigInt('12345678901234567890')

// Fixture pre-computed nullifier (would normally come from computeNullifier WASM).
const FIXTURE_NULLIFIER = BigInt('98765432109876543210')

// Pre-computed extDataHash from hashExtDataSobre (mocked as a field element).
const FIXTURE_EXT_DATA_HASH = '42'

// Pool / ASP roots (decimal strings).
const FIXTURE_POOL_ROOT = '1234567890'
const FIXTURE_ASP_MEMBER_ROOT = '9876543210'
const FIXTURE_ASP_NON_MEMBER_ROOT = '1111111111'

// Recipient Stellar address (placeholder).
const FIXTURE_RECIPIENT = 'GDXSRISWM3A7XXLKEF2QY3XK7SVWWCPKUVVNRHBPXP7SCLFKL2CXXX'

function makeArgs() {
  return {
    note: FIXTURE_NOTE,
    bn254Priv: FIXTURE_BN254_PRIV,
    inputNullifier: FIXTURE_NULLIFIER,
    pathElements: FIXTURE_PATH_ELEMENTS,
    pathIndices: FIXTURE_PATH_INDICES,
    recipientAddress: FIXTURE_RECIPIENT,
    poolRoot: FIXTURE_POOL_ROOT,
    aspMemberRoot: FIXTURE_ASP_MEMBER_ROOT,
    aspNonMemberRoot: FIXTURE_ASP_NON_MEMBER_ROOT,
    extDataHash: FIXTURE_EXT_DATA_HASH,
  }
}

describe('buildWithdrawInputs', () => {
  it('builds a valid N-to-1 withdraw input shape for policy_tx_1_8', () => {
    const witness = buildWithdrawInputs(makeArgs())
    expect(witness).toBeDefined()
    expect(typeof witness).toBe('object')
  })

  it('returns inputNullifier as an array of length 1', () => {
    const witness = buildWithdrawInputs(makeArgs())
    expect(Array.isArray(witness.inputNullifier)).toBe(true)
    expect((witness.inputNullifier as string[]).length).toBe(1)
  })

  it('returns outputCommitment as an array of length 8 (all zeros)', () => {
    const witness = buildWithdrawInputs(makeArgs())
    expect(Array.isArray(witness.outputCommitment)).toBe(true)
    const oc = witness.outputCommitment as string[]
    expect(oc.length).toBe(8)
    expect(oc.every(v => v === '0')).toBe(true)
  })

  it('sets publicAmount to the negative field-reduced withdrawal amount', () => {
    const witness = buildWithdrawInputs(makeArgs())
    const pubAmt = BigInt(witness.publicAmount as string)
    // toFieldElement(-amount): the field-reduced form of -100_000_000
    const expected = (((-BigInt(100_000_000)) % BN254_MOD) + BN254_MOD) % BN254_MOD
    expect(pubAmt).toBe(expected)
  })

  it('sets publicAmount to a value less than BN254_MOD (field element)', () => {
    const witness = buildWithdrawInputs(makeArgs())
    const pubAmt = BigInt(witness.publicAmount as string)
    expect(pubAmt).toBeGreaterThanOrEqual(BigInt(0))
    expect(pubAmt).toBeLessThan(BN254_MOD)
  })

  it('sets inAmount[0] to the note amount (NON-zero — real input, Merkle check activates)', () => {
    const witness = buildWithdrawInputs(makeArgs())
    const inAmount = witness.inAmount as string[]
    expect(inAmount[0]).toBe(FIXTURE_NOTE.amount.toString())
    expect(inAmount[0]).not.toBe('0')
  })

  it('sets inPrivateKey[0] to the bn254Priv', () => {
    const witness = buildWithdrawInputs(makeArgs())
    const inPrivateKey = witness.inPrivateKey as string[]
    expect(inPrivateKey[0]).toBe(FIXTURE_BN254_PRIV.toString())
  })

  it('sets inBlinding[0] to the note blinding', () => {
    const witness = buildWithdrawInputs(makeArgs())
    const inBlinding = witness.inBlinding as string[]
    expect(inBlinding[0]).toBe(FIXTURE_NOTE.blinding.toString())
  })

  it('sets outAmount, outPubkey, outBlinding to length-8 zero arrays', () => {
    const witness = buildWithdrawInputs(makeArgs())
    const outAmount = witness.outAmount as string[]
    const outPubkey = witness.outPubkey as string[]
    const outBlinding = witness.outBlinding as string[]

    expect(outAmount.length).toBe(8)
    expect(outPubkey.length).toBe(8)
    expect(outBlinding.length).toBe(8)

    expect(outAmount.every(v => v === '0')).toBe(true)
    expect(outPubkey.every(v => v === '0')).toBe(true)
    expect(outBlinding.every(v => v === '0')).toBe(true)
  })

  it('sets root to the poolRoot', () => {
    const witness = buildWithdrawInputs(makeArgs())
    expect(witness.root).toBe(FIXTURE_POOL_ROOT)
  })

  it('sets extDataHash to the provided hash string', () => {
    const witness = buildWithdrawInputs(makeArgs())
    expect(witness.extDataHash).toBe(FIXTURE_EXT_DATA_HASH)
  })

  it('sets inputNullifier[0] to the precomputed nullifier string', () => {
    const witness = buildWithdrawInputs(makeArgs())
    const nullifiers = witness.inputNullifier as string[]
    expect(nullifiers[0]).toBe(FIXTURE_NULLIFIER.toString())
  })

  it('all numeric string fields are non-negative and less than BN254_MOD', () => {
    const witness = buildWithdrawInputs(makeArgs())
    const fieldsToCheck = [
      witness.publicAmount as string,
      ...(witness.inputNullifier as string[]),
      ...(witness.inAmount as string[]),
      ...(witness.inPrivateKey as string[]),
      ...(witness.inBlinding as string[]),
    ]
    for (const field of fieldsToCheck) {
      const v = BigInt(field)
      expect(v).toBeGreaterThanOrEqual(BigInt(0))
      expect(v).toBeLessThan(BN254_MOD)
    }
  })
})
