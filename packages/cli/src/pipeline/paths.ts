/**
 * paths.ts — resolve the worktree-root anchored paths the pipeline needs.
 *
 * The CLI ships compiled to `packages/cli/dist/`, so a pipeline module at
 * `packages/cli/dist/pipeline/foo.js` is four levels below the worktree root:
 *   dist/pipeline → dist → cli → packages → <root>
 *
 * Everything the live `sobre pay` chain touches (frozen blobs, the proof-gen
 * binary, circuit artifacts, the submit script, deployments.json) is resolved
 * from that root so the CLI behaves identically regardless of cwd.
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Worktree root: packages/cli/dist/pipeline → up four. */
export const REPO_ROOT = resolve(__dirname, "../../../..");

/** Gitignored batch manifest dir (keys.json, blobs.json, proof.json, ext_data_arg.json). */
export const OUT_DIR = resolve(REPO_ROOT, "ops/testnet-batch");

export const ZK_DIR = resolve(REPO_ROOT, "packages/zk");
export const PROOF_GEN_BIN = resolve(ZK_DIR, "target/debug/payroll-proof-gen");
export const PROVING_KEY = resolve(ZK_DIR, "testdata/policy_tx_1_8_proving_key.bin");
export const SUBMIT_SCRIPT = resolve(REPO_ROOT, "ops/scripts/submit-real-batch.sh");

export function deploymentsJson(network: string): string {
  return resolve(REPO_ROOT, `ops/deployments/${network}/deployments.json`);
}

/**
 * Locate the circuit WASM + R1CS under the cargo build dir. The artifacts live
 * at `packages/zk/target/debug/build/circuits-<hash>/out/circuits/...`; the hash
 * is non-deterministic, so glob the `circuits-*` dirs and pick the one whose
 * WASM actually exists (matches smoke-test.sh STEP 4).
 */
export function circuitArtifacts(): { wasm: string; r1cs: string } {
  const buildDir = resolve(ZK_DIR, "target/debug/build");
  if (!existsSync(buildDir)) {
    throw new Error(
      `circuit build dir not found: ${buildDir} — run \`pnpm zk:setup\` (cargo build -p circuits) first`,
    );
  }
  let wasm = "";
  let r1cs = "";
  for (const entry of readdirSync(buildDir)) {
    if (!entry.startsWith("circuits-")) continue;
    const outDir = resolve(buildDir, entry, "out/circuits");
    const candidateWasm = resolve(outDir, "wasm/policy_tx_1_8_js/policy_tx_1_8.wasm");
    const candidateR1cs = resolve(outDir, "policy_tx_1_8.r1cs");
    if (existsSync(candidateWasm) && existsSync(candidateR1cs)) {
      wasm = candidateWasm;
      r1cs = candidateR1cs;
    }
  }
  if (!wasm || !r1cs) {
    throw new Error(
      "circuit artifacts (policy_tx_1_8.wasm / .r1cs) not found — run `pnpm zk:setup`",
    );
  }
  return { wasm, r1cs };
}
