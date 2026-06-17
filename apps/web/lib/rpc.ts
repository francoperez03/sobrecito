import {
  Account,
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  scValToNative,
} from '@stellar/stellar-sdk'
import { Server } from '@stellar/stellar-sdk/rpc'
import deployments from '../../../ops/deployments/testnet/deployments.json'

/** USDC has 7 decimals on the Stellar SAC. 1 USDC = 10_000_000 base units. */
export const USDC_DECIMALS = 7

/**
 * Live testnet deployment values, read from the single source of truth at
 * ops/deployments/testnet/deployments.json. Both the employer dashboard and the
 * auditor console read the live pool via RPC (D-07 / D-09), so they share this.
 */
export function readDeployments() {
  return {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    poolContractId: deployments.pools[0].poolContractId,
    deploymentLedger: deployments.pools[0].deploymentLedger,
    usdcContractId: deployments.pools[0].tokenContractId,
    deployer: deployments.deployer,
    /** Published auditor X25519 pubkey (64-char hex). Persisted in deployments.json (D3).
     *  IMPORTANT: fill with the real auditor pubkey from the Phase 06.1 keygen before the testnet demo. */
    auditorPubkeyHex: (deployments as { auditorPubkeyHex?: string }).auditorPubkeyHex ?? '',
    /** ASP contract IDs for the membership/non-membership proofs. */
    aspMembershipId: deployments.asp_membership,
    aspNonMembershipId: deployments.asp_non_membership,
  }
}

/** Block-explorer (stellar.expert, testnet) transaction URL for a tx hash. */
export function explorerTxUrl(txHash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${txHash}`
}

/** Format USDC base units (7 decimals) as a human string, trimming trailing zeros.
 *  Uses BigInt() (not `0n`/`1n` literals) because the web tsconfig targets ES2017. */
export function formatUsdc(base: bigint): string {
  const ZERO = BigInt(0)
  const SCALE = BigInt(10_000_000)
  const neg = base < ZERO
  const v = neg ? -base : base
  const int = v / SCALE
  const frac = v % SCALE
  let s = int.toString()
  if (frac > ZERO) s += '.' + frac.toString().padStart(7, '0').replace(/0+$/, '')
  return (neg ? '-' : '') + s
}

/**
 * Fetch the live Merkle root of the pool contract via a read-only Soroban
 * simulation of `pool.get_root()`. Returns a DECIMAL STRING (the witness builder
 * needs decimal-string field elements). No signing or gas required.
 */
export async function fetchPoolRoot(): Promise<string> {
  const { rpcUrl, poolContractId, deployer } = readDeployments()
  const server = new Server(rpcUrl)
  const pool = new Contract(poolContractId)
  const source = new Account(deployer, '0')
  const tx = new TransactionBuilder(source, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(pool.call('get_root'))
    .setTimeout(30)
    .build()

  const sim = await server.simulateTransaction(tx)
  if ('error' in sim && sim.error) throw new Error(sim.error)
  const retval = (sim as { result?: { retval?: unknown } }).result?.retval
  if (!retval) throw new Error('fetchPoolRoot: simulation returned no value')
  return BigInt(scValToNative(retval as never) as bigint | number).toString()
}

/**
 * Fetch the live Merkle roots of both ASP contracts (membership and non-membership)
 * via read-only Soroban simulations of `get_root()`. Returns decimal strings.
 * No signing or gas required.
 */
export async function fetchASPRoots(): Promise<{
  memberRoot: string
  nonMemberRoot: string
}> {
  const { rpcUrl, aspMembershipId, aspNonMembershipId, deployer } =
    readDeployments()
  const server = new Server(rpcUrl)

  async function getRootDecimal(contractId: string): Promise<string> {
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
    if (!retval) throw new Error(`fetchASPRoots: simulation returned no value for ${contractId}`)
    return BigInt(scValToNative(retval as never) as bigint | number).toString()
  }

  const [memberRoot, nonMemberRoot] = await Promise.all([
    getRootDecimal(aspMembershipId),
    getRootDecimal(aspNonMembershipId),
  ])

  return { memberRoot, nonMemberRoot }
}

/**
 * Read the REAL on-chain USDC balance of the pool contract via a read-only
 * Soroban simulation of the SAC `balance(pool)` call. This is the actual total
 * deposited into the pool — the public, verified-on-chain predicate value the
 * employer dashboard shows (no demo constant).
 */
export async function readPoolUsdcBalance(): Promise<bigint> {
  const { rpcUrl, poolContractId, usdcContractId, deployer } = readDeployments()
  const server = new Server(rpcUrl)
  const usdc = new Contract(usdcContractId)
  // Simulation does not submit or need funding; the source is only a placeholder.
  const source = new Account(deployer, '0')
  const tx = new TransactionBuilder(source, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(usdc.call('balance', Address.fromString(poolContractId).toScVal()))
    .setTimeout(30)
    .build()

  const sim = await server.simulateTransaction(tx)
  if ('error' in sim && sim.error) throw new Error(sim.error)
  const retval = (sim as { result?: { retval?: unknown } }).result?.retval
  if (!retval) throw new Error('balance simulation returned no value')
  return BigInt(scValToNative(retval as never) as bigint | number)
}
