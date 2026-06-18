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
import { readFileSync } from "node:fs";
import { parseCSV } from "../pipeline/parseCSV.js";
import { genBatchFromCSV } from "../pipeline/genKeys.js";
import { proofGen } from "../pipeline/proofGen.js";
import { submitBatch } from "../pipeline/submit.js";
import { OUT_DIR, deploymentsJson } from "../pipeline/paths.js";
import { step, successSummary, formatUsdc, HONEST_DISCLOSURE } from "../output.js";

export interface PayOptions {
  dryRun?: boolean;
  verbose?: boolean;
  network?: string;
}

/** Convert a 64-char hex string to a 32-byte Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Load the auditor public key from deployments.json for the given network.
 * Throws clearly when the key is missing, all zeros, or not valid 64-char hex.
 * The CLI never mints or holds the auditor private key: the auditor publishes
 * its pubkey and keeps the private key outside the CLI.
 */
function loadAuditorPubkey(network: string): Uint8Array {
  const path = deploymentsJson(network);
  const deployments = JSON.parse(readFileSync(path, "utf8")) as {
    auditorPubkeyHex?: string;
  };
  const hex = deployments.auditorPubkeyHex ?? "";

  if (!hex || /^0+$/.test(hex)) {
    throw new Error(
      `auditorPubkeyHex is missing or all zeros in ${path}. ` +
        "Run the Phase 06.1 auditor keygen and set auditorPubkeyHex in deployments.json before paying.",
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      `auditorPubkeyHex in ${path} must be exactly 64 hex characters (32 bytes), got: "${hex}"`,
    );
  }
  return hexToBytes(hex);
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

  // Auditor pubkey: loaded from deployments.json for the target network.
  // The auditor publishes its pubkey; the CLI encrypts to it and never holds
  // or mints the auditor private key.
  const auditorPub = loadAuditorPubkey(network);

  // 3. freeze the dual blobs ONCE (L3 — single call site, never regenerated).
  const frozen = genBatchFromCSV(amounts, employeePubkeys, auditorPub, blindings, {
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
