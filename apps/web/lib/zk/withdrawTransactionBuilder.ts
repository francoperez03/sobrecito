/**
 * withdrawTransactionBuilder.ts — 1-in / 8-dummy-out withdraw witness assembly.
 *
 * policy_tx_1_8 reused for withdraw: 1 real input, 8 dummy zero outputs
 * (per 06.3-RESEARCH.md Pattern 4).
 *
 * The key difference from buildDepositInputs (depositTransactionBuilder.ts):
 *   - inAmount[0] = note.amount   (NON-zero -> circuit runs Merkle membership check)
 *   - inPrivateKey[0] = bn254Priv (employee spending key)
 *   - inBlinding[0] = note.blinding
 *   - publicAmount = toFieldElement(-note.amount)  (NEGATIVE = withdrawal direction)
 *   - outputCommitment, outAmount, outPubkey, outBlinding = all zeros (no change outputs)
 *
 * ES2017 only: BigInt() calls, never 0n/1n/...617n literals.
 * No default export — callers import buildWithdrawInputs by name.
 */

import { BN254_FIELD_MODULUS } from 'viewkey'
import type { EmployeeNote } from '@/lib/employee-scan'

// Re-export for callers that need hashExtDataSobre for the withdraw direction.
export { hashExtDataSobre } from '@/lib/zk/depositTransactionBuilder'

// ---------------------------------------------------------------------------
// BN254 field helpers
// ---------------------------------------------------------------------------

const BN254_MOD = BN254_FIELD_MODULUS

/**
 * Reduce a bigint into the BN254 scalar field.
 * Handles negative values (two's complement BN254 encoding) by adding BN254_MOD.
 * Mirrors the same function in depositTransactionBuilder.ts (lines 324-327).
 */
function toFieldElement(v: bigint): bigint {
  return ((v % BN254_MOD) + BN254_MOD) % BN254_MOD
}

// ---------------------------------------------------------------------------
// BuildWithdrawArgs
// ---------------------------------------------------------------------------

export interface BuildWithdrawArgs {
  /** The employee's decrypted note to be claimed. */
  note: EmployeeNote
  /** BN254 spending private key (bn254Priv from keyDerivation.ts). */
  bn254Priv: bigint
  /**
   * Pre-computed nullifier via proverClient.computeNullifier(bn254Priv, blinding, pathIndices).
   * Must use the Poseidon2 WASM bridge for the circuit to accept it.
   */
  inputNullifier: bigint
  /** Merkle sibling hashes for the note's commitment leaf (from reconstructMerklePathFromEvents). */
  pathElements: string[]
  /** Merkle path direction bitmask string (from reconstructMerklePathFromEvents). */
  pathIndices: string
  /** Freighter account address (the employee's Stellar account receiving the USDC). */
  recipientAddress: string
  /** Live pool Merkle root (decimal string from fetchPoolRoot). */
  poolRoot: string
  /** ASP membership root (decimal string from fetchASPRoots). */
  aspMemberRoot: string
  /** ASP non-membership root (decimal string from fetchASPRoots). */
  aspNonMemberRoot: string
  /**
   * Pre-computed ext_data_hash (decimal string from hashExtDataSobre with negative ext_amount).
   * Call: hashExtDataSobre({ recipient, ext_amount: -note.amount, encrypted_outputs: [] }).bigInt
   * and pass its .toString() here.
   */
  extDataHash: string
  /**
   * Commitment of an all-zero output note = Poseidon2(0, 0, 0, domain=1), from the
   * WASM bridge (computeCommitment(0,0,0)). The circuit verifies
   * outCommitmentHasher.out === outputCommitment[i] UNCONDITIONALLY
   * (policyTransaction.circom:187), so the 8 unused change outputs must carry the
   * real zero-note commitment, NOT a literal 0. Optional only so existing unit
   * tests still type-check; the live claim (employee-claim.ts) always supplies it.
   */
  zeroOutputCommitment?: string
  /**
   * Self-consistent ASP membership proof for the EMPLOYEE's spending key, mirroring
   * the deposit's dummy-input proof. The circuit verifies membership unconditionally
   * for every input (policyTransaction.circom:127-170), so the withdraw needs a real
   * proof: leaf = Poseidon2(derivePublicKey(bn254Priv), 0, 1), reconstructed against a
   * tree that contains it. The pool no longer cross-checks the root on-chain (ASP
   * obviated), so any internally-consistent root is accepted.
   */
  precomputedMembership?: {
    publicKey: bigint
    leaf: bigint
    pathElements: string[]
    pathIndices: string
  }
}

// ---------------------------------------------------------------------------
// buildWithdrawInputs
// ---------------------------------------------------------------------------

/**
 * Assemble the witness input object for the policy_tx_1_8 prover in withdraw mode.
 *
 * policy_tx_1_8 reused for withdraw: 1 real input, 8 dummy zero outputs
 * (per RESEARCH Pattern 4). The note being claimed is the real input;
 * no change outputs are produced (full-note claim).
 *
 * All numeric values are returned as decimal strings (the witness generator
 * expects strings). The membership/non-membership root fields mirror the shape
 * of buildDepositInputs for compatibility with the proverClient worker.
 */
export function buildWithdrawInputs(args: BuildWithdrawArgs): Record<string, unknown> {
  const {
    note,
    bn254Priv,
    inputNullifier,
    pathElements,
    pathIndices,
    poolRoot,
    aspMemberRoot,
    aspNonMemberRoot,
    extDataHash,
    zeroOutputCommitment,
    precomputedMembership,
  } = args

  const zero8 = Array(8).fill('0')

  // publicAmount is NEGATIVE for a withdrawal (pool checks sign for direction).
  // toFieldElement(-amount) encodes the negative value in BN254 two's complement.
  const publicAmount = toFieldElement(-note.amount).toString()

  return {
    // Public inputs
    root: poolRoot,
    publicAmount,
    extDataHash,
    inputNullifier: [toFieldElement(inputNullifier).toString()],
    // 8 unused change outputs, each the commitment of an all-zero note
    // (Poseidon2(0,0,0,1)). The circuit checks this hash unconditionally, so a
    // literal 0 would fail the constraint.
    outputCommitment: Array(8).fill(zeroOutputCommitment ?? '0'),
    membershipRoots: [[aspMemberRoot]],
    nonMembershipRoots: [[aspNonMemberRoot]],

    // Private inputs (1 real input, NON-zero inAmount activates Merkle membership check)
    inAmount: [toFieldElement(note.amount).toString()],
    inPrivateKey: [toFieldElement(bn254Priv).toString()],
    inBlinding: [toFieldElement(note.blinding).toString()],
    inPathIndices: [pathIndices],
    inPathElements: [pathElements],

    // Self-consistent ASP membership proof for the employee's spending key. The
    // circuit verifies membership for every input unconditionally; an all-zero
    // placeholder makes the proof locally invalid. When precomputedMembership is
    // supplied (claimNote computes it via the WASM bridge), use it; otherwise fall
    // back to zeros (kept only so callers mid-migration still type-check).
    membershipProofs: [[
      precomputedMembership
        ? {
            leaf: precomputedMembership.leaf.toString(),
            blinding: '0',
            pathElements: precomputedMembership.pathElements,
            pathIndices: precomputedMembership.pathIndices,
          }
        : { leaf: '0', blinding: '0', pathElements: Array(10).fill('0'), pathIndices: '0' },
    ]],
    nonMembershipProofs: [[
      {
        key: precomputedMembership ? precomputedMembership.publicKey.toString() : '0',
        siblings: Array(10).fill('0'),
        oldKey: '0',
        oldValue: '0',
        isOld0: '1',
      },
    ]],

    // 8 dummy zero outputs (no change; employee receives the full note amount via ext_amount)
    outAmount: zero8,
    outPubkey: zero8,
    outBlinding: zero8,
  }
}
