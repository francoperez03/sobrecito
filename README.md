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
USDC for the total `T`, and an UltraHonk proof (Noir circuit `sobre_slim`, one
employer input to eight employee notes) splits it into private notes while
proving conservation `sumIns + publicAmount === sumOuts`. The public predicate
`sum(payments) = T` is verified on-chain by an UltraHonk verifier contract;
individual amounts stay encrypted to the auditor's view-key. Commitments use
Poseidon2, aligned between circuit and contract. A claim spends a note via a
withdraw proof (Merkle membership + nullifier), so a salary can be proven once
and never double-spent.

UltraHonk has no per-circuit trusted setup: there is no proving-key ceremony to
trust. The on-chain verifier holds an immutable verification key (VK) set once at
deploy time, and the proof is produced by `bb 0.87.0`.

## Try it

Prerequisites: Node 20.9+, pnpm, the [Freighter](https://www.freighter.app/)
wallet on Stellar **testnet** with a funded account. Then:

```bash
pnpm install
pnpm --filter viewkey build   # build the viewkey package (uncommitted output)
pnpm dev                       # Next.js on http://localhost:3000
```

Open the three tabs (`/employer`, `/employee`, `/auditor`). Proving runs entirely
in the browser (UltraHonk via `bb.js`); signing uses Freighter on testnet. The
in-app progress panel walks you through the five steps in order.

## Monorepo layout

```
sobrecito/
├── circuits/
│   └── sobre_slim/     # Noir circuit (1 employer input -> 8 employee notes)
├── apps/
│   └── web/            # Next.js landing + employer / employee / auditor dashboards
├── packages/
│   ├── zk/             # Cargo workspace: Soroban contracts
│   │   ├── contracts/  #   pool (UltraHonk edition), soroban-utils, poseidon2-tester
│   │   └── testdata/   #   real UltraHonk proof fixture (sobre_slim_real.*)
│   └── viewkey/        # auditor view-key + batch reconstruction, employee scan
└── ops/
    ├── deploy-noir-pool.sh   # deploy UltraHonk verifier + noir_pool to testnet
    ├── scripts/              # submit-real-batch.sh, gen-real-deposit-blobs.mjs
    └── deployments/          # on-chain addresses per network (deployments.json)
```

The UltraHonk verifier contract lives in the external, **unaudited**
[`rs-soroban-ultrahonk`](https://github.com/yugocabrio/rs-soroban-ultrahonk)
repo (vendored as a sibling of `sobrecito/` in this monorepo). The deployed pool
delegates verification to it by address.

## Commands

Driven from the root `package.json`:

```bash
# Web
pnpm dev                       # run the app locally
pnpm build                     # build the web app
pnpm web:test                  # Playwright end-to-end tests
pnpm --filter web test:unit    # Vitest unit tests

# ZK / contracts
pnpm circuit:build    # compile the Noir circuit (nargo)
pnpm zk:test          # Rust tests (soroban-utils + pool, incl. real-proof e2e)
pnpm zk:test:pool     # pool contract tests only
pnpm pool:build       # build the pool contract to wasm
pnpm contracts:build  # build all contracts (optimized wasm)
pnpm deploy:testnet   # deploy UltraHonk verifier + noir_pool to Stellar testnet
```

> `pnpm zk:test` includes `transact_with_real_ultrahonk_proof`, which verifies a
> genuine `bb 0.87.0` proof on-chain through the real verifier. It needs the
> sibling `rs-soroban-ultrahonk/` repo present (path dev-dependency).

> The `viewkey` package ships its build output uncommitted. After a fresh
> checkout, run `pnpm --filter viewkey build` (or `pnpm -r build`) before the web
> app so the auditor and employee flows resolve.

## Stack

Noir + UltraHonk (`bb 0.87.0`), Soroban (Rust, `wasm32v1-none`), Stellar testnet,
Freighter for signing, Next.js + Tailwind for the frontend with in-browser
UltraHonk proving (`bb.js`). Toolchain: Rust 1.92.0, nargo 1.0.0-beta.9, Node
20.9+, pnpm.

## License

TBD.
