/**
 * employee-scan.ts — Employee pool scanner and Merkle path reconstruction.
 *
 * scanEmployeeNotes mirrors batchReconstructor.ts from the viewkey package, opening
 * the employee half (employeeCiphertext) of each dual-blob instead of the auditor
 * half. Foreign blobs (notes not encrypted to this employee's key) are silently
 * skipped via the GCM auth-tag catch — no logging on skips (Pitfall 2 from
 * 06.3-RESEARCH.md).
 *
 * reconstructMerklePathFromEvents implements the A2 fallback: pool.get_proof is
 * ABSENT from pool.rs (confirmed in Wave 0, plan 01). The Merkle path for a note
 * must be reconstructed client-side from the ordered commitment events by
 * rebuilding the incremental Poseidon2 tree.
 *
 * Tree parameters (matching depositTransactionBuilder.ts / policyTransaction circuit):
 *   TREE_LEVELS = 10
 *   ZERO_LEAF   = poseidon2(88, 76, 77)  -- see STATE.md; NOT just zero.
 *
 * A2 fallback boundary: this implementation builds the path correctly for the
 * fixture (tested tree size <= 2^TREE_LEVELS). For live proving, the same
 * reconstruction runs against real on-chain events.
 */

import { scanCommitmentEvents, decodeDualBlob, decryptNote } from 'viewkey'
import type { ScannedEvent } from 'viewkey'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmployeeNote {
  commitment: bigint
  index: number
  amount: bigint
  blinding: bigint
  ledger: number
  txHash: string
}

/**
 * Source of the commitment events to scan.
 *   events: inject directly (fixture/test mode, no network).
 *   rpcUrl + poolContractId + fromLedger: scan from the live pool.
 */
export type EmployeeEventSource =
  | { events: ScannedEvent[] }
  | { rpcUrl: string; poolContractId: string; fromLedger: number }

// ---------------------------------------------------------------------------
// Incremental Merkle tree constants (A2 fallback)
// ---------------------------------------------------------------------------

/**
 * Tree depth of the pool's incremental Merkle tree (matches the policy_tx_1_8
 * circuit and the WASM MerkleTree). The empty-leaf value (Poseidon2 of "XLM")
 * and the per-level Poseidon2 hashing live in the WASM bridge; the path is
 * reconstructed there (reconstructMerklePath) so the values are real field
 * elements the witness generator accepts.
 */
const TREE_LEVELS = 10

// ---------------------------------------------------------------------------
// scanEmployeeNotes
// ---------------------------------------------------------------------------

/**
 * Scan commitment events and decrypt the employee half of each dual-blob.
 *
 * Mirrors reconstructBatch (batchReconstructor.ts) with one difference:
 * opens blob.employeeCiphertext instead of blob.auditorCiphertext.
 * Foreign blobs throw a GCM auth-tag error and are silently skipped (Pitfall 2:
 * do NOT log decrypt failures — they are expected for other employees' notes).
 */
export async function scanEmployeeNotes(
  employeePrivkey: Uint8Array,
  source: EmployeeEventSource,
): Promise<EmployeeNote[]> {
  const events =
    'events' in source
      ? source.events
      : await scanCommitmentEvents(source)

  const notes: EmployeeNote[] = []

  for (const event of events) {
    let blob
    try {
      blob = decodeDualBlob(event.encryptedOutput)
    } catch {
      continue
    }
    try {
      const payload = decryptNote(employeePrivkey, blob.employeeCiphertext)
      notes.push({
        commitment: event.commitment,
        index: event.index,
        amount: payload.amount,
        blinding: payload.blinding,
        ledger: event.ledger,
        txHash: event.txHash,
      })
    } catch {
      // foreign blob: GCM tag mismatch (expected for other employees' notes)
    }
  }

  return notes
}

// ---------------------------------------------------------------------------
// reconstructMerklePathFromEvents (A2 fallback)
// ---------------------------------------------------------------------------

/**
 * Reconstruct the Merkle path for a commitment at `targetIndex` from the
 * ordered commitment events (newest-to-oldest or oldest-to-newest; events are
 * sorted by index for correctness).
 *
 * This is the A2 fallback: pool.get_proof is ABSENT from pool.rs (plan 01
 * investigation). The employee must reconstruct the Merkle path by rebuilding
 * the incremental tree from the pool's commitment event history.
 *
 * Returns:
 *   pathElements: string[TREE_LEVELS]  — sibling hashes at each level
 *   pathIndices:  string               — binary bitmask of left/right choices
 *
 * pathIndices is returned as a decimal string whose binary representation
 * encodes the direction at each level (bit i = 0 means left child at level i).
 * The circuit reads pathIndices as a single field element.
 */
export async function reconstructMerklePathFromEvents(
  events: ScannedEvent[],
  targetIndex: number,
): Promise<{ pathElements: string[]; pathIndices: string }> {
  // Sort events by index to ensure incremental insertion order, then extract the
  // commitment leaves in that order. The WASM MerkleTree rebuilds the tree with
  // the SAME Poseidon2 hash the circuit uses, so the path elements it returns are
  // valid BN254 field elements the withdraw witness generator accepts. The prior
  // pure-JS placeholder produced concatenated strings ("a_b") that the WASM
  // witness generator rejected (root cause of the proving crash, 06.3-04).
  const sorted = [...events].sort((a, b) => a.index - b.index)
  const leaves = sorted.map((e) => e.commitment)

  const { reconstructMerklePath } = await import('@/lib/zk/proverClient')
  return reconstructMerklePath(leaves, targetIndex, TREE_LEVELS)
}
