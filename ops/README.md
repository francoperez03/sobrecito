# ops

Deployment and on-chain operations for Sobrecito on Stellar **testnet**. The
single source of truth for on-chain addresses is
[`deployments/testnet/deployments.json`](deployments/testnet/deployments.json).

## Contents

- **`deploy-noir-pool.sh`** — the live deploy. Reuses the deployed UltraHonk
  verifier, deploys a fresh `pool.wasm` (UltraHonk edition, empty Merkle tree)
  against the USDC SAC testnet token, runs a real deposit/transact end to end, and
  writes `ultrahonk_verifier`, `noir_pool`, `bb_version` and `vk_hash` into
  `deployments.json`. Requires `bb 0.87.0`, `nargo 1.0.0-beta.9`, the `stellar` CLI,
  `ts-node`, `node`.
- **`scripts/gen-real-deposit-blobs.mjs`** — builds the 8 dual ECIES blobs
  (employee + auditor ciphertexts) and the `ext_data` argument for a real batch.
- **`scripts/submit-real-batch.sh`** — submits one real `pool.transact` to the
  deployed `noir_pool`, carrying those 8 blobs as `encrypted_outputs`.
- **`fixtures/demo.csv`** — sample payroll for the demo.

## deployments.json

Live (Noir) keys: `noir_pool`, `ultrahonk_verifier`, `noir_pool_token` (USDC SAC),
`bb_version`, `vk_hash`, `auditorPubkeyHex`. The web app reads `noir_pool` /
`noir_pool_token` from here via `apps/web/lib/chain/stellar/config.ts`. The legacy
Groth16 entries (`pools[]`, `asp_*`, `verifier`) were removed in the full-Noir
migration.

## Funding testnet / Freighter

The deployer identity is `mikey`
(`GBWJZZ3XSNAY3WLFNLXUZXEEYMZCYVG4TW6Z5VSASJS2TOWF7GGPPKMW`). To run flows you need
a funded testnet account:

1. Create/import an account in [Freighter](https://www.freighter.app/) and switch
   it to **testnet**.
2. Fund it with the [Stellar testnet friendbot](https://friendbot.stellar.org).
3. Acquire testnet USDC (the pool's token is the USDC SAC in `deployments.json`).

> **Real token movement is capped at 1 USDC** on testnet. The shielded note totals
> in a batch are BN254 field values, not USDC transfers; only `ext_amount` moves
> real tokens.

## Deploy

```bash
pnpm deploy:testnet     # = ops/deploy-noir-pool.sh testnet
```

## Guarantee

Non-custodial and reproducible: the circuit and verifier are public, the VK is
immutable per deploy, and `deployments.json` pins every on-chain id. **PoC, not
audited, testnet.**
