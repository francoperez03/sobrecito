/**
 * proofGen.ts — compute the matching ext_data_hash from the FROZEN blobs, then
 * generate a fresh Groth16 proof and write the submit inputs (Plan 06-02, L4/L5).
 *
 * Order is load-bearing (A3 soundness, trust boundary frozen blobs → proof):
 *   1. read ops/testnet-batch/blobs.json (the bytes genKeys froze, never regenerated)
 *   2. compute ext_data_hash = keccak256(XDR(ExtData)) mod BN254 by shelling out to
 *      the pool's own Rust helper `print_real_batch_ext_data_hash` with the 8 blob
 *      hexes injected via SOBRE_BLOBS_HEX (L4 — reuses the contract's XDR path so the
 *      on-chain check `hash_ext_data(submitted) == proof.ext_data_hash` holds).
 *   3. read the live pool + ASP roots via `stellar contract invoke get_root`.
 *   4. run `payroll-proof-gen --ext-data-hash <hash> --out proof.json`.
 *   5. write ext_data_arg.json carrying the REAL 8 blob hexes + the deployer
 *      recipient read from deployments.json (L5 — the proof-gen's own ext_data_arg
 *      emits empty blobs and a hardcoded recipient, so the pipeline writes the real
 *      ext_data the submit script consumes).
 *
 * Throws on any failure (caught by the CLI top-level → process.exit(1)).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ZK_DIR,
  PROOF_GEN_BIN,
  PROVING_KEY,
  circuitArtifacts,
  deploymentsJson,
} from "./paths.js";

/** The checked-in verifier VK the pool crate's build.rs needs to compile. */
const VERIFIER_VK_JSON = resolve(ZK_DIR, "testdata/policy_tx_1_8_vk.json");

interface BlobsManifest {
  count: number;
  blobs: string[];
}

interface Deployments {
  deployer: string;
  asp_membership: string;
  asp_non_membership: string;
  pools: { poolContractId: string }[];
}

function readBlobs(outDir: string): string[] {
  const manifest = JSON.parse(
    readFileSync(resolve(outDir, "blobs.json"), "utf8"),
  ) as BlobsManifest;
  if (!Array.isArray(manifest.blobs) || manifest.blobs.length !== 8) {
    throw new Error(
      `blobs.json must carry exactly 8 frozen blobs, found ${manifest.blobs?.length ?? 0}`,
    );
  }
  return manifest.blobs;
}

function readDeployments(network: string): Deployments {
  return JSON.parse(readFileSync(deploymentsJson(network), "utf8")) as Deployments;
}

/** `stellar contract invoke <id> -- get_root`, returns the decimal root string. */
function getRoot(network: string, deployer: string, contractId: string): string {
  const out = execFileSync(
    "stellar",
    [
      "contract",
      "invoke",
      "--network",
      network,
      "--source-account",
      deployer,
      "--id",
      contractId,
      "--",
      "get_root",
    ],
    { encoding: "utf8" },
  );
  return out.trim().replace(/"/g, "");
}

/**
 * Compute ext_data_hash from the frozen blobs by shelling out to the pool's Rust
 * helper. Captures the printed `ext_data_hash_hex=<hex>` line (L4).
 */
function computeExtDataHash(blobHexes: string[], extAmount: bigint): string {
  const out = execFileSync(
    "cargo",
    [
      "test",
      "-p",
      "pool",
      "print_real_batch_ext_data_hash",
      "--",
      "--nocapture",
      "--ignored",
    ],
    {
      cwd: ZK_DIR,
      encoding: "utf8",
      // SOBRE_EXT_AMOUNT binds the real deposit amount into the hashed ExtData so
      // the on-chain check hash_ext_data(submitted) == proof.ext_data_hash holds.
      env: {
        ...process.env,
        // Required by the pool crate's build.rs (circom-groth16-verifier) so the
        // `cargo test -p pool` helper compiles without external env setup.
        VERIFIER_VK_JSON,
        SOBRE_BLOBS_HEX: blobHexes.join(","),
        SOBRE_EXT_AMOUNT: extAmount.toString(),
      },
    },
  );
  const match = out.match(/ext_data_hash_hex=([0-9a-fA-F]{64})/);
  if (!match) {
    throw new Error("could not parse ext_data_hash from print_real_batch_ext_data_hash output");
  }
  return match[1];
}

export interface ProofResult {
  extDataHash: string;
  proofPath: string;
  extDataArgPath: string;
}

/**
 * Generate the proof + submit inputs from the frozen batch under `outDir`.
 *
 * @param outDir  the frozen batch dir (ops/testnet-batch), holding blobs.json
 * @param network stellar network for the live root reads (default "testnet")
 */
export function proofGen(outDir: string, network = "testnet", amounts: bigint[] = [], outBlindings: bigint[] = []): ProofResult {
  // 1. frozen blobs (never regenerated here — L3/Pitfall 1).
  const blobHexes = readBlobs(outDir);

  if (amounts.length !== 8) {
    throw new Error(`proofGen needs exactly 8 deposit amounts, got ${amounts.length}`);
  }
  // Real deposit: ext_amount = sum of the 8 base-unit amounts (USDC, 7 decimals).
  const extAmount = amounts.reduce((a, b) => a + b, 0n);

  // 2. ext_data_hash bound to those exact bytes AND the deposit amount (L4).
  const extDataHash = computeExtDataHash(blobHexes, extAmount);

  // 3. live roots (pool + ASP) for the proof public inputs.
  const deployments = readDeployments(network);
  const deployer = deployments.deployer;
  const poolId = deployments.pools[0].poolContractId;
  const poolRoot = getRoot(network, deployer, poolId);
  const aspMemberRoot = getRoot(network, deployer, deployments.asp_membership);
  const aspNonMemberRoot = getRoot(network, deployer, deployments.asp_non_membership);

  // 4. fresh proof with the matching ext_data_hash.
  const { wasm, r1cs } = circuitArtifacts();
  const proofPath = resolve(outDir, "proof.json");
  execFileSync(
    PROOF_GEN_BIN,
    [
      "--wasm",
      wasm,
      "--r1cs",
      r1cs,
      "--pk",
      PROVING_KEY,
      "--pool-root",
      poolRoot,
      "--asp-member-root",
      aspMemberRoot,
      "--asp-non-member-root",
      aspNonMemberRoot,
      "--ext-data-hash",
      extDataHash,
      "--deposit-amounts",
      amounts.map((a) => a.toString()).join(","),
      // Fresh blinding seed → unique dummy-input nullifier per batch, so a second
      // real deposit does not revert with AlreadySpentNullifier (pool Error #9).
      "--blinding",
      (Date.now() % 2_000_000_000).toString(),
      // When outBlindings is provided, forward to Rust so the on-chain commitment
      // blinding matches the blob payload blinding (Pitfall 2: both must be equal).
      ...(outBlindings.length === 8
        ? ["--out-blindings", outBlindings.map((b) => b.toString()).join(",")]
        : []),
      "--out",
      proofPath,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );

  // 5. the REAL ext_data the submit script consumes: 8 frozen blob hexes +
  //    deployer recipient (L5 — overrides the empty/hardcoded ext_data_arg
  //    that proof-gen emits).
  const extDataArgPath = resolve(outDir, "ext_data_arg.json");
  writeFileSync(
    extDataArgPath,
    JSON.stringify(
      {
        recipient: deployer,
        ext_amount: extAmount.toString(),
        encrypted_outputs: blobHexes,
      },
      null,
      2,
    ),
  );

  return { extDataHash, proofPath, extDataArgPath };
}
