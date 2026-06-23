# zk

The on-chain half of Sobrecito's ZK stack: the **Soroban contracts** that hold the
shielded payroll pool and verify UltraHonk proofs. The Noir circuit itself lives
one level up in [`circuits/sobre_slim`](../../circuits/sobre_slim).

## What's here

Cargo workspace (`packages/zk/Cargo.toml`, members = `contracts/*`):

- **`contracts/pool`** — the privacy pool (UltraHonk edition). Accepts shielded
  deposits and `transact` calls: checks the Merkle root history, nullifier replay,
  the `ext_data_hash` binding and the public amount, then delegates ZK verification
  to the on-chain UltraHonk verifier **by address** (cross-contract call). One
  employer input → eight employee notes; commitments use Poseidon2.
- **`contracts/soroban-utils`** — shared helpers: pool-aligned Poseidon2
  (`poseidon2_compress`, `get_zeroes`), `bn256_modulus`, `update_admin`, a
  `MockToken` for tests.
- **`contracts/poseidon2-tester`** — a tiny harness contract exposing Poseidon2 as
  invocable methods, used to cross-check the circuit's hashing against the pool.

The UltraHonk **verifier contract** is the external, **unaudited**
[`rs-soroban-ultrahonk`](https://github.com/yugocabrio/rs-soroban-ultrahonk)
(vendored as a sibling of `sobrecito/`). It holds an immutable VK set at deploy
time and exposes `verify_proof(public_inputs, proof_bytes)`.

`testdata/` holds the real UltraHonk proof fixture (`sobre_slim_real.proof.bin`,
`.public_inputs.bin`, `.vk.bin` + a JSON manifest) used by the e2e test.

## Build / test

```bash
cargo build                 # build all contracts (from packages/zk/)
cargo test -p pool          # pool tests, incl. the real-proof e2e
cargo test -p soroban-utils
cargo build -p pool --target wasm32v1-none   # wasm artifact
```

The pool suite includes `transact_with_real_ultrahonk_proof`, which registers the
real verifier with the `sobre_slim` VK and verifies a genuine `bb 0.87.0` proof
on-chain — exercising `verify_proof()` end to end, not a mock. It needs the sibling
`rs-soroban-ultrahonk/` repo present (path dev-dependency, test-only).

## Regenerating the proof fixture

```bash
cd ../../circuits/sobre_slim
nargo execute
bb prove    --scheme ultra_honk --oracle_hash keccak --output_format bytes_and_fields \
            -b ./target/sobre_slim.json -w ./target/sobre_slim.gz -o ./target
bb write_vk --scheme ultra_honk --oracle_hash keccak -b ./target/sobre_slim.json -o ./target
# proof (14592 b), public_inputs (384 b), vk (1760 b) → copy into packages/zk/testdata/
```

The witness comes from `circuits/sobre_slim/Prover.toml` (in_amount=0,
public_amount=0, root = the empty-tree root of a fresh depth-10 pool,
recipient=mikey, 8 empty outputs).

## Guarantee

Soundness of the proven total against a dishonest employer (A3): a `transact` only
succeeds if a valid UltraHonk proof verifies on-chain and the public inputs bind to
the batch (nullifiers, Merkle history, ext-data hash). UltraHonk has **no trusted
setup** per circuit. **PoC, not audited, testnet.**
