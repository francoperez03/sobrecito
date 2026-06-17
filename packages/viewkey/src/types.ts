import { keccak_256 } from "@noble/hashes/sha3.js";
import { StrKey } from "@stellar/stellar-sdk";

/**
 * BN254 (alt_bn128) scalar field modulus. The pool reduces every public input
 * modulo this value (pool.rs `bn256_modulus`). `buildExtContextHash` reduces its
 * keccak256 digest into this field so the value is a valid circuit public input.
 */
export const BN254_FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Cleartext payload of a single output note. Mirrors the note material the
 * employer commits to in the circuit: only `amount` and `blinding` are secret;
 * the commitment and pubkey are derived from them.
 */
export interface NotePayload {
  amount: bigint;
  blinding: bigint;
}

/**
 * The two ciphertexts that travel together inside a single `encrypted_outputs[i]`
 * blob (dual encryption, decision D-02). One is decryptable by the employee, the
 * other by the auditor; neither can open the other's half (key separation).
 */
export interface EncryptedBlob {
  /** ECIES ciphertext for the employee's X25519 key. */
  employeeCiphertext: Uint8Array;
  /** ECIES ciphertext for the auditor's X25519 key. */
  auditorCiphertext: Uint8Array;
}

/**
 * One reconstructed note as the auditor sees it after decrypting their half of a
 * blob and matching it to the `NewCommitmentEvent` emitted by the pool.
 */
export interface AuditorNote {
  commitment: bigint;
  index: number;
  amount: bigint;
  blinding: bigint;
  /** Employee's X25519 encryption public key (32 bytes), from `PublicKeyEvent`. */
  employeePubkeyX25519: Uint8Array;
  /** Ledger the event was emitted at — the batch/period grouping key. */
  ledger: number;
  /** Transaction hash of the payroll batch this note belongs to. */
  txHash: string;
}

/**
 * The full reconstructed batch the auditor produces from one payroll period:
 * the declared total plus the per-note desglose, bound to a period context hash.
 */
export interface BatchSummary {
  total: bigint;
  notes: AuditorNote[];
  extContextHash: bigint;
  periodStart: number;
  poolAddress: string;
}

/**
 * Decode a Stellar strkey (contract `C...` or account `G...`) into its raw 32
 * payload bytes. Falls back to UTF-8 bytes for non-strkey inputs so test values
 * remain deterministic. The same decoding MUST run on both employer and auditor
 * sides, otherwise the `extContextHash` will not match (RESEARCH Pitfall 3).
 */
function poolAddressBytes(poolAddress: string): Uint8Array {
  try {
    if (StrKey.isValidContract(poolAddress)) {
      return StrKey.decodeContract(poolAddress);
    }
    if (StrKey.isValidEd25519PublicKey(poolAddress)) {
      return StrKey.decodeEd25519PublicKey(poolAddress);
    }
  } catch {
    // fall through to UTF-8 encoding
  }
  return new TextEncoder().encode(poolAddress);
}

/**
 * Build the `extContextHash` public input that binds a `SelectiveDisclosure`
 * proof to one pool and one period.
 *
 * Schema: `keccak256(poolAddressBytes || periodStart as 8-byte big-endian) mod BN254`.
 * This mirrors the pool's `hash_ext_data` (pool.rs:126-134), which keccak256-hashes
 * its payload and reduces modulo the BN254 field. The schema MUST be identical on
 * the employer side (proof generation) and the auditor side (reconstruction); any
 * divergence in field order or encoding makes the proof fail to verify (Pitfall 3).
 */
export function buildExtContextHash(
  poolAddress: string,
  periodStart: number,
): bigint {
  const addrBytes = poolAddressBytes(poolAddress);

  const periodBytes = new Uint8Array(8);
  const view = new DataView(periodBytes.buffer);
  view.setBigUint64(0, BigInt(periodStart), false); // big-endian

  const payload = new Uint8Array(addrBytes.length + periodBytes.length);
  payload.set(addrBytes, 0);
  payload.set(periodBytes, addrBytes.length);

  const digest = keccak_256(payload);
  let acc = 0n;
  for (const byte of digest) {
    acc = (acc << 8n) | BigInt(byte);
  }
  return acc % BN254_FIELD_MODULUS;
}
