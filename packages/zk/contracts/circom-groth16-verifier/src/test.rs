use super::*;
use ark_bn254::{Bn254, Fr as ArkFr};
use ark_circom::CircomReduction;
use ark_ff::{BigInteger, Field, PrimeField};
use ark_groth16::{Groth16, Proof};
use ark_relations::gr1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError, Variable};
use ark_std::rand::{SeedableRng, rngs::StdRng};
use contract_types::PROOF_SIZE;
use soroban_sdk::{Bytes, BytesN, Env, Vec};
use soroban_utils::{g1_bytes_from_ark, g2_bytes_from_ark, vk_bytes_from_ark};
use contract_types;

/// Simple circuit that exposes eleven public inputs (as many as a tx circuit).
///
/// The circuit ties the first public input to a witness to keep the proving
/// key minimal while still exercising the fixed `ic` array length expected by
/// the contract (11 public inputs + 1 constant term).
#[derive(Clone)]
struct ElevenInputCircuit<F: Field> {
    inputs: [F; 11],
}

impl<F: Field> ConstraintSynthesizer<F> for ElevenInputCircuit<F> {
    fn generate_constraints(self, cs: ConstraintSystemRef<F>) -> Result<(), SynthesisError> {
        // Register all public inputs
        let mut input_vars = alloc::vec::Vec::with_capacity(self.inputs.len());
        for value in self.inputs {
            input_vars.push(cs.new_input_variable(|| Ok(value))?);
        }

        // Constrain a witness to equal the first public input: w * 1 = input_0
        let witness = cs.new_witness_variable(|| Ok(self.inputs[0]))?;
        let a_lc = witness.into();
        let b_lc = Variable::One.into();
        let c_lc = input_vars[0].into();
        cs.enforce_r1cs_constraint(|| a_lc, || b_lc, || c_lc)?;
        Ok(())
    }
}

fn seeded_rng() -> StdRng {
    StdRng::seed_from_u64(7)
}

fn fr_from_ark(env: &Env, value: ArkFr) -> Bn254Fr {
    let bytes = value.into_bigint().to_bytes_be();
    let mut buf = [0u8; 32];
    buf.copy_from_slice(&bytes);
    Bn254Fr::from_bytes(BytesN::from_array(env, &buf))
}

fn groth16_proof_from_ark(env: &Env, proof: &Proof<Bn254>) -> Groth16Proof {
    Groth16Proof {
        a: G1Affine::from_bytes(BytesN::from_array(env, &g1_bytes_from_ark(proof.a))),
        b: G2Affine::from_bytes(BytesN::from_array(env, &g2_bytes_from_ark(proof.b))),
        c: G1Affine::from_bytes(BytesN::from_array(env, &g1_bytes_from_ark(proof.c))),
    }
}

fn groth16_proof_from_ark_circuit_keys(env: &Env, proof: &Proof<Bn254>) -> Groth16Proof {
    Groth16Proof {
        a: G1Affine::from_bytes(BytesN::from_array(
            env,
            &circuit_keys::g1_to_soroban_bytes(&proof.a),
        )),
        b: G2Affine::from_bytes(BytesN::from_array(
            env,
            &circuit_keys::g2_to_soroban_bytes(&proof.b),
        )),
        c: G1Affine::from_bytes(BytesN::from_array(
            env,
            &circuit_keys::g1_to_soroban_bytes(&proof.c),
        )),
    }
}

fn serialize_proof(env: &Env, proof: &Groth16Proof) -> Bytes {
    let mut data = Bytes::new(env);
    data.append(&Bytes::from(proof.a.to_bytes()));
    data.append(&Bytes::from(proof.b.to_bytes()));
    data.append(&Bytes::from(proof.c.to_bytes()));
    data
}

fn build_test(
    env: &Env,
) -> (
    VerificationKeyBytes,
    Groth16Proof,
    Vec<Bn254Fr>,
    [ArkFr; 11],
) {
    let mut rng = seeded_rng();
    let inputs = [ArkFr::from(33u64); 11];
    let circuit = ElevenInputCircuit { inputs };
    let params = Groth16::<Bn254, CircomReduction>::generate_random_parameters_with_reduction(
        circuit.clone(),
        &mut rng,
    )
    .expect("params failed to generate");
    let proof = Groth16::<Bn254, CircomReduction>::create_random_proof_with_reduction(
        circuit, &params, &mut rng,
    )
    .expect("proof failed");

    let mut public_inputs: Vec<Bn254Fr> = Vec::new(env);
    for value in inputs {
        public_inputs.push_back(fr_from_ark(env, value));
    }

    let vk_bytes_ext = vk_bytes_from_ark(env, &params.vk);
    let vk_bytes = VerificationKeyBytes {
        alpha: vk_bytes_ext.alpha,
        beta: vk_bytes_ext.beta,
        gamma: vk_bytes_ext.gamma,
        delta: vk_bytes_ext.delta,
        ic: vk_bytes_ext.ic,
    };

    (
        vk_bytes,
        groth16_proof_from_ark(env, &proof),
        public_inputs,
        inputs,
    )
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
fn verifies_valid_proof() {
    let env = test_env();
    let (vk_bytes, proof, public_inputs, _) = build_test(&env);
    let vk = verification_key_from_bytes(&env, &vk_bytes);

    let result = CircomGroth16Verifier::verify_with_vk(&env, &vk, proof, public_inputs);

    assert_eq!(result, Ok(true));
}

#[test]
fn rejects_wrong_public_input_length() {
    let env = test_env();
    let (vk_bytes, proof, _public_inputs, inputs) = build_test(&env);
    let vk = verification_key_from_bytes(&env, &vk_bytes);

    // Provide too few public inputs (length 5 instead of 11)
    let mut short_inputs: Vec<Bn254Fr> = Vec::new(&env);
    for value in inputs.iter().take(5) {
        short_inputs.push_back(fr_from_ark(&env, *value));
    }

    let result = CircomGroth16Verifier::verify_with_vk(&env, &vk, proof, short_inputs);
    assert!(matches!(result, Err(Groth16Error::MalformedPublicInputs)));
}

#[test]
fn groth16_proof_parsing_checks_size() {
    let env = test_env();
    let (_vk_bytes, proof, _public_inputs, _) = build_test(&env);

    let encoded = serialize_proof(&env, &proof);
    assert_eq!(encoded.len(), PROOF_SIZE);
    assert!(Groth16Proof::try_from(encoded.clone()).is_ok());

    let truncated = encoded.slice(0..(PROOF_SIZE - 1));
    assert!(matches!(
        Groth16Proof::try_from(truncated),
        Err(Groth16Error::MalformedProof)
    ));
}

/// Verify that `circuit_keys::g1_to_soroban_bytes` and
/// `soroban_utils::g1_bytes_from_ark` produce identical bytes for G1 points,
/// and likewise for G2. These are the two serialization paths: production
/// uses `circuit_keys`, the existing unit tests use `soroban_utils`.
#[test]
fn serialization_equivalence_circuit_keys_vs_soroban_utils() {
    let mut rng = seeded_rng();
    let inputs = [ArkFr::from(33u64); 11];
    let circuit = ElevenInputCircuit { inputs };
    let params = Groth16::<Bn254, CircomReduction>::generate_random_parameters_with_reduction(
        circuit.clone(),
        &mut rng,
    )
    .expect("params failed to generate");
    let proof = Groth16::<Bn254, CircomReduction>::create_random_proof_with_reduction(
        circuit, &params, &mut rng,
    )
    .expect("proof failed");

    // Compare G1 serialization (proof.a and proof.c)
    let a_circuit_keys = circuit_keys::g1_to_soroban_bytes(&proof.a);
    let a_soroban_utils = g1_bytes_from_ark(proof.a);
    assert_eq!(
        a_circuit_keys, a_soroban_utils,
        "G1 proof.a serialization differs between circuit_keys and soroban_utils"
    );

    let c_circuit_keys = circuit_keys::g1_to_soroban_bytes(&proof.c);
    let c_soroban_utils = g1_bytes_from_ark(proof.c);
    assert_eq!(
        c_circuit_keys, c_soroban_utils,
        "G1 proof.c serialization differs between circuit_keys and soroban_utils"
    );

    // Compare G2 serialization (proof.b)
    let b_circuit_keys = circuit_keys::g2_to_soroban_bytes(&proof.b);
    let b_soroban_utils = g2_bytes_from_ark(proof.b);
    assert_eq!(
        b_circuit_keys, b_soroban_utils,
        "G2 proof.b serialization differs between circuit_keys and soroban_utils"
    );
}

/// Verify that a proof serialized with `circuit_keys` (the production path used
/// by `payroll-proof-gen`) passes the Soroban verifier, just as the proof
/// serialized with `soroban_utils` does.
#[test]
fn verifies_valid_proof_with_circuit_keys_serialization() {
    let env = test_env();
    let mut rng = seeded_rng();
    let inputs = [ArkFr::from(33u64); 11];
    let circuit = ElevenInputCircuit { inputs };
    let params = Groth16::<Bn254, CircomReduction>::generate_random_parameters_with_reduction(
        circuit.clone(),
        &mut rng,
    )
    .expect("params failed to generate");
    let proof = Groth16::<Bn254, CircomReduction>::create_random_proof_with_reduction(
        circuit, &params, &mut rng,
    )
    .expect("proof failed");

    // Build VK bytes using soroban_utils (same as existing test)
    let vk_bytes_ext = vk_bytes_from_ark(&env, &params.vk);
    let vk_bytes = contract_types::VerificationKeyBytes {
        alpha: vk_bytes_ext.alpha,
        beta: vk_bytes_ext.beta,
        gamma: vk_bytes_ext.gamma,
        delta: vk_bytes_ext.delta,
        ic: vk_bytes_ext.ic,
    };
    let vk = verification_key_from_bytes(&env, &vk_bytes);

    // Build proof using circuit_keys (the production path)
    let soroban_proof = groth16_proof_from_ark_circuit_keys(&env, &proof);

    let mut public_inputs: Vec<Bn254Fr> = Vec::new(&env);
    for value in inputs {
        public_inputs.push_back(fr_from_ark(&env, value));
    }

    let result = CircomGroth16Verifier::verify_with_vk(&env, &vk, soroban_proof, public_inputs);
    assert_eq!(
        result,
        Ok(true),
        "proof serialized via circuit_keys should verify in the Soroban verifier"
    );
}
