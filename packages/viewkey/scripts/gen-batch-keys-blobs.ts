/**
 * gen-batch-keys-blobs.ts — Nivel A, step 1+2.
 *
 * Generates the keys and the 8 dual ECIES blobs for ONE live payroll batch, then
 * persists them so the SAME bytes are hashed, proven (the sobre_slim browser prover),
 * and submitted (pool.transact). Because encryptNote uses a random ephemeral key +
 * IV, the blobs are non-deterministic: they must be generated once and frozen.
 *
 * Outputs (under ops/testnet-batch/, gitignored):
 *   - keys.json  : auditor PRIVATE + PUBLIC key, 8 employee PRIVATE + PUBLIC keys.
 *   - blobs.json : the 8 dual-blob hexes (employee_ct || auditor_ct, length-prefixed).
 *
 * No secret material is ever committed (ops/testnet-batch/ is gitignored).
 *
 * Run: node packages/viewkey/scripts/gen-batch-keys-blobs.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { x25519 } from "@noble/curves/ed25519.js";
import { encryptNote } from "../src/crypto/ecies.js";
import { buildEncryptedOutputs } from "../src/crypto/encoding.js";
import type { EncryptedBlob, NotePayload } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../../../ops/testnet-batch");

/** Shielded payroll: BN254 field values, NOT real USDC. Sum = T = 800. */
const SALARIES = [50n, 80n, 120n, 60n, 200n, 90n, 110n, 90n];

/**
 * Fixed per-note blinding factors. These are cleartext payload material the
 * auditor recovers; they are independent of the circuit witness (the proof uses
 * its own fixed out-blinding 2000+i). The auditor only needs amount to reconcile T.
 */
const BLINDINGS = SALARIES.map((_, i) => BigInt(3000 + i));

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });

  // Auditor keypair.
  const auditorPriv = x25519.utils.randomSecretKey();
  const auditorPub = x25519.getPublicKey(auditorPriv);

  // 8 employee keypairs.
  const employees = SALARIES.map(() => {
    const priv = x25519.utils.randomSecretKey();
    return { priv, pub: x25519.getPublicKey(priv) };
  });

  // Build the 8 dual blobs: each note encrypted to (employee[i], auditor).
  const blobs: EncryptedBlob[] = SALARIES.map((amount, i) => {
    const payload: NotePayload = { amount, blinding: BLINDINGS[i] };
    return {
      employeeCiphertext: encryptNote(employees[i].pub, payload),
      auditorCiphertext: encryptNote(auditorPub, payload),
    };
  });

  // Frozen dual-blob bytes (the exact bytes that will be hashed, proven, submitted).
  const dualBlobs = buildEncryptedOutputs(blobs);
  const blobHexes = dualBlobs.map(toHex);

  const keysOut = {
    note: "SECRET — auditor private key + employee keys. Never commit. X25519 raw 32-byte hex.",
    salaries: SALARIES.map((s) => s.toString()),
    blindings: BLINDINGS.map((b) => b.toString()),
    total: SALARIES.reduce((a, b) => a + b, 0n).toString(),
    auditor: { priv: toHex(auditorPriv), pub: toHex(auditorPub) },
    employees: employees.map((e, i) => ({
      index: i,
      priv: toHex(e.priv),
      pub: toHex(e.pub),
    })),
  };

  const blobsOut = {
    note: "Frozen dual-blob hexes for the live batch. layout per blob: [4B emp_len][emp_ct][4B aud_len][aud_ct].",
    count: blobHexes.length,
    blobs: blobHexes,
  };

  writeFileSync(resolve(OUT_DIR, "keys.json"), JSON.stringify(keysOut, null, 2));
  writeFileSync(resolve(OUT_DIR, "blobs.json"), JSON.stringify(blobsOut, null, 2));

  console.log(`Wrote ${OUT_DIR}/keys.json and blobs.json`);
  console.log(`Auditor pubkey:  ${keysOut.auditor.pub}`);
  console.log(`Total (T):       ${keysOut.total}`);
  blobHexes.forEach((h, i) =>
    console.log(`blob[${i}] len=${h.length / 2}B  ${h.slice(0, 32)}...`),
  );
}

main();
