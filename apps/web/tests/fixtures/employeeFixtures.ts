/**
 * employeeFixtures.ts - Dual-blob fixture generator for the employee claim dashboard.
 *
 * Contract-method investigation results (confirmed from pool.rs, wave 0):
 *
 * A1 — pool.is_spent(nullifier): PRIVATE fn at pool.rs:374 (no `pub` keyword).
 *   NOT callable via simulateTransaction. FALLBACK (A1): nullifier status defaults
 *   to 'pending'; the status check is best-effort and degrades gracefully to
 *   'pending' on any simulate error. Plans 03 and 04 must default to 'pending'
 *   when the simulate call is unavailable.
 *
 * A2 — pool.get_proof(index): ABSENT from pool.rs entirely.
 *   No such method exists in the #[contractimpl] block. FALLBACK (A2): the Merkle
 *   path must be reconstructed client-side from the scanner's commitment-event
 *   history (incremental tree rebuild) for live proving. Otherwise the claim is a
 *   stub/demo. Plan 02 owns the reconstruction helper signature; plan 04 wires
 *   the fallback branch.
 */

import { encryptNote, encodeDualBlob } from 'viewkey'
import { deriveX25519 } from '../../lib/zk/keyDerivation'

/** 32-byte test employee seed (0x43 x 32). Used in keyDerivation.test.ts and e2e scaffolds. */
export const EMPLOYEE_TEST_SEED_HEX = '43'.repeat(32)

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * Build dual-blob ScannedEvent-shaped objects whose employee half decrypts under
 * the test seed (EMPLOYEE_TEST_SEED_HEX = 0x43 x 32).
 *
 * The auditor half is encrypted to a fixed test auditor key (0x42 x 32), matching
 * the AUDITOR_PRIV used in auditor.spec.ts FIXTURE_EVENTS.
 *
 * The on-the-wire shape mirrors auditor.spec.ts FIXTURE_EVENTS exactly:
 *   { commitment, index, encryptedOutput, ledger, txHash }
 * where encryptedOutput is a Uint8Array (dual blob: employeeCiphertext || auditorCiphertext).
 *
 * Plans 02 and 03 feed these into Playwright mockRpc the same way auditor.spec.ts does.
 */
export function makeEmployeeFixtureEvents(amounts: bigint[]): unknown[] {
  const { pub: empPub } = deriveX25519(hexToBytes(EMPLOYEE_TEST_SEED_HEX))
  const auditorPub = new Uint8Array(32).fill(0x42) // matches AUDITOR_PRIV in auditor.spec.ts

  return amounts.map((amount, index) => {
    const blinding = BigInt(1000 + index)
    const empCt = encryptNote(empPub, { amount, blinding })
    const audCt = encryptNote(auditorPub, { amount, blinding })
    const encryptedOutput = encodeDualBlob(empCt, audCt)
    return {
      commitment: BigInt(index + 1),
      index,
      encryptedOutput,
      ledger: 3110500 + index,
      txHash: 'a'.repeat(63) + String(index),
    }
  })
}
