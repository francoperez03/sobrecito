//! Merkle tree utilities using Poseidon2 hash
//!
//! Provides merkle tree operations for use in ZK circuits. These functions
//! match the Circom circuit implementations and produce identical roots/proofs.

use alloc::vec::Vec;
use core::ops::Add;
use zkhash::{
    fields::bn256::FpBN256 as Scalar,
    poseidon2::{poseidon2::Poseidon2, poseidon2_instance_bn256::POSEIDON2_BN256_PARAMS_2},
};

/// Poseidon2 compression for merkle tree nodes
///
/// Computes `P(left, right)[0] + left` where P is the Poseidon2 permutation.
/// This matches the feed-forward compression used in Circom circuits.
#[inline]
pub fn poseidon2_compression(left: Scalar, right: Scalar) -> Scalar {
    let poseidon2 = Poseidon2::new(&POSEIDON2_BN256_PARAMS_2);
    let input = [left, right];
    let perm = poseidon2.permutation(&input);
    perm[0].add(input[0])
}

/// Build a Merkle root from a full list of leaves
///
/// Computes the Merkle root by repeatedly hashing pairs of nodes until
/// a single root remains.
///
/// # Panics
///
/// Panics if `leaves` is empty.
pub fn merkle_root(mut leaves: Vec<Scalar>) -> Scalar {
    assert!(!leaves.is_empty(), "leaves cannot be empty");
    assert!(
        leaves.len().is_power_of_two(),
        "leaves length must be a power of 2"
    );
    while leaves.len() > 1 {
        let mut next = Vec::with_capacity(leaves.len() / 2);
        for pair in leaves.chunks_exact(2) {
            next.push(poseidon2_compression(pair[0], pair[1]));
        }
        leaves = next;
    }
    leaves[0]
}

/// Compute the Merkle path and path index bits for a given leaf
/// index
///
/// Generates the Merkle proof for a leaf at the given index, including all
/// sibling nodes along the path to the root and the path indices encoded as
/// a bit pattern.
///
/// # Returns
///
/// Returns a tuple containing:
/// - `path_elements`: Vector of sibling scalar values along the path
/// - `path_indices`: Path indices encoded as a u64 bit pattern
/// - `levels`: Number of levels in the tree
pub fn merkle_proof(leaves: &[Scalar], mut index: usize) -> (Vec<Scalar>, u64, usize) {
    assert!(!leaves.is_empty() && leaves.len().is_power_of_two());
    let mut level_nodes = leaves.to_vec();
    let levels = level_nodes.len().ilog2() as usize;

    let mut path_elems = Vec::with_capacity(levels);
    let mut path_indices_bits_lsb = Vec::with_capacity(levels);

    for _level in 0..levels {
        let sib_index = if index.is_multiple_of(2) {
            index.checked_add(1).expect("sibling index overflow")
        } else {
            index.checked_sub(1).expect("sibling index underflow")
        };

        path_elems.push(level_nodes[sib_index]);
        path_indices_bits_lsb.push((index & 1) as u64);

        let mut next = Vec::with_capacity(leaves.len() / 2);
        for pair in level_nodes.chunks_exact(2) {
            next.push(poseidon2_compression(pair[0], pair[1]));
        }
        level_nodes = next;
        index /= 2;
    }

    let mut path_indices: u64 = 0;
    for (i, b) in path_indices_bits_lsb.iter().copied().enumerate() {
        path_indices |= b << i;
    }

    (path_elems, path_indices, levels)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merkle_root_single_leaf() {
        let leaf = Scalar::from(42u64);
        let root = merkle_root(alloc::vec![leaf]);
        assert_eq!(root, leaf);
    }

    #[test]
    fn test_merkle_root_two_leaves() {
        let leaves = alloc::vec![Scalar::from(1u64), Scalar::from(2u64)];
        let root = merkle_root(leaves.clone());
        let expected = poseidon2_compression(leaves[0], leaves[1]);
        assert_eq!(root, expected);
    }

    #[test]
    fn test_merkle_proof_basics() {
        let leaves: Vec<Scalar> = (0..4).map(Scalar::from).collect();
        let (path, indices, levels) = merkle_proof(&leaves, 0);

        assert_eq!(levels, 2);
        assert_eq!(path.len(), 2);
        assert_eq!(indices, 0);
    }

    /// Probe: compute the ASP membership root with different zero-leaf assumptions
    /// to find what matches the on-chain root 21469248...8715
    #[test]
    fn probe_asp_root_zero_leaf_assumption() {
        use zkhash::{ark_ff::Zero, fields::bn256::FpBN256 as Scalar};
        use num_bigint::BigUint;
        use ark_ff::{BigInteger, PrimeField};

        let on_chain_root_dec = "21469248025944430904811230013963704341332885446897450976146734701928101288715";
        let on_chain_root_biguint: BigUint = on_chain_root_dec.parse().unwrap();

        fn scalar_to_dec(s: Scalar) -> String {
            let bi = s.into_bigint();
            BigUint::from_bytes_le(&bi.to_bytes_le()).to_string()
        }

        const LEVELS: usize = 10;
        const N: usize = 1 << LEVELS;

        // zeroes[0] = Poseidon2("XLM") from on-chain contract get_zeroes() fn
        // bytes (BE): [37,48,34,136,219,153,53,3,68,151,65,131,206,49,13,99,181,58,187,158,240,248,87,87,83,238,211,110,1,24,249,206]
        let zero_leaf_bytes_be: [u8; 32] = [
            37, 48, 34, 136, 219, 153, 53, 3, 68, 151, 65, 131, 206, 49, 13, 99, 181, 58,
            187, 158, 240, 248, 87, 87, 83, 238, 211, 110, 1, 24, 249, 206,
        ];
        // Convert big-endian bytes to Scalar (little-endian internally)
        let zero_leaf_biguint = BigUint::from_bytes_be(&zero_leaf_bytes_be);
        let zero_leaf_bytes_le = {
            let mut b = zero_leaf_biguint.to_bytes_le();
            b.resize(32, 0);
            b
        };
        let zero_leaf = Scalar::from_le_bytes_mod_order(&zero_leaf_bytes_le);

        // employer leaf = poseidon2_hash2(pubkey(424242), 0, Some(1))
        use crate::test::utils::general::poseidon2_hash2 as h2;
        use crate::test::utils::keypair::derive_public_key;
        let pk_field = derive_public_key(Scalar::from(424242u64));
        let mem_leaf = h2(pk_field, Scalar::zero(), Some(Scalar::from(1u64)));

        // Hypothesis A: leaves[0..7]=1..8, leaves[8]=mem_leaf, rest=Scalar::zero()
        {
            let mut leaves = vec![Scalar::zero(); N];
            for i in 0..8usize { leaves[i] = Scalar::from((i + 1) as u64); }
            leaves[8] = mem_leaf;
            let root_a = merkle_root(leaves);
            println!("Hypothesis A (zero=0, dummy=1..8): {}", scalar_to_dec(root_a));
        }

        // Hypothesis B: only employer at index 8, rest=Scalar::zero()
        {
            let mut leaves = vec![Scalar::zero(); N];
            leaves[8] = mem_leaf;
            let root_b = merkle_root(leaves);
            println!("Hypothesis B (zero=0, only employer at 8): {}", scalar_to_dec(root_b));
        }

        // Hypothesis C: leaves[0..7]=1..8, leaves[8]=mem_leaf, rest=zero_leaf (on-chain zero)
        {
            let mut leaves = vec![zero_leaf; N];
            for i in 0..8usize { leaves[i] = Scalar::from((i + 1) as u64); }
            leaves[8] = mem_leaf;
            let root_c = merkle_root(leaves);
            println!("Hypothesis C (zero=XLM, dummy=1..8): {}", scalar_to_dec(root_c));
        }

        // Hypothesis D: only employer at index 8, rest=zero_leaf (on-chain zero)
        {
            let mut leaves = vec![zero_leaf; N];
            leaves[8] = mem_leaf;
            let root_d = merkle_root(leaves);
            println!("Hypothesis D (zero=XLM, only employer at 8): {}", scalar_to_dec(root_d));
        }

        // Hypothesis E: only employer at index 0 (first inserted), rest=zero_leaf
        {
            let mut leaves = vec![zero_leaf; N];
            leaves[0] = mem_leaf;
            let root_e = merkle_root(leaves);
            println!("Hypothesis E (zero=XLM, employer at 0): {}", scalar_to_dec(root_e));
        }

        println!("Target on-chain root: {}", on_chain_root_dec);
    }

    #[test]
    fn test_merkle_proof_verifies() {
        let leaves: Vec<Scalar> = (0..4).map(Scalar::from).collect();
        let root = merkle_root(leaves.clone());

        for idx in 0..4 {
            let (path, indices, levels) = merkle_proof(&leaves, idx);
            let mut current = leaves[idx];

            for (level, elem) in path.iter().enumerate().take(levels) {
                let is_right = (indices >> level) & 1 == 1;
                current = if is_right {
                    poseidon2_compression(*elem, current)
                } else {
                    poseidon2_compression(current, *elem)
                };
            }

            assert_eq!(current, root, "Proof verification failed for index {}", idx);
        }
    }
}
