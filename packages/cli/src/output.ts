/**
 * output.ts — CLI line formatting for `sobre pay`, per the Phase 6 UI-SPEC
 * "Copywriting Contract / CLI `sobre pay`".
 *
 * Voice: terse, technical, honest. No marketing copy. The middle dot `·` is the
 * step separator (never dashes or arrows). Normal mode is sealed by default:
 * individual amounts are NEVER printed here except `warnLine`, which exists only
 * for the explicit unshield-exposure warning. Every other line shows the total T.
 */

export type StepState = "pending" | "proving" | "submitting" | "committed" | "failed";

/**
 * Progress line for a pipeline step. The two steps the CLI actually prints are
 * `proving` (needs the note count N) and `submitting`. Both use the `·` prefix.
 *
 *   step("proving", 8)  → "· generating proof for 8 notes…"
 *   step("submitting")  → "· submitting batch to pool…"
 */
export function step(state: StepState, n?: number): string {
  switch (state) {
    case "proving":
      return `· generating proof for ${n ?? 0} notes…`;
    case "submitting":
      return "· submitting batch to pool…";
    case "pending":
      return "· pending…";
    case "committed":
      return "· committed";
    case "failed":
      return "· failed";
    default:
      return `· ${state}`;
  }
}

/**
 * Error line. UI-SPEC format: `[ERROR] {problem} — {what to try next}`.
 * The em dash here is English copy (CLI output), which the project style allows.
 */
export function errorLine(problem: string, next: string): string {
  return `[ERROR] ${problem} — ${next}`;
}

/**
 * Exposure warning for an unshield (the only place an individual amount is ever
 * surfaced). UI-SPEC format:
 *   `[WARN] unshielding reveals {amount} USDC on-chain for address {addr}`
 */
export function warnLine(amount: string, addr: string): string {
  return `[WARN] unshielding reveals ${amount} USDC on-chain for address ${addr}`;
}

/**
 * Success summary block. Returns the three UI-SPEC lines as a single string:
 *   ✓ {N} notes committed · sum(payments) = {T} USDC · verified on-chain
 *     batch tx: {hash}
 *     ledger: {seq}
 * Only the total T is printed — never the per-note amounts (sealed by default).
 */
export function successSummary(
  n: number,
  total: bigint | string,
  hash: string,
  seq: string,
): string {
  return [
    `✓ ${n} notes committed · sum(payments) = ${total.toString()} USDC · verified on-chain`,
    `  batch tx: ${hash}`,
    `  ledger: ${seq}`,
  ].join("\n");
}

/** The honest-disclosure footnote (printed only under --verbose, per UI-SPEC). */
export const HONEST_DISCLOSURE =
  "PoC — not audited. ZK proof is technical; confidentiality is a policy guarantee.";
