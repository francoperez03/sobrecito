/**
 * keyDerivation.ts - Single-seed BN254 + X25519 key derivation for the employee
 * claim dashboard (Option B, locked in 06.3-CONTEXT.md).
 *
 * From ONE employee seed (32 bytes) we deterministically derive two independent
 * keypairs via HKDF-SHA256 with distinct info labels:
 *   1. A BN254 spending keypair: bn254Priv (scalar) + bn254Pub = Poseidon2(bn254Priv, 0)
 *      This is what the circuit's Keypair() template computes (domain 0x03).
 *   2. An X25519 encryption keypair: x25519Priv + x25519Pub for the ECIES dual-blob.
 *
 * Security notes (T-063-01 through T-063-05 in the threat model):
 *   - Pure functions; no persistence, no logging of key material.
 *   - HKDF-SHA256 32-byte output mod BN254 has negligible modular bias (~2^-128).
 *   - Wrong-seed decryption throws via GCM auth tag (key separation guarantee).
 *   - bn254Pub is computed by the SAME WASM the circuit uses, so client and circuit
 *     always agree on the keypair.
 *   - parseEmployeeKey rejects non-32-byte input via regex + keyFromBase64 length check.
 */

import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { BN254_FIELD_MODULUS, keyFromBase64 } from 'viewkey'
import { derivePublicKey } from '@/lib/zk/proverClient'

const BN254_INFO = new TextEncoder().encode('sobre-bn254-spending-key-v1')
const X25519_INFO = new TextEncoder().encode('sobre-x25519-encryption-key-v1')

/**
 * Interpret 32 bytes as a little-endian scalar and reduce mod BN254_FIELD_MODULUS.
 * Used to convert HKDF output into a valid BN254 field element.
 */
function leBytesToScalar(bytes: Uint8Array): bigint {
  let s = BigInt(0)
  for (let i = 31; i >= 0; i--) s = (s << BigInt(8)) | BigInt(bytes[i])
  return s % BN254_FIELD_MODULUS
}

export interface EmployeeKeys {
  bn254Priv: bigint
  bn254Pub: bigint
  x25519Priv: Uint8Array
  x25519Pub: Uint8Array
}

/**
 * Derive the BN254 spending private key (scalar) deterministically from the seed.
 * Pure and SSR-safe. The result is always < BN254_FIELD_MODULUS.
 */
export function deriveBn254PrivKey(seed: Uint8Array): bigint {
  if (seed.length !== 32) throw new Error(`deriveBn254PrivKey: expected 32 bytes, got ${seed.length}`)
  return leBytesToScalar(hkdf(sha256, seed, undefined, BN254_INFO, 32))
}

/**
 * Derive the X25519 encryption keypair deterministically from the seed.
 * Pure and SSR-safe.
 */
export function deriveX25519(seed: Uint8Array): { priv: Uint8Array; pub: Uint8Array } {
  if (seed.length !== 32) throw new Error(`deriveX25519: expected 32 bytes, got ${seed.length}`)
  const priv = hkdf(sha256, seed, undefined, X25519_INFO, 32)
  return { priv, pub: x25519.getPublicKey(priv) }
}

/**
 * Full single-seed key derivation (Option B). Returns all four key components.
 *
 * bn254Pub is computed by the WASM bridge (Poseidon2(bn254Priv, 0), domain 0x03)
 * so it matches the circuit's Keypair() template exactly. Browser-only because
 * derivePublicKey calls the WASM. For SSR or pure use, call deriveBn254PrivKey
 * and deriveX25519 directly.
 *
 * Deposit uses bn254Pub as the circuit output key.
 * Withdraw uses bn254Priv to generate the nullifier and prove key ownership.
 */
export async function deriveEmployeeKeys(seed: Uint8Array): Promise<EmployeeKeys> {
  const bn254Priv = deriveBn254PrivKey(seed)
  const bn254Pub = await derivePublicKey(bn254Priv)
  const { priv: x25519Priv, pub: x25519Pub } = deriveX25519(seed)
  return { bn254Priv, bn254Pub, x25519Priv, x25519Pub }
}

/**
 * Parse a pasted employee seed (hex or url-safe base64) into 32 bytes.
 * Mirrors auditor parseViewKey pattern.
 *
 * Accepts:
 *   - 64 hex chars (with or without leading 0x)
 *   - URL-safe base64 (via keyFromBase64 from the viewkey package)
 * Throws on malformed input or wrong byte length.
 */
export function parseEmployeeKey(input: string): Uint8Array {
  const clean = input.trim().replace(/^0x/, '')
  if (/^[0-9a-fA-F]{64}$/.test(clean)) {
    const out = new Uint8Array(32)
    for (let i = 0; i < 32; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
    return out
  }
  return keyFromBase64(input.trim())
}
