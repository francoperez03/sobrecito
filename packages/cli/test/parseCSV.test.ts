/**
 * parseCSV + output formatting unit tests (Plan 06-02, Task 1).
 *
 * Run: node --test packages/cli/test/parseCSV.test.ts  (after `pnpm --filter @sobre/cli build`).
 * The test imports the built dist modules so it exercises the same code the CLI ships.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { parseCSV } from "../dist/pipeline/parseCSV.js";
import { step, errorLine, warnLine } from "../dist/output.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// test/ lives at packages/cli/test → demo.csv is at ops/fixtures relative to the worktree root.
const DEMO_CSV = resolve(__dirname, "../../../ops/fixtures/demo.csv");

function tmpCsv(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sobre-csv-"));
  const file = join(dir, "nomina.csv");
  writeFileSync(file, content);
  return file;
}

const HEADER = "name,amount,public_key";
const KEY = "cfd57402fdb5ac83b2cbf295a5244955a231eb0de7fbf66aa159814cb995ac56";

function rows(n: number): string {
  const lines = [HEADER];
  for (let i = 0; i < n; i++) lines.push(`Emp${i},${10 * (i + 1)},${KEY}`);
  return lines.join("\n") + "\n";
}

test("parseCSV parses the 8-row demo.csv into 8 typed rows", () => {
  const parsed = parseCSV(DEMO_CSV);
  assert.equal(parsed.length, 8);
  for (const row of parsed) {
    assert.equal(typeof row.name, "string");
    assert.equal(typeof row.amount, "bigint");
    assert.ok(row.publicKey instanceof Uint8Array);
    assert.equal(row.publicKey.length, 32);
  }
  // Demo amounts are real USDC decimals summing to T = 1 USDC = 10_000_000 base units.
  const total = parsed.reduce((acc, r) => acc + r.amount, 0n);
  assert.equal(total, 10_000_000n);
});

test("parseCSV converts USDC decimals to base units (0.0625 → 625000)", () => {
  const parsed = parseCSV(DEMO_CSV);
  assert.equal(parsed[0].amount, 625000n); // Ana 0.0625 USDC
  assert.equal(parsed[1].amount, 1_000_000n); // Bruno 0.10 USDC
});

test("parseCSV throws on a 7-row CSV (not-8 rows → non-zero exit)", () => {
  const file = tmpCsv(rows(7));
  assert.throws(() => parseCSV(file), /expected columns: name, amount, public_key/);
});

test("parseCSV throws when the public_key column is missing", () => {
  const file = tmpCsv("name,amount\n" + Array.from({ length: 8 }, (_, i) => `Emp${i},${10 * (i + 1)}`).join("\n") + "\n");
  assert.throws(() => parseCSV(file), /expected columns: name, amount, public_key/);
});

test("parseCSV rejects a public_key that is not 64 hex chars", () => {
  const bad = HEADER + "\n" + Array.from({ length: 8 }, (_, i) => `Emp${i},${10 * (i + 1)},deadbeef`).join("\n") + "\n";
  const file = tmpCsv(bad);
  assert.throws(() => parseCSV(file), /expected columns: name, amount, public_key/);
});

test("parseCSV rejects an amount with more than 7 decimals", () => {
  const bad = HEADER + "\n" + Array.from({ length: 8 }, (_, i) => `Emp${i},${i === 0 ? "0.12345678" : 10 * (i + 1)},${KEY}`).join("\n") + "\n";
  const file = tmpCsv(bad);
  assert.throws(() => parseCSV(file), /expected columns: name, amount, public_key/);
});

test("output.step('proving', 8) renders the exact UI-SPEC line", () => {
  assert.equal(step("proving", 8), "· generating proof for 8 notes…");
});

test("output.step('submitting') renders the exact UI-SPEC line", () => {
  assert.equal(step("submitting"), "· submitting batch to pool…");
});

test("output.errorLine maps to the [ERROR] problem — next format", () => {
  assert.equal(
    errorLine("could not parse nomina.csv", "check input and retry"),
    "[ERROR] could not parse nomina.csv — check input and retry",
  );
});

test("output.warnLine maps to the [WARN] unshielding format", () => {
  assert.equal(
    warnLine("50", "GABC"),
    "[WARN] unshielding reveals 50 USDC on-chain for address GABC",
  );
});
