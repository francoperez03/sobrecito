/**
 * lib/chain/stellar/encoding.ts — Soroban ScVal/XDR encoding for the pool.
 *
 * Moved verbatim from lib/zk/proofArg.ts (buildProofScVal) and the hashExtDataSobre
 * helper from lib/zk/depositTransactionBuilder.ts. This is the ONLY place that
 * knows the pool's #[contracttype] layouts; the domain passes semantic values and
 * never sees an xdr.ScVal. Byte-for-byte SPIKE-confirmed against the contract.
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
 */

import { keccak_256 } from '@noble/hashes/sha3.js'
import { Address, nativeToScVal, XdrLargeInt, xdr } from '@stellar/stellar-sdk'
import type { ExtDataHash, ExtDataInput, ProofPublicInputs, U256Like } from '../types'

const BN254_MOD = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617',
)

function u256(v: U256Like): xdr.ScVal {
  return new XdrLargeInt('u256', typeof v === 'bigint' ? v.toString() : v).toScVal()
}

function bytes(b: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.from(b))
}

function entry(key: string, val: xdr.ScVal): xdr.ScMapEntry {
  return new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })
}

/** Build the Groth16Proof ScVal { a, b, c } from the 256-byte A||B||C proof. */
function groth16ProofScVal(proof256: Uint8Array): xdr.ScVal {
  if (proof256.length !== 256) {
    throw new Error(`encoding: expected 256-byte proof, got ${proof256.length}`)
  }
  const a = proof256.slice(0, 64) // G1 (64 bytes)
  const b = proof256.slice(64, 192) // G2 (128 bytes)
  const c = proof256.slice(192, 256) // G1 (64 bytes)
  // Keys sorted ascending: a, b, c
  return xdr.ScVal.scvMap([entry('a', bytes(a)), entry('b', bytes(b)), entry('c', bytes(c))])
}

/** Build the structured `Proof` ScVal (ScMap) for pool.transact. */
export function buildProofScVal(p: {
  proof: Uint8Array
} & ProofPublicInputs): xdr.ScVal {
  if (p.extDataHash.length !== 32) {
    throw new Error(`encoding: ext_data_hash must be 32 bytes, got ${p.extDataHash.length}`)
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

/**
 * Build the ext_data ScVal (encrypted_outputs Vec<Bytes>, ext_amount i256,
 * recipient Address) for pool.transact. Fields alphabetical (Soroban order).
 */
export function buildExtDataScVal(input: {
  recipient: string
  ext_amount: bigint
  encrypted_outputs: Uint8Array[]
}): xdr.ScVal {
  return nativeToScVal(
    {
      encrypted_outputs: xdr.ScVal.scvVec(
        input.encrypted_outputs.map(b => xdr.ScVal.scvBytes(Buffer.from(b))),
      ),
      ext_amount: nativeToScVal(input.ext_amount.toString(), { type: 'i256' }),
      recipient: new Address(input.recipient).toScVal(),
    },
    {
      type: {
        encrypted_outputs: ['symbol', null],
        ext_amount: ['symbol', null],
        recipient: ['symbol', null],
      },
    },
  )
}

/**
 * Compute the ext_data_hash for a pool.transact call.
 *
 * The Sobre pool's ExtData is `{ recipient, ext_amount, encrypted_outputs: Vec<Bytes> }`.
 * Soroban #[contracttype] serializes struct fields in ALPHABETICAL order, so the
 * XDR map entries are: encrypted_outputs → ext_amount → recipient. keccak256 of
 * the XDR bytes, reduced modulo BN254. SPIKE-confirmed byte-for-byte (prefix
 * 0b3f2759) against the contract.
 */
export function hashExtData(input: ExtDataInput): ExtDataHash {
  // Build the three map entries — alphabetical order: encrypted_outputs, ext_amount, recipient
  const entries = [
    {
      key: 'encrypted_outputs',
      val: xdr.ScVal.scvVec(
        input.encrypted_outputs.map(b => xdr.ScVal.scvBytes(Buffer.from(b))),
      ),
    },
    {
      key: 'ext_amount',
      val: new XdrLargeInt('i256', input.ext_amount.toString()).toScVal(),
    },
    {
      key: 'recipient',
      val: Address.fromString(input.recipient).toScVal(),
    },
  ]

  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  const scEntries = entries.map(
    e => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(e.key), val: e.val }),
  )
  const xdrBytes = xdr.ScVal.scvMap(scEntries).toXDR()
  const digest = keccak_256(xdrBytes)

  // Reduce the 32-byte big-endian digest into the BN254 scalar field
  let digestBig = BigInt(0)
  for (const byte of digest) {
    digestBig = (digestBig << BigInt(8)) | BigInt(byte)
  }
  const reduced = digestBig % BN254_MOD

  const hexPadded = reduced.toString(16).padStart(64, '0')
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hexPadded.slice(i * 2, i * 2 + 2), 16)
  }
  return { bigInt: reduced, bytes: out }
}
