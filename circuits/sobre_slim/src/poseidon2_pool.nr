// Pool-aligned Poseidon2 for Sobre (Option B: adapt the Noir circuit to the
// deployed pool's exact Poseidon2, leaving on-chain hashing unchanged).
//
// The noir-lang/poseidon v0.2.0 lib and Noir's std::hash::poseidon2_permutation
// implement a t=4 sponge with an IV (message_size * 2^64); the deployed pool uses
// the Soroban SDK crypto_hazmat.poseidon2_permutation at t=2/t=3 (no sponge, no IV)
// plus an off-chain Circom t=4 permutation for commitments. Neither stdlib helper
// reproduces the pool, so we port the permutations directly here.
//
// Verified byte-for-byte (see 09-02-SUMMARY.md Task 0):
//   * compress(t=2)    == on-chain poseidon2-tester compress()
//   * hash2(t=3)       == on-chain poseidon2-tester hash2()
//   * commitment(t=4)  == zkhash POSEIDON2_BN256_PARAMS_4 (== Circom witness-gen)
//   * keypair(t=3)     == zkhash POSEIDON2_BN256_PARAMS_3

use crate::poseidon2_constants::{DIAG4, RC2_EXT, RC2_INT, RC3_ALL, RC4_EXT, RC4_INT};

fn sbox(x: Field) -> Field {
    let x2 = x * x;
    let x4 = x2 * x2;
    x4 * x
}

// --- external (full-round) MDS matrices ---
// t=2: circ(2,1)
fn ext_mat_t2(s: [Field; 2]) -> [Field; 2] {
    let sum = s[0] + s[1];
    [s[0] + sum, s[1] + sum]
}
// t=3: circ(2,1,1)
fn ext_mat_t3(s: [Field; 3]) -> [Field; 3] {
    let sum = s[0] + s[1] + s[2];
    [s[0] + sum, s[1] + sum, s[2] + sum]
}
// t=4: cheap MatMul_M4 (Poseidon2 paper Section 5.1)
fn ext_mat_t4(s: [Field; 4]) -> [Field; 4] {
    let t0 = s[0] + s[1];
    let t1 = s[2] + s[3];
    let t2 = s[1] + s[1] + t1;
    let t3 = s[3] + s[3] + t0;
    let t4 = t1 + t1 + t1 + t1 + t3;
    let t5 = t0 + t0 + t0 + t0 + t2;
    let t6 = t3 + t5;
    let t7 = t2 + t4;
    [t6, t5, t7, t4]
}

// --- internal (partial-round) matrices ---
// SDK hardcodes t=2 M_I = [[2,1],[1,3]], t=3 M_I = [[2,1,1],[1,2,1],[1,1,3]].
fn int_mat_t2(s: [Field; 2]) -> [Field; 2] {
    let sum = s[0] + s[1];
    [s[0] + sum, s[1] + s[1] + sum]
}
fn int_mat_t3(s: [Field; 3]) -> [Field; 3] {
    let sum = s[0] + s[1] + s[2];
    [s[0] + sum, s[1] + sum, s[2] + s[2] + sum]
}

fn perm_t2(input: [Field; 2]) -> [Field; 2] {
    let mut s = ext_mat_t2(input);
    for r in 0..4 {
        s = [s[0] + RC2_EXT[r][0], s[1] + RC2_EXT[r][1]];
        s = [sbox(s[0]), sbox(s[1])];
        s = ext_mat_t2(s);
    }
    for r in 0..56 {
        s[0] = sbox(s[0] + RC2_INT[r]);
        s = int_mat_t2(s);
    }
    for r in 0..4 {
        let rc = RC2_EXT[r + 4];
        s = [s[0] + rc[0], s[1] + rc[1]];
        s = [sbox(s[0]), sbox(s[1])];
        s = ext_mat_t2(s);
    }
    s
}

fn perm_t3(input: [Field; 3]) -> [Field; 3] {
    let mut s = ext_mat_t3(input);
    for r in 0..4 {
        let rc = RC3_ALL[r];
        s = [s[0] + rc[0], s[1] + rc[1], s[2] + rc[2]];
        s = [sbox(s[0]), sbox(s[1]), sbox(s[2])];
        s = ext_mat_t3(s);
    }
    for r in 0..56 {
        let rc = RC3_ALL[r + 4];
        s[0] = sbox(s[0] + rc[0]);
        s = int_mat_t3(s);
    }
    for r in 0..4 {
        let rc = RC3_ALL[r + 60];
        s = [s[0] + rc[0], s[1] + rc[1], s[2] + rc[2]];
        s = [sbox(s[0]), sbox(s[1]), sbox(s[2])];
        s = ext_mat_t3(s);
    }
    s
}

// Circom Permutation(4): internal round uses the FULL diagonal,
// out[j] = total + x_j * diag[j], total = sbox(s0+rc) + s1 + s2 + s3.
fn perm_t4(input: [Field; 4]) -> [Field; 4] {
    let mut s = ext_mat_t4(input);
    for r in 0..4 {
        let rc = RC4_EXT[r];
        s = [sbox(s[0] + rc[0]), sbox(s[1] + rc[1]), sbox(s[2] + rc[2]), sbox(s[3] + rc[3])];
        s = ext_mat_t4(s);
    }
    for r in 0..56 {
        let x = sbox(s[0] + RC4_INT[r]);
        let total = x + s[1] + s[2] + s[3];
        s = [
            total + x * DIAG4[0],
            total + s[1] * DIAG4[1],
            total + s[2] * DIAG4[2],
            total + s[3] * DIAG4[3],
        ];
    }
    for r in 0..4 {
        let rc = RC4_EXT[r + 4];
        s = [sbox(s[0] + rc[0]), sbox(s[1] + rc[1]), sbox(s[2] + rc[2]), sbox(s[3] + rc[3])];
        s = ext_mat_t4(s);
    }
    s
}

// === Public, pool-aligned hash helpers ===

// Merkle compression node (the load-bearing ON-CHAIN hash; matches the pool's
// poseidon2_compress: perm_t2([l,r])[0] + l).
pub fn compress(l: Field, r: Field) -> Field {
    perm_t2([l, r])[0] + l
}

// t=3 hash with domain separation: perm_t3([a, b, sep])[0] (matches pool hash2).
pub fn hash2_with_sep(a: Field, b: Field, sep: Field) -> Field {
    perm_t3([a, b, sep])[0]
}

// Commitment / nullifier / signature: Circom Poseidon2(3) == Permutation(4) over
// [a, b, c, sep], take out[0].
pub fn hash3_with_sep(a: Field, b: Field, c: Field, sep: Field) -> Field {
    perm_t4([a, b, c, sep])[0]
}

// Keypair: Circom Poseidon2(2) == Permutation(3) over [a, 0, sep], take out[0].
pub fn hash1_with_sep(a: Field, sep: Field) -> Field {
    perm_t3([a, 0, sep])[0]
}
