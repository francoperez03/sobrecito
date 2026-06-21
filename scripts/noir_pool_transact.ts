#!/usr/bin/env ts-node
/**
 * noir_pool_transact.ts — E2E deposit + transact for the UltraHonk noir_pool (09-04)
 *
 * Reads proof artifacts from circuits/sobre_slim/target/ and calls
 * transact on the deployed noir_pool.
 *
 * The proof was generated with:
 *   in_amount=0, public_amount=0 (reshield: no USDC transfer)
 *   ext_data_hash = keccak256(XDR(ExtData{recipient=mikey, ext_amount=0, 8 empty outputs})) mod BN254
 *
 * Returns the tx hash via stdout (last line: TX_HASH=<hash>).
 *
 * Usage:
 *   NOIR_POOL_ID=C... DEPLOYER_SECRET=S... REPO_ROOT=/path npx ts-node noir_pool_transact.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  Contract,
  Keypair,
  Networks,
  rpc as SorobanRpc,
  TimeoutInfinite,
  TransactionBuilder,
  nativeToScVal,
  xdr,
  BASE_FEE,
  Address,
} from '@stellar/stellar-sdk';

// ── Config ────────────────────────────────────────────────────────────────────

const NOIR_POOL_ID    = process.env.NOIR_POOL_ID    ?? '';
const DEPLOYER_SECRET = process.env.DEPLOYER_SECRET ?? '';
const REPO_ROOT       = process.env.REPO_ROOT       ?? '';
const RPC_URL         = process.env.RPC_URL         ?? 'https://soroban-testnet.stellar.org';

if (!NOIR_POOL_ID || !DEPLOYER_SECRET || !REPO_ROOT) {
  console.error('Missing required env: NOIR_POOL_ID, DEPLOYER_SECRET, REPO_ROOT');
  process.exit(1);
}

const TARGET = path.join(REPO_ROOT, 'circuits', 'sobre_slim', 'target');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a bigint to Soroban U256 ScVal.
 * U256 is represented as 4 × u64 parts: hi_hi, hi_lo, lo_hi, lo_lo (big-endian).
 */
function bigintToU256(n: bigint): xdr.ScVal {
  const mask = BigInt('0xFFFFFFFFFFFFFFFF');
  // UInt256Parts uses JavaScript BigInt for u64 fields (xdr.UnsignedHyper is BigInt-based)
  const hi_hi = (n >> BigInt(192)) & mask;
  const hi_lo = (n >> BigInt(128)) & mask;
  const lo_hi = (n >> BigInt(64))  & mask;
  const lo_lo = n                  & mask;
  return xdr.ScVal.scvU256(
    new xdr.UInt256Parts({ hiHi: hi_hi, hiLo: hi_lo, loHi: lo_hi, loLo: lo_lo })
  );
}

/**
 * Read a big-endian U256 field element from a 32-byte offset in a Buffer.
 */
function readField(buf: Buffer, offset: number): bigint {
  const slice = buf.slice(offset, offset + 32);
  let n = BigInt(0);
  for (const b of slice) { n = (n << BigInt(8)) | BigInt(b); }
  return n;
}

/**
 * Build a Soroban BytesN<32> ScVal from a Buffer (must be exactly 32 bytes).
 */
function bytesN32(buf: Buffer): xdr.ScVal {
  if (buf.length !== 32) throw new Error(`bytesN32: expected 32 bytes, got ${buf.length}`);
  return xdr.ScVal.scvBytes(buf);
}

/**
 * Build a Soroban I256 ScVal for value 0.
 * Int256Parts fields use BigInt (xdr.Hyper is BigInt-based).
 */
function i256Zero(): xdr.ScVal {
  return xdr.ScVal.scvI256(
    new xdr.Int256Parts({
      hiHi: BigInt(0),
      hiLo: BigInt(0),
      loHi: BigInt(0),
      loLo: BigInt(0),
    })
  );
}

/**
 * Build a Soroban Address ScVal from a public key string.
 */
function addressScVal(pubkey: string): xdr.ScVal {
  return new Address(pubkey).toScVal();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const server = new SorobanRpc.Server(RPC_URL, { allowHttp: true });
  const kp = Keypair.fromSecret(DEPLOYER_SECRET);
  const deployerPubkey = kp.publicKey();

  console.log(`noir_pool:  ${NOIR_POOL_ID}`);
  console.log(`deployer:   ${deployerPubkey}`);
  console.log(`rpc:        ${RPC_URL}`);

  // Load proof artifacts
  const publicInputsBuf = fs.readFileSync(path.join(TARGET, 'public_inputs'));
  const proofBytesBuf   = fs.readFileSync(path.join(TARGET, 'proof'));

  console.log(`public_inputs: ${publicInputsBuf.length} bytes (expected 384)`);
  console.log(`proof_bytes:   ${proofBytesBuf.length} bytes (expected 14592)`);

  if (publicInputsBuf.length !== 384) throw new Error('public_inputs size mismatch');
  if (proofBytesBuf.length !== 14592) throw new Error('proof_bytes size mismatch');

  // Parse structured fields from public_inputs blob (12 × 32 bytes, big-endian U256)
  const piRoot           = readField(publicInputsBuf, 0  * 32);
  const piPublicAmount   = readField(publicInputsBuf, 1  * 32);
  const piExtDataHashBig = readField(publicInputsBuf, 2  * 32);
  const piInputNullifier = readField(publicInputsBuf, 3  * 32);
  const piOutputCommitments: bigint[] = [];
  for (let i = 0; i < 8; i++) {
    piOutputCommitments.push(readField(publicInputsBuf, (4 + i) * 32));
  }

  console.log(`\nPublic inputs:`);
  console.log(`  root:              ${piRoot}`);
  console.log(`  public_amount:     ${piPublicAmount}`);
  console.log(`  ext_data_hash:     ${piExtDataHashBig}`);
  console.log(`  input_nullifier:   ${piInputNullifier}`);

  // ext_data_hash as BytesN<32> (big-endian 32-byte representation)
  const extDataHashBuf = Buffer.alloc(32);
  let tmp = piExtDataHashBig;
  for (let i = 31; i >= 0; i--) {
    extDataHashBuf[i] = Number(tmp & BigInt(0xFF));
    tmp = tmp >> BigInt(8);
  }
  console.log(`  ext_data_hash hex: 0x${extDataHashBuf.toString('hex')}`);

  // ── Build Proof struct ScVal ──────────────────────────────────────────────
  //
  // Soroban contracttype structs serialize as ScMap with keys sorted
  // lexicographically. Fields of `Proof`:
  //   ext_data_hash: BytesN<32>
  //   input_nullifiers: Vec<U256>
  //   output_commitments: Vec<U256>
  //   proof_bytes: Bytes
  //   public_amount: U256
  //   public_inputs: Bytes
  //   root: U256

  const inputNullifiersVec = xdr.ScVal.scvVec([bigintToU256(piInputNullifier)]);
  const outputCommitmentsVec = xdr.ScVal.scvVec(piOutputCommitments.map(bigintToU256));

  const proofStruct = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('ext_data_hash'),
      val: bytesN32(extDataHashBuf),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('input_nullifiers'),
      val: inputNullifiersVec,
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('output_commitments'),
      val: outputCommitmentsVec,
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('proof_bytes'),
      val: nativeToScVal(proofBytesBuf, { type: 'bytes' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('public_amount'),
      val: bigintToU256(piPublicAmount),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('public_inputs'),
      val: nativeToScVal(publicInputsBuf, { type: 'bytes' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('root'),
      val: bigintToU256(piRoot),
    }),
  ]);

  // ── Build ExtData struct ScVal ────────────────────────────────────────────
  //
  // Fields of `ExtData` (sorted lexicographically):
  //   encrypted_outputs: Vec<Bytes>   — 8 empty blobs
  //   ext_amount: I256                — 0 (reshield)
  //   recipient: Address              — mikey (deployer)
  //
  // The pool calls hash_ext_data(ext_data) and compares to proof.ext_data_hash.
  // ExtData must match exactly what was used to compute ext_data_hash above.

  const emptyBlobs = Array.from({ length: 8 }, () =>
    nativeToScVal(Buffer.alloc(0), { type: 'bytes' })
  );
  const encryptedOutputsVec = xdr.ScVal.scvVec(emptyBlobs);

  const extDataStruct = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('encrypted_outputs'),
      val: encryptedOutputsVec,
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('ext_amount'),
      val: i256Zero(),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('recipient'),
      val: addressScVal(deployerPubkey),
    }),
  ]);

  const senderVal = addressScVal(deployerPubkey);

  // ── Simulate ──────────────────────────────────────────────────────────────

  const account = await server.getAccount(deployerPubkey);
  const contract = new Contract(NOIR_POOL_ID);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call('transact', proofStruct, extDataStruct, senderVal))
    .setTimeout(TimeoutInfinite)
    .build();

  console.log('\nSimulating transact...');
  const sim = await server.simulateTransaction(tx);

  if (!SorobanRpc.Api.isSimulationSuccess(sim)) {
    const simAny = sim as any;
    console.error('Simulation FAILED:');
    console.error('  error:', simAny.error ?? 'unknown');
    const events = simAny.events ?? [];
    if (events.length) console.error('  events:', JSON.stringify(events, null, 2));
    process.exit(1);
  }

  const simSuccess = sim as SorobanRpc.Api.SimulateTransactionSuccessResponse;
  console.log('Simulation SUCCESS');
  const cost = simSuccess.cost;
  if (cost) {
    console.log(`  cpuInsns: ${cost.cpuInsns}`);
    console.log(`  memBytes: ${cost.memBytes}`);
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  console.log('\nPreparing and submitting transact...');
  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(kp);

  const submitResult = await server.sendTransaction(preparedTx);
  const txHash = submitResult.hash;
  console.log(`Tx hash: ${txHash}`);

  if (submitResult.status === 'ERROR') {
    console.error('Submit ERROR:', JSON.stringify(submitResult));
    process.exit(1);
  }

  // Wait for confirmation (poll up to 60s)
  let confirmed = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const check = await server.getTransaction(txHash);
    console.log(`  status check ${i + 1}: ${check.status}`);
    if (check.status === 'SUCCESS') {
      confirmed = true;
      break;
    }
    if (check.status === 'FAILED') {
      console.error('Tx FAILED:', JSON.stringify(check));
      process.exit(1);
    }
  }

  if (!confirmed) {
    console.error('Timeout waiting for confirmation');
    process.exit(1);
  }

  console.log('\nTx CONFIRMED: SUCCESS');
  console.log(`TX_HASH=${txHash}`);
}

main().catch(err => {
  console.error('ERROR:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
