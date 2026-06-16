/**
 * submit.ts — submit the frozen batch via the guarded shell script (Plan 06-02).
 *
 * Thin wrapper over `ops/scripts/submit-real-batch.sh`, which reads
 * ops/testnet-batch/{proof.json, ext_data_arg.json}, ENFORCES exactly 8 non-empty
 * encrypted_outputs (A3 count binding, T-06-06), and runs the real `pool.transact`.
 * The CLI never reimplements that guard; it shells out so the on-chain submission
 * has a single audited path.
 *
 * Returns the tx hash + ledger sequence parsed from the script's stdout.
 * Throws on failure (caught by the CLI top-level → process.exit(1)).
 */
import { execFileSync } from "node:child_process";
import { REPO_ROOT, SUBMIT_SCRIPT } from "./paths.js";

export interface SubmitResult {
  hash: string;
  seq: string;
}

/**
 * Run submit-real-batch.sh for the given network and capture the result.
 *
 * The script prints diagnostics to stderr and the bare tx hash as its last stdout
 * line. The ledger sequence is surfaced by the script as `index: <n>` on stderr;
 * when present we capture it, otherwise it is left blank for the caller to fill
 * from an explorer lookup.
 */
export function submitBatch(network = "testnet"): SubmitResult {
  const stdout = execFileSync("bash", [SUBMIT_SCRIPT, network], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  // The script echoes the tx hash as the final non-empty stdout line.
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const hash = lines.length > 0 ? lines[lines.length - 1] : "";

  // Ledger sequence, if the script surfaced one (`index: <n>` / `ledger: <n>`).
  const seqMatch = stdout.match(/(?:ledger|index)[:\s]+(\d+)/i);
  const seq = seqMatch ? seqMatch[1] : "";

  if (!hash) {
    throw new Error("submit-real-batch.sh returned no tx hash");
  }

  return { hash, seq };
}
