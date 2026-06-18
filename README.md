# Sobrecito

**Payroll that doesn't dox your team: pay salaries in USDC on-chain, keep every amount private, and still prove the totals to your auditor.**

Every on-chain salary is public by default. Sobrecito seals the amounts and lets
each person open exactly their share. An organization pays in USDC on a single
shielded transaction, no individual amount is ever exposed, and a zero-knowledge
proof shows the batch total is correct.

Each role sees only what it is owed:

- **Employer** sees the full breakdown, in private, before anything goes on-chain.
- **Employee** sees only their own pay, claims it to their wallet, and can prove it, never a colleague's.
- **Auditor** reconstructs the per-employee detail with a view-key scoped to one period.
- **Public** sees one number: the batch total, proven on-chain. No individual amounts.

Trust lives in the ledger and in open code. It is non-custodial, with a public
circuit and Soroban verifier. If this project disappeared tomorrow, every proof
would still verify on-chain.

Built for the Stellar "Real-World ZK" hackathon (June 2026).

> **Status: proof of concept.** Not audited, runs on Stellar testnet. The ZK
> circuit and Soroban verifier are load-bearing. Some guarantees are technical
> (a proof) and others are policy (an operational promise); each is labeled in
> the app and the package docs.

## How it works

The product is three tabs over one sealed payroll. The private key the employee
holds is the spending key that claims the pay, and the auditor's view-key is the
only thing that reopens the detail.

1. **Generate** — the employee creates a key in the browser and keeps the private half.
2. **View-key** — the auditor generates a keypair and keeps the private view-key.
3. **Pay** — the employer pastes each public key and amount, proves the batch in the
   browser, and sends real USDC. Amounts go on-chain encrypted.
4. **Claim** — the employee scans the pool, finds the one note that decrypts for
   them, and withdraws it.
5. **Audit** — the auditor pastes the view-key and rebuilds every amount for that
   period, and nothing outside it.

Under the hood, the batch is a single shielded transaction. The employer shields
USDC for the total `T`, and a Groth16 proof (`policy_tx_1_8`, one employer input
to eight employee notes) splits it into private notes while proving conservation
`sumIns + publicAmount === sumOuts`. The public predicate `sum(payments) = T` is
verified on-chain; individual amounts stay encrypted to the auditor's view-key.
Commitments use Poseidon2, aligned between circuit and contract. A claim spends a
note via a withdraw proof (Merkle membership + nullifier), so a salary can be
proven once and never double-spent.

## Try it

Run the web app and open the three tabs (`/employer`, `/employee`, `/auditor`).
Proving runs entirely in the browser; signing uses Freighter on Stellar testnet.
The in-app progress panel walks you through the five steps in order.

## Monorepo layout

```
sobrecito/
├── apps/
│   └── web/            # Next.js landing + employer / employee / auditor dashboards
├── packages/
│   ├── zk/             # Cargo workspace: circom circuits + Soroban contracts
│   │   ├── circuits/   #   policy_tx_1_8 (1 employer input -> 8 employee notes)
│   │   ├── contracts/  #   pool, circom-groth16-verifier, asp-*, soroban-utils
│   │   ├── poseidon2/  #   hash aligned circuit <-> contract
│   │   └── testdata/   #   verification + proving keys (PoC trusted setup)
│   ├── viewkey/        # auditor view-key + batch reconstruction, employee scan
│   └── cli/            # `sobre pay` command (WIP)
└── ops/
    ├── scripts/        # build-verifier-with-vk.sh, deploy.sh
    └── deployments/    # on-chain addresses per network
```

## Commands

Driven from the root `package.json`:

```bash
# Web
pnpm dev                       # run the app locally
pnpm build                     # build the web app
pnpm web:test                  # Playwright end-to-end tests
pnpm --filter web test:unit    # Vitest unit tests

# ZK / contracts
pnpm zk:setup         # trusted setup (PoC): generate proving + verification key
pnpm zk:test          # Rust tests (soroban-utils + pool + circuits)
pnpm zk:test:pool     # pool contract tests (verifier VK embedded)
pnpm verifier:build   # build the Soroban verifier with the circuit's VK baked in
pnpm pool:build       # build the pool contract to wasm
pnpm contracts:build  # build all contracts (optimized wasm)
pnpm deploy:testnet   # deploy pool + verifier + ASP to Stellar testnet
```

> The `viewkey` package ships its build output uncommitted. After a fresh
> checkout, run `pnpm --filter viewkey build` (or `pnpm -r build`) before the web
> app so the auditor and employee flows resolve.

## Stack

Circom + Groth16, Soroban (Rust, `wasm32v1-none`), Stellar testnet, Freighter for
signing, Next.js + Tailwind for the frontend with in-browser WASM proving.
Toolchain: Rust 1.92.0, Node 20.9+, pnpm.

## License

TBD.
