/**
 * withdrawTransactionBuilder.ts — 1-in / 8-zero-out withdraw witness assembly.
 *
 * sobre_slim Noir ABI (plan 09.1-02): 1 real input note, 8 zero change outputs.
 *
 * The key difference from buildDepositInputs (depositTransactionBuilder.ts):
 *   - in_amount = note.amount  (NON-zero → circuit runs Merkle membership check)
 *   - in_private_key = bn254Priv (employee spending key)
 *   - in_blinding = note.blinding
 *   - public_amount = toFieldElement(-note.amount)  (NEGATIVE = withdrawal direction)
 *   - output_commitment_i = hash3WithSep(0n, 0n, 0n, 1n) — zero-note commitment
 *     (the circuit checks outputCommitment unconditionally — not a literal '0')
 *   - in_path_bits: bit-decomposition of pathIndices (NEW Noir ABI field)
 *   - input_nullifier: recomputed via the circuit's exact hash chain so the
 *     public input matches what Noir computes internally
 *
 * D2 scope: ASP allowlist proofs intentionally dropped (sobre_slim has none).
 * No ASP fields in the witness.
 *
 * ES2017 only: BigInt() calls, never 0n/1n/…617n literals.
 * No default export — callers import buildWithdrawInputs by name.
 */

import type { EmployeeNote } from '@/lib/employee-scan'
import { hash1WithSep, hash3WithSep } from '@/lib/zk/poseidon2Pool'

// ---------------------------------------------------------------------------
// BN254 field helpers (ES2017-safe: BigInt() constructor, not literals)
// ---------------------------------------------------------------------------

const BN254_MOD = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617')

/**
 * Reduce a bigint into the BN254 scalar field.
 * Handles negative values (two's complement BN254 encoding) by adding BN254_MOD.
 */
function toFieldElement(v: bigint): bigint {
  return ((v % BN254_MOD) + BN254_MOD) % BN254_MOD
}

/**
 * Decompose a path-indices bitmask into a length-`levels` bit array.
 * bit[k] = (BigInt(bitmask) >> BigInt(k)) & 1n, returned as '0' or '1' strings.
 *
 * This matches the `in_path_bits` semantics in main.nr's compute_root:
 *   bit==0 → current node is left child (sibling on right)
 *   bit==1 → current node is right child (sibling on left)
 */
function pathIndicesToBits(bitmask: string, levels: number = 10): string[] {
  const n = BigInt(bitmask)
  const bits: string[] = []
  for (let k = 0; k < levels; k++) {
    bits.push(((n >> BigInt(k)) & BigInt(1)).toString())
  }
  return bits
}

// ---------------------------------------------------------------------------
// BuildWithdrawArgs
// ---------------------------------------------------------------------------

export interface BuildWithdrawArgs {
  /** The employee's decrypted note to be claimed. */
  note: EmployeeNote
  /** BN254 spending private key (bn254Priv from keyDerivation.ts). */
  bn254Priv: bigint
  /** Merkle sibling hashes for the note's commitment leaf (from reconstructMerklePathFromEvents). */
  pathElements: string[]
  /** Merkle path direction bitmask string (from reconstructMerklePathFromEvents). */
  pathIndices: string
  /** Freighter account address (the employee's Stellar account receiving the USDC). */
  recipientAddress: string
  /** Live pool Merkle root (decimal string from fetchPoolRoot). */
  poolRoot: string
  /**
   * Pre-computed ext_data_hash (decimal string from hashExtData with negative ext_amount).
   * Call: getChainAdapter().encoding.hashExtData({ recipient, ext_amount: -amount, encrypted_outputs: [] }).bigInt.toString()
   */
  extDataHash: string
}

// ---------------------------------------------------------------------------
// Withdraw witness return type (Noir ABI)
// ---------------------------------------------------------------------------

export interface WithdrawWitness {
  // Public (12 flat scalar strings)
  root: string
  public_amount: string
  ext_data_hash: string
  input_nullifier: string
  output_commitment_0: string
  output_commitment_1: string
  output_commitment_2: string
  output_commitment_3: string
  output_commitment_4: string
  output_commitment_5: string
  output_commitment_6: string
  output_commitment_7: string
  // Private (scalar strings)
  in_amount: string
  in_private_key: string
  in_blinding: string
  in_path_indices: string
  // Private (arrays)
  in_path_elements: string[]
  in_path_bits: string[]
  out_amount: string[]
  out_pub_key: string[]
  out_blinding: string[]
}

// ---------------------------------------------------------------------------
// buildWithdrawInputs
// ---------------------------------------------------------------------------

/**
 * Assemble the witness input object for the sobre_slim Noir prover in withdraw mode.
 *
 * sobre_slim reused for withdraw: 1 real input, 8 zero change outputs.
 * The note being claimed is the real input; no change outputs are produced (full-note claim).
 *
 * All numeric values are returned as decimal strings (the witness generator expects strings).
 * No ASP fields — D2 scope, sobre_slim intentionally drops the allowlist proofs.
 *
 * input_nullifier is RECOMPUTED here via the circuit's hash chain so the public input
 * matches what Noir computes internally (the old passed-in value from the WASM worker is
 * no longer trustworthy — the COMPUTE_* handlers are dead in bb-prover.ts):
 *   pub_key = hash1WithSep(bn254Priv, 3n)
 *   in_commitment = hash3WithSep(note.amount, pub_key, note.blinding, 1n)
 *   sig = hash3WithSep(bn254Priv, in_commitment, BigInt(pathIndices), 4n)
 *   input_nullifier = hash3WithSep(in_commitment, BigInt(pathIndices), sig, 2n)
 */
export function buildWithdrawInputs(args: BuildWithdrawArgs): WithdrawWitness {
  const {
    note,
    bn254Priv,
    pathElements,
    pathIndices,
    poolRoot,
    extDataHash,
  } = args

  const zero8 = Array(8).fill('0')

  // public_amount is NEGATIVE for a withdrawal (pool checks sign for direction).
  // toFieldElement(-amount) encodes the negative value in BN254 two's complement.
  const public_amount = toFieldElement(-note.amount).toString()

  // Recompute input_nullifier via the circuit's exact hash chain (main.nr:64-74).
  // This replaces the old WASM worker call (COMPUTE_NULLIFIER handler is dead in bb-prover.ts).
  const pub_key = hash1WithSep(bn254Priv, BigInt(3))
  const in_commitment = hash3WithSep(note.amount, pub_key, note.blinding, BigInt(1))
  const pathIndicesBigInt = BigInt(pathIndices)
  const sig = hash3WithSep(bn254Priv, in_commitment, pathIndicesBigInt, BigInt(4))
  const input_nullifier = hash3WithSep(in_commitment, pathIndicesBigInt, sig, BigInt(2)).toString()

  // Zero-note output commitment = hash3WithSep(0n, 0n, 0n, 1n).
  // The circuit checks outputCommitment unconditionally (main.nr:93) — a literal '0'
  // would fail the constraint. All 8 change outputs carry this canonical zero commitment.
  const zeroCommitment = hash3WithSep(BigInt(0), BigInt(0), BigInt(0), BigInt(1)).toString()

  // in_path_bits: bit-decomposition of the path-indices bitmask (NEW Noir ABI field).
  // main.nr compute_root receives path_bits as [Field;10], not the integer bitmask.
  const in_path_bits = pathIndicesToBits(pathIndices)

  return {
    // 12 public inputs (flat scalar strings)
    root: poolRoot,
    public_amount,
    ext_data_hash: extDataHash,
    input_nullifier,
    output_commitment_0: zeroCommitment,
    output_commitment_1: zeroCommitment,
    output_commitment_2: zeroCommitment,
    output_commitment_3: zeroCommitment,
    output_commitment_4: zeroCommitment,
    output_commitment_5: zeroCommitment,
    output_commitment_6: zeroCommitment,
    output_commitment_7: zeroCommitment,
    // Private inputs (scalar strings)
    in_amount: toFieldElement(note.amount).toString(),
    in_private_key: toFieldElement(bn254Priv).toString(),
    in_blinding: toFieldElement(note.blinding).toString(),
    in_path_indices: pathIndices,
    // Private inputs (arrays)
    in_path_elements: pathElements,
    in_path_bits,
    // 8 dummy zero outputs (no change; employee receives the full note amount via ext_amount)
    out_amount: zero8,
    out_pub_key: zero8,
    out_blinding: zero8,
  }
}
