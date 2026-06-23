#![no_std]
//! Poseidon2 tester contract — cross-check harness for NOIR-04
//! Exposes poseidon2_compress and poseidon2_hash2 as invocable methods.

use soroban_sdk::{contract, contractimpl, Env, U256};
use soroban_utils::{poseidon2_compress, poseidon2_hash2};

#[contract]
pub struct Poseidon2Tester;

#[contractimpl]
impl Poseidon2Tester {
    /// Poseidon2 compress (t=2): used for Merkle tree compression.
    /// Corresponds to hash2(left, right) in the Noir circuit.
    pub fn compress(env: Env, left: U256, right: U256) -> U256 {
        poseidon2_compress(&env, left, right)
    }

    /// Poseidon2 hash2 (t=3): used for commitment and nullifier hashing.
    /// Corresponds to hash3_with_sep(a, b, c, sep) in the Noir circuit when
    /// called as hash2(a, b, sep=Some(sep)).
    pub fn hash2(env: Env, a: U256, b: U256, sep: U256) -> U256 {
        poseidon2_hash2(&env, a, b, Some(sep))
    }
}
