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
  cached = {
    rpcUrl: RPC_URL,
    networkId: TESTNET_PASSPHRASE,
    baseFee: BASE_FEE,
    poolId: deployments.pools[0].poolContractId,
    usdcId: deployments.pools[0].tokenContractId,
    aspMembershipId: deployments.asp_membership,
    aspNonMembershipId: deployments.asp_non_membership,
    deployer: deployments.deployer,
    auditorPubkeyHex:
      (deployments as { auditorPubkeyHex?: string }).auditorPubkeyHex ?? '',
    deploymentLedger: deployments.pools[0].deploymentLedger,
  }
  return cached
}

/** Block-explorer (stellarchain.io, testnet) transaction URL. */
export function explorerTxUrl(txHash: string): string {
  return `https://testnet.stellarchain.io/transactions/${txHash}`
}
