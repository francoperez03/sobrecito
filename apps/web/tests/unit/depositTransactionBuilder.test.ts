/**
 * depositTransactionBuilder.test.ts — unit tests for the 1→8 deposit witness builder.
 *
 * Verifies the Noir ABI shape (plan 09.1-02):
 * 1. hashExtDataSobre matches the SPIKE fixture hash (0b3f2759…c66056).
 * 2. buildFrozenBlobs is non-deterministic: two calls with the same inputs
 *    produce DIFFERENT blobs AND DIFFERENT blindings (proving the freeze is
 *    necessary — you cannot call it twice and expect the same hash).
 * 3. buildDepositInputs returns the exact Noir ABI witness shape:
 *    - 12 public keys flat (root, public_amount, ext_data_hash, input_nullifier,
 *      output_commitment_0..7) — each a string scalar, NOT arrays.
 *    - Private keys: in_amount, in_private_key, in_blinding, in_path_indices
 *      (all scalar strings), in_path_elements (string[10]), in_path_bits (string[10]),
 *      out_amount/out_pub_key/out_blinding (each string[8]).
 *    - NO ASP fields: no membershipRoots, nonMembershipRoots, membershipProofs,
 *      nonMembershipProofs, aspMemberRoot.
 *    - Commitments computed via poseidon2Pool hash3WithSep (match circuit semantics).
 *    - input_nullifier computed via circuit hash chain for dummy input (in_amount=0).
 */

import { describe, it, expect } from 'vitest'
import {
  buildFrozenBlobs,
  buildDepositInputs,
} from '../../lib/zk/depositTransactionBuilder'
// hashExtData moved into the Stellar chain adapter's encoding module.
import { hashExtData as hashExtDataSobre } from '../../lib/chain/stellar/encoding'
import type { DenomNote } from '../../lib/zk/denominationBuilder'
import { pubkeyToBn254 } from '../../lib/zk/denominationBuilder'
import { USDC_SCALE } from '../../lib/csvParser'
import { hash3WithSep, hash1WithSep } from '../../lib/zk/poseidon2Pool'

// ------------------------------------------------------------------
// Test fixtures
// ------------------------------------------------------------------

/**
 * Demo fixture from SPIKE.md:
 * recipient = mikey (GBWJZZ3X…PPKMW), ext_amount = 0, 8 empty blobs.
 * Expected hash prefix: 0b3f2759…
 */
const SPIKE_RECIPIENT = 'GBWJZZ3XSNAY3WLFNLXUZXEEYMZCYVG4TW6Z5VSASJS2TOWF7GGPPKMW'
const SPIKE_HASH = '0b3f2759b68a3bf239da2b7d987c95c9373c5595623ae21d334f01c123c66056'

/**
 * Valid X25519 test pubkeys (non-zero, 32 bytes each).
 * X25519 rejects all-zero keys; use real-looking test values.
 * Generated as sha256 of "sobre-test-key-1/2" truncated to 32 bytes.
 */
const DUMMY_AUDITOR_PUBKEY_HEX = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const DUMMY_EMPLOYEE_PUBKEY_HEX = 'ba7816bf8f01cfea414140de5dae2ec73b00361bbef0469fe2fcea359a63b0af'

/** A simple 8-note batch: 8 zero-amount dummies with a valid pubkey. */
function makeDummyNotes(): DenomNote[] {
  const outPubkey = pubkeyToBn254(DUMMY_EMPLOYEE_PUBKEY_HEX)
  return Array.from({ length: 8 }, () => ({
    denomination: BigInt(0),
    recipientPubkeyHex: DUMMY_EMPLOYEE_PUBKEY_HEX,
    employeeName: '',
    outPubkey,
  }))
}

/** A minimal non-trivial 8-note batch: 1 USDC to a test pubkey, rest dummies. */
function makeRealNotes(): DenomNote[] {
  const realPubkeyHex = 'ba7816bf8f01cfea414140de5dae2ec73b00361bbef0469fe2fcea359a63b0af'
  const dummyPubkeyHex = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  const notes: DenomNote[] = [
    {
      denomination: BigInt(1) * USDC_SCALE,
      recipientPubkeyHex: realPubkeyHex,
      employeeName: 'Alice',
      outPubkey: pubkeyToBn254(realPubkeyHex),
    },
  ]
  const dummy: DenomNote = {
    denomination: BigInt(0),
    recipientPubkeyHex: dummyPubkeyHex,
    employeeName: '',
    outPubkey: pubkeyToBn254(dummyPubkeyHex),
  }
  while (notes.length < 8) notes.push(dummy)
  return notes
}

// ------------------------------------------------------------------
// Test 1: hashExtDataSobre matches the SPIKE fixture
// ------------------------------------------------------------------

describe('hashExtDataSobre', () => {
  it('matches the contract reference for the demo fixture (mikey, ext_amount=0, 8 empty blobs)', () => {
    const result = hashExtDataSobre({
      recipient: SPIKE_RECIPIENT,
      ext_amount: BigInt(0),
      encrypted_outputs: Array.from({ length: 8 }, () => new Uint8Array(0)),
    })
    expect(result.bigInt.toString(16).padStart(64, '0')).toBe(SPIKE_HASH)
    expect(result.bytes).toBeInstanceOf(Uint8Array)
    expect(result.bytes.length).toBe(32)
    // First 4 bytes should spell 0b3f2759
    const prefix = Array.from(result.bytes.slice(0, 4))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    expect(prefix).toBe('0b3f2759')
  })

  it('is sensitive to ext_amount', () => {
    const base = {
      recipient: SPIKE_RECIPIENT,
      encrypted_outputs: Array.from({ length: 8 }, () => new Uint8Array(0)),
    }
    const a = hashExtDataSobre({ ...base, ext_amount: BigInt(0) })
    const b = hashExtDataSobre({ ...base, ext_amount: BigInt(1) })
    expect(a.bigInt).not.toBe(b.bigInt)
  })

  it('uses scvVec(scvBytes) internally — the caller can pass non-empty blobs', () => {
    // Non-empty blobs should not throw
    const blob = new Uint8Array([1, 2, 3])
    const result = hashExtDataSobre({
      recipient: SPIKE_RECIPIENT,
      ext_amount: BigInt(0),
      encrypted_outputs: Array.from({ length: 8 }, () => blob),
    })
    expect(result.bigInt).toBeGreaterThan(BigInt(0))
  })
})

// ------------------------------------------------------------------
// Test 2: buildFrozenBlobs — non-determinism + return shape
// ------------------------------------------------------------------

describe('buildFrozenBlobs', () => {
  it('returns exactly 8 blobs and 8 blindings', async () => {
    const notes = makeDummyNotes()
    const result = await buildFrozenBlobs(notes, DUMMY_AUDITOR_PUBKEY_HEX)
    expect(result.blobs).toHaveLength(8)
    expect(result.blindings).toHaveLength(8)
    for (const blob of result.blobs) {
      expect(blob).toBeInstanceOf(Uint8Array)
    }
    for (const b of result.blindings) {
      expect(typeof b).toBe('bigint')
    }
  })

  it('is non-deterministic: two calls produce DIFFERENT blobs AND DIFFERENT blindings', async () => {
    const notes = makeDummyNotes()
    const first = await buildFrozenBlobs(notes, DUMMY_AUDITOR_PUBKEY_HEX)
    const second = await buildFrozenBlobs(notes, DUMMY_AUDITOR_PUBKEY_HEX)

    // At least one blob must differ
    const blobsDiffer = first.blobs.some(
      (b, i) => !arraysEqual(b, second.blobs[i]),
    )
    expect(blobsDiffer).toBe(true)

    // At least one blinding must differ
    const blindingsDiffer = first.blindings.some(
      (b, i) => b !== second.blindings[i],
    )
    expect(blindingsDiffer).toBe(true)
  })
})

// ------------------------------------------------------------------
// Test 3: buildDepositInputs — Noir ABI shape (plan 09.1-02)
// ------------------------------------------------------------------

describe('buildDepositInputs — Noir ABI', () => {
  it('returns the 12 flat public keys as scalar strings (no arrays)', async () => {
    const notes = makeRealNotes()
    const { blobs, blindings } = await buildFrozenBlobs(notes, DUMMY_AUDITOR_PUBKEY_HEX)
    const dummyBlinding = BigInt(99999)

    const inputs = buildDepositInputs({
      notes,
      blindings,
      encOutputs: blobs,
      extDataHash: BigInt(42),
      poolRoot: '1234',
      senderAddress: SPIKE_RECIPIENT,
      dummyBlinding,
    })

    // All 12 public keys must exist as scalar strings
    expect(typeof inputs.root).toBe('string')
    expect(typeof inputs.public_amount).toBe('string')
    expect(typeof inputs.ext_data_hash).toBe('string')
    expect(typeof inputs.input_nullifier).toBe('string')
    for (let i = 0; i < 8; i++) {
      expect(typeof (inputs as Record<string, unknown>)[`output_commitment_${i}`]).toBe('string')
    }
  })

  it('has NO ASP fields (membershipRoots, nonMembershipRoots, aspMemberRoot, etc.)', async () => {
    const notes = makeRealNotes()
    const { blobs, blindings } = await buildFrozenBlobs(notes, DUMMY_AUDITOR_PUBKEY_HEX)

    const inputs = buildDepositInputs({
      notes,
      blindings,
      encOutputs: blobs,
      extDataHash: BigInt(0),
      poolRoot: '0',
      senderAddress: SPIKE_RECIPIENT,
      dummyBlinding: BigInt(1),
    }) as Record<string, unknown>

    expect(inputs.membershipRoots).toBeUndefined()
    expect(inputs.nonMembershipRoots).toBeUndefined()
    expect(inputs.membershipProofs).toBeUndefined()
    expect(inputs.nonMembershipProofs).toBeUndefined()
    expect(inputs.aspMemberRoot).toBeUndefined()
    expect(inputs.aspNonMemberRoot).toBeUndefined()
  })

  it('has NO old Circom camelCase field names', async () => {
    const notes = makeDummyNotes()
    const { blobs, blindings } = await buildFrozenBlobs(notes, DUMMY_AUDITOR_PUBKEY_HEX)

    const inputs = buildDepositInputs({
      notes,
      blindings,
      encOutputs: blobs,
      extDataHash: BigInt(0),
      poolRoot: '0',
      senderAddress: SPIKE_RECIPIENT,
      dummyBlinding: BigInt(1),
    }) as Record<string, unknown>

    // Old Circom names must not exist
    expect(inputs.inAmount).toBeUndefined()
    expect(inputs.inPrivateKey).toBeUndefined()
    expect(inputs.inBlinding).toBeUndefined()
    expect(inputs.inPathIndices).toBeUndefined()
    expect(inputs.inPathElements).toBeUndefined()
    expect(inputs.outPubkey).toBeUndefined()
    expect(inputs.inputNullifier).toBeUndefined()
    expect(inputs.outputCommitment).toBeUndefined()
    expect(inputs.publicAmount).toBeUndefined()
    expect(inputs.extDataHash).toBeUndefined()
  })

  it('has in_path_bits as string[10] with only "0" or "1" values (dummy deposit: all zeros)', async () => {
    const notes = makeDummyNotes()
    const { blobs, blindings } = await buildFrozenBlobs(notes, DUMMY_AUDITOR_PUBKEY_HEX)

    const inputs = buildDepositInputs({
      notes,
      blindings,
      encOutputs: blobs,
      extDataHash: BigInt(0),
      poolRoot: '0',
      senderAddress: SPIKE_RECIPIENT,
      dummyBlinding: BigInt(1),
    })

    expect(inputs.in_path_bits).toHaveLength(10)
    // Deposit dummy input (in_amount=0): all path bits must be '0'
    expect(inputs.in_path_bits).toStrictEqual(Array(10).fill('0'))
    // Every element must be '0' or '1'
    for (const bit of inputs.in_path_bits) {
      expect(['0', '1']).toContain(bit)
    }
  })

  it('has in_path_elements as string[10] of zeros (dummy deposit)', async () => {
    const notes = makeDummyNotes()
    const { blobs, blindings } = await buildFrozenBlobs(notes, DUMMY_AUDITOR_PUBKEY_HEX)

    const inputs = buildDepositInputs({
      notes,
      blindings,
      encOutputs: blobs,
      extDataHash: BigInt(0),
      poolRoot: '0',
      senderAddress: SPIKE_RECIPIENT,
      dummyBlinding: BigInt(1),
    })

    expect(inputs.in_path_elements).toHaveLength(10)
    expect(inputs.in_path_elements).toStrictEqual(Array(10).fill('0'))
  })

  it('has out_amount, out_pub_key, out_blinding as string[8]', async () => {
    const notes = makeRealNotes()
    const { blobs, blindings } = await buildFrozenBlobs(notes, DUMMY_AUDITOR_PUBKEY_HEX)

    const inputs = buildDepositInputs({
      notes,
      blindings,
      encOutputs: blobs,
      extDataHash: BigInt(0),
      poolRoot: '0',
      senderAddress: SPIKE_RECIPIENT,
      dummyBlinding: BigInt(1),
    })

    expect(inputs.out_amount).toHaveLength(8)
    expect(inputs.out_pub_key).toHaveLength(8)
    expect(inputs.out_blinding).toHaveLength(8)
  })

  it('out_blinding equals the blindings passed in (as decimal strings)', async () => {
    const notes = makeDummyNotes()
    const { blobs, blindings } = await buildFrozenBlobs(notes, DUMMY_AUDITOR_PUBKEY_HEX)

    const inputs = buildDepositInputs({
      notes,
      blindings,
      encOutputs: blobs,
      extDataHash: BigInt(0),
      poolRoot: '0',
      senderAddress: SPIKE_RECIPIENT,
      dummyBlinding: BigInt(99999),
    })

    for (let i = 0; i < 8; i++) {
      expect(inputs.out_blinding[i]).toBe(blindings[i].toString())
    }
  })

  it('output_commitment_i matches hash3WithSep(out_amount, out_pub_key, blinding, 1) (circuit semantics)', async () => {
    const notes = makeRealNotes()
    const { blobs, blindings } = await buildFrozenBlobs(notes, DUMMY_AUDITOR_PUBKEY_HEX)

    const inputs = buildDepositInputs({
      notes,
      blindings,
      encOutputs: blobs,
      extDataHash: BigInt(0),
      poolRoot: '0',
      senderAddress: SPIKE_RECIPIENT,
      dummyBlinding: BigInt(5),
    }) as Record<string, unknown>

    for (let i = 0; i < 8; i++) {
      const expectedCommitment = hash3WithSep(
        notes[i].denomination,
        notes[i].outPubkey,
        blindings[i],
        BigInt(1),
      ).toString()
      expect(inputs[`output_commitment_${i}`]).toBe(expectedCommitment)
    }
  })

  it('input_nullifier matches the circuit hash chain for dummy input (in_amount=0)', async () => {
    // Circuit chain for dummy (DUMMY_PRIVKEY=424242, in_amount=0, in_path_indices=0):
    //   pub_key = hash1WithSep(DUMMY_PRIVKEY, 3n)
    //   in_commitment = hash3WithSep(0n, pub_key, dummyBlinding, 1n)
    //   sig = hash3WithSep(DUMMY_PRIVKEY, in_commitment, 0n, 4n)
    //   input_nullifier = hash3WithSep(in_commitment, 0n, sig, 2n)
    const notes = makeDummyNotes()
    const { blobs, blindings } = await buildFrozenBlobs(notes, DUMMY_AUDITOR_PUBKEY_HEX)
    const dummyBlinding = BigInt(777)

    const inputs = buildDepositInputs({
      notes,
      blindings,
      encOutputs: blobs,
      extDataHash: BigInt(0),
      poolRoot: '0',
      senderAddress: SPIKE_RECIPIENT,
      dummyBlinding,
    })

    const DUMMY_PRIVKEY = BigInt(424242)
    const pubKey = hash1WithSep(DUMMY_PRIVKEY, BigInt(3))
    const inCommitment = hash3WithSep(BigInt(0), pubKey, dummyBlinding, BigInt(1))
    const sig = hash3WithSep(DUMMY_PRIVKEY, inCommitment, BigInt(0), BigInt(4))
    const expectedNullifier = hash3WithSep(inCommitment, BigInt(0), sig, BigInt(2)).toString()

    expect(inputs.input_nullifier).toBe(expectedNullifier)
  })

  it('in_amount is "0" (scalar string, not array)', async () => {
    const notes = makeDummyNotes()
    const { blobs, blindings } = await buildFrozenBlobs(notes, DUMMY_AUDITOR_PUBKEY_HEX)

    const inputs = buildDepositInputs({
      notes,
      blindings,
      encOutputs: blobs,
      extDataHash: BigInt(0),
      poolRoot: '0',
      senderAddress: SPIKE_RECIPIENT,
      dummyBlinding: BigInt(1),
    })

    expect(inputs.in_amount).toBe('0')
    expect(Array.isArray(inputs.in_amount)).toBe(false)
  })

  it('root matches the poolRoot passed in', async () => {
    const notes = makeDummyNotes()
    const { blobs, blindings } = await buildFrozenBlobs(notes, DUMMY_AUDITOR_PUBKEY_HEX)

    const inputs = buildDepositInputs({
      notes,
      blindings,
      encOutputs: blobs,
      extDataHash: BigInt(0),
      poolRoot: 'POOL_ROOT_TEST',
      senderAddress: SPIKE_RECIPIENT,
      dummyBlinding: BigInt(1),
    })

    expect(inputs.root).toBe('POOL_ROOT_TEST')
  })

  it('in_private_key matches DUMMY_PRIVKEY as decimal string', async () => {
    const notes = makeDummyNotes()
    const { blobs, blindings } = await buildFrozenBlobs(notes, DUMMY_AUDITOR_PUBKEY_HEX)

    const inputs = buildDepositInputs({
      notes,
      blindings,
      encOutputs: blobs,
      extDataHash: BigInt(0),
      poolRoot: '0',
      senderAddress: SPIKE_RECIPIENT,
      dummyBlinding: BigInt(1),
    })

    expect(inputs.in_private_key).toBe(BigInt(424242).toString())
  })
})

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
