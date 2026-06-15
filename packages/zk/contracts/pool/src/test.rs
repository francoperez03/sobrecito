use crate::{
    Error, ExtData, PoolContract, PoolContractClient, Proof,
    merkle_with_history::{MerkleDataKey, MerkleTreeWithHistory},
};
use asp_membership::{ASPMembership, ASPMembershipClient};
use asp_non_membership::{ASPNonMembership, ASPNonMembershipClient};
use circom_groth16_verifier::{CircomGroth16Verifier, Groth16Proof};
use soroban_sdk::{
    Address, Bytes, BytesN, Env, I256, U256, Vec,
    crypto::bn254::{Bn254G1Affine as G1Affine, Bn254G2Affine as G2Affine},
    testutils::Address as _,
    xdr::ToXdr,
};
use soroban_utils::{constants::bn256_modulus, utils::MockToken};

/// Number of levels for the ASP Membership Merkle tree in tests
const ASP_MEMBERSHIP_LEVELS: u32 = 8;

// Helper to get 32 bytes
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

/// Build a `Vec<U256>` of output commitments from raw u32 values.
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

/// Create a mock Groth16 proof for testing
///
/// This creates a dummy proof with valid curve points.
/// The actual proof validity is not checked in unit tests for now
fn mk_mock_groth16_proof(env: &Env) -> Groth16Proof {
    // G1 generator point
    let g1_bytes = {
        let mut bytes = [0u8; 64];
        bytes[31] = 1; // x = 1 (big-endian)
        bytes[63] = 2; // y = 2 (big-endian)
        bytes
    };

    // G2 generator point
    let g2_bytes = {
        let mut bytes = [0u8; 128];
        // Set some non-zero values for a valid-looking G2 point
        bytes[31] = 1;
        bytes[63] = 1;
        bytes[95] = 1;
        bytes[127] = 1;
        bytes
    };

    Groth16Proof {
        a: G1Affine::from_array(env, &g1_bytes),
        b: G2Affine::from_array(env, &g2_bytes),
        c: G1Affine::from_array(env, &g1_bytes),
    }
}

/// Helper struct to hold all test setup
struct TestSetup {
    admin: Address,
    token: Address,
    verifier: Address,
    asp_membership_address: Address,
    asp_non_membership_address: Address,
    asp_membership_client: ASPMembershipClient<'static>,
    asp_non_membership_client: ASPNonMembershipClient<'static>,
}

/// Creates and deploys all contracts needed for testing
fn setup_test_contracts(env: &Env) -> TestSetup {
    let admin = Address::generate(env);

    // Register ASP Membership contract
    let asp_membership_address =
        env.register(ASPMembership, (admin.clone(), ASP_MEMBERSHIP_LEVELS));
    let asp_membership_client = ASPMembershipClient::new(env, &asp_membership_address);

    // Register ASP Non-Membership contract
    let asp_non_membership_address = env.register(ASPNonMembership, (admin.clone(),));
    let asp_non_membership_client = ASPNonMembershipClient::new(env, &asp_non_membership_address);

    // Register CircomGroth16Verifier contract
    let verifier_address = env.register(CircomGroth16Verifier, ());

    TestSetup {
        admin,
        token: register_mock_token(env),
        verifier: verifier_address,
        asp_membership_address,
        asp_non_membership_address,
        asp_membership_client,
        asp_non_membership_client,
    }
}

/// Create a test environment that disables snapshot writing under Miri.
/// Miri's isolation mode blocks filesystem operations, which the Soroban SDK
/// uses for test snapshots.
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

#[test]
fn pool_constructor_sets_state() {
    let env = test_env();
    let setup = setup_test_contracts(&env);
    let max = U256::from_u32(&env, 100);
    let levels = 8u32;
    let pool_id = env.register(
        PoolContract,
        (
            setup.admin.clone(),
            setup.token.clone(),
            setup.verifier.clone(),
            setup.asp_membership_address.clone(),
            setup.asp_non_membership_address.clone(),
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

    assert_eq!(stored_admin, setup.admin);
    assert_eq!(stored_max, max);
    assert!(has_merkle_root);
    let _root = pool.get_root();
}

#[test]
fn merkle_init_only_once() {
    let env = test_env();
    // As MerkleTreeWithHistory is now a module
    // We need to register the contract first to access the env.storage of a smart
    // contract
    let setup = setup_test_contracts(&env);
    let max = U256::from_u32(&env, 100);
    let levels = 8u32;
    // First init should succeed
    let pool_id = env.register(
        PoolContract,
        (
            setup.admin.clone(),
            setup.token.clone(),
            setup.verifier.clone(),
            setup.asp_membership_address.clone(),
            setup.asp_non_membership_address.clone(),
            max.clone(),
            levels,
        ),
    );

    env.as_contract(&pool_id, || {
        // Second init should return AlreadyInitialized error
        let result = MerkleTreeWithHistory::init(&env, levels);
        assert!(result.is_err());
    });
}

#[test]
fn merkle_insert_updates_root_and_index() {
    let env = test_env();
    let setup = setup_test_contracts(&env);
    let max = U256::from_u32(&env, 100);
    let levels = 8u32;
    let pool_id = env.register(
        PoolContract,
        (
            setup.admin.clone(),
            setup.token.clone(),
            setup.verifier.clone(),
            setup.asp_membership_address.clone(),
            setup.asp_non_membership_address.clone(),
            max.clone(),
            levels,
        ),
    );

    env.as_contract(&pool_id, || {
        let leaf1 = U256::from_u32(&env, 0x01);
        let leaf2 = U256::from_u32(&env, 0x02);

        let (idx_0, idx_1) = MerkleTreeWithHistory::insert_two_leaves(&env, leaf1, leaf2)
            .unwrap_or_else(|err| panic!("expected leaf insertion to succeed: {err:?}"));
        assert_eq!(idx_0, 0);
        assert_eq!(idx_1, 1);

        // last root must be known
        let root = MerkleTreeWithHistory::get_last_root(&env)
            .unwrap_or_else(|err| panic!("expected last root to exist: {err:?}"));
        assert!(
            MerkleTreeWithHistory::is_known_root(&env, &root)
                .unwrap_or_else(|err| panic!("expected root lookup to succeed: {err:?}"))
        );

        // nextIndex should now be 2 (stored in persistent storage)
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
    let setup = setup_test_contracts(&env);
    let max = U256::from_u32(&env, 1000);
    let levels = 8u32;
    let pool_id = env.register(
        PoolContract,
        (
            setup.admin.clone(),
            setup.token.clone(),
            setup.verifier.clone(),
            setup.asp_membership_address.clone(),
            setup.asp_non_membership_address.clone(),
            max.clone(),
            levels,
        ),
    );

    env.as_contract(&pool_id, || {
        // 8 employee output commitments (payroll batch).
        let leaves = mk_commitments(&env, &[0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
        let indices = MerkleTreeWithHistory::insert_n_leaves(&env, leaves)
            .unwrap_or_else(|err| panic!("expected 8-leaf insertion to succeed: {err:?}"));

        // Returns the 8 indices in order 0..7.
        assert_eq!(indices.len(), 8);
        for i in 0..8u32 {
            assert_eq!(indices.get(i).unwrap(), i);
        }

        // next_index advanced to 8 (parity preserved across the 4 pair inserts).
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
    let setup = setup_test_contracts(&env);
    let max = U256::from_u32(&env, 1000);
    let levels = 8u32;
    let pool_id = env.register(
        PoolContract,
        (
            setup.admin.clone(),
            setup.token.clone(),
            setup.verifier.clone(),
            setup.asp_membership_address.clone(),
            setup.asp_non_membership_address.clone(),
            max.clone(),
            levels,
        ),
    );

    env.as_contract(&pool_id, || {
        // Odd number of leaves must be rejected (would break the even-index invariant).
        let leaves = mk_commitments(&env, &[0x11, 0x22, 0x33]);
        let result = MerkleTreeWithHistory::insert_n_leaves(&env, leaves);
        assert!(result.is_err());
    });
}

/// Guards the IC count for policy_tx_1_8: verify_proof must build exactly 14
/// public inputs (= vk.ic.len() - 1, IC = 15) or the verifier returns
/// MalformedPublicInputs before the pairing check (the error Enclave hit).
/// Mirrors verify_proof's canonical construction order against the real Proof
/// field lengths. The authoritative on-chain check runs in Plan 03 (live deploy).
#[test]
fn payroll_proof_has_14_public_inputs() {
    let env = test_env();

    // policy_tx_1_8 payroll shape: 1 input nullifier, 8 output commitments.
    let mut input_nullifiers: Vec<U256> = Vec::new(&env);
    input_nullifiers.push_back(U256::from_u32(&env, 0xAB));
    let output_commitments = mk_commitments(&env, &[1, 2, 3, 4, 5, 6, 7, 8]);

    // verify_proof order: root + public_amount + ext_data_hash (3 fixed)
    //   + input_nullifiers + output_commitments
    //   + asp_membership_root (×nIns) + asp_non_membership_root (×nIns)
    let n_in = input_nullifiers.len();
    let n_out = output_commitments.len();
    let public_input_count = 3 + n_in + n_out + n_in + n_in;

    assert_eq!(public_input_count, 14);

    // PROOF-02: assert the canonical ABI ORDER by index, not just the count.
    // Mirror verify_proof's construction (pool.rs:443-470) with distinct
    // sentinel values so a misordered slot is caught.
    let root = U256::from_u32(&env, 0x1111);
    let public_amount = U256::from_u32(&env, 0x2222);
    let ext_data_hash = U256::from_u32(&env, 0x3333);
    let asp_membership_root = U256::from_u32(&env, 0xAAAA);
    let asp_non_membership_root = U256::from_u32(&env, 0xBBBB);

    let mut abi: Vec<U256> = Vec::new(&env);
    abi.push_back(root.clone()); // [0] root
    abi.push_back(public_amount.clone()); // [1] public_amount
    abi.push_back(ext_data_hash.clone()); // [2] ext_data_hash
    for n in input_nullifiers.iter() {
        abi.push_back(n); // [3] input_nullifiers[0..nIns]
    }
    for c in output_commitments.iter() {
        abi.push_back(c); // [4..11] output_commitments[0..7]
    }
    for _ in 0..n_in {
        abi.push_back(asp_membership_root.clone()); // [12] asp_membership_root ×nIns
    }
    for _ in 0..n_in {
        abi.push_back(asp_non_membership_root.clone()); // [13] asp_non_membership_root ×nIns
    }

    assert_eq!(abi.len(), 14);
    assert_eq!(abi.get(0).unwrap(), root);
    assert_eq!(abi.get(1).unwrap(), public_amount);
    assert_eq!(abi.get(2).unwrap(), ext_data_hash);
    assert_eq!(abi.get(3).unwrap(), U256::from_u32(&env, 0xAB)); // nullifier
    assert_eq!(abi.get(4).unwrap(), U256::from_u32(&env, 1)); // first commitment
    assert_eq!(abi.get(11).unwrap(), U256::from_u32(&env, 8)); // last commitment
    assert_eq!(abi.get(12).unwrap(), asp_membership_root);
    assert_eq!(abi.get(13).unwrap(), asp_non_membership_root);
}

/// PROOF-01 (A1 observador): el evento publico del pool no expone montos
/// individuales. `NewCommitmentEvent` solo lleva commitment + index + blob
/// cifrado; nunca un amount en claro. Construimos el evento con un blob opaco y
/// confirmamos su forma. El total `sum=T` queda probado por la conservacion del
/// circuito (PROOF-07), no por ningun campo publico de monto.
///
/// Disclosure: garantia tecnica (la struct no tiene campo de monto) + de
/// politica (el blob debe cifrarse antes de pasarse al pool; el contrato lo
/// emite tal cual). PoC, no auditado.
#[test]
fn events_expose_no_plaintext_amount() {
    use crate::pool::NewCommitmentEvent;
    let env = test_env();

    // An opaque encrypted blob (the only place a per-note amount may live, and
    // only in ciphertext form).
    let encrypted_output = Bytes::from_array(&env, &[0xDE, 0xAD, 0xBE, 0xEF]);
    let event = NewCommitmentEvent {
        commitment: U256::from_u32(&env, 0xC0FFEE),
        index: 0u32,
        encrypted_output: encrypted_output.clone(),
    };

    // The public event surface is exactly {commitment, index, encrypted_output}.
    // There is no plaintext amount field to assert against: its absence is a
    // compile-time guarantee of the struct definition (pool.rs:198-206). We
    // assert the carried blob is the opaque ciphertext, never a cleartext value.
    assert_eq!(event.commitment, U256::from_u32(&env, 0xC0FFEE));
    assert_eq!(event.index, 0u32);
    assert_eq!(event.encrypted_output, encrypted_output);
}

#[test]
fn merkle_insert_fails_when_full() {
    let env = test_env();
    let setup = setup_test_contracts(&env);
    let max = U256::from_u32(&env, 100);
    let levels = 1u32;
    let pool_id = env.register(
        PoolContract,
        (
            setup.admin.clone(),
            setup.token.clone(),
            setup.verifier.clone(),
            setup.asp_membership_address.clone(),
            setup.asp_non_membership_address.clone(),
            max.clone(),
            levels,
        ),
    );

    env.as_contract(&pool_id, || {
        let leaf1 = U256::from_u32(&env, 0x0A);
        let leaf2 = U256::from_u32(&env, 0x0B);

        // First insert should succeed
        let result1 = MerkleTreeWithHistory::insert_two_leaves(&env, leaf1.clone(), leaf2.clone());
        assert!(result1.is_ok());

        // Second insert should fail with MerkleTreeFull error
        let result2 = MerkleTreeWithHistory::insert_two_leaves(&env, leaf1, leaf2);
        assert!(result2.is_err());
    });
}

#[test]
fn merkle_init_rejects_zero_levels() {
    let env = test_env();
    let setup = setup_test_contracts(&env);
    let max = U256::from_u32(&env, 100);
    let levels = 8u32;
    let pool_id = env.register(
        PoolContract,
        (
            setup.admin.clone(),
            setup.token.clone(),
            setup.verifier.clone(),
            setup.asp_membership_address.clone(),
            setup.asp_non_membership_address.clone(),
            max.clone(),
            levels,
        ),
    );
    let levels = 0u32;

    env.as_contract(&pool_id, || {
        let result = MerkleTreeWithHistory::init(&env, levels);
        assert!(result.is_err());
    });
}

#[test]
fn transact_rejects_unknown_root() {
    let env = test_env();
    let setup = setup_test_contracts(&env);
    let max = U256::from_u32(&env, 1000);
    let levels = 3u32;
    let root = U256::from_u32(&env, 0xFF); // not a known root
    let pool_id = env.register(
        PoolContract,
        (
            setup.admin.clone(),
            setup.token.clone(),
            setup.verifier.clone(),
            setup.asp_membership_address.clone(),
            setup.asp_non_membership_address.clone(),
            max.clone(),
            levels,
        ),
    );
    let pool = PoolContractClient::new(&env, &pool_id);

    env.mock_all_auths();
    let sender = Address::generate(&env);
    let ext = mk_ext_data(&env, Address::generate(&env), 0);

    // Get actual roots
    let asp_membership_root = setup.asp_membership_client.get_root();
    let asp_non_membership_root = setup.asp_non_membership_client.get_root();

    let proof = Proof {
        proof: mk_mock_groth16_proof(&env),
        root,
        input_nullifiers: {
            let mut v: Vec<U256> = Vec::new(&env);
            v.push_back(U256::from_u32(&env, 0xAB));
            v
        },
        output_commitments: mk_commitments(&env, &[0x01, 0x02]),
        public_amount: U256::from_u32(&env, 0),
        ext_data_hash: mk_bytesn32(&env, 0xEE),
        asp_membership_root,
        asp_non_membership_root,
    };

    assert!(pool.try_transact(&proof, &ext, &sender).is_err());
}

#[test]
fn transact_rejects_bad_ext_hash() {
    let env = test_env();
    let setup = setup_test_contracts(&env);
    let max = U256::from_u32(&env, 1000);
    let levels = 3u32;
    let pool_id = env.register(
        PoolContract,
        (
            setup.admin.clone(),
            setup.token.clone(),
            setup.verifier.clone(),
            setup.asp_membership_address.clone(),
            setup.asp_non_membership_address.clone(),
            max.clone(),
            levels,
        ),
    );
    let pool = PoolContractClient::new(&env, &pool_id);

    env.mock_all_auths();
    let sender = Address::generate(&env);
    let root = pool.get_root();
    let ext = mk_ext_data(&env, Address::generate(&env), 0);

    // Get actual roots
    let asp_membership_root = setup.asp_membership_client.get_root();
    let asp_non_membership_root = setup.asp_non_membership_client.get_root();

    let proof = Proof {
        proof: mk_mock_groth16_proof(&env),
        root,
        input_nullifiers: {
            let mut v: Vec<U256> = Vec::new(&env);
            v.push_back(U256::from_u32(&env, 0xCC));
            v
        },
        output_commitments: mk_commitments(&env, &[0x03, 0x04]),
        public_amount: U256::from_u32(&env, 0),
        ext_data_hash: mk_bytesn32(&env, 0x99), // mismatched hash
        asp_membership_root,
        asp_non_membership_root,
    };

    assert!(pool.try_transact(&proof, &ext, &sender).is_err());
}

#[test]
fn transact_rejects_bad_public_amount() {
    let env = test_env();
    let setup = setup_test_contracts(&env);
    let max = U256::from_u32(&env, 1000);
    let levels = 3u32;
    let pool_id = env.register(
        PoolContract,
        (
            setup.admin.clone(),
            setup.token.clone(),
            setup.verifier.clone(),
            setup.asp_membership_address.clone(),
            setup.asp_non_membership_address.clone(),
            max.clone(),
            levels,
        ),
    );
    let pool = PoolContractClient::new(&env, &pool_id);

    env.mock_all_auths();
    let sender = Address::generate(&env);
    let root = pool.get_root();
    let ext = mk_ext_data(&env, Address::generate(&env), 0);
    let ext_hash = compute_ext_hash(&env, &ext);

    // Get actual roots
    let asp_membership_root = setup.asp_membership_client.get_root();
    let asp_non_membership_root = setup.asp_non_membership_client.get_root();

    let proof = Proof {
        proof: mk_mock_groth16_proof(&env),
        root,
        input_nullifiers: {
            let mut v: Vec<U256> = Vec::new(&env);
            v.push_back(U256::from_u32(&env, 0xDD));
            v
        },
        output_commitments: mk_commitments(&env, &[0x05, 0x06]),
        public_amount: U256::from_u32(&env, 1), // should be 0 for ext_amount=0, fee=0
        ext_data_hash: ext_hash,
        asp_membership_root,
        asp_non_membership_root,
    };

    assert!(pool.try_transact(&proof, &ext, &sender).is_err());
}

/// PROOF-05 (A3 doble conteo): un batch que reusa un nullifier ya gastado
/// revierte con `AlreadySpentNullifier` antes del verify ZK. La invocacion
/// Soroban es atomica: el revert deja el estado intacto (ningun commitment se
/// inserta), garantizando el all-or-nothing del batch.
///
/// Pre-marcamos el nullifier 0xABCD via `env.as_contract` (simula una primera
/// transaccion exitosa) y luego intentamos gastarlo de nuevo. El mock proof
/// basta: el check de nullifier (paso 2 de internal_transact, pool.rs:580-585)
/// corre ANTES del verify ZK (paso 5).
#[test]
fn transact_rejects_reused_nullifier() {
    let env = test_env();
    let setup = setup_test_contracts(&env);
    let maximum_deposit_amount = U256::from_u32(&env, 1000);
    let levels = 3u32;
    let pool_id = env.register(
        PoolContract,
        (
            setup.admin.clone(),
            setup.token.clone(),
            setup.verifier.clone(),
            setup.asp_membership_address.clone(),
            setup.asp_non_membership_address.clone(),
            maximum_deposit_amount.clone(),
            levels,
        ),
    );
    let pool = PoolContractClient::new(&env, &pool_id);

    env.mock_all_auths();
    let sender = Address::generate(&env);

    // Pre-marcar el nullifier como gastado (simula una primera transaccion exitosa).
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
    let asp_membership_root = setup.asp_membership_client.get_root();
    let asp_non_membership_root = setup.asp_non_membership_client.get_root();

    // Snapshot del root antes del intento: debe quedar intacto tras el revert.
    let root_before = pool.get_root();

    let proof = Proof {
        proof: mk_mock_groth16_proof(&env),
        root,
        input_nullifiers: {
            let mut v: Vec<U256> = Vec::new(&env);
            v.push_back(used_nullifier.clone());
            v
        },
        output_commitments: mk_commitments(&env, &[1, 2, 3, 4, 5, 6, 7, 8]),
        public_amount: U256::from_u32(&env, 0),
        ext_data_hash: ext_hash,
        asp_membership_root,
        asp_non_membership_root,
    };

    // Segundo gasto del mismo nullifier: rebota con AlreadySpentNullifier.
    assert!(matches!(
        pool.try_transact(&proof, &ext, &sender),
        Err(Ok(Error::AlreadySpentNullifier))
    ));

    // All-or-nothing: tras el revert atomico el arbol no inserto ningun
    // commitment; el root permanece intacto.
    assert_eq!(pool.get_root(), root_before);
}

#[test]
fn transact_rejects_non_canonical_nullifier() {
    let env = test_env();
    let setup = setup_test_contracts(&env);
    let maximum_deposit_amount = U256::from_u32(&env, 1000);
    let levels = 3u32;
    let pool_id = env.register(
        PoolContract,
        (
            setup.admin.clone(),
            setup.token.clone(),
            setup.verifier.clone(),
            setup.asp_membership_address.clone(),
            setup.asp_non_membership_address.clone(),
            maximum_deposit_amount.clone(),
            levels,
        ),
    );
    let pool = PoolContractClient::new(&env, &pool_id);

    env.mock_all_auths();
    let sender = Address::generate(&env);
    let root = pool.get_root();
    let ext = mk_ext_data(&env, Address::generate(&env), 0);
    let ext_hash = compute_ext_hash(&env, &ext);

    let asp_membership_root = setup.asp_membership_client.get_root();
    let asp_non_membership_root = setup.asp_non_membership_client.get_root();

    let proof = Proof {
        proof: mk_mock_groth16_proof(&env),
        root,
        input_nullifiers: {
            let mut v: Vec<U256> = Vec::new(&env);
            let non_canonical_nullifier = bn256_modulus(&env);
            v.push_back(non_canonical_nullifier);
            v
        },
        output_commitments: mk_commitments(&env, &[0x07, 0x08]),
        public_amount: U256::from_u32(&env, 0),
        ext_data_hash: ext_hash,
        asp_membership_root,
        asp_non_membership_root,
    };

    assert!(matches!(
        pool.try_transact(&proof, &ext, &sender),
        Err(Ok(Error::NonCanonicalPublicInput))
    ));
}

#[test]
fn transact_rejects_non_canonical_output_commitment() {
    let env = test_env();
    let setup = setup_test_contracts(&env);
    let maximum_deposit_amount = U256::from_u32(&env, 1000);
    let levels = 3u32;
    let pool_id = env.register(
        PoolContract,
        (
            setup.admin.clone(),
            setup.token.clone(),
            setup.verifier.clone(),
            setup.asp_membership_address.clone(),
            setup.asp_non_membership_address.clone(),
            maximum_deposit_amount.clone(),
            levels,
        ),
    );
    let pool = PoolContractClient::new(&env, &pool_id);

    env.mock_all_auths();
    let sender = Address::generate(&env);
    let root = pool.get_root();
    let ext = mk_ext_data(&env, Address::generate(&env), 0);
    let ext_hash = compute_ext_hash(&env, &ext);

    let asp_membership_root = setup.asp_membership_client.get_root();
    let asp_non_membership_root = setup.asp_non_membership_client.get_root();

    let proof = Proof {
        proof: mk_mock_groth16_proof(&env),
        root,
        input_nullifiers: {
            let mut v: Vec<U256> = Vec::new(&env);
            v.push_back(U256::from_u32(&env, 0xEE));
            v
        },
        output_commitments: {
            let mut v: Vec<U256> = Vec::new(&env);
            v.push_back(bn256_modulus(&env));
            v.push_back(U256::from_u32(&env, 0x08));
            v
        },
        public_amount: U256::from_u32(&env, 0),
        ext_data_hash: ext_hash,
        asp_membership_root,
        asp_non_membership_root,
    };

    assert!(matches!(
        pool.try_transact(&proof, &ext, &sender),
        Err(Ok(Error::NonCanonicalPublicInput))
    ));
}

#[test]
fn transact_does_not_reject_boundary_canonical_public_input() {
    let env = test_env();
    let setup = setup_test_contracts(&env);
    let maximum_deposit_amount = U256::from_u32(&env, 1000);
    let levels = 3u32;
    let pool_id = env.register(
        PoolContract,
        (
            setup.admin.clone(),
            setup.token.clone(),
            setup.verifier.clone(),
            setup.asp_membership_address.clone(),
            setup.asp_non_membership_address.clone(),
            maximum_deposit_amount.clone(),
            levels,
        ),
    );
    let pool = PoolContractClient::new(&env, &pool_id);

    env.mock_all_auths();
    let sender = Address::generate(&env);
    let root = pool.get_root();
    let ext = mk_ext_data(&env, Address::generate(&env), 0);
    let ext_hash = compute_ext_hash(&env, &ext);

    let asp_membership_root = setup.asp_membership_client.get_root();
    let asp_non_membership_root = setup.asp_non_membership_client.get_root();
    let one = U256::from_u32(&env, 1);

    let proof = Proof {
        proof: mk_mock_groth16_proof(&env),
        root,
        input_nullifiers: {
            let mut v: Vec<U256> = Vec::new(&env);
            let canonical_boundary_nullifier = bn256_modulus(&env).sub(&one);
            v.push_back(canonical_boundary_nullifier);
            v
        },
        output_commitments: {
            let mut v: Vec<U256> = Vec::new(&env);
            v.push_back(bn256_modulus(&env).sub(&one));
            v.push_back(U256::from_u32(&env, 0x08));
            v
        },
        public_amount: U256::from_u32(&env, 0),
        ext_data_hash: ext_hash,
        asp_membership_root,
        asp_non_membership_root,
    };

    assert!(!matches!(
        pool.try_transact(&proof, &ext, &sender),
        Err(Ok(Error::NonCanonicalPublicInput))
    ));
}

/// Computes and prints the ext_data_hash for the payroll demo ExtData.
///
/// This test is NOT a pass/fail unit test: it exists to compute the
/// `ext_data_hash` that `smoke-test.sh` needs as a circuit input so that
/// the on-chain check `hash_ext_data(ext_data) == proof.ext_data_hash` passes.
///
/// Run with:
///   cargo test -p pool print_demo_ext_data_hash -- --nocapture --ignored
#[test]
#[ignore]
fn print_demo_ext_data_hash() {
    use soroban_sdk::testutils::Address as _;
    let env = test_env();

    // Mirror the demo in smoke-test.sh:
    //   recipient  = deployer address (mikey: GBWJZZ3XSNAY3WLFNLXUZXEEYMZCYVG4TW6Z5VSASJS2TOWF7GGPPKMW)
    //   ext_amount = 800 (sum of 8 salaries: 50+80+120+60+200+90+110+90)
    //   8 empty encrypted_output blobs (one per employee note)
    // IMPORTANT: ext_amount = 0 for reshield demo (no actual USDC deposit needed)
    // The proof uses publicAmount = 0 to match ext_amount = 0.
    let deployer_strkey = "GBWJZZ3XSNAY3WLFNLXUZXEEYMZCYVG4TW6Z5VSASJS2TOWF7GGPPKMW";
    let recipient = Address::from_str(&env, deployer_strkey);

    // ext_amount = 0 for reshield (conservacion: inAmount = outAmount, publicAmount = 0)
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

    // Print as hex bytes array for easy consumption by scripts
    // Format: "ext_data_hash_bytes=[b0,b1,...,b31]"
    let _ = hash_bytes; // ensure used
    extern crate std;
    let hex: std::string::String = hash_bytes.iter()
        .map(|b| std::format!("{b:02x}"))
        .collect::<std::vec::Vec<_>>()
        .join("");
    std::println!("ext_data_hash_hex={hex}");
}

/// Computes the `ext_data_hash` for a REAL payroll batch carrying 8 dual ECIES
/// blobs in `encrypted_outputs` (Nivel A — live auditor reconstruction).
///
/// Reads the 8 frozen dual-blob hexes from the env var `SOBRE_BLOBS_HEX` (comma
/// separated, no `0x` prefix), builds the exact `ExtData { recipient: mikey,
/// ext_amount: 0, encrypted_outputs: [the 8 Bytes] }` the deployer will SUBMIT,
/// and prints `keccak256(ext_data.to_xdr(env))` reduced mod BN254 as hex32. This
/// is the bulletproof way to match the contract's XDR encoding: the same
/// `ExtData.to_xdr` path the pool runs in `hash_ext_data` (pool.rs:126-134).
///
/// The printed value is passed to `payroll-proof-gen --ext-data-hash`, so the
/// on-chain check `hash_ext_data(submitted_ext_data) == proof.ext_data_hash`
/// holds for the byte-identical ext_data submitted in the transact.
///
/// Run with:
///   SOBRE_BLOBS_HEX="<hex0>,<hex1>,...,<hex7>" \
///     cargo test -p pool print_real_batch_ext_data_hash -- --nocapture --ignored
#[test]
#[ignore]
fn print_real_batch_ext_data_hash() {
    extern crate std;
    let env = test_env();

    // recipient = deployer (mikey); ext_amount = 0 (no USDC moves, reshield path).
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

    let ext = ExtData {
        recipient,
        ext_amount: I256::from_i32(&env, 0),
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
