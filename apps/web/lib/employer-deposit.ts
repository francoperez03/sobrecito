/**
 * employer-deposit.ts — Freighter deposit flow for the employer pay batch.
 *
 * Mirror of apps/web/lib/employee-unshield.ts. Key differences from the
 * employee withdraw path:
 *   - ext_amount is POSITIVE (deposit = the employer funds the pool).
 *     The pool.rs transact() adds this amount to the pool balance.
 *   - encrypted_outputs is a Vec<Bytes> (8 blobs), serialized as
 *     scvVec(scvBytes(…)) — NOT a two-field named struct.
 *   - The sender is the employer's Freighter address (must hold USDC + trustline).
 *   - No proof is carried from a link; the caller generates the proof locally
 *     via proverClient.ts (Wave 2) before calling submitDeposit.
 *
 * DEMO NOTE (RESEARCH Open Question 3 / MEMORY testnet-usdc-cap-1.md):
 *   For the testnet demo, pass totalBaseUnits = BigInt(0) so ext_amount = 0.
 *   No real USDC moves; the denomination note amounts are BN254 field values.
 *   Disclosure: "PoC demo — no real USDC transferred." shown in the UI.
 *
 * Error surfaces handled (RESEARCH Q6):
 *   - Freighter not installed → requestAccess error
 *   - Wallet locked / no address → empty address
 *   - Wrong network → networkPassphrase guard
 *   - Pool rejects (WrongExtHash, InvalidProof, AlreadySpentNullifier) → sendTransaction ERROR
 *   - No trustline / insufficient balance → pool.transact reverts (Soroban error)
 */
'use client'

import {
  Account,
  Address,
  Contract,
  nativeToScVal,
  rpc as StellarRpc,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk'
import {
  getAddress,
  getNetwork,
  requestAccess,
  signTransaction,
} from '@stellar/freighter-api'
import { readDeployments } from './rpc'

const RPC_URL = 'https://soroban-testnet.stellar.org'
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'
/** Base fee in stroops. The employer pays the submission fee. */
const BASE_FEE = '1000000'

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface DepositParams {
  /** 256-byte Groth16 proof in Soroban format (from proverClient.prove). */
  proof: Uint8Array
  /** 8 dual-blob Uint8Arrays from buildFrozenBlobs (frozen before hash + proof). */
  encOutputs: Uint8Array[]
  /**
   * Total deposit amount in USDC base units (7 decimals).
   * For the testnet PoC demo: pass BigInt(0) — no real USDC moves.
   * Testnet cap: max 10_000_000 (= 1 USDC) for real token movement.
   */
  totalBaseUnits: bigint
  /** Employer's Stellar address (G…). If omitted, fetched from Freighter. */
  sender?: string
}

export interface DepositResult {
  /** Submitted Soroban transaction hash. */
  hash: string
  /** The employer address that signed the transaction. */
  sender: string
}

// ---------------------------------------------------------------------------
// Freighter helper — copy verbatim from employee-unshield.ts (lines 86-94)
// ---------------------------------------------------------------------------

/** Result of a Freighter call: either a value field or an `error`. v6 returns
 * errors in the result object rather than throwing. */
function unwrapFreighter<T extends Record<string, unknown>>(
  res: T & { error?: unknown },
  what: string,
): T {
  if (res.error) {
    throw new Error(`Freighter ${what} failed: ${String(res.error)}`)
  }
  return res
}

// ---------------------------------------------------------------------------
// connectFreighter — helper for Wave 3 UI
// ---------------------------------------------------------------------------

/**
 * Connect to Freighter and return the employer's Stellar address.
 * Guards: Freighter must be installed, wallet unlocked, and on testnet.
 * Throws with a user-friendly message on any failure.
 */
export async function connectFreighter(): Promise<string> {
  await unwrapFreighter(await requestAccess(), 'requestAccess')
  const { address } = unwrapFreighter(await getAddress(), 'getAddress')
  if (!address) {
    throw new Error('Freighter returned no address. Unlock the wallet and retry.')
  }
  const { networkPassphrase } = unwrapFreighter(await getNetwork(), 'getNetwork')
  if (networkPassphrase !== TESTNET_PASSPHRASE) {
    throw new Error('Switch Freighter to Testnet to submit payroll.')
  }
  return address
}

// ---------------------------------------------------------------------------
// submitDeposit — the main deposit flow
// ---------------------------------------------------------------------------

/**
 * Build, sign (Freighter), and submit the employer deposit (pool.transact).
 *
 * The caller is responsible for generating the proof + frozen blobs BEFORE
 * calling this function (blobs must be frozen before computing ext_data_hash
 * and before calling prove — Pitfall 2).
 *
 * Steps:
 *  1. Connect Freighter + network guard (reuses connectFreighter).
 *  2. Build pool.transact with:
 *       proof arg (256-byte Soroban format)
 *       ext_data arg: { recipient=sender, ext_amount=+totalBaseUnits,
 *                       encrypted_outputs=scvVec(scvBytes[8]) }
 *       sender arg (employer address)
 *  3. prepareTransaction (Soroban RPC footprint + resource fees).
 *  4. signTransaction via Freighter (wallet shows tx before signing).
 *  5. sendTransaction, guard status !== 'ERROR', return { hash, sender }.
 */
export async function submitDeposit(params: DepositParams): Promise<DepositResult> {
  // 1. Connect Freighter + guard
  const address = params.sender ?? (await connectFreighter())

  // Verify network (in case the caller provided a sender but Freighter changed network)
  const { networkPassphrase } = unwrapFreighter(await getNetwork(), 'getNetwork')
  if (networkPassphrase !== TESTNET_PASSPHRASE) {
    throw new Error('Switch Freighter to Testnet to submit payroll.')
  }

  const server = new StellarRpc.Server(RPC_URL)
  const source = await server.getAccount(address)

  // 2. Build the pool.transact invocation
  const tx = buildDepositTransaction({
    source,
    proof: params.proof,
    encOutputs: params.encOutputs,
    totalBaseUnits: params.totalBaseUnits,
    sender: address,
    networkPassphrase,
  })

  // 3. Prepare the transaction (footprint + resource fees via Soroban RPC)
  const prepared = await server.prepareTransaction(tx)

  // 4. Freighter signs the prepared XDR (wallet shows the tx before signing)
  const signed = unwrapFreighter(
    await signTransaction(prepared.toXDR(), {
      networkPassphrase,
      address,
    }),
    'signTransaction',
  )

  const signedTx = TransactionBuilder.fromXDR(
    signed.signedTxXdr,
    networkPassphrase,
  )

  // 5. Submit and return the hash
  const sent = await server.sendTransaction(signedTx)
  if (sent.status === 'ERROR') {
    throw new Error(`Pool rejected the deposit: ${JSON.stringify(sent.errorResult)}`)
  }
  return { hash: sent.hash, sender: address }
}

// ---------------------------------------------------------------------------
// buildDepositTransaction — internal helper
// ---------------------------------------------------------------------------

/**
 * Build the unsigned pool.transact deposit transaction.
 *
 * ext_amount is POSITIVE (deposit, not withdrawal).
 * encrypted_outputs uses scvVec(scvBytes) — NOT nativeToScVal with a map.
 * This matches pool.rs ExtData { encrypted_outputs: Vec<Bytes> }.
 */
function buildDepositTransaction({
  source,
  proof,
  encOutputs,
  totalBaseUnits,
  sender,
  networkPassphrase,
}: {
  source: Account
  proof: Uint8Array
  encOutputs: Uint8Array[]
  totalBaseUnits: bigint
  sender: string
  networkPassphrase: string
}) {
  const { poolContractId } = readDeployments()
  const pool = new Contract(poolContractId)

  // Proof argument: the 256-byte Soroban-format Groth16 proof as scvBytes
  const proofArg: xdr.ScVal = xdr.ScVal.scvBytes(Buffer.from(proof))

  // ext_data argument: serialized as an ScMap with fields in alphabetical order
  // (encrypted_outputs → ext_amount → recipient) matching pool.rs #[contracttype].
  //
  // CRITICAL: encrypted_outputs MUST be scvVec(scvBytes), not a simple map value.
  // ext_amount is POSITIVE (nativeToScVal with type 'i256', no leading minus).
  const extDataArg: xdr.ScVal = nativeToScVal(
    {
      encrypted_outputs: xdr.ScVal.scvVec(
        encOutputs.map(b => xdr.ScVal.scvBytes(Buffer.from(b))),
      ),
      ext_amount: nativeToScVal(totalBaseUnits.toString(), { type: 'i256' }),
      recipient: new Address(sender).toScVal(),
    },
    {
      type: {
        encrypted_outputs: ['symbol', null],
        ext_amount: ['symbol', null],
        recipient: ['symbol', null],
      },
    },
  )

  const senderScVal = new Address(sender).toScVal()

  const op = pool.call('transact', proofArg, extDataArg, senderScVal)

  return new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(120)
    .build()
}
