/**
 * SPIKE / cross-check: ext_data_hash (RESEARCH Pattern 3)
 *
 * Computes the Sobre pool ext_data_hash in browser-equivalent JS and verifies it
 * matches, byte-for-byte, the value the contract produces. The contract path is
 * `keccak256(ExtData.to_xdr(env)) mod BN254` (pool.rs `hash_ext_data`), exercised
 * off-chain by the Rust helper `print_demo_ext_data_hash` / `print_real_batch_ext_data_hash`.
 *
 * Reference fixture (deterministic, no random blobs):
 *   ExtData { recipient: mikey, ext_amount: 0, encrypted_outputs: [8 empty Bytes] }
 *   => 0b3f2759b68a3bf239da2b7d987c95c9373c5595623ae21d334f01c123c66056
 *   (produced by `cargo test -p pool print_demo_ext_data_hash -- --nocapture --ignored`
 *    with VERIFIER_VK_JSON set to testdata/policy_tx_1_8_vk.json)
 *
 * If the browser hash diverges from the reference, this script exits 1 (CI gate):
 * a mismatch causes WrongExtHash on-chain.
 *
 * Run:
 *   node tests/spike-ext-data-hash.mjs        (from the sobrecito repo root)
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Anchor module resolution to apps/web (where @stellar/stellar-sdk and
// @noble/hashes are declared as deps). This keeps the script runnable from the
// repo root regardless of pnpm's non-hoisted layout.
const here = dirname(fileURLToPath(import.meta.url))
const webPkg = resolve(here, '../apps/web/package.json')
const require = createRequire(webPkg)

const { keccak_256 } = await import(require.resolve('@noble/hashes/sha3.js'))
const { xdr, Address, XdrLargeInt } = await import(
  require.resolve('@stellar/stellar-sdk')
)

const BN254_MOD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n

/**
 * Browser-equivalent ext_data_hash for the Sobre pool's
 * `ExtData { recipient, ext_amount, encrypted_outputs: Vec<Bytes> }`.
 *
 * Soroban `#[contracttype]` structs serialize as an ScMap with entries ordered
 * alphabetically by field name: encrypted_outputs -> ext_amount -> recipient.
 */
export function hashExtDataSobre({ recipient, ext_amount, encrypted_outputs }) {
  const entries = [
    {
      key: 'encrypted_outputs',
      val: xdr.ScVal.scvVec(
        encrypted_outputs.map((b) => xdr.ScVal.scvBytes(Buffer.from(b))),
      ),
    },
    {
      key: 'ext_amount',
      val: new XdrLargeInt('i256', ext_amount.toString()).toScVal(),
    },
    {
      key: 'recipient',
      val: Address.fromString(recipient).toScVal(),
    },
  ]
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const scEntries = entries.map(
    (e) =>
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol(e.key),
        val: e.val,
      }),
  )
  const xdrBytes = xdr.ScVal.scvMap(scEntries).toXDR()
  const digest = keccak_256(xdrBytes)
  let digestBig = 0n
  for (const byte of digest) digestBig = (digestBig << 8n) | BigInt(byte)
  const reduced = digestBig % BN254_MOD
  const hexPadded = reduced.toString(16).padStart(64, '0')
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++)
    bytes[i] = parseInt(hexPadded.slice(i * 2, i * 2 + 2), 16)
  return { bigInt: reduced, hex: hexPadded, bytes }
}

// ---------------------------------------------------------------------------
// Cross-check against the Rust contract reference (demo fixture)
// ---------------------------------------------------------------------------
const DEMO = {
  // mikey deployer (matches print_demo_ext_data_hash recipient)
  recipient: 'GBWJZZ3XSNAY3WLFNLXUZXEEYMZCYVG4TW6Z5VSASJS2TOWF7GGPPKMW',
  ext_amount: 0n, // reshield: no USDC moves, publicAmount=0
  encrypted_outputs: Array.from({ length: 8 }, () => new Uint8Array(0)), // 8 empty blobs
}

// Reference value from the Soroban contract's hash_ext_data XDR+keccak+mod path.
const REFERENCE_HEX =
  '0b3f2759b68a3bf239da2b7d987c95c9373c5595623ae21d334f01c123c66056'

const { hex } = hashExtDataSobre(DEMO)

console.log('[ext-data-hash] browser  =', hex)
console.log('[ext-data-hash] contract =', REFERENCE_HEX)

const startsWithDemoPrefix = hex.startsWith('0b3f2759')
const matches = hex === REFERENCE_HEX

if (!matches) {
  console.error(
    '[ext-data-hash] MISMATCH — browser hashExtDataSobre does not equal the contract reference.',
  )
  console.error(
    '  This would cause WrongExtHash on-chain. Check XDR field order (encrypted_outputs, ext_amount, recipient).',
  )
  process.exit(1)
}
if (!startsWithDemoPrefix) {
  console.error(
    '[ext-data-hash] demo fixture hash must start with 0b3f2759 — got',
    hex.slice(0, 8),
  )
  process.exit(1)
}

console.log(
  '[ext-data-hash] OK — browser hash matches contract reference byte-for-byte (prefix 0b3f2759).',
)
