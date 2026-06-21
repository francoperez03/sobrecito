mod poseidon2_constants;
mod poseidon2_pool;

use poseidon2_pool::{compress, hash2_with_sep, hash3_with_sep};

// Cross-check harness entrypoint (Task 0): exposes the pool-aligned Poseidon2
// helpers so cross_check_poseidon.ts can compare them byte-for-byte against the
// on-chain poseidon2-tester contract.
//
//   out[0] = hash2_with_sep(amount, pubkey, sep=0x01)  -> on-chain hash2 (t=3)
//   out[1] = hash3_with_sep(amount, pubkey, blinding, sep=0x01) -> commitment (t=4)
//   out[2] = compress(merkle_left, merkle_right)       -> on-chain compress (t=2)
//
// The harness checks out[0] == on-chain hash2(100,7,sep=1) and
// out[2] == on-chain compress(1,2). The t=4 commitment (out[1]) is validated
// separately against the zkhash reference (see 09-02-SUMMARY.md Task 0).
pub fn main(
    amount: Field,
    pubkey: Field,
    blinding: Field,
    merkle_left: Field,
    merkle_right: Field,
) -> pub [Field; 3] {
    let h2 = hash2_with_sep(amount, pubkey, 0x01);
    let commitment = hash3_with_sep(amount, pubkey, blinding, 0x01);
    let merkle = compress(merkle_left, merkle_right);
    [h2, commitment, merkle]
}
