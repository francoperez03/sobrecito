/**
 * parseCSV.ts — turn `nomina.csv` into typed payroll rows (Plan 06-02, D-01/D-05).
 *
 * Columns are exactly `name, amount, public_key`. Hard constraints, all enforced
 * before any crypto runs (the CSV is an untrusted file shape, trust boundary
 * CSV → CLI):
 *   - exactly 8 data rows (D-05: the circuit `policy_tx_1_8` is fixed at 8 outputs)
 *   - `amount` is a non-negative integer → BigInt (shielded field value, not USDC)
 *   - `public_key` is 64 hex chars → Uint8Array(32) (X25519 employee key)
 *
 * The `name` column is display-only. It is NEVER passed to a shell or to
 * execFileSync args (CSV-injection mitigation T-06-04).
 *
 * On any validation failure this throws a single Error whose message carries the
 * UI-SPEC expected-columns copy, so the CLI's top-level catch renders the
 * `[ERROR] could not parse {file} — expected columns: name, amount, public_key`
 * line and exits non-zero.
 */
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

/** One validated payroll row. `amount` is a BN254 field value, not real USDC. */
export interface PayrollRow {
  /** Display-only label. Never reaches a shell (T-06-04). */
  name: string;
  /** Shielded note amount as a bigint. */
  amount: bigint;
  /** Employee X25519 encryption public key (raw 32 bytes). */
  publicKey: Uint8Array;
}

const REQUIRED_COLUMNS = ["name", "amount", "public_key"] as const;
const EXPECTED_ROWS = 8;

function parseFailure(file: string): Error {
  return new Error(
    `could not parse ${file} — expected columns: name, amount, public_key`,
  );
}

function isHex64(s: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(s);
}

function hexToBytes32(hex: string): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Parse and validate a payroll CSV. Returns exactly 8 typed rows or throws the
 * single expected-columns Error on any shape/value violation.
 */
export function parseCSV(file: string): PayrollRow[] {
  let records: Record<string, string>[];
  try {
    const content = readFileSync(file, "utf8");
    records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];
  } catch {
    // Unreadable file or malformed CSV both render as the parse error.
    throw parseFailure(file);
  }

  // Column shape: header must be exactly the three required columns.
  const header = records.length > 0 ? Object.keys(records[0]) : [];
  const columnsOk =
    header.length === REQUIRED_COLUMNS.length &&
    REQUIRED_COLUMNS.every((c) => header.includes(c));
  if (!columnsOk) {
    throw parseFailure(file);
  }

  // Row count: exactly 8 (D-05, A3 count binding).
  if (records.length !== EXPECTED_ROWS) {
    throw parseFailure(file);
  }

  return records.map((row) => {
    const name = row.name;
    const amountRaw = row.amount;
    const keyRaw = row.public_key;

    // amount must be a non-negative integer.
    if (typeof amountRaw !== "string" || !/^\d+$/.test(amountRaw)) {
      throw parseFailure(file);
    }
    let amount: bigint;
    try {
      amount = BigInt(amountRaw);
    } catch {
      throw parseFailure(file);
    }

    // public_key must be 64 hex chars → 32 bytes.
    if (typeof keyRaw !== "string" || !isHex64(keyRaw)) {
      throw parseFailure(file);
    }

    return {
      name: typeof name === "string" ? name : "",
      amount,
      publicKey: hexToBytes32(keyRaw),
    } satisfies PayrollRow;
  });
}
