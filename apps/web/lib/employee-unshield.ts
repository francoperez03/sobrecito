/**
 * employee-unshield.ts — the Freighter-fallback unshield (RESEARCH D-12 verdict #1).
 *
 * The DEFAULT employee-claim path. The OZ Relayer + passkey gasless path was NOT
 * deliverable in the hackathon window (hosted testnet API key never obtained,
 * passkey factory not in our deployments — see docs/gasless-upgrade-path.md), so
 * the employee signs the unshield with Freighter and pays their own XLM fee.
 *
 * The flow preserves A1 (unlinkability): the note key lives only in the claim
 * link, the employee chooses a fresh recipient address and the moment to claim, so
 * the on-chain withdraw is never re-linked to the employer's payroll batch by an
 * observer (D-06). The withdraw IS the single point where an individual amount
 * becomes public on-chain (T-06-16) — amber-warned in the UI BEFORE the CTA.
 *
 * What this builds: a `pool.transact` with `ext_amount < 0` (a withdrawal) whose
 * `recipient` is the employee's Freighter address. The withdrawal proof and
 * ext_data are carried by the note metadata decoded from the link token (the proof
 * is generated off-line during `sobre pay` and embedded with the note key —
 * RESEARCH Open Question 2). Freighter signs the assembled Soroban transaction;
 * the signed XDR is submitted via the Soroban RPC; the tx hash is returned.
 *
 * Honest disclosure: the on-chain `transact` moves shielded BN254 field values, not
 * real USDC (the testnet 1-USDC cap is respected). The amount the employee sees
 * revealed is the note's field value, the same quantity the auditor reconstructs.
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

const RPC_URL = 'https://soroban-testnet.stellar.org'
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'
/** Base fee in stroops. The employee pays their own fee (fallback #1). */
const BASE_FEE = '1000000'

/**
 * Note metadata decoded from the claim link token. Everything the unshield needs
 * comes from the link (commitment index, the X25519 note privkey, the blinding)
 * plus the pre-generated withdrawal proof + ext_data the employer embedded during
 * `sobre pay`. The token is a bearer credential (T-06-17): it is never persisted
 * server-side and never logged.
 */
export interface NoteMeta {
  /** The pool (Soroban contract C…) holding the shielded note. */
  poolContractId: string
  /** Commitment leaf index of the note being unshielded. */
  commitmentIndex: number
  /** The note's shielded amount (BN254 field value, revealed after claim). */
  amount: string
  /** X25519 note private key (hex) — opens the employee half of the dual blob. */
  notePrivkeyHex: string
  /** Note blinding factor (decimal string) bound into the commitment. */
  blinding: string
  /**
   * Pre-generated withdrawal artifact embedded during `sobre pay`: the base64
   * proof_arg + ext_data_arg the pool `transact` consumes. Optional in the demo —
   * when absent the lib builds a placeholder ext_data so the Freighter signature
   * path is still exercised end to end.
   */
  withdrawProofXdr?: string
  withdrawExtDataXdr?: string
}

export interface UnshieldResult {
  /** The submitted Soroban transaction hash. */
  hash: string
  /** The recipient address the employee chose (their Freighter account). */
  recipient: string
}

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

/**
 * Build, sign (Freighter), and submit the unshield (pool withdraw) for a single
 * note. Returns the tx hash. The employee pays their own fee.
 *
 * Steps:
 *  1. Ask Freighter for access + the employee's address (the withdraw recipient).
 *  2. Confirm Freighter is on testnet (the pool lives on testnet).
 *  3. Build a `pool.transact` invocation: `ext_amount` negative, `recipient` =
 *     the employee address, proof + ext_data from the note metadata.
 *  4. Prepare the transaction against the Soroban RPC (footprint + resource fees).
 *  5. Hand the XDR to Freighter to sign — the wallet shows the tx to the employee
 *     before signing (T-06-19).
 *  6. Submit the signed XDR via the RPC and return the hash.
 */
export async function unshieldNote(noteMeta: NoteMeta): Promise<UnshieldResult> {
  // 1. Freighter access + recipient address.
  await unwrapFreighter(await requestAccess(), 'requestAccess')
  const { address } = unwrapFreighter(await getAddress(), 'getAddress')
  if (!address) {
    throw new Error('Freighter returned no address. Unlock the wallet and retry.')
  }

  // 2. Network guard — the pool is on testnet.
  const { networkPassphrase } = unwrapFreighter(await getNetwork(), 'getNetwork')
  if (networkPassphrase !== TESTNET_PASSPHRASE) {
    throw new Error('Switch Freighter to Testnet to claim this note.')
  }

  const server = new StellarRpc.Server(RPC_URL)
  const source = await server.getAccount(address)

  // 3. Assemble the pool.transact (withdraw) invocation.
  const tx = buildUnshieldTransaction({
    source,
    noteMeta,
    recipient: address,
    networkPassphrase,
  })

  // 4. Let the RPC compute the footprint + resource fees for the contract call.
  const prepared = await server.prepareTransaction(tx)

  // 5. Freighter signs the prepared XDR (the wallet shows the tx, T-06-19).
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

  // 6. Submit and return the hash. The employee paid their own fee.
  const sent = await server.sendTransaction(signedTx)
  if (sent.status === 'ERROR') {
    throw new Error(`Pool rejected the unshield: ${JSON.stringify(sent.errorResult)}`)
  }
  return { hash: sent.hash, recipient: address }
}

/**
 * Build the unsigned `pool.transact` withdrawal transaction. The proof + ext_data
 * come from the note metadata when present (the artifact `sobre pay` embedded in
 * the link); otherwise a minimal ext_data placeholder is built so the Freighter
 * signature path is still exercised in the demo. `ext_amount` is negative — this is
 * a withdrawal, the only place an amount surfaces on-chain (amber-warned).
 */
function buildUnshieldTransaction({
  source,
  noteMeta,
  recipient,
  networkPassphrase,
}: {
  source: Account
  noteMeta: NoteMeta
  recipient: string
  networkPassphrase: string
}) {
  const pool = new Contract(noteMeta.poolContractId)

  // Proof argument: the pre-generated withdrawal proof embedded in the link, or a
  // placeholder ScVal when absent (demo-only — the wallet still signs a real tx).
  const proofArg: xdr.ScVal = noteMeta.withdrawProofXdr
    ? xdr.ScVal.fromXDR(noteMeta.withdrawProofXdr, 'base64')
    : nativeToScVal(noteMeta.commitmentIndex, { type: 'u32' })

  // ext_data argument: the embedded ext_data (recipient + negative ext_amount +
  // encrypted_outputs), or a struct assembled from the recipient + amount here.
  const extDataArg: xdr.ScVal = noteMeta.withdrawExtDataXdr
    ? xdr.ScVal.fromXDR(noteMeta.withdrawExtDataXdr, 'base64')
    : nativeToScVal(
        {
          // A withdrawal produces no encrypted outputs — an empty Vec<Bytes>.
          // It MUST be present (and empty) so hash_ext_data on-chain matches the
          // proof.ext_data_hash computed with encrypted_outputs: [].
          encrypted_outputs: xdr.ScVal.scvVec([]),
          // Negative ext_amount = withdrawal. The note amount becomes public.
          ext_amount: nativeToScVal(`-${noteMeta.amount}`, { type: 'i256' }),
          recipient: new Address(recipient).toScVal(),
        },
        {
          type: {
            encrypted_outputs: ['symbol', null],
            ext_amount: ['symbol', null],
            recipient: ['symbol', null],
          },
        },
      )

  const op = pool.call(
    'transact',
    proofArg,
    extDataArg,
    new Address(recipient).toScVal(),
  )

  return new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(120)
    .build()
}
