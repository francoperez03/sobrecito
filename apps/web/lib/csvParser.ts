/**
 * csvParser.ts — browser-safe port of packages/cli/src/pipeline/parseCSV.ts.
 *
 * Accepts a string (from FileReader.readAsText or a <textarea>) and returns
 * typed PayrollRow[]. Columns: name, amount, public_key.
 *
 * Key differences from the Node CLI version:
 *   - No readFileSync, no csv-parse/sync (both Node-only).
 *   - No hard 8-row limit: the UI enforces the note budget via decompose().
 *   - name is display-only; NEVER passed to shell/SQL/eval (T-06.2-05).
 *
 * BigInt literals use BigInt() calls, not 0n/1n syntax, for ES2017 compat.
 */

/** USDC has 7 decimals on Stellar (the SAC). 1 USDC = 10_000_000 base units. */
export const USDC_DECIMALS = 7
export const USDC_SCALE = BigInt(10) ** BigInt(USDC_DECIMALS)

/** One validated payroll row. `amount` is in USDC base units (7 decimals). */
export interface PayrollRow {
  /** Display-only label. Never reaches a shell (T-06.2-05). */
  name: string
  /** Shielded note amount in USDC base units (10_000_000 = 1 USDC). */
  amount: bigint
  /** Employee X25519 encryption public key (raw 32 bytes). */
  publicKey: Uint8Array
}

/**
 * Convert a human USDC string ("1", "0.0625", up to 7 decimals) to base units.
 * Uses string math so there is no float rounding on money.
 */
export function usdcToBaseUnits(s: string): bigint {
  const [intPart, fracRaw = ''] = s.split('.')
  const frac = (fracRaw + '0'.repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS)
  return BigInt(intPart) * USDC_SCALE + BigInt(frac)
}

/** Returns true if s is exactly 64 lowercase or uppercase hex characters. */
export function isHex64(s: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(s)
}

/** Decode a 64-char hex string into a 32-byte Uint8Array. */
function hexToBytes32(hex: string): Uint8Array {
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/**
 * Parse a simple quoted-CSV field. Handles double-quoted fields with embedded
 * commas. Trims unquoted fields.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let i = 0
  while (i <= line.length) {
    if (line[i] === '"') {
      // quoted field
      let j = i + 1
      while (j < line.length && !(line[j] === '"' && line[j + 1] !== '"')) {
        if (line[j] === '"' && line[j + 1] === '"') j++ // escaped quote
        j++
      }
      fields.push(line.slice(i + 1, j).replace(/""/g, '"'))
      i = j + 1
      // skip comma after closing quote
      if (line[i] === ',') i++
    } else {
      const end = line.indexOf(',', i)
      if (end === -1) {
        fields.push(line.slice(i).trim())
        break
      }
      fields.push(line.slice(i, end).trim())
      i = end + 1
    }
  }
  return fields
}

/**
 * Parse and validate payroll CSV text. Returns a PayrollRow[] or throws on
 * any shape/value violation.
 *
 * Accepts an optional header row (name,amount,public_key). Skips blank lines.
 * Does NOT enforce an 8-row limit; that's the denomination builder's job.
 */
export function parseCsvText(text: string): PayrollRow[] {
  const rawLines = text.split('\n')
  const lines = rawLines.map((l) => l.trim()).filter((l) => l.length > 0)

  if (lines.length === 0) {
    throw new Error('CSV is empty')
  }

  // Strip optional header row
  let dataLines = lines
  const firstFields = parseCsvLine(lines[0])
  const looksLikeHeader =
    firstFields.length >= 3 &&
    firstFields[0].toLowerCase() === 'name' &&
    firstFields[1].toLowerCase() === 'amount' &&
    firstFields[2].toLowerCase() === 'public_key'
  if (looksLikeHeader) {
    dataLines = lines.slice(1)
  }

  if (dataLines.length === 0) {
    throw new Error('CSV contains no data rows')
  }

  return dataLines.map((line, idx) => {
    const fields = parseCsvLine(line)
    if (fields.length < 3) {
      throw new Error(`Row ${idx + 1}: expected 3 columns, got ${fields.length}`)
    }

    const name = fields[0]
    const amountRaw = fields[1]
    const keyRaw = fields[2]

    // amount: non-negative USDC value with up to 7 decimal places
    if (!/^\d+(\.\d{1,7})?$/.test(amountRaw)) {
      throw new Error(
        `Row ${idx + 1}: invalid amount "${amountRaw}" — expected a non-negative number with up to 7 decimal places`,
      )
    }
    let amount: bigint
    try {
      amount = usdcToBaseUnits(amountRaw)
    } catch {
      throw new Error(`Row ${idx + 1}: could not convert amount "${amountRaw}" to base units`)
    }

    // public_key: exactly 64 hex chars → 32 bytes
    if (!isHex64(keyRaw)) {
      throw new Error(
        `Row ${idx + 1}: invalid public_key "${keyRaw.slice(0, 8)}…" — expected 64 hex characters`,
      )
    }

    return {
      name: typeof name === 'string' ? name : '',
      amount,
      publicKey: hexToBytes32(keyRaw),
    } satisfies PayrollRow
  })
}
