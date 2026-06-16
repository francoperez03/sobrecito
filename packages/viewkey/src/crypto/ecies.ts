import { x25519 } from "@noble/curves/ed25519.js";
import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { NotePayload } from "../types.js";

/**
 * ECIES over X25519 + AES-256-GCM.
 *
 * Each note amount is encrypted to a recipient's X25519 `encryption_key`
 * (pool.rs Account, 32 bytes) — NOT the BN254 `note_key` used for circuit
 * commitments (RESEARCH Pitfall 5). The scheme follows RESEARCH Patrón 1 and
 * uses @noble primitives end to end; no hand-rolled crypto.
 *
 * Output blob layout: ephemeralPub(32) || iv(12) || ciphertext+tag.
 * (@noble's gcm appends the 16-byte auth tag to the ciphertext.)
 */

const EPHEMERAL_PUB_LEN = 32;
const IV_LEN = 12;
const SECRET_LEN = 32;
const HEADER_LEN = EPHEMERAL_PUB_LEN + IV_LEN;

/** HKDF info/context string. Must match exactly on encrypt and decrypt sides. */
const HKDF_INFO = new TextEncoder().encode("sobre-viewkey-v1");

/** Number of bytes used to serialize each bigint field (32-byte big-endian). */
const FIELD_BYTES = 32;

/** Serialize a NotePayload as two 32-byte big-endian bigints: amount || blinding. */
function encodePayload(payload: NotePayload): Uint8Array {
  const out = new Uint8Array(FIELD_BYTES * 2);
  writeBigUintBE(out, 0, payload.amount);
  writeBigUintBE(out, FIELD_BYTES, payload.blinding);
  return out;
}

/** Deserialize the payload produced by `encodePayload`. */
function decodePayload(bytes: Uint8Array): NotePayload {
  if (bytes.length !== FIELD_BYTES * 2) {
    throw new Error(
      `viewkey: invalid note payload length ${bytes.length}, expected ${FIELD_BYTES * 2}`,
    );
  }
  return {
    amount: readBigUintBE(bytes, 0, FIELD_BYTES),
    blinding: readBigUintBE(bytes, FIELD_BYTES, FIELD_BYTES),
  };
}

function writeBigUintBE(buf: Uint8Array, offset: number, value: bigint): void {
  if (value < 0n) {
    throw new Error("viewkey: cannot encode negative bigint");
  }
  let v = value;
  for (let i = FIELD_BYTES - 1; i >= 0; i--) {
    buf[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) {
    throw new Error("viewkey: bigint exceeds 32 bytes");
  }
}

function readBigUintBE(buf: Uint8Array, offset: number, len: number): bigint {
  let acc = 0n;
  for (let i = 0; i < len; i++) {
    acc = (acc << 8n) | BigInt(buf[offset + i]);
  }
  return acc;
}

/**
 * Derive the shared AES-256 key from a raw X25519 shared secret via HKDF-SHA256.
 */
function deriveKey(sharedSecret: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedSecret, undefined, HKDF_INFO, 32);
}

/**
 * Encrypt a note payload to a recipient's X25519 public key.
 * Returns: ephemeralPub(32) || iv(12) || ciphertext || tag(16).
 */
export function encryptNote(
  recipientPubkey: Uint8Array,
  payload: NotePayload,
): Uint8Array {
  if (recipientPubkey.length !== EPHEMERAL_PUB_LEN) {
    throw new Error(
      `viewkey: recipient X25519 pubkey must be ${EPHEMERAL_PUB_LEN} bytes, got ${recipientPubkey.length}`,
    );
  }

  const ephemeralPriv = x25519.utils.randomSecretKey();
  const ephemeralPub = x25519.getPublicKey(ephemeralPriv);
  const shared = x25519.getSharedSecret(ephemeralPriv, recipientPubkey);
  const key = deriveKey(shared);

  const iv = randomIv();
  const ciphertext = gcm(key, iv).encrypt(encodePayload(payload));

  const blob = new Uint8Array(HEADER_LEN + ciphertext.length);
  blob.set(ephemeralPub, 0);
  blob.set(iv, EPHEMERAL_PUB_LEN);
  blob.set(ciphertext, HEADER_LEN);
  return blob;
}

/**
 * Decrypt a blob produced by `encryptNote` using the recipient's X25519 private
 * key. Throws if the blob is malformed or the GCM tag does not verify (e.g. when
 * the wrong key is used — this is the key-separation guarantee).
 */
export function decryptNote(privkey: Uint8Array, blob: Uint8Array): NotePayload {
  if (privkey.length !== SECRET_LEN) {
    throw new Error(
      `viewkey: X25519 private key must be ${SECRET_LEN} bytes, got ${privkey.length}`,
    );
  }
  if (blob.length <= HEADER_LEN) {
    throw new Error(
      `viewkey: ciphertext too short (${blob.length} bytes), missing header or body`,
    );
  }

  const ephemeralPub = blob.subarray(0, EPHEMERAL_PUB_LEN);
  const iv = blob.subarray(EPHEMERAL_PUB_LEN, HEADER_LEN);
  const ciphertext = blob.subarray(HEADER_LEN);

  const shared = x25519.getSharedSecret(privkey, ephemeralPub);
  const key = deriveKey(shared);

  // gcm().decrypt throws on tag mismatch — propagated as key-separation failure.
  const plaintext = gcm(key, iv).decrypt(ciphertext);
  return decodePayload(plaintext);
}

function randomIv(): Uint8Array {
  const iv = new Uint8Array(IV_LEN);
  globalThis.crypto.getRandomValues(iv);
  return iv;
}
