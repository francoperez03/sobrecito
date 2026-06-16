/**
 * reconstruct-testnet.ts — Nivel A, step 6 (the checkpoint).
 *
 * Runs the AUDITOR reconstruction against the REAL deployed pool on Stellar
 * testnet. It scans the pool's `NewCommitmentEvent`s over the ledger range of the
 * live batch (the transact submitted in step 5), decrypts the auditor half of each
 * dual blob with the auditor X25519 private key, prints the per-note breakdown, and
 * asserts the sum reconciles to T = 800.
 *
 * The amounts are shielded BN254 field values, NOT real USDC; the transact moved
 * ext_amount = 0 (no USDC). This is the soundness story: the auditor derives T from
 * ciphertext it can open, never trusting an employer-supplied breakdown.
 *
 * Inputs:
 *   - ops/testnet-batch/keys.json : auditor PRIVATE key (gitignored secret).
 *   - the live batch ledger range (env LIVE_BATCH_LEDGER, default below).
 *
 * Run:
 *   node --import ./packages/viewkey/scripts/register.mjs \
 *     packages/viewkey/scripts/reconstruct-testnet.ts
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reconstructBatch } from "../src/reconstructor/batchReconstructor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_PATH = resolve(__dirname, "../../../ops/testnet-batch/keys.json");

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const POOL_ID =
  process.env.POOL_ID ?? "CDHJ6W5ZCK7STNED7AT7SKCURQDFVCFJL6ZBF6XW7QMPOIBKHAOLCVL2";

/** Ledger the live dual-blob transact landed in (step 5). Override via env. */
const LIVE_BATCH_LEDGER = Number(process.env.LIVE_BATCH_LEDGER ?? 3110571);
/** Scan a small window so RPC retention is respected and only this batch matches. */
const SCAN_FROM = Number(process.env.SCAN_FROM ?? LIVE_BATCH_LEDGER - 1);
const SCAN_TO = Number(process.env.SCAN_TO ?? LIVE_BATCH_LEDGER + 1);

const T = 800n;

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function main(): Promise<void> {
  const keys = JSON.parse(readFileSync(KEYS_PATH, "utf8"));
  const auditorPrivkey = hexToBytes(keys.auditor.priv);

  console.log("=== Auditor reconstruction from Stellar testnet (LIVE) ===");
  console.log(`Pool:        ${POOL_ID}`);
  console.log(`RPC:         ${RPC_URL}`);
  console.log(`Ledger range: [${SCAN_FROM}, ${SCAN_TO}] (batch landed @ ${LIVE_BATCH_LEDGER})`);
  console.log("");

  // Scan the chain + decrypt the auditor halves. The blobs from THIS batch
  // (indices 8..15) decrypt; the empty blobs from the prior batch (indices 0..7)
  // are not in this ledger window, so the reconstruction sees only this batch.
  const summary = await reconstructBatch({
    auditorPrivkey,
    source: {
      rpcUrl: RPC_URL,
      poolContractId: POOL_ID,
      fromLedger: SCAN_FROM,
      toLedger: SCAN_TO,
    },
    poolAddress: POOL_ID,
    // Period start is metadata for the extContextHash binding; not load-bearing
    // for the amount reconciliation. Use the batch ledger's wall clock proxy.
    periodStart: LIVE_BATCH_LEDGER,
  });

  console.log("Per-note breakdown (decrypted auditor halves, from chain):");
  const sorted = [...summary.notes].sort((a, b) => a.index - b.index);
  for (const note of sorted) {
    console.log(
      `  index=${note.index}  amount=${note.amount}  blinding=${note.blinding}  commitment=${note.commitment}`,
    );
  }
  console.log("");
  console.log(`Notes decrypted: ${summary.notes.length}`);
  console.log(`Sum of amounts:  ${summary.total}`);
  console.log(`Declared total T: ${T}`);

  if (summary.notes.length === 0) {
    throw new Error(
      "reconstruct-testnet: scanned 0 events in range — RPC retention window may have rolled past the batch ledger, or the range is wrong",
    );
  }
  if (summary.total !== T) {
    throw new Error(
      `reconstruct-testnet: reconciliation FAILED — sum ${summary.total} !== T ${T}`,
    );
  }

  console.log("");
  console.log(`ASSERTION PASSED: sum(decrypted amounts) === T (${T}). Reconciled.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
