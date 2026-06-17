import { x25519 } from "@noble/curves/ed25519.js";

export interface AuditorKeypair {
  /** 32-byte X25519 private key. Keep in component state; never persist or send. */
  privkey: Uint8Array;
  /** 32-byte X25519 public key. Share with employer so they encrypt to this key. */
  pubkey: Uint8Array;
}

/** Generate a fresh X25519 keypair for the auditor. Browser-safe (uses subtle crypto internally via @noble). */
export function generateAuditorKeypair(): AuditorKeypair {
  const privkey = x25519.utils.randomSecretKey();
  const pubkey = x25519.getPublicKey(privkey);
  return { privkey, pubkey };
}

/** Encode a 32-byte key as unpadded base64 (URL-safe, no line breaks). */
export function keyToBase64(key: Uint8Array): string {
  return btoa(String.fromCharCode(...key))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Decode a base64 key back to 32 bytes. Throws if length != 32. */
export function keyFromBase64(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length !== 32) throw new Error(`viewkey: keygen: expected 32 bytes, got ${bytes.length}`);
  return bytes;
}
