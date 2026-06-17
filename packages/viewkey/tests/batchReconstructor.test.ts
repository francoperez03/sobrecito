/**
 * batchReconstructor — per-employee salary grouping tests (D2).
 *
 * Multiple denomination notes for the same employee are grouped by pubkey and
 * summed to recover the salary. The grand total (sum==T) is preserved exactly.
 */

import { describe, it, expect } from 'vitest'
import { x25519 } from '@noble/curves/ed25519.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { encryptNote } from '../src/crypto/ecies.js'
import { encodeDualBlob } from '../src/crypto/encoding.js'
import type { ScannedEvent } from '../src/scanner/eventScanner.js'
import { reconstructBatch } from '../src/reconstructor/batchReconstructor.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a deterministic X25519 keypair from a single seed byte. */
function makeKeypair(seed: number) {
  // Build a 32-byte private key: byte 0 = seed, rest = seed+1 (avoids all-zero key)
  const priv = new Uint8Array(32).fill(seed + 1)
  priv[0] = seed
  const pub = x25519.getPublicKey(priv)
  return { priv, pub }
}

/**
 * Build a fake ScannedEvent where both the employee and auditor ciphertexts
 * encrypt the given amount, dual-encoded into one blob.
 */
function makeEvent(
  index: number,
  commitment: bigint,
  amount: bigint,
  auditorPub: Uint8Array,
  employeePub: Uint8Array,
): ScannedEvent {
  const blinding = BigInt(index + 1) * BigInt(1000)
  const auditorCt = encryptNote(auditorPub, { amount, blinding })
  const employeeCt = encryptNote(employeePub, { amount, blinding })
  const encryptedOutput = encodeDualBlob(employeeCt, auditorCt)
  return { commitment, index, encryptedOutput }
}

const POOL_ADDRESS = 'CDHJ6W5ZCK7STNED7AT7SKCURQDFVCFJL6ZBF6XW7QMPOIBKHAOLCVL2'
const PERIOD_START = 1_700_000_000

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reconstructBatch — per-employee salary grouping', () => {
  it('groups 2 denomination notes for Alice + 6 dummies; maps Alice → summed salary; total==T', async () => {
    const auditor = makeKeypair(0x01)
    const alice = makeKeypair(0x02)
    const dummy = makeKeypair(0xfe) // use valid dummy keypair

    const aliceAmount1 = BigInt(100) // denomination note 1
    const aliceAmount2 = BigInt(10)  // denomination note 2
    const dummyAmount = BigInt(0)

    const events: ScannedEvent[] = [
      makeEvent(0, BigInt(1001), aliceAmount1, auditor.pub, alice.pub),
      makeEvent(1, BigInt(1002), aliceAmount2, auditor.pub, alice.pub),
      makeEvent(2, BigInt(1003), dummyAmount, auditor.pub, dummy.pub),
      makeEvent(3, BigInt(1004), dummyAmount, auditor.pub, dummy.pub),
      makeEvent(4, BigInt(1005), dummyAmount, auditor.pub, dummy.pub),
      makeEvent(5, BigInt(1006), dummyAmount, auditor.pub, dummy.pub),
      makeEvent(6, BigInt(1007), dummyAmount, auditor.pub, dummy.pub),
      makeEvent(7, BigInt(1008), dummyAmount, auditor.pub, dummy.pub),
    ]

    const employeePubkeys = new Map<number, Uint8Array>([
      [0, alice.pub],
      [1, alice.pub],
      // indices 2-7 have no entry → empty Uint8Array(0) (zero-length, not in map)
    ])

    const summary = await reconstructBatch({
      auditorPrivkey: auditor.priv,
      source: { events },
      poolAddress: POOL_ADDRESS,
      periodStart: PERIOD_START,
      employeePubkeys,
    })

    // grand total must equal the pre-grouping sum (sum==T)
    expect(summary.total).toBe(aliceAmount1 + aliceAmount2)

    // employeeSalaries must be present
    expect(summary.employeeSalaries).toBeDefined()
    expect(summary.employeeSalaries).toBeInstanceOf(Map)

    // Alice's salary = 100 + 10 = 110
    const aliceKey = bytesToHex(alice.pub)
    expect(summary.employeeSalaries.get(aliceKey)).toBe(
      aliceAmount1 + aliceAmount2,
    )
  })

  it('handles all 8 notes belonging to the same employee', async () => {
    const auditor = makeKeypair(0x03)
    const bob = makeKeypair(0x04)

    const amount = BigInt(50)
    const events: ScannedEvent[] = Array.from({ length: 8 }, (_, i) =>
      makeEvent(i, BigInt(2000 + i), amount, auditor.pub, bob.pub),
    )
    const employeePubkeys = new Map<number, Uint8Array>(
      Array.from({ length: 8 }, (_, i) => [i, bob.pub] as [number, Uint8Array]),
    )

    const summary = await reconstructBatch({
      auditorPrivkey: auditor.priv,
      source: { events },
      poolAddress: POOL_ADDRESS,
      periodStart: PERIOD_START,
      employeePubkeys,
    })

    // total = 8 * 50 = 400
    expect(summary.total).toBe(amount * BigInt(8))

    // Bob should have a single entry summing all 8 notes
    const bobKey = bytesToHex(bob.pub)
    expect(summary.employeeSalaries.get(bobKey)).toBe(amount * BigInt(8))
  })
})
