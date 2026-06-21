use dep::poseidon::poseidon2::Poseidon2;

fn hash2(a: Field, b: Field) -> Field {
    Poseidon2::hash([a, b], 2)
}

fn hash3_with_sep(a: Field, b: Field, c: Field, sep: Field) -> Field {
    Poseidon2::hash([a, b, c, sep], 4)
}

fn hash1_with_sep(a: Field, sep: Field) -> Field {
    Poseidon2::hash([a, sep], 2)
}

// Cross-check harness entrypoint: expone los 3 usos como public outputs.
pub fn main(
    amount: Field, pubkey: Field, blinding: Field,
    merkle_left: Field, merkle_right: Field,
) -> pub [Field; 3] {
    let commitment = hash3_with_sep(amount, pubkey, blinding, 0x01);
    let nullifier  = hash3_with_sep(commitment, 0, 0, 0x02);
    let compress   = hash2(merkle_left, merkle_right);
    [commitment, nullifier, compress]
}
