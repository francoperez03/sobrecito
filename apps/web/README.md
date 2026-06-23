# web

The Sobrecito frontend: a Next.js app with the landing page and the three actor
surfaces. Proving runs **in the browser** (UltraHonk via `bb.js`); signing uses
Freighter on Stellar testnet.

> For *what* the product does and *how it looks*, see [`PRODUCT.md`](PRODUCT.md)
> and [`DESIGN.md`](DESIGN.md). This file is about running the app.

## Surfaces

- **`/`** — marketing landing.
- **`/employer`** — paste the payroll (CSV or table), prove the batch in-browser,
  sign and send with Freighter. Amounts go on-chain encrypted.
- **`/employee`** — generate/recover a key, scan the pool for the note that
  decrypts for you, claim it.
- **`/auditor`** — paste the view-key, reconstruct every amount of a period and
  reconcile against the proven total `T`.

## Run

Prerequisites: Node 20.9+, pnpm, the [Freighter](https://www.freighter.app/) wallet
on **testnet** with a funded account (see [`../../ops/README.md`](../../ops/README.md)).

```bash
pnpm install                  # from the repo root (installs bb.js + noir_js)
pnpm --filter viewkey build   # build the viewkey package (its dist/ is gitignored)
pnpm dev                      # Next.js on http://localhost:3000
```

`pnpm dev` and friends also work from the repo root (`pnpm dev` → `--filter web`).

> If `/employer` / `/employee` / `/auditor` return HTTP 500 with
> "Can't resolve '@aztec/bb.js'", run `pnpm install` — the UltraHonk prover deps
> (`@aztec/bb.js`, `@noir-lang/noir_js`) are declared but must be installed.

## Test

```bash
pnpm --filter web test:e2e    # Playwright (includes surfaces-smoke.spec.ts, 3/3)
pnpm --filter web test:unit   # Vitest
```

The prover worker is `workers/bb-prover.ts` (compiled by Next.js as a Web Worker);
the chain layer is isolated under `lib/chain/` (the StellarAdapter), reading the
live `noir_pool` from `ops/deployments/testnet/deployments.json`.

## Guarantee

The proof is generated and the amounts are sealed client-side; nothing but the
view-key reopens the detail. Claiming to your own address is public (linkability).
**PoC, not audited, testnet** — labeled in the app.
