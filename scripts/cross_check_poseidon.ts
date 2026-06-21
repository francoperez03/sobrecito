#!/usr/bin/env ts-node
/**
 * cross_check_poseidon.ts — Poseidon2 cross-check harness (NOIR-04)
 *
 * Compares Poseidon2 hashes produced by the Noir circuit (via nargo execute)
 * against the on-chain implementation in the Soroban poseidon2-tester contract.
 *
 * CRITICAL: This is the day-killer gate for Phase 9. A silent mismatch would
 * produce proofs that verify locally with `bb verify` but fail on-chain with
 * `VerificationFailed`. The script MUST fail loudly (exit != 0) if hashes
 * differ or if it cannot run the comparison.
 *
 * Usage:
 *   npx ts-node cross_check_poseidon.ts \
 *     --contract-id <POSEIDON2_TESTER_CONTRACT_ID> \
 *     --source-secret <STELLAR_SECRET> \
 *     [--rpc-url https://soroban-testnet.stellar.org] \
 *     [--network-passphrase 'Test SDF Network ; September 2015']
 *
 * On-chain contract (poseidon2-tester):
 *   compress(left, right): t=2, d=5, RF=8, RP=56, mat_diag=[1,2] + absorption step
 *   hash2(a, b, sep):      t=3, d=5, RF=8, RP=56, mat_diag=[1,1,2], no IV
 *
 * Noir lib (noir-lang/poseidon v0.2.0) Poseidon2::hash([inputs], msg_size):
 *   Sponge construction: RATE=3, state=[Field;4], IV = message_size * 2^64
 *   Permutation: t=4 internally — DIFFERENT from on-chain t=2/t=3 constructions
 *
 * Expected result (Wave 0 finding): MISMATCH — the Noir lib and on-chain pool
 * use fundamentally different Poseidon2 constructions. Resolve in plan 09-02
 * before the full circuit port proceeds.
 */

import * as path from 'path';
import { spawn } from 'child_process';
import { ArgumentParser } from 'argparse';
import {
  Contract,
  Keypair,
  Networks,
  TimeoutInfinite,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
// stellar-sdk v16: RPC submodule via the CJS index path
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rpcModule = require(
  require.resolve('@stellar/stellar-sdk').replace(/index\.js$/, 'rpc/index.js')
) as {
  Server: new (url: string, opts?: { allowHttp?: boolean }) => {
    getAccount: (key: string) => Promise<unknown>;
    simulateTransaction: (tx: unknown) => Promise<unknown>;
  };
  Api: {
    isSimulationSuccess: (sim: unknown) => boolean;
  };
};
const { Server, Api } = rpcModule;

const CIRCUIT_DIR = path.resolve(__dirname, '..', 'circuits', 'sobre_slim');
const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org';
const DEFAULT_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

// Inputs from Prover.toml (must match exactly for reproducible cross-check)
const INPUTS = {
  amount: 100n,
  pubkey: 7n,
  blinding: 42n,
  merkle_left: 1n,
  merkle_right: 2n,
};

interface NargoOutputs {
  commitment: bigint;
  nullifier: bigint;
  compress: bigint;
}

interface SorobanHashes {
  compress: bigint;
  hash2_commitment: bigint;
}

function runCommand(
  cmd: string,
  args: string[],
  cwd: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['inherit', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      process.stdout.write(d);
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      process.stderr.write(d);
    });
    child.on('close', (code: number | null) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function runNargoExecute(): Promise<NargoOutputs> {
  console.log('\n[1/3] Running nargo execute in circuits/sobre_slim...');
  const result = await runCommand('nargo', ['execute'], CIRCUIT_DIR);
  if (result.code !== 0) {
    throw new Error(`nargo execute failed with code ${result.code}`);
  }

  // Combine stdout + stderr to find output (nargo prints to stderr for warnings,
  // stdout for results — but the exact stream varies by version)
  const combined = result.stdout + result.stderr;
  // nargo prints field elements in signed form (values > p/2 appear negative),
  // so accept an optional leading '-' and normalize into [0, p) below.
  const match = combined.match(
    /Circuit output: Vec\(\[Field\((-?\d+)\), Field\((-?\d+)\), Field\((-?\d+)\)\]\)/
  );
  if (!match) {
    throw new Error(
      `Failed to parse nargo execute output.\n` +
      `stdout=${result.stdout}\nstderr=${result.stderr}`
    );
  }

  // BN254 scalar field modulus — canonicalize signed nargo outputs.
  const BN254_P =
    21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const canon = (v: bigint): bigint => ((v % BN254_P) + BN254_P) % BN254_P;

  return {
    commitment: canon(BigInt(match[1])),
    nullifier: canon(BigInt(match[2])),
    compress: canon(BigInt(match[3])),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bigIntToScValU256(value: bigint): xdr.ScVal {
  // Encode bigint as ScvU256 (4x64-bit parts, big-endian)
  const MASK = 0xFFFFFFFFFFFFFFFFn;
  const hi_hi = (value >> 192n) & MASK;
  const hi_lo = (value >> 128n) & MASK;
  const lo_hi = (value >> 64n) & MASK;
  const lo_lo = value & MASK;
  // The xdr.UInt256Parts constructor accepts bigint at runtime despite the TS type
  // being Uint64 — cast via unknown to bypass the type check safely.
  return xdr.ScVal.scvU256(
    new xdr.UInt256Parts({
      hiHi: hi_hi as unknown as xdr.Uint64,
      hiLo: hi_lo as unknown as xdr.Uint64,
      loHi: lo_hi as unknown as xdr.Uint64,
      loLo: lo_lo as unknown as xdr.Uint64,
    })
  );
}

function scValU256ToBigInt(scVal: xdr.ScVal): bigint {
  const u = scVal.u256();
  const hi_hi = BigInt(u.hiHi().toString());
  const hi_lo = BigInt(u.hiLo().toString());
  const lo_hi = BigInt(u.loHi().toString());
  const lo_lo = BigInt(u.loLo().toString());
  return (hi_hi << 192n) | (hi_lo << 128n) | (lo_hi << 64n) | lo_lo;
}

async function simulateContractMethod(
  server: Server,
  keypair: Keypair,
  networkPassphrase: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[]
): Promise<bigint> {
  const account = await server.getAccount(keypair.publicKey());
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(TimeoutInfinite)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!Api.isSimulationSuccess(sim)) {
    throw new Error(
      `Simulation of ${method} failed: ${JSON.stringify((sim as Api.SimulateTransactionErrorResponse).error)}`
    );
  }

  const successSim = sim as Api.SimulateTransactionSuccessResponse;
  if (!successSim.result?.retval) {
    throw new Error(`No return value from ${method}`);
  }
  return scValU256ToBigInt(successSim.result.retval);
}

async function runSorobanCrossCheck(
  contractId: string,
  sourceSecret: string,
  rpcUrl: string,
  networkPassphrase: string
): Promise<SorobanHashes> {
  console.log('\n[2/3] Simulating Soroban Poseidon2 hashes on-chain...');
  const server = new Server(rpcUrl, { allowHttp: true });
  const keypair = Keypair.fromSecret(sourceSecret);

  console.log(`  Contract : ${contractId}`);
  console.log(`  RPC      : ${rpcUrl}`);
  console.log(`  Account  : ${keypair.publicKey()}`);

  // Verify account is funded — fail loudly if not
  try {
    await server.getAccount(keypair.publicKey());
  } catch {
    throw new Error(
      `Account ${keypair.publicKey()} not found on network. ` +
      `Fund via friendbot: curl "https://friendbot.stellar.org/?addr=${keypair.publicKey()}"`
    );
  }

  // Test 1: compress(merkle_left=1, merkle_right=2)
  // On-chain: t=2, mat_diag=[1,2], with absorption step (out[0] += left)
  // Noir: Poseidon2::hash([1,2], 2) — t=4 sponge, IV=2*2^64
  console.log('  Simulating compress(1, 2)...');
  const compressOnChain = await simulateContractMethod(
    server, keypair, networkPassphrase, contractId,
    'compress',
    [bigIntToScValU256(INPUTS.merkle_left), bigIntToScValU256(INPUTS.merkle_right)]
  );

  // Test 2: hash2(amount=100, pubkey=7, sep=1)
  // On-chain: t=3, mat_diag=[1,1,2], state=[a,b,sep], no IV
  // Noir: Poseidon2::hash([100,7,42,1], 4) — t=4 sponge, IV=4*2^64, 4 inputs
  // Note: this is NOT the same computation (different t, different IV, different inputs)
  console.log('  Simulating hash2(100, 7, sep=1)...');
  const hash2OnChain = await simulateContractMethod(
    server, keypair, networkPassphrase, contractId,
    'hash2',
    [
      bigIntToScValU256(INPUTS.amount),
      bigIntToScValU256(INPUTS.pubkey),
      bigIntToScValU256(0x01n),
    ]
  );

  return { compress: compressOnChain, hash2_commitment: hash2OnChain };
}

function compareAndReport(noirOutputs: NargoOutputs, sorobanHashes: SorobanHashes): boolean {
  console.log('\n[3/3] Comparing Noir vs Soroban hashes...\n');

  const tests = [
    {
      name: 'Merkle compress (inputs: left=1, right=2)',
      noir: noirOutputs.compress,
      soroban: sorobanHashes.compress,
      match: noirOutputs.compress === sorobanHashes.compress,
      note: 'Noir poseidon2_pool::compress(1,2) [ported t=2 perm + absorption] vs Soroban poseidon2_compress(1,2)',
    },
    {
      name: 'Domain-separated hash2 (inputs: a=100, b=7, sep=0x01)',
      // out[0] of the cross-check circuit is the pool-aligned t=3 hash2.
      noir: noirOutputs.commitment,
      soroban: sorobanHashes.hash2_commitment,
      match: noirOutputs.commitment === sorobanHashes.hash2_commitment,
      note: 'Noir poseidon2_pool::hash2_with_sep(100,7,1) [ported t=3 perm] vs Soroban poseidon2_hash2(100,7,sep=1)',
    },
  ];

  let allMatch = true;
  for (const t of tests) {
    const label = t.match ? 'MATCH   ' : 'MISMATCH';
    console.log(`  [${label}] ${t.name}`);
    console.log(`            Noir    : ${t.noir}`);
    console.log(`            Soroban : ${t.soroban}`);
    console.log(`            Note    : ${t.note}`);
    console.log();
    if (!t.match) {
      allMatch = false;
    }
  }

  return allMatch;
}

async function main(): Promise<void> {
  const parser = new ArgumentParser({
    description: 'Poseidon2 cross-check: Noir witness vs Soroban on-chain (NOIR-04 day-killer gate)',
  });
  parser.add_argument('--contract-id', {
    required: true,
    help: 'poseidon2-tester contract ID on testnet',
  });
  parser.add_argument('--source-secret', {
    required: true,
    help: 'Stellar secret key of a funded account',
  });
  parser.add_argument('--rpc-url', {
    default: DEFAULT_RPC_URL,
    help: `Soroban RPC URL (default: ${DEFAULT_RPC_URL})`,
  });
  parser.add_argument('--network-passphrase', {
    default: DEFAULT_NETWORK_PASSPHRASE,
    help: 'Network passphrase',
  });

  const args = parser.parse_args();

  console.log('=== Poseidon2 Cross-Check Harness (NOIR-04) ===');
  console.log('Circuit  :', CIRCUIT_DIR);
  console.log('Contract :', args.contract_id);
  console.log('Inputs   :', JSON.stringify(
    Object.fromEntries(Object.entries(INPUTS).map(([k, v]) => [k, v.toString()])),
    null, 2
  ));

  let noirOutputs: NargoOutputs;
  let sorobanHashes: SorobanHashes;

  try {
    noirOutputs = await runNargoExecute();
    console.log('\n  commitment :', noirOutputs.commitment.toString());
    console.log('  nullifier  :', noirOutputs.nullifier.toString());
    console.log('  compress   :', noirOutputs.compress.toString());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\nFATAL: nargo execute failed — ${msg}`);
    console.error('Day-killer gate: cannot run cross-check without Noir outputs.');
    process.exit(1);
  }

  try {
    sorobanHashes = await runSorobanCrossCheck(
      args.contract_id,
      args.source_secret,
      args.rpc_url,
      args.network_passphrase
    );
    console.log('\n  compress(1,2)       :', sorobanHashes.compress.toString());
    console.log('  hash2(100,7,sep=1)  :', sorobanHashes.hash2_commitment.toString());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\nFATAL: Soroban simulation failed — ${msg}`);
    console.error('Day-killer gate: cannot run without testnet/contract access.');
    process.exit(1);
  }

  const allMatch = compareAndReport(noirOutputs, sorobanHashes);

  if (allMatch) {
    console.log('MATCH: Poseidon2 params aligned');
    console.log('Phase 9 can proceed to full circuit port.');
    process.exit(0);
  } else {
    console.error('MISMATCH: Poseidon2 params diverge between Noir lib v0.2.0 and Soroban pool.');
    console.error('');
    console.error('ROOT CAUSE (Wave 0 discovery):');
    console.error('  noir-lang/poseidon v0.2.0 Poseidon2::hash uses a sponge with:');
    console.error('    RATE=3, state=[Field;4], IV = message_size * 2^64, t=4 internally.');
    console.error('  The Soroban pool uses t=2 (compress) and t=3 (hash2) primitives');
    console.error('  without the IV/sponge wrapping.');
    console.error('');
    console.error('RESOLUTION REQUIRED before plan 09-02:');
    console.error('  Option A — Add t=4 constants + sponge IV to soroban-utils');
    console.error('             so the pool hashes match the Noir lib exactly.');
    console.error('  Option B — Use t=2/t=3 on-chain primitives and adapt the Noir');
    console.error('             circuit to call the permutation directly (not via sponge).');
    console.error('  Option C — Use Noir stdlib std::hash::poseidon2 (different sponge,');
    console.error('             t=4, rate=3 — same as v0.2.0) and implement equivalently');
    console.error('             in soroban-utils.');
    console.error('');
    console.error('The full circuit port MUST NOT start until hashes align byte-per-byte.');
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  process.exit(1);
});
