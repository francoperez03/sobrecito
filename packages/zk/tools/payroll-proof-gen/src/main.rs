//! payroll-proof-gen: genera un proof Groth16 valido para policy_tx_1_8 y
//! lo serializa al formato JSON que acepta el CLI de Stellar (pool.transact).
//!
//! Uso:
//!   payroll-proof-gen \
//!     --wasm  <path/to/policy_tx_1_8.wasm> \
//!     --r1cs  <path/to/policy_tx_1_8.r1cs> \
//!     --pk    <path/to/policy_tx_1_8_proving_key.bin> \
//!     --asp-member-root <decimal_u256> \
//!     --asp-non-member-root <decimal_u256> \
//!     --pool-root <decimal_u256>       (actual on-chain root) \
//!     [--zero-input]                   (usa inAmount=0; el circuito desactiva merkle-check; root on-chain pasa is_known_root)
//!     [--blinding <u64>]               (semilla del blinding de la nota de entrada; default: 515151. Variar para generar nullifiers frescos sin cambiar pk_field)
//!     [--ext-data-hash <hex32>]        (default: hash for ext_amount=0, deployer=mikey) \
//!     [--out <path/to/output.json>]    (default: stdout)

use anyhow::{Context, Result, anyhow, bail};
use ark_bn254::Bn254;
use ark_circom::{CircomBuilder, CircomConfig};
use ark_ff::{BigInteger, PrimeField};
use ark_groth16::{Groth16, ProvingKey};
use ark_serialize::CanonicalDeserialize;
use ark_snark::SNARK;
use circuit_keys::{g1_to_soroban_bytes, g2_to_soroban_bytes};
use circuits::test::utils::{
    circom_tester::{InputValue, Inputs, load_keys},
    general::{poseidon2_hash2, poseidon2_hash3, scalar_to_bigint},
    keypair::{derive_public_key, sign},
    merkle_tree::{merkle_proof, merkle_root},
    sparse_merkle_tree::prepare_smt_proof_with_overrides,
    transaction::{commitment, nullifier, prepopulated_leaves},
    transaction_case::{InputNote, OutputNote, TxCase},
};
use num_bigint::{BigInt, BigUint};
use std::{
    env,
    fs::{self, File},
    io::BufReader,
    path::PathBuf,
};
use zkhash::{ark_ff::Zero, fields::bn256::FpBN256 as Scalar};

fn main() -> Result<()> {
    let args: Vec<String> = env::args().collect();

    let wasm = get_arg(&args, "--wasm")?;
    let r1cs = get_arg(&args, "--r1cs")?;
    let pk_path = get_arg(&args, "--pk")?;
    let asp_member_root_str = get_arg(&args, "--asp-member-root")?;
    let asp_non_member_root_str = get_arg(&args, "--asp-non-member-root")?;
    let pool_root_provided = get_arg(&args, "--pool-root")?;
    let ext_data_hash_hex = get_arg(&args, "--ext-data-hash").unwrap_or_else(|_| {
        // Default: hash for ext_amount=0, recipient=mikey deployer, 8 empty encrypted_outputs
        // Calculado via: cargo test -p pool print_demo_ext_data_hash -- --nocapture --ignored
        "0b3f2759b68a3bf239da2b7d987c95c9373c5595623ae21d334f01c123c66056".to_string()
    });
    let out_path = get_arg(&args, "--out").ok();
    let zero_input = args.iter().any(|a| a == "--zero-input");

    // --deposit-amounts <a,b,...,h>: REAL deposit of `sum` base units (USDC, 7
    // decimals). inAmount=0 (merkle-check disabled like --zero-input), outputs =
    // the 8 provided amounts, publicAmount = ext_amount = sum. Reuses the
    // on-chain ASP/root state handling so the proof verifies against the live pool.
    let deposit_amounts: Option<[u64; 8]> = get_arg(&args, "--deposit-amounts").ok().map(|s| {
        let v: Vec<u64> = s
            .split(',')
            .map(|x| x.trim().parse::<u64>().expect("invalid --deposit-amounts value"))
            .collect();
        assert_eq!(v.len(), 8, "--deposit-amounts must carry exactly 8 values");
        let mut arr = [0u64; 8];
        arr.copy_from_slice(&v[..8]);
        arr
    });
    let is_deposit = deposit_amounts.is_some();
    // A deposit reuses the live on-chain ASP/root branches that --zero-input uses.
    let use_onchain_state = zero_input || is_deposit;
    let blinding_seed: u64 = get_arg(&args, "--blinding")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(515151);

    // Load proving key using circom_tester helper (loads PK + extracts VK + pvk)
    eprintln!("==> Loading proving key from {pk_path}");
    let keys = load_keys(&pk_path).context("Failed to load proving key")?;

    // Build payroll case: 1 input, 8 outputs, reshield (publicAmount = 0)
    let salaries: [u64; 8] = [50, 80, 120, 60, 200, 90, 110, 90];
    let total: u64 = salaries.iter().sum(); // 800

    // --deposit-amounts: real deposit → inAmount=0 (merkle-check off), outputs = the
    //   8 provided base-unit amounts, conservation 0 + publicAmount(sum) = sumOuts(sum).
    // --zero-input: inAmount=0, outAmounts=0 (el circuito desactiva el merkle-check cuando inAmount=0)
    let (in_amount, out_amounts): (u64, [u64; 8]) = if let Some(d) = deposit_amounts {
        (0, d)
    } else if zero_input {
        (0, [0; 8])
    } else {
        (total, salaries)
    };

    let outputs: Vec<OutputNote> = out_amounts
        .iter()
        .enumerate()
        .map(|(i, &amt)| OutputNote {
            pub_key: Scalar::from(1000u64.saturating_add(i as u64)),
            blinding: Scalar::from(2000u64.saturating_add(i as u64)),
            amount: Scalar::from(amt),
        })
        .collect();

    let case = TxCase::new(
        vec![InputNote {
            leaf_index: 11,
            priv_key: Scalar::from(424242u64),
            blinding: Scalar::from(blinding_seed),
            amount: Scalar::from(in_amount),
        }],
        outputs,
    );

    const LEVELS: usize = 10;

    // Pool Merkle tree
    let leaves = prepopulated_leaves(LEVELS, 0x50B5Eu64, &[case.inputs[0].leaf_index], 24);
    let input = &case.inputs[0];
    let pk_field = derive_public_key(input.priv_key);
    let input_commitment = commitment(input.amount, pk_field, input.blinding);
    let mut leaves_with_input = leaves.clone();
    leaves_with_input[input.leaf_index] = input_commitment;
    let pool_root = merkle_root(leaves_with_input.clone());

    // Log computed root vs provided root (informational)
    let pool_root_big = scalar_to_bigint(pool_root);
    eprintln!("==> Computed pool root: {pool_root_big}");
    eprintln!("==> Provided pool root: {pool_root_provided}");

    // Con --zero-input el circuito desactiva el merkle-check (inAmount=0),
    // así que usamos el root on-chain directamente para pasar is_known_root.
    let proof_root_bigint: BigInt = if use_onchain_state {
        pool_root_provided.parse::<BigInt>().context("invalid --pool-root")?
    } else {
        pool_root_big.clone()
    };
    let proof_root_str = proof_root_bigint.magnitude().to_string();

    // Compute Merkle path for input note
    let (siblings, path_idx_u64, depth) = merkle_proof(&leaves_with_input, input.leaf_index);
    if depth != LEVELS {
        bail!("unexpected Merkle depth: {depth} != {LEVELS}");
    }
    let path_idx = Scalar::from(path_idx_u64);

    let sig = sign(input.priv_key, input_commitment, path_idx);
    let nul = nullifier(input_commitment, path_idx, sig);

    // Output commitments
    let output_commitments: Vec<Scalar> = case
        .outputs
        .iter()
        .map(|out| commitment(out.amount, out.pub_key, out.blinding))
        .collect();

    // Membership tree.
    // --zero-input: usa el estado real on-chain del ASP (8 dummy leaves 1..8 + employer en idx 8).
    // Default: árbol local con semilla (para pruebas locales).
    let mem_leaf = poseidon2_hash2(pk_field, Scalar::zero(), Some(Scalar::from(1u64)));
    let (mem_root, mem_siblings, mem_path_idx, mem_depth) = if use_onchain_state {
        // Estado on-chain conocido: leaves[0..7] = 1..8, leaves[8] = employer_mem_leaf
        // Los slots vacíos del árbol on-chain usan zeroes[0] = poseidon2("XLM") = poseidon2(88,76,77)
        // (misma función de compresión t=4, r=3, domain_sep=0 que define get_zeroes() en soroban-utils).
        // Usar Scalar::zero() como hoja vacía produce una raíz diferente a la del contrato on-chain.
        let employer_leaf_index = 8usize;
        let zero_leaf = poseidon2_hash3(
            Scalar::from(88u64),
            Scalar::from(76u64),
            Scalar::from(77u64),
            None,
        );
        let mut known_leaves = vec![zero_leaf; 1 << LEVELS];
        for i in 0..8usize {
            known_leaves[i] = Scalar::from((i + 1) as u64);
        }
        known_leaves[employer_leaf_index] = mem_leaf;
        let root = merkle_root(known_leaves.clone());
        let known_arr: [Scalar; 1 << LEVELS] = known_leaves.try_into().map_err(|_| anyhow!("conversion failed"))?;
        let (sibs, path_idx, depth) = merkle_proof(&known_arr, employer_leaf_index);
        (root, sibs, path_idx, depth)
    } else {
        let mem_seed = 0xFEED_FACEu64 ^ (0u64 << 40) ^ 0x1234_5678u64;
        let base_mem_leaves: Vec<Scalar> = prepopulated_leaves(LEVELS, mem_seed, &[], 24);
        let mut frozen_leaves: [Scalar; 1 << LEVELS] =
            base_mem_leaves.try_into().map_err(|_| anyhow!("conversion failed"))?;
        frozen_leaves[input.leaf_index] = mem_leaf;
        let root = merkle_root(frozen_leaves.to_vec());
        let (sibs, path_idx, depth) = merkle_proof(&frozen_leaves, input.leaf_index);
        (root, sibs, path_idx, depth)
    };
    if mem_depth != LEVELS {
        bail!("unexpected membership Merkle depth: {mem_depth} != {LEVELS}");
    }

    // Non-membership proof.
    // --zero-input: el contrato ASP non-membership on-chain es un SMT vacío
    // (get_root() == 0). El proof debe generarse contra ese mismo SMT vacío
    // (sin overrides) para que nonMembershipRoots[0] == 0 e is_old0 == true,
    // coincidiendo con el public input que el pool pasa al verifier
    // (proof.asp_non_membership_root, leído vía cross-contract de get_root()).
    // Default (local proving test): inserta un override para ejercitar la
    // verificación de no-inclusión contra un SMT poblado (root != 0).
    let overrides: Vec<(BigInt, BigInt)> = if use_onchain_state {
        vec![]
    } else {
        let override_key = Scalar::from(100_001u64); // 1 * 100_000 + 1
        let override_leaf = poseidon2_hash2(pk_field, Scalar::zero(), Some(Scalar::from(1u64)));
        vec![(
            scalar_to_bigint(override_key),
            scalar_to_bigint(override_leaf),
        )]
    };
    let non_mem_proof =
        prepare_smt_proof_with_overrides(&scalar_to_bigint(pk_field), &overrides, LEVELS);

    // ext_data_hash as BigInt from hex
    let ext_hash_bytes = hex_to_bytes32(&ext_data_hash_hex)?;
    let ext_hash_bigint = BigInt::from_bytes_be(num_bigint::Sign::Plus, &ext_hash_bytes);

    // publicAmount: deposit → sum(outputs) (= ext_amount); reshield → 0.
    let public_amount_u64: u64 = if is_deposit {
        out_amounts.iter().copied().sum()
    } else {
        0
    };
    let public_amount = BigInt::from(public_amount_u64);

    // Build Circom inputs
    let mut inputs = Inputs::new();
    inputs.set("root", proof_root_bigint.clone());
    inputs.set("publicAmount", public_amount);
    inputs.set("extDataHash", ext_hash_bigint);
    inputs.set("inputNullifier", vec![scalar_to_bigint(nul)]);
    inputs.set("inAmount", vec![input.amount]);
    inputs.set("inPrivateKey", vec![input.priv_key]);
    inputs.set("inBlinding", vec![input.blinding]);
    inputs.set("inPathIndices", vec![path_idx]);
    inputs.set(
        "inPathElements",
        siblings.iter().map(|&s| scalar_to_bigint(s)).collect::<Vec<_>>(),
    );
    inputs.set(
        "outputCommitment",
        output_commitments.iter().map(|&c| scalar_to_bigint(c)).collect::<Vec<_>>(),
    );
    inputs.set("outAmount", case.outputs.iter().map(|n| n.amount).collect::<Vec<_>>());
    inputs.set("outPubkey", case.outputs.iter().map(|n| n.pub_key).collect::<Vec<_>>());
    inputs.set("outBlinding", case.outputs.iter().map(|n| n.blinding).collect::<Vec<_>>());

    inputs.set("membershipRoots", vec![scalar_to_bigint(mem_root)]);

    // Membership proof fields (flat circom signal names)
    inputs.set_key(
        &circuits::test::utils::circom_tester::SignalKey::new("membershipProofs")
            .idx(0)
            .idx(0)
            .field("leaf"),
        scalar_to_bigint(mem_leaf),
    );
    inputs.set_key(
        &circuits::test::utils::circom_tester::SignalKey::new("membershipProofs")
            .idx(0)
            .idx(0)
            .field("blinding"),
        BigInt::from(0u64),
    );
    inputs.set_key(
        &circuits::test::utils::circom_tester::SignalKey::new("membershipProofs")
            .idx(0)
            .idx(0)
            .field("pathIndices"),
        scalar_to_bigint(Scalar::from(mem_path_idx)),
    );
    inputs.set_key(
        &circuits::test::utils::circom_tester::SignalKey::new("membershipProofs")
            .idx(0)
            .idx(0)
            .field("pathElements"),
        mem_siblings.iter().map(|&s| scalar_to_bigint(s)).collect::<Vec<BigInt>>(),
    );

    // Non-membership proof
    inputs.set("nonMembershipRoots", vec![non_mem_proof.root.clone()]);
    let nmp_key = scalar_to_bigint(pk_field);
    inputs.set_key(
        &circuits::test::utils::circom_tester::SignalKey::new("nonMembershipProofs")
            .idx(0)
            .idx(0)
            .field("key"),
        nmp_key,
    );
    if non_mem_proof.is_old0 {
        inputs.set_key(
            &circuits::test::utils::circom_tester::SignalKey::new("nonMembershipProofs")
                .idx(0)
                .idx(0)
                .field("oldKey"),
            BigInt::from(0u64),
        );
        inputs.set_key(
            &circuits::test::utils::circom_tester::SignalKey::new("nonMembershipProofs")
                .idx(0)
                .idx(0)
                .field("oldValue"),
            BigInt::from(0u64),
        );
        inputs.set_key(
            &circuits::test::utils::circom_tester::SignalKey::new("nonMembershipProofs")
                .idx(0)
                .idx(0)
                .field("isOld0"),
            BigInt::from(1u64),
        );
    } else {
        inputs.set_key(
            &circuits::test::utils::circom_tester::SignalKey::new("nonMembershipProofs")
                .idx(0)
                .idx(0)
                .field("oldKey"),
            non_mem_proof.not_found_key.clone(),
        );
        inputs.set_key(
            &circuits::test::utils::circom_tester::SignalKey::new("nonMembershipProofs")
                .idx(0)
                .idx(0)
                .field("oldValue"),
            non_mem_proof.not_found_value.clone(),
        );
        inputs.set_key(
            &circuits::test::utils::circom_tester::SignalKey::new("nonMembershipProofs")
                .idx(0)
                .idx(0)
                .field("isOld0"),
            BigInt::from(0u64),
        );
    }
    inputs.set_key(
        &circuits::test::utils::circom_tester::SignalKey::new("nonMembershipProofs")
            .idx(0)
            .idx(0)
            .field("siblings"),
        non_mem_proof.siblings.clone(),
    );

    // --dump-inputs: output the circom inputs as JSON (for debugging/spike hardcoding)
    let dump_inputs = args.iter().any(|a| a == "--dump-inputs");
    if dump_inputs {
        let mut dump_map: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
        for (k, v) in inputs.iter() {
            let jval = match v {
                InputValue::Single(bi) => serde_json::Value::String(bi.magnitude().to_string()),
                InputValue::Array(arr) => serde_json::Value::Array(
                    arr.iter()
                        .map(|bi| serde_json::Value::String(bi.magnitude().to_string()))
                        .collect(),
                ),
            };
            dump_map.insert(k.clone(), jval);
        }
        let dump_json = serde_json::to_string_pretty(&serde_json::Value::Object(dump_map))?;
        eprintln!("==> CIRCOM INPUTS JSON:\n{dump_json}");
    }

    let dump_witness = args.iter().any(|a| a == "--dump-witness");

    eprintln!("==> Building Circom circuit with inputs...");
    let cfg = CircomConfig::<ark_bn254::Fr>::new(&wasm, &r1cs)
        .map_err(|e| anyhow!("CircomConfig error: {e}"))?;
    let mut builder = CircomBuilder::new(cfg);

    for (signal, value) in inputs.iter() {
        push_circom_value(&mut builder, signal, value);
    }

    let circuit = builder.build().map_err(|e| anyhow!("Circom build failed: {e}"))?;

    if dump_witness {
        use ark_ff::BigInteger;
        if let Some(witness) = &circuit.witness {
            // Output witness as hex-encoded LE bytes (32 bytes per element)
            // Format: WITNESS_HEX:<hex_of_all_bytes>
            let mut bytes = Vec::with_capacity(witness.len() * 32);
            for w in witness.iter() {
                let bi = w.into_bigint();
                let le_bytes = bi.to_bytes_le();
                let mut padded = [0u8; 32];
                let len = le_bytes.len().min(32);
                padded[..len].copy_from_slice(&le_bytes[..len]);
                bytes.extend_from_slice(&padded);
            }
            let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
            eprintln!("==> WITNESS_HEX:{}", hex);
        }
    }
    let pub_inputs = circuit
        .get_public_inputs()
        .ok_or_else(|| anyhow!("get_public_inputs returned None"))?;

    eprintln!("==> Public inputs count: {}", pub_inputs.len());

    eprintln!("==> Generating Groth16 proof (this may take a while)...");
    let mut rng = ark_std::rand::thread_rng();
    // LibsnarkReduction (arkworks default, NO CircomReduction) to match the
    // LibsnarkReduction keys produced by circuits/build.rs and the enclave WASM
    // prover (prover_bg.wasm). Mixing reductions across prove/verify/keygen makes
    // verification fail. See 06.2-SPIKE.md.
    let proof = Groth16::<Bn254>::prove(&keys.pk, circuit.clone(), &mut rng)
        .map_err(|e| anyhow!("Prove failed: {e}"))?;

    // Verify locally
    let verified =
        Groth16::<Bn254>::verify_with_processed_vk(&keys.pvk, &pub_inputs, &proof)
            .map_err(|e| anyhow!("verify failed: {e}"))?;

    if !verified {
        bail!("Proof failed local verification!");
    }
    eprintln!("==> Proof verified locally: OK");

    // Serialize for CLI
    let a_hex = hex_from_bytes(&g1_to_soroban_bytes(&proof.a));
    let b_hex = hex_from_bytes(&g2_to_soroban_bytes(&proof.b));
    let c_hex = hex_from_bytes(&g1_to_soroban_bytes(&proof.c));

    let nullifier_dec = field_to_decimal(nul);
    let commitment_decs: Vec<serde_json::Value> = output_commitments
        .iter()
        .map(|&c| serde_json::Value::String(field_to_decimal(c)))
        .collect();
    let mem_root_dec = field_to_decimal(mem_root);
    let non_mem_root_dec = bigint_to_decimal(&non_mem_proof.root);
    let ext_hash_hex_32 = hex_from_bytes(&ext_hash_bytes);

    let output = serde_json::json!({
        "proof_arg": {
            "proof": { "a": a_hex, "b": b_hex, "c": c_hex },
            "root": proof_root_str,
            "input_nullifiers": [nullifier_dec],
            "output_commitments": commitment_decs,
            "public_amount": public_amount_u64.to_string(),
            "ext_data_hash": ext_hash_hex_32,
            "asp_membership_root": asp_member_root_str,
            "asp_non_membership_root": asp_non_member_root_str
        },
        "ext_data_arg": {
            "recipient": "GBWJZZ3XSNAY3WLFNLXUZXEEYMZCYVG4TW6Z5VSASJS2TOWF7GGPPKMW",
            "ext_amount": public_amount_u64.to_string(),
            "encrypted_outputs": ["","","","","","","",""]
        },
        "computed_mem_root": mem_root_dec,
        "computed_non_mem_root": non_mem_root_dec,
        "pool_root": proof_root_str,
        "pub_input_count": pub_inputs.len(),
        "verified_locally": verified
    });

    let json_str = serde_json::to_string_pretty(&output)?;

    if let Some(path) = out_path {
        fs::write(&path, &json_str)
            .with_context(|| format!("Failed to write output to {path}"))?;
        eprintln!("==> Output written to {path}");
    } else {
        println!("{json_str}");
    }

    Ok(())
}

fn get_arg(args: &[String], flag: &str) -> Result<String> {
    let pos = args
        .iter()
        .position(|a| a == flag)
        .ok_or_else(|| anyhow!("missing argument {flag}"))?;
    args.get(pos.saturating_add(1))
        .cloned()
        .ok_or_else(|| anyhow!("missing value for {flag}"))
}

fn push_circom_value(
    builder: &mut CircomBuilder<ark_bn254::Fr>,
    path: &str,
    value: &InputValue,
) {
    match value {
        InputValue::Single(v) => builder.push_input(path, v.clone()),
        InputValue::Array(arr) => {
            for v in arr {
                builder.push_input(path, v.clone());
            }
        }
    }
}

fn hex_from_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn hex_to_bytes32(hex: &str) -> Result<[u8; 32]> {
    let hex = hex.trim_start_matches("0x");
    let padded = format!("{:0>64}", hex);
    if padded.len() != 64 {
        bail!("hex too long: {}", hex);
    }
    let bytes: Vec<u8> = (0..32)
        .map(|i| u8::from_str_radix(&padded[i * 2..i * 2 + 2], 16))
        .collect::<Result<_, _>>()
        .context("invalid hex byte")?;
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

fn field_to_decimal(f: Scalar) -> String {
    let bigint = f.into_bigint();
    let bytes = bigint.to_bytes_be();
    BigUint::from_bytes_be(&bytes).to_string()
}

fn bigint_to_decimal(b: &BigInt) -> String {
    b.magnitude().to_string()
}
