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

export function createStellarWriter(config: ChainConfig, wallet: WalletAdapter): ChainWriter {
  const { rpcUrl, networkId, baseFee, poolId } = config

  async function deposit(args: DepositArgs): Promise<DepositResult> {
    // 1. Resolve sender + network guard.
    const sender = args.sender ?? (await wallet.connect())
    await wallet.assertExpectedNetwork()

    const server = new StellarRpc.Server(rpcUrl)
    const source = await server.getAccount(sender)

    // 2. Build pool.transact(proof, ext_data, sender). ext_amount POSITIVE.
    const proofArg = buildProofScVal({ proof: args.proof, ...args.publicInputs })
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
    return { hash: sent.hash, sender }
  }

  async function withdraw(args: WithdrawArgs): Promise<WithdrawResult> {
    // 1. Resolve recipient + network guard. When claimNote pre-resolved the
    //    recipient (it binds into ext_data_hash), use it as-is.
    const recipient = args.recipient ?? (await wallet.connect())
    await wallet.assertExpectedNetwork()

    const server = new StellarRpc.Server(rpcUrl)
    const source = await server.getAccount(recipient)
    const pool = new Contract(args.poolId)

    // 2. Proof argument: pre-built blob from a claim link, structured proof, or a
    //    demo placeholder (the wallet still signs a real tx).
    const proofArg: xdr.ScVal = args.proofXdr
      ? xdr.ScVal.fromXDR(args.proofXdr, 'base64')
      : args.proof && args.publicInputs
        ? buildProofScVal({ proof: args.proof, ...args.publicInputs })
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
    return { hash: sent.hash, recipient }
  }

  return { deposit, withdraw }
}
