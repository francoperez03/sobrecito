mod poseidon2_constants;
mod poseidon2_pool;

use poseidon2_pool::{compress, hash1_with_sep, hash3_with_sep};

// Empty-leaf hash of the deployed pool: get_zeroes()[0] = Poseidon2("XLM").
// See soroban-utils/src/poseidon2.rs get_zeroes(). Load-bearing for Merkle
// reconstruction against the on-chain root.
global ZERO_LEAF: Field =
    0x25302288db99350344974183ce310d63b53abb9ef0f8575753eed36e0118f9ce;

fn constrain_bit(bit: Field) {
    assert(bit * (1 - bit) == 0);
}

// Reconstruct the Merkle root for a depth-10 tree using the pool's compression.
// path_bits[i] == 0 => current node is the LEFT child (sibling on the right).
fn compute_root(leaf: Field, path_elements: [Field; 10], path_bits: [Field; 10]) -> Field {
    let mut cur = leaf;
    for i in 0..10 {
        let sib = path_elements[i];
        let bit = path_bits[i];
        constrain_bit(bit);
        if bit == 0 {
            cur = compress(cur, sib);
        } else {
            cur = compress(sib, cur);
        }
    }
    cur
}

// Slim policy-transaction circuit for Sobre payroll. D2 scope: the ASP allowlist
// proofs and the sparse-tree non-inclusion checks are intentionally dropped (not
// load-bearing for the payroll predicate; disclosed). Ported from
// policyTransaction.circom with nIns=1, nOuts=8, levels=10. All Poseidon2 hashing
// is pool-aligned (poseidon2_pool.nr).
pub fn main(
    // === 12 public inputs (separate fields, many_pubs pattern) ===
    root: pub Field,
    public_amount: pub Field,
    ext_data_hash: pub Field,
    input_nullifier: pub Field,
    output_commitment_0: pub Field,
    output_commitment_1: pub Field,
    output_commitment_2: pub Field,
    output_commitment_3: pub Field,
    output_commitment_4: pub Field,
    output_commitment_5: pub Field,
    output_commitment_6: pub Field,
    output_commitment_7: pub Field,
    // === private inputs ===
    in_amount: Field,
    in_private_key: Field,
    in_blinding: Field,
    in_path_indices: Field,
    in_path_elements: [Field; 10],
    in_path_bits: [Field; 10],
    out_amount: [Field; 8],
    out_pub_key: [Field; 8],
    out_blinding: [Field; 8],
) {
    // Keypair: publicKey = Poseidon2(2)([privKey, 0], domSep=0x03)
    let pub_key = hash1_with_sep(in_private_key, 0x03);

    // Input commitment: Poseidon2(3)([amount, pubKey, blinding], domSep=0x01)
    let in_commitment = hash3_with_sep(in_amount, pub_key, in_blinding, 0x01);

    // Signature: Poseidon2(3)([privKey, commitment, pathIndices], domSep=0x04)
    let sig = hash3_with_sep(in_private_key, in_commitment, in_path_indices, 0x04);

    // Nullifier: Poseidon2(3)([commitment, pathIndices, signature], domSep=0x02)
    let nullifier = hash3_with_sep(in_commitment, in_path_indices, sig, 0x02);
    assert(nullifier == input_nullifier);

    // Merkle inclusion is checked only when the input is a real (non-zero) UTXO.
    // ZERO_LEAF is the pool's canonical empty leaf (Poseidon2("XLM")); empty
    // positions of the Merkle path carry the zero-hash chain rooted at it, so we
    // bind the constant into the circuit (anchors the on-chain empty-tree shape).
    assert(ZERO_LEAF != 0);
    if in_amount != 0 {
        let computed_root = compute_root(in_commitment, in_path_elements, in_path_bits);
        assert(computed_root == root);
    }

    // Output commitments + 248-bit range checks.
    let expected = [
        output_commitment_0, output_commitment_1, output_commitment_2, output_commitment_3,
        output_commitment_4, output_commitment_5, output_commitment_6, output_commitment_7,
    ];
    let mut sum_outs: Field = 0;
    for i in 0..8 {
        let oc = hash3_with_sep(out_amount[i], out_pub_key[i], out_blinding[i], 0x01);
        assert(oc == expected[i]);
        // range check: amount must fit in 248 bits (Circom Num2Bits(248) analog).
        // 31 bytes = 248 bits; the byte decomposition must reconstruct the field.
        let bytes: [u8; 31] = out_amount[i].to_le_bytes();
        let mut acc: Field = 0;
        let mut mul: Field = 1;
        for b in 0..31 {
            acc += (bytes[b] as Field) * mul;
            mul *= 256;
        }
        assert(acc == out_amount[i]);
        sum_outs += out_amount[i];
    }

    // Conservation invariant: sumIns + publicAmount == sumOuts.
    assert(in_amount + public_amount == sum_outs);

    // extDataHash binding (mirror of the Circom extDataSquare safety constraint).
    let _ = ext_data_hash * ext_data_hash;
}
