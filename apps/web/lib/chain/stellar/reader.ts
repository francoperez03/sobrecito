/**
 * lib/chain/stellar/reader.ts — read-only Soroban simulations (ChainReader).
 *
 * Moved verbatim from lib/rpc.ts. Every method is a read-only
 * Server.simulateTransaction of a Contract.call — no signing, no gas. Returns
 * decimal strings where the witness builder needs field elements.
 */

import {
  Account,
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
} from '@stellar/stellar-sdk'
import { Server } from '@stellar/stellar-sdk/rpc'
import {
  MerkleProofUnavailableError,
  type ChainConfig,
  type ChainReader,
  type MerklePath,
} from '../types'

export function createStellarReader(config: ChainConfig): ChainReader {
  const { rpcUrl, poolId, usdcId, aspMembershipId, aspNonMembershipId, deployer } = config

  /** Simulate a single read-only contract.call and return its decimal U256. */
  async function getRootDecimal(contractId: string): Promise<string> {
    const server = new Server(rpcUrl)
    const contract = new Contract(contractId)
    const source = new Account(deployer, '0')
    const tx = new TransactionBuilder(source, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call('get_root'))
      .setTimeout(30)
      .build()

    const sim = await server.simulateTransaction(tx)
    if ('error' in sim && sim.error) throw new Error(sim.error)
    const retval = (sim as { result?: { retval?: unknown } }).result?.retval
    // Explicit null check: `!retval` incorrectly rejects BigInt(0n).
    if (retval == null) throw new Error(`reader: simulation returned no value for ${contractId}`)
    return BigInt(scValToNative(retval as never) as bigint | number).toString()
  }

  async function balanceOf(address: string): Promise<bigint> {
    const server = new Server(rpcUrl)
    const usdc = new Contract(usdcId)
    const source = new Account(deployer, '0')
    const tx = new TransactionBuilder(source, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(usdc.call('balance', Address.fromString(address).toScVal()))
      .setTimeout(30)
      .build()

    const sim = await server.simulateTransaction(tx)
    if ('error' in sim && sim.error) throw new Error(sim.error)
    const retval = (sim as { result?: { retval?: unknown } }).result?.retval
    if (!retval) throw new Error('balance simulation returned no value')
    return BigInt(scValToNative(retval as never) as bigint | number)
  }

  return {
    poolRoot() {
      return getRootDecimal(poolId)
    },

    async aspRoots() {
      const [memberRoot, nonMemberRoot] = await Promise.all([
        getRootDecimal(aspMembershipId),
        getRootDecimal(aspNonMembershipId),
      ])
      return { memberRoot, nonMemberRoot }
    },

    usdcBalance(address: string) {
      return balanceOf(address)
    },

    poolUsdcBalance() {
      return balanceOf(poolId)
    },

    /**
     * A1 fallback: pool.is_spent is a PRIVATE fn (not callable via simulate). We
     * still attempt the call; on ANY error or missing retval we return false
     * (treat as 'pending'). The pool rejects a double-claim on submit regardless.
     */
    async nullifierSpent(nullifier: bigint) {
      try {
        const server = new Server(rpcUrl)
        const pool = new Contract(poolId)
        const source = new Account(deployer, '0')
        const tx = new TransactionBuilder(source, {
          fee: '100',
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(pool.call('is_spent', nativeToScVal(nullifier.toString(), { type: 'u256' })))
          .setTimeout(30)
          .build()
        const sim = await server.simulateTransaction(tx)
        if ('error' in sim && sim.error) return false
        const retval = (sim as { result?: { retval?: unknown } }).result?.retval
        if (!retval) return false
        return Boolean(scValToNative(retval as never))
      } catch {
        return false
      }
    },

    /**
     * A2 fallback: pool.get_proof is ABSENT from pool.rs. The simulate call fails
     * or returns no value; this throws MerkleProofUnavailableError so the caller
     * switches to client-side reconstruction from events. This wrapper is also a
     * mock seam for test suites that inject a fake get_proof response.
     */
    async merkleProof(index: number): Promise<MerklePath> {
      try {
        const server = new Server(rpcUrl)
        const pool = new Contract(poolId)
        const source = new Account(deployer, '0')
        const tx = new TransactionBuilder(source, {
          fee: '100',
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(pool.call('get_proof', nativeToScVal(index, { type: 'u32' })))
          .setTimeout(30)
          .build()
        const sim = await server.simulateTransaction(tx)
        if ('error' in sim && sim.error) throw new MerkleProofUnavailableError()
        const retval = (sim as { result?: { retval?: unknown } }).result?.retval
        if (retval == null) throw new MerkleProofUnavailableError()
        const parsed = scValToNative(retval as never) as MerklePath
        if (!parsed || typeof parsed !== 'object' || !('pathElements' in parsed)) {
          throw new MerkleProofUnavailableError()
        }
        return parsed
      } catch (err) {
        if (err instanceof MerkleProofUnavailableError) throw err
        throw new MerkleProofUnavailableError()
      }
    },

    /**
     * Funded amount of a batch (base units) from its transact tx. Per-note amounts
     * are sealed in the events, so the batch total is read from ext_data.ext_amount
     * on the deposit. Returns null on any failure (tx outside RPC retention, decode
     * error) so callers can fall back gracefully.
     */
    async batchExtAmount(txHash: string): Promise<bigint | null> {
      if (!txHash) return null
      try {
        const server = new Server(rpcUrl)
        const res = await server.getTransaction(txHash)
        if (res.status !== 'SUCCESS' || !res.envelopeXdr) return null
        const tx = TransactionBuilder.fromXDR(res.envelopeXdr, Networks.TESTNET) as unknown as {
          operations?: Array<{ func?: { invokeContract?: () => { args: () => unknown[] } } }>
        }
        for (const op of tx.operations ?? []) {
          const invoke = op.func?.invokeContract?.()
          if (!invoke) continue
          const args = invoke.args()
          // transact(proof, ext_data, sender) → ext_data is arg index 1.
          if (args.length < 2) continue
          const extData = scValToNative(args[1] as never) as { ext_amount?: bigint | number }
          if (extData?.ext_amount == null) continue
          const amt = BigInt(extData.ext_amount)
          return amt < BigInt(0) ? -amt : amt
        }
        return null
      } catch {
        return null
      }
    },
  }
}
