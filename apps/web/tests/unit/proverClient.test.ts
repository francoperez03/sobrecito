import { test, expect } from 'vitest'
import {
  computeNullifier,
  computeCommitment,
  derivePublicKey,
} from '@/lib/zk/proverClient'

// Regression guard for the 09.1 gap "Unknown message type: DERIVE_PUBLIC_KEY":
// derivePublicKey/computeNullifier/computeCommitment used to post COMPUTE_*/
// DERIVE_PUBLIC_KEY messages to the bb.js worker, which only handles
// INIT_PROVER/PROVE/VERIFY. They are now pure JS over the pool-aligned Poseidon2.
// These assertions pin them to the on-chain-verified Prover.toml vectors (tx
// 6a83f967…) — the SAME vectors poseidon2Pool.test.ts and the withdraw builder use.
// Hardcoded literals (A3 soundness): never read expected values dynamically.
// ES2017 target: use BigInt(...) calls, not 0n/5n literals (matches sibling tests).

test('computeNullifier reproduces the on-chain input_nullifier (priv=5, blinding=42)', async () => {
  // pub_key=hash1(5,3) → commitment=hash3(0,pk,42,1) → sig=hash3(5,c,0,4) → nullifier=hash3(c,0,sig,2)
  const nullifier = await computeNullifier(BigInt(5), BigInt(42), BigInt(0), BigInt(0))
  expect(nullifier).toBe(
    BigInt('17540796094016619695186207484084590326080291941308026732214951827401819841709'),
  )
})

test('computeCommitment reproduces output_commitment_0 (amount=0, pubkey=7, blinding=100)', async () => {
  const c0 = await computeCommitment(BigInt(0), BigInt(7), BigInt(100))
  expect(c0).toBe(
    BigInt('5229152078784151807472328887896265311281808399033364372814471869899988004871'),
  )
})

test('derivePublicKey is pure JS (no worker) and returns a field element', async () => {
  const pk = await derivePublicKey(BigInt(5))
  expect(typeof pk).toBe('bigint')
  // hash1WithSep(5,3) must be a valid BN254 field element
  expect(pk).toBeLessThan(
    BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617'),
  )
  expect(pk).toBeGreaterThan(BigInt(0))
})
