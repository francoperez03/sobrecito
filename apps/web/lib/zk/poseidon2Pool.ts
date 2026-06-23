/**
 * poseidon2Pool.ts — pool-aligned pure-JS Poseidon2 over BN254.
 *
 * Ports the semantics of circuits/sobre_slim/src/poseidon2_pool.nr 1-to-1.
 * No WASM, no @aztec, no worker — importable in Node (Vitest) and browser.
 *
 * Hash semantics (matching poseidon2_pool.nr):
 *   compress(l, r)             = perm_t2([l, r])[0] + l         (Merkle internal node)
 *   hash2WithSep(a, b, sep)    = perm_t3([a, b, sep])[0]        (pool hash2)
 *   hash3WithSep(a, b, c, sep) = perm_t4([a, b, c, sep])[0]     (commitment/nullifier/sig)
 *   hash1WithSep(a, sep)       = perm_t3([a, 0, sep])[0]        (keypair pubkey)
 *
 * Round schedule (RF=8, RP=56):
 *   t=2: ext_mat_t2 init; 4 full (RC2_EXT[0..3]); 56 partial (RC2_INT, int_mat_t2);
 *        4 full (RC2_EXT[4..7]); sbox = x^5
 *   t=3: ext_mat_t3 init; 4 full (RC3_ALL[0..3]); 56 partial (RC3_ALL[4..59], int_mat_t3);
 *        4 full (RC3_ALL[60..63])
 *   t=4: ext_mat_t4 (MatMul_M4) init; 4 full (RC4_EXT[0..3], sbox on all 4 lanes);
 *        56 partial (RC4_INT, DIAG4 full-diagonal internal); 4 full (RC4_EXT[4..7])
 *
 * Verified byte-for-byte against on-chain Prover.toml vectors (09-04, tx 6a83f967).
 */

import { RC2_EXT, RC2_INT, RC3_ALL, RC4_EXT, RC4_INT, DIAG4 } from './poseidon2PoolConstants'

// BN254 scalar field prime
const BN254_P = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617')

function mod(x: bigint): bigint {
  return ((x % BN254_P) + BN254_P) % BN254_P
}

// sbox: x^5 mod p
function sbox(x: bigint): bigint {
  const x2 = mod(x * x)
  const x4 = mod(x2 * x2)
  return mod(x4 * x)
}

// --- External (full-round) MDS matrices ---

// t=2: circ(2,1)
function extMatT2(s: bigint[]): bigint[] {
  const sum = mod(s[0] + s[1])
  return [mod(s[0] + sum), mod(s[1] + sum)]
}

// t=3: circ(2,1,1)
function extMatT3(s: bigint[]): bigint[] {
  const sum = mod(s[0] + s[1] + s[2])
  return [mod(s[0] + sum), mod(s[1] + sum), mod(s[2] + sum)]
}

// t=4: cheap MatMul_M4 (Poseidon2 paper Section 5.1), exactly as in poseidon2_pool.nr
function extMatT4(s: bigint[]): bigint[] {
  const t0 = mod(s[0] + s[1])
  const t1 = mod(s[2] + s[3])
  const t2 = mod(s[1] + s[1] + t1)
  const t3 = mod(s[3] + s[3] + t0)
  const t4 = mod(t1 + t1 + t1 + t1 + t3)
  const t5 = mod(t0 + t0 + t0 + t0 + t2)
  const t6 = mod(t3 + t5)
  const t7 = mod(t2 + t4)
  return [t6, t5, t7, t4]
}

// --- Internal (partial-round) matrices ---
// SDK hardcodes t=2 M_I = [[2,1],[1,3]], t=3 M_I = [[2,1,1],[1,2,1],[1,1,3]]

function intMatT2(s: bigint[]): bigint[] {
  const sum = mod(s[0] + s[1])
  return [mod(s[0] + sum), mod(s[1] + s[1] + sum)]
}

function intMatT3(s: bigint[]): bigint[] {
  const sum = mod(s[0] + s[1] + s[2])
  return [mod(s[0] + sum), mod(s[1] + sum), mod(s[2] + s[2] + sum)]
}

// --- Permutations ---

function permT2(input: bigint[]): bigint[] {
  let s = extMatT2(input)
  // 4 full rounds (external)
  for (let r = 0; r < 4; r++) {
    s = [mod(s[0] + RC2_EXT[r][0]), mod(s[1] + RC2_EXT[r][1])]
    s = [sbox(s[0]), sbox(s[1])]
    s = extMatT2(s)
  }
  // 56 partial rounds (internal)
  for (let r = 0; r < 56; r++) {
    s[0] = sbox(mod(s[0] + RC2_INT[r]))
    s = intMatT2(s)
  }
  // 4 full rounds (external)
  for (let r = 0; r < 4; r++) {
    const rc = RC2_EXT[r + 4]
    s = [mod(s[0] + rc[0]), mod(s[1] + rc[1])]
    s = [sbox(s[0]), sbox(s[1])]
    s = extMatT2(s)
  }
  return s
}

function permT3(input: bigint[]): bigint[] {
  let s = extMatT3(input)
  // 4 full rounds
  for (let r = 0; r < 4; r++) {
    const rc = RC3_ALL[r]
    s = [mod(s[0] + rc[0]), mod(s[1] + rc[1]), mod(s[2] + rc[2])]
    s = [sbox(s[0]), sbox(s[1]), sbox(s[2])]
    s = extMatT3(s)
  }
  // 56 partial rounds (only s[0] goes through sbox; rc[1] and rc[2] are 0 in partial rounds)
  for (let r = 0; r < 56; r++) {
    const rc = RC3_ALL[r + 4]
    s[0] = sbox(mod(s[0] + rc[0]))
    s = intMatT3(s)
  }
  // 4 full rounds
  for (let r = 0; r < 4; r++) {
    const rc = RC3_ALL[r + 60]
    s = [mod(s[0] + rc[0]), mod(s[1] + rc[1]), mod(s[2] + rc[2])]
    s = [sbox(s[0]), sbox(s[1]), sbox(s[2])]
    s = extMatT3(s)
  }
  return s
}

// Circom Permutation(4): internal round uses the FULL diagonal,
// out[j] = total + x_j * diag[j], total = sbox(s[0]+rc) + s[1] + s[2] + s[3]
function permT4(input: bigint[]): bigint[] {
  let s = extMatT4(input)
  // 4 full rounds
  for (let r = 0; r < 4; r++) {
    const rc = RC4_EXT[r]
    s = [sbox(mod(s[0] + rc[0])), sbox(mod(s[1] + rc[1])), sbox(mod(s[2] + rc[2])), sbox(mod(s[3] + rc[3]))]
    s = extMatT4(s)
  }
  // 56 partial rounds with DIAG4 internal matrix
  for (let r = 0; r < 56; r++) {
    const x = sbox(mod(s[0] + RC4_INT[r]))
    const total = mod(x + s[1] + s[2] + s[3])
    s = [
      mod(total + mod(x * DIAG4[0])),
      mod(total + mod(s[1] * DIAG4[1])),
      mod(total + mod(s[2] * DIAG4[2])),
      mod(total + mod(s[3] * DIAG4[3])),
    ]
  }
  // 4 full rounds
  for (let r = 0; r < 4; r++) {
    const rc = RC4_EXT[r + 4]
    s = [sbox(mod(s[0] + rc[0])), sbox(mod(s[1] + rc[1])), sbox(mod(s[2] + rc[2])), sbox(mod(s[3] + rc[3]))]
    s = extMatT4(s)
  }
  return s
}

// === Public, pool-aligned hash helpers ===

/**
 * Merkle compression node — the load-bearing ON-CHAIN hash.
 * Matches pool poseidon2_compress: perm_t2([l, r])[0] + l
 */
export function compress(l: bigint, r: bigint): bigint {
  return mod(permT2([l, r])[0] + l)
}

/**
 * t=3 hash with domain separation: perm_t3([a, b, sep])[0] (matches pool hash2).
 */
export function hash2WithSep(a: bigint, b: bigint, sep: bigint): bigint {
  return permT3([a, b, sep])[0]
}

/**
 * Commitment / nullifier / signature: Circom Poseidon2(3) == Permutation(4) over
 * [a, b, c, sep], take out[0].
 */
export function hash3WithSep(a: bigint, b: bigint, c: bigint, sep: bigint): bigint {
  return permT4([a, b, c, sep])[0]
}

/**
 * Keypair: Circom Poseidon2(2) == Permutation(3) over [a, 0, sep], take out[0].
 */
export function hash1WithSep(a: bigint, sep: bigint): bigint {
  return permT3([a, BigInt(0), sep])[0]
}

/**
 * Pool empty leaf: get_zeroes()[0] == Poseidon2("XLM") as BN254 field element.
 * This is the 260618-k43 fix — do NOT replace with WASM zero_leaf() which diverges.
 *
 * Decimal: 16820622405745174042249830601237189755928192602553897283642901160942722677198
 * Hex:     0x25302288db99350344974183ce310d63b53abb9ef0f8575753eed36e0118f9ce
 */
export const ZERO_LEAF: bigint = BigInt('16820622405745174042249830601237189755928192602553897283642901160942722677198')
