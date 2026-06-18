/**
 * rpc.ts — chain-read facade over the ChainAdapter.
 *
 * The Soroban simulation + deployment-config logic moved into lib/chain (the
 * StellarAdapter). This module keeps the historical function names the app's
 * components/pages import, delegating each to getChainAdapter(). Swapping chains
 * needs no change here. The two pure helpers (formatUsdc, USDC_DECIMALS) carry no
 * chain coupling and stay inline.
 */

import { getChainAdapter, MerkleProofUnavailableError, type MerklePath } from './chain'

export { MerkleProofUnavailableError }

/** USDC has 7 decimals on the Stellar SAC. 1 USDC = 10_000_000 base units. */
export const USDC_DECIMALS = 7

/**
 * Deployment values, preserved in the original readDeployments() shape so existing
 * callers (pages, PayrollComposer, employee-claim) keep working unchanged.
 */
export function readDeployments() {
  const c = getChainAdapter().config
  return {
    rpcUrl: c.rpcUrl,
    poolContractId: c.poolId,
    deploymentLedger: c.deploymentLedger,
    usdcContractId: c.usdcId,
    deployer: c.deployer,
    auditorPubkeyHex: c.auditorPubkeyHex,
    aspMembershipId: c.aspMembershipId,
    aspNonMembershipId: c.aspNonMembershipId,
  }
}

/** Block-explorer (stellarchain.io, testnet) transaction URL for a tx hash. */
export function explorerTxUrl(txHash: string): string {
  return getChainAdapter().explorerTxUrl(txHash)
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

/** Funded amount of a batch (USDC base units) from its transact tx, or null. */
export function fetchBatchExtAmount(txHash: string): Promise<bigint | null> {
  return getChainAdapter().reader.batchExtAmount(txHash)
}

/** Live pool Merkle root as a decimal string (read-only simulation). */
export function fetchPoolRoot(): Promise<string> {
  return getChainAdapter().reader.poolRoot()
}

/** Live ASP membership + non-membership roots (decimal strings). */
export function fetchASPRoots(): Promise<{ memberRoot: string; nonMemberRoot: string }> {
  return getChainAdapter().reader.aspRoots()
}

/** Real on-chain USDC balance of the pool contract (base units). */
export function readPoolUsdcBalance(): Promise<bigint> {
  return getChainAdapter().reader.poolUsdcBalance()
}

/** On-chain USDC balance of an arbitrary account (base units). */
export function fetchUsdcBalance(accountAddress: string): Promise<bigint> {
  return getChainAdapter().reader.usdcBalance(accountAddress)
}

/** Best-effort spent check for a nullifier (A1 fallback; conservatively false). */
export function fetchNullifierStatus(nullifier: bigint): Promise<boolean> {
  return getChainAdapter().reader.nullifierSpent(nullifier)
}

/** Merkle path for a commitment; throws MerkleProofUnavailableError if absent (A2). */
export function fetchMerkleProof(index: number): Promise<MerklePath> {
  return getChainAdapter().reader.merkleProof(index)
}
