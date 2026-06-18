/**
 * employeeRoster.ts — per-device roster of employee PUBLIC keys.
 *
 * Purpose: the employee generates their X25519+BN254 keypair on the employee
 * console. The employer needs the employee's PUBLIC key to deposit salary notes
 * encrypted to it. Storing alias + public key in localStorage lets the employer
 * screen autofill without manual copy/paste of the 128-hex combined key.
 *
 * SECURITY (load-bearing, A4 trust model): ONLY the public key is ever stored.
 * The employee's PRIVATE key / seed NEVER leaves memory and is NEVER written here.
 * The public key combines two halves:
 *   - x25519Pub (64 hex): the ECIES key salary notes are encrypted to (discovery).
 *   - bn254Pub  (64 hex): the BN254 spending pubkey the commitment uses (withdraw).
 * Both derive from the same employee seed, so the employee holds a single secret.
 *
 * Do not add any setter for the private key or seed.
 */

import { isEmployeePubkey } from '@/lib/csvParser'

/** Stable localStorage key. Namespaced so it never collides with other state. */
export const EMPLOYEE_ROSTER_STORAGE_KEY = 'sobre.employeeRoster'

/** A saved employee entry: alias (human-readable name) + combined public key. */
export interface RosterEntry {
  alias: string
  publicKey: string
}

/**
 * Validate that `input` is a well-formed combined employee public key (128 hex).
 * Returns false for empty, too-short, too-long, or non-hex input.
 */
export function isValidEmployeePublicKey(input: string): boolean {
  if (!input || input.trim().length === 0) return false
  return isEmployeePubkey(input)
}

/**
 * Load the persisted roster, or [] when absent / malformed / SSR.
 * Filters out any entry that does not validate (alias non-empty + valid public key),
 * so a corrupted/foreign localStorage entry never flows to the UI.
 * Read side-effect-free (no auto-cleaning).
 */
export function loadRoster(): RosterEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = window.localStorage.getItem(EMPLOYEE_ROSTER_STORAGE_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e: unknown): e is RosterEntry =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as RosterEntry).alias === 'string' &&
        (e as RosterEntry).alias.trim().length > 0 &&
        isValidEmployeePublicKey((e as RosterEntry).publicKey),
    )
  } catch {
    return []
  }
}

/**
 * Persist an employee entry (alias + PUBLIC key). SSR-safe.
 * No-op when alias is empty or the public key is malformed.
 * UPSERT by alias (case-sensitive on the trimmed alias): replaces an existing
 * entry's public key if the alias already exists, appends otherwise.
 * The public key is stored trimmed.
 * Never call this with the employee's private key or seed.
 */
export function saveEntry(alias: string, publicKey: string): void {
  if (typeof window === 'undefined') return
  const trimAlias = alias.trim()
  const trimKey = publicKey.trim()
  if (!trimAlias || !isValidEmployeePublicKey(trimKey)) return
  try {
    const roster = loadRoster()
    const idx = roster.findIndex((e) => e.alias === trimAlias)
    if (idx >= 0) {
      roster[idx] = { alias: trimAlias, publicKey: trimKey }
    } else {
      roster.push({ alias: trimAlias, publicKey: trimKey })
    }
    window.localStorage.setItem(EMPLOYEE_ROSTER_STORAGE_KEY, JSON.stringify(roster))
  } catch {
    // localStorage can throw (private mode, quota). Persistence is best-effort;
    // the manual paste path still works.
  }
}

/**
 * Remove the entry with the given alias from the roster. SSR-safe.
 * No-op when alias is empty or when the alias is not in the roster.
 */
export function removeEntry(alias: string): void {
  if (typeof window === 'undefined') return
  const trimAlias = alias.trim()
  if (!trimAlias) return
  try {
    const roster = loadRoster().filter((e) => e.alias !== trimAlias)
    window.localStorage.setItem(EMPLOYEE_ROSTER_STORAGE_KEY, JSON.stringify(roster))
  } catch {
    // ignore
  }
}

/** Clear the entire roster from localStorage. SSR-safe. */
export function clearRoster(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(EMPLOYEE_ROSTER_STORAGE_KEY)
  } catch {
    // ignore
  }
}
