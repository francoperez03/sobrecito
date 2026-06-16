import deployments from '../../../ops/deployments/testnet/deployments.json'

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
  }
}
