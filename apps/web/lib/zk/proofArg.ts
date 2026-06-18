/**
 * proofArg.ts — build the on-chain `Proof` ScVal for `pool.transact`.
 *
 * The deployed pool's transact signature is `transact(proof: Proof, ext_data:
 * ExtData, sender: Address)`. `Proof` is a #[contracttype] struct, NOT raw bytes.
 * Sending `scvBytes(proof)` makes the Soroban host panic converting Bytes → Proof
 * ("VM call trapped: UnreachableCodeReached"). This helper builds the full struct.
 *
 * Mirrors the CLI reference `proof_arg` (payroll-proof-gen, main.rs:441-449) and
 * the deployed contract spec:
 *
 *   struct Proof {
 *     asp_membership_root:     U256,
 *     asp_non_membership_root: U256,
 *     ext_data_hash:           BytesN<32>,
 *     input_nullifiers:        Vec<U256>,
 *     output_commitments:      Vec<U256>,
 *     proof:                   Groth16Proof,   // { a: BytesN<64>, b: BytesN<128>, c: BytesN<64> }
 *     public_amount:           U256,
 *     root:                    U256,
 *   }
 *
 * Soroban serializes #[contracttype] structs as an ScMap with keys sorted
 * ascending, so the entries below are emitted in that exact order.
 *
 * The 256-byte Soroban-format proof from the worker is the uncompressed
 * [A (64) || B (128) || C (64)] layout, split here into the three points.
 */

import { XdrLargeInt, xdr } from '@stellar/stellar-sdk'

/** Decimal string or bigint accepted for U256 fields. */
type U256Like = bigint | string

function u256(v: U256Like): xdr.ScVal {
  return new XdrLargeInt('u256', typeof v === 'bigint' ? v.toString() : v).toScVal()
}

function bytes(b: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.from(b))
}

function entry(key: string, val: xdr.ScVal): xdr.ScMapEntry {
  return new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })
}

/**
 * Build the Groth16Proof ScVal { a, b, c } from the 256-byte A||B||C proof.
 */
function groth16ProofScVal(proof256: Uint8Array): xdr.ScVal {
  if (proof256.length !== 256) {
    throw new Error(`proofArg: expected 256-byte proof, got ${proof256.length}`)
  }
  const a = proof256.slice(0, 64) // G1 (64 bytes)
  const b = proof256.slice(64, 192) // G2 (128 bytes)
  const c = proof256.slice(192, 256) // G1 (64 bytes)
  // Keys sorted ascending: a, b, c
  return xdr.ScVal.scvMap([entry('a', bytes(a)), entry('b', bytes(b)), entry('c', bytes(c))])
}

export interface ProofArgParams {
  /** 256-byte Soroban-format Groth16 proof (A||B||C) from the worker. */
  proof: Uint8Array
  /** Pool Merkle root the proof was generated against (public input). */
  root: U256Like
  /** Net public amount (deposit = +sum(outputs), withdrawal = field-encoded negative). */
  publicAmount: U256Like
  /** 32-byte keccak ext_data hash (BytesN<32>); from hashExtDataSobre(...).bytes. */
  extDataHash: Uint8Array
  /** One nullifier per input (payroll: 1). */
  inputNullifiers: U256Like[]
  /** Output commitments (payroll: 8). */
  outputCommitments: U256Like[]
  /** ASP membership root the proof was generated against (self-consistent reconstructed root). */
  aspMembershipRoot: U256Like
  /** ASP non-membership root (empty SMT → 0). */
  aspNonMembershipRoot: U256Like
}

/**
 * Build the `Proof` ScVal (ScMap) for pool.transact.
 */
export function buildProofScVal(p: ProofArgParams): xdr.ScVal {
  if (p.extDataHash.length !== 32) {
    throw new Error(`proofArg: ext_data_hash must be 32 bytes, got ${p.extDataHash.length}`)
  }
  // Keys sorted ascending (Soroban #[contracttype] map order):
  //   asp_membership_root, asp_non_membership_root, ext_data_hash,
  //   input_nullifiers, output_commitments, proof, public_amount, root
  return xdr.ScVal.scvMap([
    entry('asp_membership_root', u256(p.aspMembershipRoot)),
    entry('asp_non_membership_root', u256(p.aspNonMembershipRoot)),
    entry('ext_data_hash', bytes(p.extDataHash)),
    entry('input_nullifiers', xdr.ScVal.scvVec(p.inputNullifiers.map(u256))),
    entry('output_commitments', xdr.ScVal.scvVec(p.outputCommitments.map(u256))),
    entry('proof', groth16ProofScVal(p.proof)),
    entry('public_amount', u256(p.publicAmount)),
    entry('root', u256(p.root)),
  ])
}
