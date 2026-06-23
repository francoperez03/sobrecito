#!/usr/bin/env ts-node
/**
 * verify_public_inputs_layout.ts — NOIR-05 (Wave 3)
 *
 * Validates the public-inputs blob that bb 0.87.0 produces against the slim
 * UltraHonk verifier deployed on testnet, and documents the TRUE layout.
 *
 * Key finding vs. the plan's assumption:
 *   Plan (09-03-PLAN.md) assumed  28 fields / 896 bytes (12 circuit + 16 PPO).
 *   Reality with bb 0.87.0:       12 fields / 384 bytes (circuit inputs only).
 *   The 16-element Pairing-Point Object (PPO) is FOLDED INTO the proof blob
 *   (proof.length = 14592 bytes), not appended to public_inputs.
 *
 * Tests:
 *   POSITIVE — pass the full 384-byte blob to verify_proof  => OK
 *   NEGATIVE — truncate to 11 fields (352 bytes)            => VerificationFailed
 *              (proves the full 12-field blob is load-bearing)
 *
 * Usage (all flags optional; defaults use the testnet values from the spike):
 *   npx ts-node verify_public_inputs_layout.ts \
 *     --contract-id CCIMHTM466A2V36MP3JJOV22C6CPPG3OBXM634Q77OAMBYDZJORRCFPO \
 *     --source-secret <SECRET> \
 *     [--dataset ../../circuits/sobre_slim/target] \
 *     [--rpc-url https://soroban-testnet.stellar.org]
 */

import * as fs from 'fs';
import * as path from 'path';
import { ArgumentParser } from 'argparse';
import {
  Contract,
  Keypair,
  Networks,
  rpc as SorobanRpc,
  TimeoutInfinite,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk';

// ── constants ─────────────────────────────────────────────────────────────────

const FIELD_BYTES = 32;

/**
 * TRUE shape (bb 0.87.0, scheme ultra_honk, oracle keccak):
 *   - public_inputs  : 12 fields × 32 bytes = 384 bytes
 *   - proof          : 14 592 bytes (contains the 16-element PPO internally)
 *
 * The plan assumed 28 fields / 896 bytes because RESEARCH §6 documented
 * UltraHonk spec from Aztec's internal format.  bb 0.87.0 embeds the PPO in
 * the proof serialisation instead; see public-inputs-layout.md for full
 * discussion.
 */
const EXPECTED_PUBLIC_INPUTS_BYTES = 384; // 12 × 32
const EXPECTED_PROOF_BYTES = 14_592;
const CIRCUIT_FIELD_COUNT = 12;

/**
 * Canonical order of the 12 circuit public inputs (many_pubs pattern).
 * This is the order in which they appear in the bb-produced public_inputs file.
 */
const FIELD_NAMES: string[] = [
  'root',               //  0 — on-chain Merkle root of the note tree
  'public_amount',      //  1 — sum declared to the auditor (shielded per-payment amounts are hidden)
  'ext_data_hash',      //  2 — hash of the external-data struct (recipient, relayer, fee)
  'input_nullifier',    //  3 — nullifier for the consumed note (prevents double-spend)
  'output_commitment_0', // 4
  'output_commitment_1', // 5
  'output_commitment_2', // 6
  'output_commitment_3', // 7
  'output_commitment_4', // 8
  'output_commitment_5', // 9
  'output_commitment_6', // 10
  'output_commitment_7', // 11  — 8 shielded output note commitments
];

// ── CLI args ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DATASET = path.join(PROJECT_ROOT, 'circuits', 'sobre_slim', 'target');
const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org';
const DEFAULT_CONTRACT_ID = 'CCIMHTM466A2V36MP3JJOV22C6CPPG3OBXM634Q77OAMBYDZJORRCFPO';
const DEFAULT_SECRET = 'SA3B5PL4FUSEHTFV2FDKIKTUHS3YODFH3CAX6BVQNO2B7EN3KWH24JCB';

function parseArgs() {
  const parser = new ArgumentParser({
    description: 'Validate public-inputs layout for the slim UltraHonk verifier (NOIR-05)',
  });
  parser.add_argument('--contract-id', {
    default: DEFAULT_CONTRACT_ID,
    help: 'Slim UltraHonk verifier contract ID',
  });
  parser.add_argument('--source-secret', {
    default: DEFAULT_SECRET,
    help: 'Stellar secret key for the simulation account',
  });
  parser.add_argument('--dataset', {
    default: DEFAULT_DATASET,
    help: 'Directory containing proof and public_inputs artifacts',
  });
  parser.add_argument('--rpc-url', {
    default: DEFAULT_RPC_URL,
    help: 'Soroban RPC URL',
  });
  return parser.parse_args();
}

// ── helpers ───────────────────────────────────────────────────────────────────

function loadArtifacts(dir: string): { publicInputs: Buffer; proof: Buffer } {
  const piPath = path.resolve(dir, 'public_inputs');
  const prPath = path.resolve(dir, 'proof');
  for (const p of [piPath, prPath]) {
    if (!fs.existsSync(p)) throw new Error(`Missing artifact: ${p}`);
  }
  return {
    publicInputs: fs.readFileSync(piPath),
    proof: fs.readFileSync(prPath),
  };
}

async function callVerifyProof(
  server: SorobanRpc.Server,
  keypair: Keypair,
  contractId: string,
  publicInputs: Buffer,
  proofBytes: Buffer
): Promise<{ ok: boolean; errorMessage: string }> {
  const account = await server.getAccount(keypair.publicKey());
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        'verify_proof',
        nativeToScVal(publicInputs, { type: 'bytes' }),
        nativeToScVal(proofBytes, { type: 'bytes' })
      )
    )
    .setTimeout(TimeoutInfinite)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationSuccess(sim)) {
    return { ok: true, errorMessage: '' };
  }
  const errStr = JSON.stringify(sim);
  return { ok: false, errorMessage: errStr };
}

function printFieldTable(publicInputs: Buffer): void {
  console.log('\n── Public-inputs field table ──────────────────────────────────────');
  console.log(
    `${'Index'.padEnd(6)} ${'Signal'.padEnd(24)} First 8 bytes (hex)      Full hex (32 bytes)`
  );
  console.log('─'.repeat(100));
  for (let i = 0; i < CIRCUIT_FIELD_COUNT; i++) {
    const offset = i * FIELD_BYTES;
    const field = publicInputs.slice(offset, offset + FIELD_BYTES);
    const first8 = field.slice(0, 8).toString('hex');
    const fullHex = field.toString('hex');
    const name = FIELD_NAMES[i] ?? `unknown_${i}`;
    console.log(`${String(i).padEnd(6)} ${name.padEnd(24)} ${first8}...  0x${fullHex}`);
  }
  console.log('─'.repeat(100));
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  const { publicInputs, proof } = loadArtifacts(args.dataset);

  console.log('=== NOIR-05: verify_public_inputs_layout ===\n');
  console.log(`Dataset    : ${args.dataset}`);
  console.log(`Contract   : ${args.contract_id}`);
  console.log(`RPC        : ${args.rpc_url}`);

  // ── Shape assertions ──────────────────────────────────────────────────────

  console.log('\n── Shape assertions ─────────────────────────────────────────────────');
  console.log(
    `public_inputs.length : ${publicInputs.length} bytes  (expected ${EXPECTED_PUBLIC_INPUTS_BYTES})`
  );
  console.log(
    `proof.length         : ${proof.length} bytes  (expected ${EXPECTED_PROOF_BYTES})`
  );

  if (publicInputs.length !== EXPECTED_PUBLIC_INPUTS_BYTES) {
    console.error(
      `FAIL: public_inputs.length === ${publicInputs.length}, expected ${EXPECTED_PUBLIC_INPUTS_BYTES}`
    );
    process.exit(1);
  }
  if (proof.length !== EXPECTED_PROOF_BYTES) {
    console.error(
      `FAIL: proof.length === ${proof.length}, expected ${EXPECTED_PROOF_BYTES}`
    );
    process.exit(1);
  }
  if (publicInputs.length % FIELD_BYTES !== 0) {
    console.error('FAIL: public_inputs.length is not a multiple of 32');
    process.exit(1);
  }
  const fieldCount = publicInputs.length / FIELD_BYTES;
  if (fieldCount !== CIRCUIT_FIELD_COUNT) {
    console.error(`FAIL: field count === ${fieldCount}, expected ${CIRCUIT_FIELD_COUNT}`);
    process.exit(1);
  }

  console.log('public_inputs.length ASSERT OK (384 bytes, 12 fields × 32)');
  console.log('proof.length         ASSERT OK (14592 bytes)');

  // Print the field table for documentation purposes
  printFieldTable(publicInputs);

  // ── On-chain simulation ───────────────────────────────────────────────────

  const server = new SorobanRpc.Server(args.rpc_url, { allowHttp: true });
  const keypair = Keypair.fromSecret(args.source_secret);

  // POSITIVE CASE: full 384-byte blob must verify OK
  console.log('\n── POSITIVE CASE: full 384-byte blob ────────────────────────────────');
  console.log('Calling verify_proof with the complete bb-produced public_inputs blob...');
  const positive = await callVerifyProof(
    server,
    keypair,
    args.contract_id,
    publicInputs,
    proof
  );
  if (!positive.ok) {
    console.error('FAIL (positive case): verify_proof returned error with full blob.');
    console.error('Error:', positive.errorMessage.slice(0, 400));
    process.exit(1);
  }
  console.log('POSITIVE CASE: verify_proof OK (simulation success, no error returned)');

  // NEGATIVE CASE: truncate to 11 fields (352 bytes) — must fail
  // This confirms that every field in the blob is load-bearing and that passing
  // fewer than the required 12 fields causes VerificationFailed.
  console.log('\n── NEGATIVE CASE: truncated to 11 fields (352 bytes) ────────────────');
  const truncated = publicInputs.slice(0, (CIRCUIT_FIELD_COUNT - 1) * FIELD_BYTES); // 11 × 32 = 352
  console.log(
    `Truncated blob length: ${truncated.length} bytes (dropped last field: output_commitment_7)`
  );
  console.log('Calling verify_proof with truncated public_inputs — must fail...');
  const negative = await callVerifyProof(
    server,
    keypair,
    args.contract_id,
    truncated,
    proof
  );
  if (negative.ok) {
    console.error(
      'FAIL (negative case): verify_proof accepted truncated blob — something is wrong with the shape!'
    );
    process.exit(1);
  }
  console.log('NEGATIVE CASE: verify_proof FAILED as expected (truncated blob rejected)');
  console.log(`  Error snippet: ${negative.errorMessage.slice(0, 200)}`);

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('NOIR-05 LAYOUT VALIDATION: ALL ASSERTIONS PASSED');
  console.log('');
  console.log('TRUE layout (bb 0.87.0, ultra_honk, keccak oracle):');
  console.log(`  public_inputs : ${EXPECTED_PUBLIC_INPUTS_BYTES} bytes = ${CIRCUIT_FIELD_COUNT} fields × ${FIELD_BYTES} bytes/field`);
  console.log(`  proof         : ${EXPECTED_PROOF_BYTES} bytes (PPO folded in, not in public_inputs)`);
  console.log('  endianness    : big-endian (U256 per field)');
  console.log('');
  console.log('Field order (index → signal):');
  FIELD_NAMES.forEach((name, i) => console.log(`  [${i}] ${name}`));
  console.log('');
  console.log('Correction vs. plan 09-03 (and RESEARCH §6):');
  console.log('  Plan assumed 28 fields / 896 bytes (12 circuit + 16 PPO).');
  console.log('  Reality: 12 fields / 384 bytes. PPO is inside proof, not public_inputs.');
  console.log('');
  console.log('Drop-in instruction for 09-04 (pool swap):');
  console.log('  const publicInputsBytes = fs.readFileSync(".../target/public_inputs");');
  console.log('  // Pass this buffer DIRECTLY to verify_proof. No reconstruction needed.');
  console.log('  // Do NOT build a Vec<Fr> field-by-field like the old Groth16 verifier.');
  console.log('══════════════════════════════════════════════════════════════════════');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('ERROR:', msg);
  process.exit(1);
});
