# Sobre

**Payroll that doesn't dox your team: pay salaries in USDC on-chain, keep every amount private, and still prove the totals to your auditor.**

Sobre is confidential payroll on Stellar/Soroban. An organization pays salaries in
USDC on-chain without exposing each individual amount, and proves with a
zero-knowledge proof that the batch total is correct to its auditor.

- **The public** sees that payroll happened, not how much each person earns.
- **The auditor**, with a view-key, reconstructs the detail they are entitled to.
- **Everyone else** sees nothing.

Built for the Stellar "Real-World ZK" hackathon (June 2026).

> **Status: proof of concept.** Not audited. ZK circuit + Soroban verifier are
> load-bearing; some guarantees are technical and others are policy. See the
> disclosure notes in each package before relying on anything here.

## How it works

The batch is a single shielded transaction: the employer shields USDC for the
total `T`, and a Groth16 proof (`policy_tx_1_8`) splits it into N private employee
notes while proving conservation `sumIns + publicAmount === sumOuts`. The public
predicate `sum(payments) = T` is verified on-chain; individual amounts stay
encrypted to the auditor's view-key. Commitments use Poseidon2, aligned between
circuit and contract.

## Monorepo layout

```
sobrecito/
├── apps/
│   └── web/            # Next.js landing + employer/auditor dashboards
├── packages/
│   ├── zk/             # Cargo workspace: circom circuits + Soroban contracts
│   │   ├── circuits/   #   policy_tx_1_8 (1 employer input -> 8 employee notes)
│   │   ├── contracts/  #   pool, circom-groth16-verifier, asp-*, soroban-utils
│   │   ├── poseidon2/  #   hash aligned circuit <-> contract
│   │   └── testdata/   #   verification + proving keys (PoC trusted setup)
│   ├── cli/            # `sobre pay` command (WIP)
│   └── viewkey/        # auditor view-key layer (WIP)
└── ops/
    ├── scripts/        # build-verifier-with-vk.sh, deploy.sh
    └── deployments/    # on-chain addresses per network
```

## Commands

Everything is driven from the root `package.json`:

```bash
# Web
pnpm dev              # run the landing locally
pnpm build            # build the web app
pnpm web:test         # Playwright end-to-end tests

# ZK / contracts
pnpm zk:setup         # trusted setup (PoC): generate proving key + verification key
pnpm zk:test          # Rust tests (soroban-utils + pool + circuits)
pnpm zk:test:pool     # pool contract tests (verifier VK embedded)
pnpm verifier:build   # build the Soroban verifier with the circuit's VK baked in
pnpm pool:build       # build the pool contract to wasm
pnpm contracts:build  # build all contracts (optimized wasm)
pnpm deploy:testnet   # deploy pool + verifier + ASP to Stellar testnet
```

## Stack

Circom + Groth16, Soroban (Rust, `wasm32v1-none`), Stellar testnet, Next.js +
Tailwind for the frontend. Toolchain: Rust 1.92.0, Node 20.9+, pnpm.

## License

TBD.
