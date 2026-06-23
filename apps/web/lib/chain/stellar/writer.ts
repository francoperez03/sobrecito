/**
 * lib/chain/stellar/writer.ts — build + sign + submit pool.transact (ChainWriter).
 *
 * Moved from lib/employer-deposit.ts (submitDeposit/buildDepositTransaction) and
 * lib/employee-unshield.ts (unshieldNote/buildUnshieldTransaction). The deployed
 * pool's transact takes a structured `Proof` (NOT raw bytes); the proof + ext_data
 * ScVals are built here via the encoding module so the domain never touches xdr.
 *
 *   - deposit:  ext_amount POSITIVE, encrypted_outputs = the 8 dual blobs.
 *   - withdraw: ext_amount NEGATIVE, encrypted_outputs = [] (the note amount
 *               becomes public on-chain — the only such point, amber-warned in UI).
 */

import {
  Address,
  Contract,
  nativeToScVal,
  rpc as StellarRpc,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk'
import type {
  ChainConfig,
  ChainWriter,
  DepositArgs,
  DepositResult,
  WalletAdapter,
  WithdrawArgs,
  WithdrawResult,
} from '../types'
import { buildExtDataScVal, buildProofScVal } from './encoding'

/**
 * Poll the RPC until the submitted tx is applied to a closed ledger (SUCCESS) or
 * fails. `sendTransaction` returns while the tx is still PENDING; returning then
 * leaves the account sequence un-advanced from the RPC's point of view, so the
 * NEXT build reads a stale sequence and the next submit fails with txBadSeq
 * (e.g. claiming two notes in a row without refreshing). Waiting here also makes
 * the UI receipt ("Cashed out" / "Confirmed") reflect real on-chain success and
 * lets the nullifier-status scan find the just-spent note.
 */
async function waitForTx(server: StellarRpc.Server, hash: string, label: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((r) => setTimeout(r, 1500))
    const res = await server.getTransaction(hash)
    if (res.status === 'SUCCESS') return
    if (res.status === 'FAILED') {
      const detail = (res as { resultXdr?: { toXDR?: (fmt: string) => string } }).resultXdr
      throw new Error(`${label}: ${detail?.toXDR ? detail.toXDR('base64') : JSON.stringify(res)}`)
    }
    // NOT_FOUND → not yet in a closed ledger, keep polling
  }
  throw new Error(`${label}: confirmation timed out`)
}

export function createStellarWriter(config: ChainConfig, wallet: WalletAdapter): ChainWriter {
  const { rpcUrl, networkId, baseFee, poolId } = config

  async function deposit(args: DepositArgs): Promise<DepositResult> {
    // 1. Ensure wallet access + network guard (connect is idempotent). When the
    //    caller pre-resolved the sender, use it as-is; otherwise the connected one.
    const connected = await wallet.connect()
    const sender = args.sender ?? connected

    const server = new StellarRpc.Server(rpcUrl)
    const source = await server.getAccount(sender)

    // 2. Build pool.transact(proof, ext_data, sender). ext_amount POSITIVE.
    // args.proof = the 14592-byte UltraHonk proof blob; publicInputsBlob = the
    // 384-byte public-inputs blob (both come from bb 0.87.0 prove() output).
    const proofArg = buildProofScVal({
      ...args.publicInputs,
      proofBytes: args.proof,
      publicInputsBlob: args.publicInputs.publicInputsBlob,
    })
    const extDataArg = buildExtDataScVal({
      recipient: sender,
      ext_amount: args.totalBaseUnits,
      encrypted_outputs: args.encOutputs,
    })
    const senderScVal = new Address(sender).toScVal()
    const pool = new Contract(poolId)
    const tx = new TransactionBuilder(source, { fee: baseFee, networkPassphrase: networkId })
      .addOperation(pool.call('transact', proofArg, extDataArg, senderScVal))
      .setTimeout(120)
      .build()

    // 3. prepare → sign (wallet shows the tx) → submit.
    const prepared = await server.prepareTransaction(tx)
    const signedXdr = await wallet.signXdr(prepared.toXDR(), sender)
    const signedTx = TransactionBuilder.fromXDR(signedXdr, networkId)
    const sent = await server.sendTransaction(signedTx)
    if (sent.status === 'ERROR') {
      throw new Error(`Pool rejected the deposit: ${JSON.stringify(sent.errorResult)}`)
    }
    // Wait for the deposit to close so the account sequence advances before any
    // follow-up tx (prevents txBadSeq) and the receipt reflects real success.
    await waitForTx(server, sent.hash, 'Pool rejected the deposit')
    return { hash: sent.hash, sender }
  }

  async function withdraw(args: WithdrawArgs): Promise<WithdrawResult> {
    // 1. Ensure wallet access + network guard (connect is idempotent). When
    //    claimNote pre-resolved the recipient (it binds into ext_data_hash), use
    //    it as-is; otherwise the connected address.
    const connected = await wallet.connect()
    const recipient = args.recipient ?? connected

    const server = new StellarRpc.Server(rpcUrl)
    const source = await server.getAccount(recipient)
    const pool = new Contract(args.poolId)

    // 2. Proof argument: pre-built blob from a claim link, structured proof, or a
    //    demo placeholder (the wallet still signs a real tx).
    // args.proof = the 14592-byte UltraHonk proof blob; publicInputsBlob comes from
    // publicInputs (the 384-byte blob). Both forwarded into the alphabetical ScMap.
    const proofArg: xdr.ScVal = args.proofXdr
      ? xdr.ScVal.fromXDR(args.proofXdr, 'base64')
      : args.proof && args.publicInputs
        ? buildProofScVal({
            ...args.publicInputs,
            proofBytes: args.proof,
            publicInputsBlob: args.publicInputs.publicInputsBlob,
          })
        : nativeToScVal(args.commitmentIndex, { type: 'u32' })

    // 3. ext_data argument: pre-built blob, or built from recipient + NEGATIVE
    //    amount + empty encrypted_outputs (must be present and empty so the
    //    on-chain hash_ext_data matches the proof.ext_data_hash).
    const extDataArg: xdr.ScVal = args.extDataXdr
      ? xdr.ScVal.fromXDR(args.extDataXdr, 'base64')
      : buildExtDataScVal({
          recipient,
          ext_amount: -BigInt(args.amount),
          encrypted_outputs: [],
        })

    const tx = new TransactionBuilder(source, { fee: baseFee, networkPassphrase: networkId })
      .addOperation(pool.call('transact', proofArg, extDataArg, new Address(recipient).toScVal()))
      .setTimeout(120)
      .build()

    // 4. prepare → sign → submit. The recipient pays their own fee.
    const prepared = await server.prepareTransaction(tx)
    const signedXdr = await wallet.signXdr(prepared.toXDR(), recipient)
    const signedTx = TransactionBuilder.fromXDR(signedXdr, networkId)
    const sent = await server.sendTransaction(signedTx)
    if (sent.status === 'ERROR') {
      throw new Error(`Pool rejected the unshield: ${JSON.stringify(sent.errorResult)}`)
    }
    // Wait for the unshield to close so claiming the next note reads a fresh
    // account sequence (prevents txBadSeq) and "Cashed out" means confirmed.
    await waitForTx(server, sent.hash, 'Pool rejected the unshield')
    return { hash: sent.hash, recipient }
  }

  return { deposit, withdraw }
}
