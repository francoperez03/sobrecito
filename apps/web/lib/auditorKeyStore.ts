/**
 * auditorKeyStore.ts — cross-screen persistence of the auditor's PUBLIC key.
 *
 * Purpose: the auditor generates their X25519 keypair on the auditor console and
 * the employer needs the auditor's PUBLIC key to encrypt salary amounts to it
 * (selective disclosure / compliance). Persisting the public key in localStorage
 * lets the employer screen autofill it without manual copy/paste between roles in
 * the same browser.
 *
 * SECURITY (load-bearing): ONLY the PUBLIC key is ever stored. The auditor's
 * PRIVATE key (view-key) NEVER leaves memory and is NEVER written here — that is
 * the whole privacy model (the auditor reconstructs amounts client-side; the
 * private key is a one-shot copy in KeygenCard). Do not add a private-key setter.
 *
 * The value is stored as the auditor produces it (base64). Reads validate the
 * format (hex64 or base64 → 32 bytes) so a corrupted/foreign localStorage entry
 * never flows into the deposit encryption.
 */

import { keyFromBase64 } from 'viewkey'
import { isHex64 } from '@/lib/csvParser'

/** Stable localStorage key. Namespaced so it never collides with other state. */
export const AUDITOR_PUBLIC_KEY_STORAGE_KEY = 'sobre.auditorPublicKey'

/**
 * Validate that `input` is a well-formed 32-byte X25519 public key (hex64 or
 * base64). Returns true for valid keys; used to gate both save and load so only
 * sound keys round-trip through storage.
 */
export function isValidAuditorPublicKey(input: string): boolean {
  const clean = input.trim().replace(/^0x/, '')
  if (clean.length === 0) return false
  if (isHex64(clean)) return true
  try {
    return keyFromBase64(input.trim()).length === 32
  } catch {
    return false
  }
}

/**
 * Persist the auditor's PUBLIC key (as produced — base64). No-op during SSR or
 * when the value is malformed (we never store junk). Never call this with a
 * private key.
 */
export function saveAuditorPublicKey(publicKey: string): void {
  if (typeof window === 'undefined') return
  if (!isValidAuditorPublicKey(publicKey)) return
  try {
    window.localStorage.setItem(AUDITOR_PUBLIC_KEY_STORAGE_KEY, publicKey.trim())
  } catch {
    // localStorage can throw (private mode, quota). Persistence is best-effort;
    // the manual paste path still works.
  }
}

/**
 * Load the persisted auditor PUBLIC key, or null when absent / malformed / SSR.
 * A malformed stored value is treated as absent (and not auto-cleaned, to keep
 * this read side-effect-free).
 */
export function loadAuditorPublicKey(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(AUDITOR_PUBLIC_KEY_STORAGE_KEY)
    if (!stored || !isValidAuditorPublicKey(stored)) return null
    return stored
  } catch {
    return null
  }
}

/** Remove the persisted auditor public key. SSR-safe. */
export function clearAuditorPublicKey(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(AUDITOR_PUBLIC_KEY_STORAGE_KEY)
  } catch {
    // ignore
  }
}
