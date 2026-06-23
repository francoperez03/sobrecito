/**
 * lib/chain/stellar/config.ts — resolve ChainConfig from the testnet deployment.
 *
 * Single source of truth: ops/deployments/testnet/deployments.json. The previous
 * readDeployments() in lib/rpc.ts is reimplemented here so the Stellar constants
 * (RPC URL, network passphrase, base fee) live in one place behind the adapter.
 */

import type { ChainConfig } from '../types'
import deployments from '../../../../../ops/deployments/testnet/deployments.json'

/** Soroban testnet RPC. */
export const RPC_URL = 'https://soroban-testnet.stellar.org'
/** Stellar testnet network passphrase (the chain's network identity). */
export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'
/** Base fee in stroops (the submitter pays the fee). */
export const BASE_FEE = '1000000'
/** USDC has 7 decimals on the Stellar SAC. 1 USDC = 10_000_000 base units. */
export const USDC_DECIMALS = 7

let cached: ChainConfig | null = null

/** Resolve and memoize the live testnet ChainConfig. */
export function stellarConfig(): ChainConfig {
  if (cached) return cached
  // poolId points at the UltraHonk noir_pool (CCZKS7KD…), not the legacy Groth16
  // pools[0] (CBLJ33QH…). Sending an UltraHonk proof to the Groth16 pool would
  // fail verification (T-09.1-08 mitigation).
  const d = deployments as typeof deployments & {
    noir_pool: string
    noir_pool_deployment_ledger: number
  }
  cached = {
    rpcUrl: RPC_URL,
    networkId: TESTNET_PASSPHRASE,
    baseFee: BASE_FEE,
    poolId: d.noir_pool,
    // USDC SAC id stays from the original pools[0] deployment.
    usdcId: deployments.pools[0].tokenContractId,
    aspMembershipId: deployments.asp_membership,
    aspNonMembershipId: deployments.asp_non_membership,
    deployer: deployments.deployer,
    auditorPubkeyHex:
      (deployments as { auditorPubkeyHex?: string }).auditorPubkeyHex ?? '',
    // noir_pool_deployment_ledger (3211979) is the scan start for this pool.
    // If the noir_pool were empty at that ledger the only cost is a slightly
    // early scan start (harmless overhead — no missed events, just empty pages).
    deploymentLedger: d.noir_pool_deployment_ledger,
  }
  return cached
}

/** Block-explorer (stellar.expert, testnet) transaction URL. */
export function explorerTxUrl(txHash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${txHash}`
}
