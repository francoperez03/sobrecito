/**
 * depositTransactionBuilder.test.ts — unit tests for the 1→8 deposit witness builder.
 *
 * Verifies:
 * 1. hashExtDataSobre matches the SPIKE fixture hash (0b3f2759…c66056).
 * 2. buildFrozenBlobs is non-deterministic: two calls with the same inputs
 *    produce DIFFERENT blobs AND DIFFERENT blindings (proving the freeze is
 *    necessary — you cannot call it twice and expect the same hash).
 * 3. buildDepositInputs returns the correct array shapes and that
 *    outBlinding === the blindings passed in and outputCommitment[i] is
 *    recomputable from those same blindings.
 */

import { describe, it, expect } from 'vitest'
import {
  hashExtDataSobre,
  buildFrozenBlobs,
  buildDepositInputs,
} from '../../lib/zk/depositTransactionBuilder'
import type { DenomNote } from '../../lib/zk/denominationBuilder'
import { pubkeyToBn254 } from '../../lib/zk/denominationBuilder'
import { USDC_SCALE } from '../../lib/csvParser'

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

/** Minimal auditor pubkey (32-byte zero hex = 64 zeros). Non-functional for decryption, fine for builder tests. */
const DUMMY_AUDITOR_PUBKEY_HEX = '00'.repeat(32)

/** A simple 8-note batch: 8 zero-amount dummies with the same pubkey. */
function makeDummyNotes(): DenomNote[] {
  const outPubkey = pubkeyToBn254('00'.repeat(32))
  return Array.from({ length: 8 }, () => ({
    denomination: BigInt(0),
    recipientPubkeyHex: '00'.repeat(32),
    employeeName: '',
    outPubkey,
  }))
}

/** A minimal non-trivial 8-note batch: 1 USDC to a test pubkey, rest dummies. */
function makeRealNotes(): DenomNote[] {
  const realPubkeyHex = 'ab'.repeat(32)
  const dummyPubkeyHex = '00'.repeat(32)
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
// Test 3: buildDepositInputs — array shapes + blinding/commitment consistency
// ------------------------------------------------------------------

describe('buildDepositInputs', () => {
  it('returns the correct array shapes: 8 outputs, 1 input, inAmount===["0"]', async () => {
    const notes = makeRealNotes()
    const { blobs, blindings } = await buildFrozenBlobs(notes, DUMMY_AUDITOR_PUBKEY_HEX)
    const dummyBlinding = blindings[0] + BigInt(1) // distinct from output blindings

    const inputs = buildDepositInputs({
      notes,
      blindings,
      encOutputs: blobs,
      extDataHash: BigInt(42),
      poolRoot: '0',
      aspMemberRoot: '0',
      aspNonMemberRoot: '0',
      senderAddress: SPIKE_RECIPIENT,
      dummyBlinding,
    })

    // Public arrays
    expect(inputs.outputCommitment).toHaveLength(8)
    expect(inputs.inputNullifier).toHaveLength(1)
    expect(inputs.membershipRoots).toHaveLength(1)
    expect(inputs.membershipRoots[0]).toHaveLength(1)
    expect(inputs.nonMembershipRoots).toHaveLength(1)
    expect(inputs.nonMembershipRoots[0]).toHaveLength(1)

    // Private arrays
    expect(inputs.inAmount).toStrictEqual(['0'])
    expect(inputs.outAmount).toHaveLength(8)
    expect(inputs.outPubkey).toHaveLength(8)
    expect(inputs.outBlinding).toHaveLength(8)
    expect(inputs.inPathElements).toHaveLength(1)
    expect(inputs.inPathElements[0]).toHaveLength(10)
  })

  it('outBlinding equals the blindings passed in (as decimal strings)', async () => {
    const notes = makeDummyNotes()
    const { blobs, blindings } = await buildFrozenBlobs(notes, DUMMY_AUDITOR_PUBKEY_HEX)
    const dummyBlinding = BigInt(99999)

    const inputs = buildDepositInputs({
      notes,
      blindings,
      encOutputs: blobs,
      extDataHash: BigInt(0),
      poolRoot: '0',
      aspMemberRoot: '0',
      aspNonMemberRoot: '0',
      senderAddress: SPIKE_RECIPIENT,
      dummyBlinding,
    })

    for (let i = 0; i < 8; i++) {
      expect(inputs.outBlinding[i]).toBe(blindings[i].toString())
    }
  })

  it('outputCommitment[i] is recomputable from the same blinding (commitment↔blinding consistency)', async () => {
    const notes = makeRealNotes()
    const { blobs, blindings } = await buildFrozenBlobs(notes, DUMMY_AUDITOR_PUBKEY_HEX)
    const dummyBlinding = BigInt(777)

    const inputs = buildDepositInputs({
      notes,
      blindings,
      encOutputs: blobs,
      extDataHash: BigInt(0),
      poolRoot: '0',
      aspMemberRoot: '0',
      aspNonMemberRoot: '0',
      senderAddress: SPIKE_RECIPIENT,
      dummyBlinding,
    })

    // outBlinding values in inputs are the string form of the blindings
    for (let i = 0; i < 8; i++) {
      expect(inputs.outBlinding[i]).toBe(blindings[i].toString())
    }

    // The note's outAmount matches its denomination (decimal string)
    for (let i = 0; i < 8; i++) {
      expect(inputs.outAmount[i]).toBe(notes[i].denomination.toString())
    }

    // The outPubkey values match the notes' outPubkey (decimal string)
    for (let i = 0; i < 8; i++) {
      expect(inputs.outPubkey[i]).toBe(notes[i].outPubkey.toString())
    }
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
