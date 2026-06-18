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
 * Fetch the funded amount of a batch (USDC base units) from its transact tx.
 *
 * Per-note amounts are sealed in the scanned commitment events, so the batch
 * total can't be derived client-side from the events. It IS the deposit's
 * `ext_data.ext_amount`, read here from the transaction. Returns the absolute
 * value (deposits are positive). Returns null on any failure (tx outside RPC
 * retention, decode error) so callers can fall back gracefully.
 */
export async function fetchBatchExtAmount(txHash: string): Promise<bigint | null> {
  if (!txHash) return null
  try {
    const { rpcUrl } = readDeployments()
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
  // Use explicit null/undefined check: `!retval` incorrectly rejects BigInt(0n).
  if (retval == null) throw new Error('fetchPoolRoot: simulation returned no value')
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
    // Use explicit null/undefined check: `!retval` incorrectly rejects BigInt(0n).
    if (retval == null) throw new Error(`fetchASPRoots: simulation returned no value for ${contractId}`)
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

/**
 * Read the on-chain USDC balance of an arbitrary account (e.g. the connected
 * employer wallet) via a read-only SAC `balance(address)` simulation. Returns
 * the balance in USDC base units (7 decimals).
 */
export async function fetchUsdcBalance(accountAddress: string): Promise<bigint> {
  const { rpcUrl, usdcContractId, deployer } = readDeployments()
  const server = new Server(rpcUrl)
  const usdc = new Contract(usdcContractId)
  const source = new Account(deployer, '0')
  const tx = new TransactionBuilder(source, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(usdc.call('balance', Address.fromString(accountAddress).toScVal()))
    .setTimeout(30)
    .build()

  const sim = await server.simulateTransaction(tx)
  if ('error' in sim && sim.error) throw new Error(sim.error)
  const retval = (sim as { result?: { retval?: unknown } }).result?.retval
  if (!retval) throw new Error('USDC balance simulation returned no value')
  return BigInt(scValToNative(retval as never) as bigint | number)
}

// ---------------------------------------------------------------------------
// fetchNullifierStatus (A1 fallback)
// ---------------------------------------------------------------------------

/**
 * Check whether a nullifier has been spent on the pool contract.
 *
 * A1 fallback: pool.is_spent is a PRIVATE fn (confirmed in pool.rs, plan 01
 * Wave 0). NOT callable via simulateTransaction. We still attempt the call; on
 * ANY error or missing retval we return false (treat as 'pending').
 * This degrades gracefully: the pool will reject a double-claim on submit
 * regardless (AlreadySpentNullifier). The status precheck is best-effort.
 *
 * Never throws into the UI (T-063-09 mitigation: RPC simulate error stalls scan).
 */
export async function fetchNullifierStatus(nullifier: bigint): Promise<boolean> {
  try {
    const { rpcUrl, poolContractId, deployer } = readDeployments()
    const server = new Server(rpcUrl)
    const pool = new Contract(poolContractId)
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
}

// ---------------------------------------------------------------------------
// fetchMerkleProof (A2 fallback)
// ---------------------------------------------------------------------------

/**
 * Typed error thrown when get_proof is absent so the caller can switch to the
 * client-side reconstructMerklePathFromEvents fallback.
 */
export class MerkleProofUnavailableError extends Error {
  constructor() {
    super('pool.get_proof is absent; use reconstructMerklePathFromEvents instead (A2 fallback)')
    this.name = 'MerkleProofUnavailableError'
  }
}

/**
 * Attempt to fetch the Merkle path for a commitment at `index` from the pool.
 *
 * A2 fallback: pool.get_proof is ABSENT from pool.rs (confirmed in plan 01 Wave 0).
 * The simulate call will fail or return no value, at which point this function
 * throws MerkleProofUnavailableError. The claim flow in plan 04 catches this
 * error and delegates to reconstructMerklePathFromEvents (employee-scan.ts).
 *
 * This wrapper exists as a mock seam: test suites can intercept simulateTransaction
 * to inject a fake get_proof response without touching the reconstruction helper.
 */
export async function fetchMerkleProof(
  index: number,
): Promise<{ pathElements: string[]; pathIndices: string }> {
  try {
    const { rpcUrl, poolContractId, deployer } = readDeployments()
    const server = new Server(rpcUrl)
    const pool = new Contract(poolContractId)
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
    const parsed = scValToNative(retval as never) as { pathElements: string[]; pathIndices: string }
    // Verify the parsed value has the expected shape; if not, the pool doesn't expose get_proof.
    if (!parsed || typeof parsed !== 'object' || !('pathElements' in parsed)) {
      throw new MerkleProofUnavailableError()
    }
    return parsed
  } catch (err) {
    if (err instanceof MerkleProofUnavailableError) throw err
    throw new MerkleProofUnavailableError()
  }
}
