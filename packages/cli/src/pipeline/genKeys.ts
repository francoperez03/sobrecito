/**
 * genKeys.ts — freeze the dual ECIES blobs for ONE payroll batch (Plan 06-02, D-01).
 *
 * CSV-driven generalization of `packages/viewkey/scripts/gen-batch-keys-blobs.ts`:
 * the salaries and employee pubkeys come from the parsed CSV instead of a hardcoded
 * const. For each note it builds the two ciphertexts (employee + auditor) via the
 * viewkey ECIES core, then `buildEncryptedOutputs` lays them into the on-chain
 * blob layout `[4B emp_len][emp_ct][4B aud_len][aud_ct]`.
 *
 * L3 (Pitfall 1) CRITICAL: `encryptNote` uses a random ephemeral key + IV, so the
 * blobs are NON-DETERMINISTIC. This function must be called exactly once per
 * pipeline run, and the bytes it writes to `blobs.json` are the bytes that are
 * hashed (ext_data_hash), proven, and submitted. Never regenerate after this.
 *
 * Writes only under the gitignored `ops/testnet-batch/` (T-06-08): keys.json holds
 * the auditor private key, so it must never land in src/ or apps/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { encryptNote, buildEncryptedOutputs } from "viewkey";
import type { EncryptedBlob } from "viewkey";
import { OUT_DIR } from "./paths.js";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface FrozenBatch {
  /** The 8 frozen dual-blob hexes (the exact bytes hashed, proven, submitted). */
  blobHexes: string[];
  /** Declared total T = sum of amounts. */
  total: bigint;
  /** Auditor X25519 public key hex (for logging / dashboards). */
  auditorPubHex: string;
  /** Where the manifest was written. */
  outDir: string;
}

/**
 * Freeze the dual blobs + key manifest for one batch.
 *
 * @param amounts          per-note shielded amounts (BN254 field values, not USDC)
 * @param employeePubkeys  per-note employee X25519 pubkeys (32 bytes each)
 * @param auditorPub       auditor X25519 public key (32 bytes)
 * @param blindings        per-note blinding factors (cleartext payload material)
 * @param employeePrivs    optional per-note employee privkeys to persist (demo keypairs)
 * @param auditorPriv      optional auditor private key to persist (demo)
 */
export function genBatchFromCSV(
  amounts: bigint[],
  employeePubkeys: Uint8Array[],
  auditorPub: Uint8Array,
  blindings: bigint[],
  opts: { employeePrivs?: Uint8Array[]; auditorPriv?: Uint8Array; names?: string[] } = {},
): FrozenBatch {
  if (amounts.length !== employeePubkeys.length || amounts.length !== blindings.length) {
    throw new Error("genBatchFromCSV: amounts, employeePubkeys and blindings must be equal length");
  }

  mkdirSync(OUT_DIR, { recursive: true });

  // Build the dual blobs: each note encrypted to (employee[i], auditor).
  // L3: encryptNote is non-deterministic — this is the single call site per run.
  const blobs: EncryptedBlob[] = amounts.map((amount, i) => {
    const payload = { amount, blinding: blindings[i] };
    return {
      employeeCiphertext: encryptNote(employeePubkeys[i], payload),
      auditorCiphertext: encryptNote(auditorPub, payload),
    };
  });

  const dualBlobs = buildEncryptedOutputs(blobs);
  const blobHexes = dualBlobs.map(toHex);

  const total = amounts.reduce((a, b) => a + b, 0n);
  const auditorPubHex = toHex(auditorPub);

  const keysOut = {
    note: "SECRET — auditor private key + employee keys. Never commit. X25519 raw 32-byte hex.",
    salaries: amounts.map((s) => s.toString()),
    blindings: blindings.map((b) => b.toString()),
    total: total.toString(),
    auditor: {
      priv: opts.auditorPriv ? toHex(opts.auditorPriv) : null,
      pub: auditorPubHex,
    },
    employees: employeePubkeys.map((pub, i) => ({
      index: i,
      name: opts.names?.[i] ?? null,
      priv: opts.employeePrivs?.[i] ? toHex(opts.employeePrivs[i]) : null,
      pub: toHex(pub),
    })),
  };

  const blobsOut = {
    note: "Frozen dual-blob hexes for the live batch. layout per blob: [4B emp_len][emp_ct][4B aud_len][aud_ct].",
    count: blobHexes.length,
    blobs: blobHexes,
  };

  writeFileSync(resolve(OUT_DIR, "keys.json"), JSON.stringify(keysOut, null, 2));
  writeFileSync(resolve(OUT_DIR, "blobs.json"), JSON.stringify(blobsOut, null, 2));

  return { blobHexes, total, auditorPubHex, outDir: OUT_DIR };
}
