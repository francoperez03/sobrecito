#!/usr/bin/env node
/**
 * gen-real-deposit-blobs.mjs — Generates 8 dual ECIES blobs for the real 16 USDC deposit.
 *
 * Deposit amounts (base units, 7 decimals):
 *   [100000000, 10000000, 10000000, 10000000, 10000000, 10000000, 10000000, 0]
 *   Sum = 160000000 = 16 USDC
 *
 * Reads pubkeys from ops/testnet-batch/demo-keys.json.
 * Writes ops/testnet-batch/ext_data_arg.json with ext_amount=160000000, recipient=mikey, 8 blob hexes.
 *
 * Run: node ops/scripts/gen-real-deposit-blobs.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(REPO_ROOT, "ops/testnet-batch");

// Load demo keys
const demoKeys = JSON.parse(readFileSync(resolve(OUT_DIR, "demo-keys.json"), "utf8"));

// Parse pubkeys from hex
function hexToBytes(hex) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

const auditorPub = hexToBytes(demoKeys.auditor.pubkeyHex);
const employeePubs = demoKeys.employees.map(e => hexToBytes(e.pubkeyHex));

// Deposit amounts (base units, 7 decimals) — sum = 160000000 = 16 USDC
const DEPOSIT_AMOUNTS = [100000000n, 10000000n, 10000000n, 10000000n, 10000000n, 10000000n, 10000000n, 0n];
const EXT_AMOUNT = DEPOSIT_AMOUNTS.reduce((a, b) => a + b, 0n); // 160000000

console.log(`Deposit amounts: [${DEPOSIT_AMOUNTS.join(", ")}]`);
console.log(`Total (ext_amount): ${EXT_AMOUNT}`);

// We need noble/curves for X25519 and noble/ciphers for AES-GCM
// Use dynamic import from the viewkey package's node_modules
const require = createRequire(import.meta.url);
const viewkeyDir = resolve(REPO_ROOT, "packages/viewkey");

// Import noble modules from viewkey's node_modules
const { x25519 } = await import(resolve(viewkeyDir, "node_modules/@noble/curves/ed25519.js"));
const { gcm } = await import(resolve(viewkeyDir, "node_modules/@noble/ciphers/aes.js"));
const { hkdf } = await import(resolve(viewkeyDir, "node_modules/@noble/hashes/hkdf.js"));
const { sha256 } = await import(resolve(viewkeyDir, "node_modules/@noble/hashes/sha2.js"));

const HKDF_INFO = new TextEncoder().encode("sobre-viewkey-v1");

function deriveKey(sharedSecret) {
  return hkdf(sha256, sharedSecret, undefined, HKDF_INFO, 32);
}

function encryptNote(recipientPubkey, amount, blinding) {
  const ephemeralPriv = x25519.utils.randomSecretKey();
  const ephemeralPub = x25519.getPublicKey(ephemeralPriv);
  const shared = x25519.getSharedSecret(ephemeralPriv, recipientPubkey);
  const key = deriveKey(shared);

  // Encode payload: amount(32B BE) || blinding(32B BE)
  const payload = new Uint8Array(64);
  // Write amount big-endian 32 bytes
  let v = amount;
  for (let i = 31; i >= 0; i--) {
    payload[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  // Write blinding big-endian 32 bytes
  v = blinding;
  for (let i = 31; i >= 0; i--) {
    payload[32 + i] = Number(v & 0xffn);
    v >>= 8n;
  }

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const ciphertext = gcm(key, iv).encrypt(payload);

  const blob = new Uint8Array(32 + 12 + ciphertext.length);
  blob.set(ephemeralPub, 0);
  blob.set(iv, 32);
  blob.set(ciphertext, 44);
  return blob;
}

function encodeDualBlob(employeeCt, auditorCt) {
  const blob = new Uint8Array(4 + employeeCt.length + 4 + auditorCt.length);
  let offset = 0;
  // Write employee length (4 bytes BE)
  const empLen = employeeCt.length;
  blob[offset++] = (empLen >>> 24) & 0xff;
  blob[offset++] = (empLen >>> 16) & 0xff;
  blob[offset++] = (empLen >>> 8) & 0xff;
  blob[offset++] = empLen & 0xff;
  blob.set(employeeCt, offset);
  offset += empLen;
  // Write auditor length (4 bytes BE)
  const audLen = auditorCt.length;
  blob[offset++] = (audLen >>> 24) & 0xff;
  blob[offset++] = (audLen >>> 16) & 0xff;
  blob[offset++] = (audLen >>> 8) & 0xff;
  blob[offset++] = audLen & 0xff;
  blob.set(auditorCt, offset);
  return blob;
}

// Generate 8 blobs — map notes to employees (wrap around for 4 employees across 8 notes)
// note 7 (index 7) has amount=0 but still gets a blob
const blindings = DEPOSIT_AMOUNTS.map((_, i) => BigInt(4000 + i));

const blobHexes = [];
for (let i = 0; i < 8; i++) {
  const amount = DEPOSIT_AMOUNTS[i];
  const blinding = blindings[i];
  // Map note i to employee (i % 4) — 4 employees cycle for 7 non-zero notes + 1 zero note
  const employeePub = employeePubs[i % employeePubs.length];

  const empCt = encryptNote(employeePub, amount, blinding);
  const audCt = encryptNote(auditorPub, amount, blinding);
  const dual = encodeDualBlob(empCt, audCt);
  blobHexes.push(bytesToHex(dual));
  console.log(`blob[${i}] len=${dual.length}B  ${bytesToHex(dual).slice(0, 32)}...`);
}

const MIKEY = "GBWJZZ3XSNAY3WLFNLXUZXEEYMZCYVG4TW6Z5VSASJS2TOWF7GGPPKMW";

const extDataArg = {
  recipient: MIKEY,
  ext_amount: EXT_AMOUNT.toString(),
  encrypted_outputs: blobHexes,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, "ext_data_arg.json"), JSON.stringify(extDataArg, null, 2));
// Also write blobs.json for compatibility with the Rust hash helper
writeFileSync(resolve(OUT_DIR, "blobs.json"), JSON.stringify({ count: 8, blobs: blobHexes }, null, 2));

console.log(`\nWrote ext_data_arg.json with ext_amount=${EXT_AMOUNT}`);
console.log(`Blob hexes for SOBRE_BLOBS_HEX:\n${blobHexes.join(",\n")}`);
