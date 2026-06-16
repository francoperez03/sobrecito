/**
 * pay.ts — the `sobre pay nomina.csv` orchestrator (Plan 06-02, D-01/D-02/D-03).
 *
 * One command, one sequential run (Pitfall 1 / L3): parse the CSV → freeze the
 * dual blobs ONCE → compute the matching ext_data_hash + generate a fresh proof →
 * submit one batch. The employer action of the whole product.
 *
 * Normal mode is sealed by default: only the total T is printed, never the
 * per-note amounts (T-06-07). `--dry-run` plans the batch (freezes blobs so the
 * artifact is inspectable) and STOPS before proof-gen and submit — it transacts
 * nothing. `--verbose` prints the honest-disclosure footnote on start.
 */
import { randomBytes } from "node:crypto";
import { x25519 } from "@noble/curves/ed25519.js";
import { parseCSV } from "../pipeline/parseCSV.js";
import { genBatchFromCSV } from "../pipeline/genKeys.js";
import { proofGen } from "../pipeline/proofGen.js";
import { submitBatch } from "../pipeline/submit.js";
import { OUT_DIR } from "../pipeline/paths.js";
import { step, successSummary, formatUsdc, HONEST_DISCLOSURE } from "../output.js";

export interface PayOptions {
  dryRun?: boolean;
  verbose?: boolean;
  network?: string;
}

/**
 * Run the full pay pipeline for `file`.
 *
 * Throws on any failure; the CLI's top-level catch renders the [ERROR] line and
 * exits non-zero, so a not-8-row CSV (parseCSV throws) aborts before any crypto.
 */
export function payCommand(file: string, opts: PayOptions = {}): void {
  const prefix = opts.dryRun ? "[dry-run] " : "";
  const network = opts.network ?? "testnet";

  if (opts.verbose) {
    console.log(`${prefix}${HONEST_DISCLOSURE}`);
  }

  // 1. parse + validate (8 rows, columns, key/amount shapes). Throws on bad input.
  console.log(`${prefix}sobre pay: reading ${file}`);
  const rows = parseCSV(file);

  // 2. derive note material from the CSV.
  const amounts = rows.map((r) => r.amount);
  const employeePubkeys = rows.map((r) => r.publicKey);
  const names = rows.map((r) => r.name);
  const blindings = rows.map((_, i) => BigInt(3000 + i));

  // Auditor keypair: generate a fresh one for this batch (persisted in keys.json).
  // A real deployment would load the auditor's published pubkey; for the demo the
  // CLI mints the pair so the auditor console can reconstruct against it.
  const auditorPriv = x25519.utils.randomSecretKey();
  const auditorPub = x25519.getPublicKey(auditorPriv);

  // 3. freeze the dual blobs ONCE (L3 — single call site, never regenerated).
  const frozen = genBatchFromCSV(amounts, employeePubkeys, auditorPub, blindings, {
    auditorPriv,
    names,
  });

  // 4. dry-run: plan only, submit nothing. Print the planned per-note lines
  //    (names + sealed markers, never amounts) and the total T, then STOP.
  if (opts.dryRun) {
    rows.forEach((row, i) => {
      console.log(`[dry-run]   note ${i + 1}: ${row.name} · sealed`);
    });
    console.log(`[dry-run] frozen blobs: ${frozen.outDir}`);
    console.log(`[dry-run] sum(payments) = ${formatUsdc(frozen.total)} USDC · would submit to ${network}`);
    console.log("[dry-run] no proof generated, no batch submitted.");
    return;
  }

  // 5. proof-gen (computes ext_data_hash from the frozen blobs first).
  //    Real deposit: ext_amount = sum(amounts), publicAmount matches on-chain.
  console.log(step("proving", rows.length));
  proofGen(OUT_DIR, network, amounts);

  // 6. submit one batch via the guarded script.
  console.log(step("submitting"));
  const { hash, seq } = submitBatch(network);

  // 7. success summary — total T only, sealed by default.
  console.log(successSummary(rows.length, frozen.total, hash, seq));
}
