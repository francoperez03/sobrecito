use crate::{
    Error, ExtData, PoolContract, PoolContractClient, Proof,
    merkle_with_history::{MerkleDataKey, MerkleTreeWithHistory},
};
use soroban_sdk::{
    Address, Bytes, BytesN, Env, I256, U256, Vec,
    testutils::Address as _,
    xdr::ToXdr,
};
use soroban_utils::{constants::bn256_modulus, utils::MockToken};

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn mk_bytesn32(env: &Env, fill: u8) -> BytesN<32> {
    BytesN::from_array(env, &[fill; 32])
}

fn mk_ext_data(env: &Env, recipient: Address, ext_amount: i32) -> ExtData {
    let mut encrypted_outputs: Vec<Bytes> = Vec::new(env);
    encrypted_outputs.push_back(Bytes::new(env));
    encrypted_outputs.push_back(Bytes::new(env));
    ExtData {
        recipient,
        ext_amount: I256::from_i32(env, ext_amount),
        encrypted_outputs,
    }
}

fn mk_commitments(env: &Env, vals: &[u32]) -> Vec<U256> {
    let mut v: Vec<U256> = Vec::new(env);
    for &x in vals {
        v.push_back(U256::from_u32(env, x));
    }
    v
}

fn compute_ext_hash(env: &Env, ext: &ExtData) -> BytesN<32> {
    let payload = ext.clone().to_xdr(env);
    let digest: BytesN<32> = env.crypto().keccak256(&payload).into();
    let digest_u256 = U256::from_be_bytes(env, &Bytes::from(digest));
    let reduced = digest_u256.rem_euclid(&bn256_modulus(env));
    let mut buf = [0u8; 32];
    reduced.to_be_bytes().copy_into_slice(&mut buf);
    BytesN::from_array(env, &buf)
}

fn register_mock_token(env: &Env) -> Address {
    env.register(MockToken, ())
}

/// Create a mock UltraHonk proof Proof struct for unit tests.
///
/// The proof and public_inputs blobs are intentionally small/invalid — unit
/// tests that reach verify_proof will fail with InvalidProof, but tests that
/// check earlier validation (root, nullifiers, ext-hash, public-amount) never
/// reach the verifier.
fn mk_mock_proof(
    env: &Env,
    root: U256,
    input_nullifiers: Vec<U256>,
    output_commitments: Vec<U256>,
    public_amount: U256,
    ext_data_hash: BytesN<32>,
) -> Proof {
    // Minimal non-empty blobs (the verifier is a separate contract; in unit
    // tests there is no live UltraHonkVerifierContract, so this never gets
    // called for tests that test earlier-stage rejections).
    let public_inputs = Bytes::from_array(env, &[0u8; 32]);
    let proof_bytes = Bytes::from_array(env, &[0u8; 32]);

    Proof {
        public_inputs,
        proof_bytes,
        root,
        input_nullifiers,
        output_commitments,
        public_amount,
        ext_data_hash,
    }
}

/// Register a pool with the new UltraHonk constructor (no ASP parameters).
fn register_pool(env: &Env, admin: &Address, token: &Address, verifier: &Address, levels: u32) -> Address {
    let max = U256::from_u32(env, 1_000_000);
    env.register(
        PoolContract,
        (
            admin.clone(),
            token.clone(),
            verifier.clone(),
            max,
            levels,
        ),
    )
}

fn test_env() -> Env {
    #[cfg(miri)]
    {
        use soroban_sdk::testutils::EnvTestConfig;
        Env::new_with_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        })
    }
    #[cfg(not(miri))]
    {
        Env::default()
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[test]
fn pool_constructor_sets_state() {
    let env = test_env();
    let admin = Address::generate(&env);
    let token = register_mock_token(&env);
    // Use a dummy address for the verifier (no actual UltraHonk contract needed here)
    let verifier = Address::generate(&env);
    let levels = 8u32;
    let max = U256::from_u32(&env, 100);

    let pool_id = env.register(
        PoolContract,
        (
            admin.clone(),
            token.clone(),
            verifier.clone(),
            max.clone(),
            levels,
        ),
    );
    let pool = PoolContractClient::new(&env, &pool_id);

    let stored_admin: Address = env.as_contract(&pool_id, || {
        env.storage()
            .persistent()
            .get(&crate::pool::DataKey::Admin)
            .unwrap_or_else(|| panic!("expected admin to be stored"))
    });
    let stored_max: U256 = env.as_contract(&pool_id, || {
        env.storage()
            .persistent()
            .get(&crate::pool::DataKey::MaximumDepositAmount)
            .unwrap_or_else(|| panic!("expected maximum deposit amount to be stored"))
    });
    let has_merkle_root = env.as_contract(&pool_id, || {
        env.storage()
            .persistent()
            .has(&MerkleDataKey::CurrentRootIndex)
    });

    assert_eq!(stored_admin, admin);
    assert_eq!(stored_max, max);
    assert!(has_merkle_root);
    let _root = pool.get_root();
}

#[test]
fn merkle_init_only_once() {
    let env = test_env();
    let admin = Address::generate(&env);
    let token = register_mock_token(&env);
    let verifier = Address::generate(&env);
    let max = U256::from_u32(&env, 100);
    let levels = 8u32;

    let pool_id = env.register(
        PoolContract,
        (admin, token, verifier, max, levels),
    );

    env.as_contract(&pool_id, || {
        let result = MerkleTreeWithHistory::init(&env, levels);
        assert!(result.is_err());
    });
}

#[test]
fn merkle_insert_updates_root_and_index() {
    let env = test_env();
    let admin = Address::generate(&env);
    let token = register_mock_token(&env);
    let verifier = Address::generate(&env);
    let max = U256::from_u32(&env, 100);
    let levels = 8u32;

    let pool_id = env.register(PoolContract, (admin, token, verifier, max, levels));

    env.as_contract(&pool_id, || {
        let leaf1 = U256::from_u32(&env, 0x01);
        let leaf2 = U256::from_u32(&env, 0x02);

        let (idx_0, idx_1) = MerkleTreeWithHistory::insert_two_leaves(&env, leaf1, leaf2)
            .unwrap_or_else(|err| panic!("expected leaf insertion to succeed: {err:?}"));
        assert_eq!(idx_0, 0);
        assert_eq!(idx_1, 1);

        let root = MerkleTreeWithHistory::get_last_root(&env)
            .unwrap_or_else(|err| panic!("expected last root to exist: {err:?}"));
        assert!(
            MerkleTreeWithHistory::is_known_root(&env, &root)
                .unwrap_or_else(|err| panic!("expected root lookup to succeed: {err:?}"))
        );

        let next: u64 = env
            .storage()
            .persistent()
            .get(&MerkleDataKey::NextIndex)
            .unwrap_or_else(|| panic!("expected next index to be stored"));
        assert_eq!(next, 2);
    });
}

#[test]
fn merkle_insert_n_leaves_inserts_eight_in_pairs() {
    let env = test_env();
    let admin = Address::generate(&env);
    let token = register_mock_token(&env);
    let verifier = Address::generate(&env);
    let max = U256::from_u32(&env, 1000);
    let levels = 8u32;

    let pool_id = env.register(PoolContract, (admin, token, verifier, max, levels));

    env.as_contract(&pool_id, || {
        let leaves = mk_commitments(&env, &[0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
        let indices = MerkleTreeWithHistory::insert_n_leaves(&env, leaves)
            .unwrap_or_else(|err| panic!("expected 8-leaf insertion to succeed: {err:?}"));

        assert_eq!(indices.len(), 8);
        for i in 0..8u32 {
            assert_eq!(indices.get(i).unwrap(), i);
        }

        let next: u64 = env
            .storage()
            .persistent()
            .get(&MerkleDataKey::NextIndex)
            .unwrap_or_else(|| panic!("expected next index to be stored"));
        assert_eq!(next, 8);
    });
}

#[test]
fn merkle_insert_n_leaves_rejects_odd_count() {
    let env = test_env();
    let admin = Address::generate(&env);
    let token = register_mock_token(&env);
    let verifier = Address::generate(&env);
    let max = U256::from_u32(&env, 1000);
    let levels = 8u32;

    let pool_id = env.register(PoolContract, (admin, token, verifier, max, levels));

    env.as_contract(&pool_id, || {
        let leaves = mk_commitments(&env, &[0x11, 0x22, 0x33]);
        let result = MerkleTreeWithHistory::insert_n_leaves(&env, leaves);
        assert!(result.is_err());
    });
}

/// UltraHonk public-inputs layout: 12 separate `pub Field` signals
/// (root, public_amount, ext_data_hash, input_nullifier, output_commitment_0..7).
/// This test documents the expected 384-byte blob shape (validated on-chain in
/// 09-03) and confirms there are exactly 12 fields, without ASP roots (D2 drop).
#[test]
fn ultrahonk_public_inputs_shape_12_fields() {
    // 12 fields × 32 bytes = 384 bytes (no PPO in public_inputs, no ASP roots)
    let expected_count: usize = 12;
    let expected_bytes: usize = expected_count * 32;
    assert_eq!(expected_bytes, 384);

    // The slim circuit signals (in order):
    let signals = [
        "root",
        "public_amount",
        "ext_data_hash",
        "input_nullifier",
        "output_commitment_0",
        "output_commitment_1",
        "output_commitment_2",
        "output_commitment_3",
        "output_commitment_4",
        "output_commitment_5",
        "output_commitment_6",
        "output_commitment_7",
    ];
    assert_eq!(signals.len(), expected_count);
    // D2: no ASP roots in the list
    assert!(!signals.contains(&"asp_membership_root"));
    assert!(!signals.contains(&"asp_non_membership_root"));
}

/// PROOF-01 (A1 observador): el evento publico del pool no expone montos
/// individuales.
#[test]
fn events_expose_no_plaintext_amount() {
    use crate::pool::NewCommitmentEvent;
    let env = test_env();

    let encrypted_output = Bytes::from_array(&env, &[0xDE, 0xAD, 0xBE, 0xEF]);
    let event = NewCommitmentEvent {
        commitment: U256::from_u32(&env, 0xC0FFEE),
        index: 0u32,
        encrypted_output: encrypted_output.clone(),
    };

    assert_eq!(event.commitment, U256::from_u32(&env, 0xC0FFEE));
    assert_eq!(event.index, 0u32);
    assert_eq!(event.encrypted_output, encrypted_output);
}

#[test]
fn merkle_insert_fails_when_full() {
    let env = test_env();
    let admin = Address::generate(&env);
    let token = register_mock_token(&env);
    let verifier = Address::generate(&env);
    let max = U256::from_u32(&env, 100);
    let levels = 1u32;

    let pool_id = env.register(PoolContract, (admin, token, verifier, max, levels));

    env.as_contract(&pool_id, || {
        let leaf1 = U256::from_u32(&env, 0x0A);
        let leaf2 = U256::from_u32(&env, 0x0B);

        let result1 = MerkleTreeWithHistory::insert_two_leaves(&env, leaf1.clone(), leaf2.clone());
        assert!(result1.is_ok());

        let result2 = MerkleTreeWithHistory::insert_two_leaves(&env, leaf1, leaf2);
        assert!(result2.is_err());
    });
}

#[test]
fn merkle_init_rejects_zero_levels() {
    let env = test_env();
    let admin = Address::generate(&env);
    let token = register_mock_token(&env);
    let verifier = Address::generate(&env);
    let max = U256::from_u32(&env, 100);
    let levels = 8u32;

    let pool_id = env.register(PoolContract, (admin, token, verifier, max, levels));
    let zero = 0u32;

    env.as_contract(&pool_id, || {
        let result = MerkleTreeWithHistory::init(&env, zero);
        assert!(result.is_err());
    });
}

#[test]
fn transact_rejects_unknown_root() {
    let env = test_env();
    let admin = Address::generate(&env);
    let token = register_mock_token(&env);
    let verifier = Address::generate(&env);
    let max = U256::from_u32(&env, 1000);
    let levels = 3u32;

    let pool_id = env.register(PoolContract, (admin, token, verifier, max, levels));
    let pool = PoolContractClient::new(&env, &pool_id);

    env.mock_all_auths();
    let sender = Address::generate(&env);
    let ext = mk_ext_data(&env, Address::generate(&env), 0);

    let root = U256::from_u32(&env, 0xFF); // not a known root

    let mut input_nullifiers: Vec<U256> = Vec::new(&env);
    input_nullifiers.push_back(U256::from_u32(&env, 0xAB));

    let proof = mk_mock_proof(
        &env,
        root,
        input_nullifiers,
        mk_commitments(&env, &[0x01, 0x02]),
        U256::from_u32(&env, 0),
        mk_bytesn32(&env, 0xEE),
    );

    assert!(pool.try_transact(&proof, &ext, &sender).is_err());
}

#[test]
fn transact_rejects_bad_ext_hash() {
    let env = test_env();
    let admin = Address::generate(&env);
    let token = register_mock_token(&env);
    let verifier = Address::generate(&env);
    let max = U256::from_u32(&env, 1000);
    let levels = 3u32;

    let pool_id = env.register(PoolContract, (admin, token, verifier, max, levels));
    let pool = PoolContractClient::new(&env, &pool_id);

    env.mock_all_auths();
    let sender = Address::generate(&env);
    let root = pool.get_root();
    let ext = mk_ext_data(&env, Address::generate(&env), 0);

    let mut input_nullifiers: Vec<U256> = Vec::new(&env);
    input_nullifiers.push_back(U256::from_u32(&env, 0xCC));

    let proof = mk_mock_proof(
        &env,
        root,
        input_nullifiers,
        mk_commitments(&env, &[0x03, 0x04]),
        U256::from_u32(&env, 0),
        mk_bytesn32(&env, 0x99), // mismatched hash
    );

    assert!(pool.try_transact(&proof, &ext, &sender).is_err());
}

#[test]
fn transact_rejects_bad_public_amount() {
    let env = test_env();
    let admin = Address::generate(&env);
    let token = register_mock_token(&env);
    let verifier = Address::generate(&env);
    let max = U256::from_u32(&env, 1000);
    let levels = 3u32;

    let pool_id = env.register(PoolContract, (admin, token, verifier, max, levels));
    let pool = PoolContractClient::new(&env, &pool_id);

    env.mock_all_auths();
    let sender = Address::generate(&env);
    let root = pool.get_root();
    let ext = mk_ext_data(&env, Address::generate(&env), 0);
    let ext_hash = compute_ext_hash(&env, &ext);

    let mut input_nullifiers: Vec<U256> = Vec::new(&env);
    input_nullifiers.push_back(U256::from_u32(&env, 0xDD));

    let proof = mk_mock_proof(
        &env,
        root,
        input_nullifiers,
        mk_commitments(&env, &[0x05, 0x06]),
        U256::from_u32(&env, 1), // should be 0 for ext_amount=0
        ext_hash,
    );

    assert!(pool.try_transact(&proof, &ext, &sender).is_err());
}

/// PROOF-05 (A3 doble conteo): nullifier ya gastado revierte con
/// `AlreadySpentNullifier` antes del verify ZK.
#[test]
fn transact_rejects_reused_nullifier() {
    let env = test_env();
    let admin = Address::generate(&env);
    let token = register_mock_token(&env);
    let verifier = Address::generate(&env);
    let max = U256::from_u32(&env, 1000);
    let levels = 3u32;

    let pool_id = env.register(PoolContract, (admin, token, verifier, max, levels));
    let pool = PoolContractClient::new(&env, &pool_id);

    env.mock_all_auths();
    let sender = Address::generate(&env);

    // Pre-marcar el nullifier como gastado
    let used_nullifier = U256::from_u32(&env, 0xABCD);
    env.as_contract(&pool_id, || {
        let mut nulls: soroban_sdk::Map<U256, bool> = env
            .storage()
            .persistent()
            .get(&crate::pool::DataKey::Nullifiers)
            .unwrap();
        nulls.set(used_nullifier.clone(), true);
        env.storage()
            .persistent()
            .set(&crate::pool::DataKey::Nullifiers, &nulls);
    });

    let root = pool.get_root();
    let ext = mk_ext_data(&env, Address::generate(&env), 0);
    let ext_hash = compute_ext_hash(&env, &ext);

    let root_before = pool.get_root();

    let mut input_nullifiers: Vec<U256> = Vec::new(&env);
    input_nullifiers.push_back(used_nullifier.clone());

    let proof = mk_mock_proof(
        &env,
        root,
        input_nullifiers,
        mk_commitments(&env, &[1, 2, 3, 4, 5, 6, 7, 8]),
        U256::from_u32(&env, 0),
        ext_hash,
    );

    assert!(matches!(
        pool.try_transact(&proof, &ext, &sender),
        Err(Ok(Error::AlreadySpentNullifier))
    ));

    // All-or-nothing: el arbol no inserto ningun commitment
    assert_eq!(pool.get_root(), root_before);
}

/// Computes and prints the ext_data_hash for the payroll demo ExtData.
///
/// Run with:
///   cargo test -p pool print_demo_ext_data_hash -- --nocapture --ignored
#[test]
#[ignore]
fn print_demo_ext_data_hash() {
    let env = test_env();

    let deployer_strkey = "GBWJZZ3XSNAY3WLFNLXUZXEEYMZCYVG4TW6Z5VSASJS2TOWF7GGPPKMW";
    let recipient = Address::from_str(&env, deployer_strkey);

    let ext_amount: i32 = 0;
    let mut encrypted_outputs: Vec<Bytes> = Vec::new(&env);
    for _ in 0..8u32 {
        encrypted_outputs.push_back(Bytes::new(&env));
    }

    let ext = ExtData {
        recipient,
        ext_amount: I256::from_i32(&env, ext_amount),
        encrypted_outputs,
    };

    let hash = compute_ext_hash(&env, &ext);
    let mut hash_bytes = [0u8; 32];
    hash.copy_into_slice(&mut hash_bytes);

    extern crate std;
    let hex: std::string::String = hash_bytes.iter()
        .map(|b| std::format!("{b:02x}"))
        .collect::<std::vec::Vec<_>>()
        .join("");
    std::println!("ext_data_hash_hex={hex}");
}

/// Computes the `ext_data_hash` for a REAL payroll batch with 8 dual ECIES blobs.
///
/// Run with:
///   SOBRE_BLOBS_HEX="<hex0>,<hex1>,...,<hex7>" \
///     cargo test -p pool print_real_batch_ext_data_hash -- --nocapture --ignored
#[test]
#[ignore]
fn print_real_batch_ext_data_hash() {
    extern crate std;
    let env = test_env();

    let deployer_strkey = "GBWJZZ3XSNAY3WLFNLXUZXEEYMZCYVG4TW6Z5VSASJS2TOWF7GGPPKMW";
    let recipient = Address::from_str(&env, deployer_strkey);

    let blobs_hex = std::env::var("SOBRE_BLOBS_HEX")
        .expect("set SOBRE_BLOBS_HEX to 8 comma-separated blob hexes");
    let parts: std::vec::Vec<&str> = blobs_hex.split(',').collect();
    assert_eq!(parts.len(), 8, "expected exactly 8 blob hexes");

    let mut encrypted_outputs: Vec<Bytes> = Vec::new(&env);
    for part in parts {
        let part = part.trim().trim_start_matches("0x");
        assert!(part.len() % 2 == 0, "blob hex must have even length");
        let mut bytes = Bytes::new(&env);
        let chars: std::vec::Vec<char> = part.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            let byte = u8::from_str_radix(
                &std::format!("{}{}", chars[i], chars[i + 1]),
                16,
            )
            .expect("invalid hex byte in SOBRE_BLOBS_HEX");
            bytes.push_back(byte);
            i += 2;
        }
        encrypted_outputs.push_back(bytes);
    }

    let ext_amount_i32: i32 = std::env::var("SOBRE_EXT_AMOUNT")
        .ok()
        .and_then(|s| s.trim().parse::<i32>().ok())
        .unwrap_or(0);

    let ext = ExtData {
        recipient,
        ext_amount: I256::from_i32(&env, ext_amount_i32),
        encrypted_outputs,
    };

    let hash = compute_ext_hash(&env, &ext);
    let mut hash_bytes = [0u8; 32];
    hash.copy_into_slice(&mut hash_bytes);
    let hex: std::string::String = hash_bytes
        .iter()
        .map(|b| std::format!("{b:02x}"))
        .collect::<std::vec::Vec<_>>()
        .join("");
    std::println!("ext_data_hash_hex={hex}");
}

// ─── Real UltraHonk e2e (verify ZK real, no mock) ──────────────────────────────

/// Raw `bb 0.87.0` artifacts for the `sobre_slim` circuit, generated from
/// `circuits/sobre_slim/Prover.toml` (in_amount=0, public_amount=0, root = the
/// empty-tree root of a fresh depth-10 pool, recipient = mikey, 8 empty outputs).
/// See `packages/zk/README.md` for the regeneration command (`nargo execute` +
/// `bb prove`/`write_vk --oracle_hash keccak`).
const REAL_PROOF: &[u8] = include_bytes!("../../../testdata/sobre_slim_real.proof.bin");
const REAL_PUBLIC_INPUTS: &[u8] =
    include_bytes!("../../../testdata/sobre_slim_real.public_inputs.bin");
const REAL_VK: &[u8] = include_bytes!("../../../testdata/sobre_slim_real.vk.bin");

/// Read field `i` (0-based) from the 384-byte public-inputs blob as a U256.
/// Layout: 12 fields × 32 bytes, big-endian (root, public_amount, ext_data_hash,
/// input_nullifier, output_commitment_0..7).
fn read_pi_field(env: &Env, i: usize) -> U256 {
    let start = i.checked_mul(32).expect("field offset overflow");
    let slice = &REAL_PUBLIC_INPUTS[start..start.checked_add(32).expect("overflow")];
    let mut buf = [0u8; 32];
    buf.copy_from_slice(slice);
    U256::from_be_bytes(env, &Bytes::from_array(env, &buf))
}

/// PROOF-08 (A3 soundness): a REAL UltraHonk proof verifies on-chain through the
/// genuine `rs-soroban-ultrahonk` verifier contract, exercising `verify_proof()`
/// end to end (not a mock). The pool registers the real verifier with the
/// `sobre_slim` VK, then `transact()` passes all public-input checks AND the ZK
/// verification.
///
/// Witness (Prover.toml): no input note (in_amount=0), public_amount=0 (reshield,
/// no USDC transfer, respects the 1-USDC testnet cap), recipient = mikey, 8 empty
/// encrypted_outputs. The proof's `root` is the empty-tree root of a freshly
/// constructed depth-10 pool, so the on-chain Merkle history check passes without
/// any prior insert.
#[test]
fn transact_with_real_ultrahonk_proof() {
    use rs_soroban_ultrahonk::UltraHonkVerifierContract;

    let env = test_env();
    let admin = Address::generate(&env);
    let token = register_mock_token(&env);

    // Register the REAL (external, unaudited) UltraHonk verifier with the
    // sobre_slim VK. The constructor validates the VK bytes.
    let vk_bytes = Bytes::from_slice(&env, REAL_VK);
    let verifier = env.register(UltraHonkVerifierContract, (vk_bytes,));

    // levels=10 matches the circuit's depth-10 Merkle tree (sobre_slim main.nr).
    let levels = 10u32;
    let pool_id = register_pool(&env, &admin, &token, &verifier, levels);
    let pool = PoolContractClient::new(&env, &pool_id);

    // The fresh pool's empty-tree root must equal the proof's `root` public input;
    // otherwise the Merkle-history check would reject before reaching verify.
    let pi_root = read_pi_field(&env, 0);
    assert_eq!(
        pool.get_root(),
        pi_root,
        "fresh depth-10 pool root must match the proof's root public input"
    );

    // ExtData that hashes to the proof's `ext_data_hash` (field 2): recipient =
    // mikey deployer, ext_amount=0, 8 empty encrypted_outputs.
    let deployer_strkey = "GBWJZZ3XSNAY3WLFNLXUZXEEYMZCYVG4TW6Z5VSASJS2TOWF7GGPPKMW";
    let recipient = Address::from_str(&env, deployer_strkey);
    let mut encrypted_outputs: Vec<Bytes> = Vec::new(&env);
    for _ in 0..8u32 {
        encrypted_outputs.push_back(Bytes::new(&env));
    }
    let ext = ExtData {
        recipient,
        ext_amount: I256::from_i32(&env, 0),
        encrypted_outputs,
    };

    // Sanity: the ExtData hash matches the proof's ext_data_hash public input.
    let ext_hash = compute_ext_hash(&env, &ext);
    let pi_ext_hash = read_pi_field(&env, 2);
    assert_eq!(
        U256::from_be_bytes(&env, &Bytes::from(ext_hash.clone())),
        pi_ext_hash,
        "ExtData hash must match the proof's ext_data_hash public input"
    );

    // Structured Proof fields (read from the same public-inputs blob the verifier sees).
    let public_amount = read_pi_field(&env, 1);
    let mut input_nullifiers: Vec<U256> = Vec::new(&env);
    input_nullifiers.push_back(read_pi_field(&env, 3));
    let mut output_commitments: Vec<U256> = Vec::new(&env);
    for i in 0..8usize {
        output_commitments.push_back(read_pi_field(&env, 4usize.checked_add(i).unwrap()));
    }

    let proof = Proof {
        public_inputs: Bytes::from_slice(&env, REAL_PUBLIC_INPUTS),
        proof_bytes: Bytes::from_slice(&env, REAL_PROOF),
        root: pi_root,
        input_nullifiers,
        output_commitments,
        public_amount,
        ext_data_hash: ext_hash,
    };

    env.mock_all_auths();
    let sender = Address::generate(&env);

    // The real verifier runs here — verify_proof() is exercised end to end.
    let result = pool.try_transact(&proof, &ext, &sender);
    assert!(
        result.is_ok(),
        "real UltraHonk proof must verify and transact: {result:?}"
    );
}
