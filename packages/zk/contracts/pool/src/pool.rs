//! Privacy Pool Contract — UltraHonk verifier edition
//!
//! This contract implements a privacy-preserving payroll pool backed by an
//! UltraHonk (Noir / bb 0.87.0) zero-knowledge verifier.  The pool accepts
//! shielded deposits and transact calls, verifying the ZK proof by delegating
//! to an on-chain `UltraHonkVerifierContract` that holds the immutable VK.
//!
//! # Architecture
//!
//! The contract maintains:
//! - A Merkle tree of commitments (via `MerkleTreeWithHistory`)
//! - A nullifier set to track spent UTXOs
//! - Token integration for deposits and withdrawals
//!
//! # D2 — ASP/SMT policy fields dropped
//!
//! The slim circuit (`sobre_slim`, 09-02) does not include ASP membership or
//! non-membership roots; those public inputs are absent from the 12-field
//! layout.  The pool therefore no longer stores or validates
//! `asp_membership_root` / `asp_non_membership_root`.  See 09-04 SUMMARY for
//! disclosure.

#![allow(clippy::too_many_arguments)]
use crate::merkle_with_history::{Error as MerkleError, MerkleTreeWithHistory};
use soroban_sdk::{
    Address, Bytes, BytesN, Env, I256, Map, U256, Vec, contract, contractclient, contracterror,
    contractevent, contractimpl, contracttype, token::TokenClient, xdr::ToXdr,
};
use soroban_utils::constants::bn256_modulus;

/// Contract error types for the privacy pool
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Caller is not authorized to perform this operation
    NotAuthorized = 1,
    /// Merkle tree has reached maximum capacity
    MerkleTreeFull = 2,
    /// Contract has already been initialized
    AlreadyInitialized = 3,
    /// Invalid Merkle tree levels configuration
    WrongLevels = 4,
    /// Internal error: next leaf index is not even
    NextIndexNotEven = 5,
    /// External amount is invalid (negative or exceeds 2^248)
    WrongExtAmount = 6,
    /// Zero-knowledge proof verification failed or proof is empty
    InvalidProof = 7,
    /// Provided Merkle root is not in the recent history
    UnknownRoot = 8,
    /// Nullifier has already been spent (double-spend attempt)
    AlreadySpentNullifier = 9,
    /// External data hash does not match the provided data
    WrongExtHash = 10,
    /// Contract is not initialized
    NotInitialized = 11,
    /// Arithmetic overflow occurred
    Overflow = 12,
    /// Public input is not canonical in the BN254 scalar field (unused in UltraHonk path but kept for ABI stability)
    NonCanonicalPublicInput = 13,
}

/// Conversion from MerkleTreeWithHistory errors to pool contract errors
impl From<MerkleError> for Error {
    fn from(e: MerkleError) -> Self {
        match e {
            MerkleError::AlreadyInitialized => Error::AlreadyInitialized,
            MerkleError::MerkleTreeFull => Error::MerkleTreeFull,
            MerkleError::WrongLevels => Error::WrongLevels,
            MerkleError::NextIndexNotEven => Error::NextIndexNotEven,
            MerkleError::NotInitialized => Error::NotInitialized,
            MerkleError::Overflow => Error::Overflow,
        }
    }
}

// ─── UltraHonk verifier client ──────────────────────────────────────────────

/// Cross-contract client for the UltraHonk on-chain verifier
/// (`rs-soroban-ultrahonk`).  The verifier holds an immutable VK set at
/// deploy time; `verify_proof` returns `Ok(())` on success and a typed error
/// on failure (the pool maps any error to `Error::InvalidProof`).
#[contractclient(crate_path = "soroban_sdk", name = "UltraHonkVerifierClient")]
pub trait UltraHonkVerifierInterface {
    fn verify_proof(
        env: Env,
        public_inputs: Bytes,
        proof_bytes: Bytes,
    ) -> Result<(), soroban_sdk::Error>;
}

// ─── Proof struct ────────────────────────────────────────────────────────────

/// Zero-knowledge proof data for a shielded transaction (UltraHonk edition).
///
/// `public_inputs` is the 384-byte blob produced by `bb 0.87.0` for the
/// `sobre_slim` circuit (12 fields × 32 bytes, big-endian U256):
///   [root, public_amount, ext_data_hash, input_nullifier,
///    output_commitment_0 .. output_commitment_7]
///
/// `proof_bytes` is the 14 592-byte proof blob from `bb 0.87.0`.
///
/// `root`, `input_nullifiers`, `output_commitments`, `public_amount`, and
/// `ext_data_hash` are provided in structured form so the pool can validate
/// them (nullifier replay, Merkle history, ext-hash binding) without
/// deserializing the opaque `public_inputs` blob.
#[contracttype]
pub struct Proof {
    /// Raw public-inputs blob from bb (384 bytes = 12 × 32, big-endian U256).
    /// Passed directly to the UltraHonk verifier; not parsed by the pool.
    pub public_inputs: Bytes,
    /// Raw UltraHonk proof blob from bb (14 592 bytes).
    pub proof_bytes: Bytes,
    /// Merkle root the proof was generated against (for on-chain history check)
    pub root: U256,
    /// Nullifiers for spent input UTXOs (prevents double-spending)
    pub input_nullifiers: Vec<U256>,
    /// Commitments for the N output UTXOs (length = nOuts of the circuit, 8 for payroll)
    pub output_commitments: Vec<U256>,
    /// Net public amount (deposit - withdrawal, modulo field size)
    pub public_amount: U256,
    /// Hash of the external data (binds proof to transaction parameters)
    pub ext_data_hash: BytesN<32>,
}

// ─── ExtData ─────────────────────────────────────────────────────────────────

/// External data for a transaction
///
/// Contains public information that is hashed and included in the ZK proof to
/// bind it to specific transaction parameters (e.g. recipient address).
#[contracttype]
#[derive(Clone)]
pub struct ExtData {
    /// Recipient address for withdrawals
    pub recipient: Address,
    /// External amount: positive for deposits, negative for withdrawals
    pub ext_amount: I256,
    /// Encrypted data for the N output UTXOs (length = nOuts, 8 for payroll)
    pub encrypted_outputs: Vec<Bytes>,
}

/// Hash external data using Keccak256
///
/// Serializes the external data to XDR, hashes it with Keccak256, and reduces
/// the result modulo the BN256 field size.
pub fn hash_ext_data(env: &Env, ext: &ExtData) -> BytesN<32> {
    let payload = ext.clone().to_xdr(env);
    let digest: BytesN<32> = env.crypto().keccak256(&payload).into();
    let digest_u256 = U256::from_be_bytes(env, &Bytes::from(digest));
    let reduced = digest_u256.rem_euclid(&bn256_modulus(env));
    let mut buf = [0u8; 32];
    reduced.to_be_bytes().copy_into_slice(&mut buf);
    BytesN::from_array(env, &buf)
}

// ─── Account ─────────────────────────────────────────────────────────────────

/// User account registration data
///
/// Used for registering a user's public key to enable encrypted communication
/// for receiving transfers.
#[contracttype]
pub struct Account {
    /// Owner address of the account
    pub owner: Address,
    /// X25519 encryption public key for encrypting note data (32 bytes)
    pub encryption_key: Bytes,
    /// BN254 note public key for creating commitments (32 bytes)
    pub note_key: Bytes,
}

// ─── Storage keys ────────────────────────────────────────────────────────────

/// Storage keys for contract persistent data
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum DataKey {
    /// Administrator address
    Admin,
    /// Address of the token contract used for deposits/withdrawals
    Token,
    /// Address of the UltraHonk verifier contract
    Verifier,
    /// Maximum allowed deposit amount per transaction
    MaximumDepositAmount,
    /// Map of spent nullifiers (nullifier -> bool)
    Nullifiers,
}

// ─── Events ──────────────────────────────────────────────────────────────────

/// Event emitted when a new commitment is added to the Merkle tree
#[contractevent]
#[derive(Clone)]
pub struct NewCommitmentEvent {
    #[topic]
    pub commitment: U256,
    pub index: u32,
    pub encrypted_output: Bytes,
}

/// Event emitted when a nullifier is spent
#[contractevent]
#[derive(Clone)]
pub struct NewNullifierEvent {
    #[topic]
    pub nullifier: U256,
}

/// Event emitted when a user registers their public keys
#[contractevent]
#[derive(Clone)]
pub struct PublicKeyEvent {
    #[topic]
    pub owner: Address,
    pub encryption_key: Bytes,
    pub note_key: Bytes,
}

// ─── Contract ────────────────────────────────────────────────────────────────

/// Privacy Pool Contract (UltraHonk edition)
#[contract]
pub struct PoolContract;

#[contractimpl]
impl PoolContract {
    /// Constructor: initialize the privacy pool contract
    ///
    /// Sets up the contract with the specified token, UltraHonk verifier, and
    /// Merkle tree configuration.  This function can only be called once.
    ///
    /// Note: the pool starts with an EMPTY Merkle tree (D3).
    pub fn __constructor(
        env: Env,
        admin: Address,
        token: Address,
        verifier: Address,
        maximum_deposit_amount: U256,
        levels: u32,
    ) -> Result<(), Error> {
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::Token, &token);
        env.storage()
            .persistent()
            .set(&DataKey::Verifier, &verifier);
        env.storage()
            .persistent()
            .set(&DataKey::MaximumDepositAmount, &maximum_deposit_amount);
        env.storage()
            .persistent()
            .set(&DataKey::Nullifiers, &Map::<U256, bool>::new(&env));

        // Initialize the Merkle tree for commitment storage (empty tree, D3)
        MerkleTreeWithHistory::init(&env, levels)?;

        Ok(())
    }

    /// Maximum absolute external amount allowed (2^248)
    fn max_ext_amount(env: &Env) -> U256 {
        U256::from_parts(env, 0x0100_0000_0000_0000, 0, 0, 0)
    }

    /// Convert a non-negative I256 to i128 with bounds checking
    fn i256_to_i128_nonneg(env: &Env, v: &I256) -> Result<i128, Error> {
        if *v < I256::from_i32(env, 0) {
            return Err(Error::WrongExtAmount);
        }
        v.to_i128().ok_or(Error::WrongExtAmount)
    }

    /// Calculate the public amount from external amount (BN256 field arithmetic)
    fn calculate_public_amount(env: &Env, ext_amount: I256) -> Result<U256, Error> {
        let abs_ext = Self::i256_abs_to_u256(env, &ext_amount);
        if abs_ext >= Self::max_ext_amount(env) {
            return Err(Error::WrongExtAmount);
        }

        let zero = I256::from_i32(env, 0);

        if ext_amount >= zero {
            let pa_bytes = ext_amount.to_be_bytes();
            Ok(U256::from_be_bytes(env, &pa_bytes))
        } else {
            let neg = zero.sub(&ext_amount);
            let neg_bytes = neg.to_be_bytes();
            let neg_u256 = U256::from_be_bytes(env, &neg_bytes);
            let field = bn256_modulus(env);
            Ok(field.sub(&neg_u256))
        }
    }

    /// Check if a nullifier has already been spent
    fn is_spent(env: &Env, n: &U256) -> Result<bool, Error> {
        let nulls = Self::get_nullifiers(env)?;
        Ok(nulls.get(n.clone()).unwrap_or(false))
    }

    /// Mark a nullifier as spent
    fn mark_spent(env: &Env, n: &U256) -> Result<(), Error> {
        let mut nulls = Self::get_nullifiers(env)?;
        nulls.set(n.clone(), true);
        Self::set_nullifiers(env, &nulls);
        Ok(())
    }

    /// Verify a zero-knowledge proof via the UltraHonk verifier contract.
    ///
    /// The pool passes `public_inputs` (384-byte blob) and `proof_bytes`
    /// (14 592-byte blob) directly to the verifier — no field reconstruction.
    /// Any error from the verifier maps to `Error::InvalidProof`.
    fn verify_proof(env: &Env, proof: &Proof) -> Result<bool, Error> {
        // Guard: the public_inputs blob must be non-empty
        if proof.public_inputs.is_empty() {
            return Err(Error::InvalidProof);
        }
        let verifier = Self::get_verifier(env)?;
        let client = UltraHonkVerifierClient::new(env, &verifier);

        // try_verify_proof returns Result<Result<(), ContractError>, InvokeError>.
        // Both inner and outer errors map to InvalidProof.
        match client.try_verify_proof(&proof.public_inputs, &proof.proof_bytes) {
            Ok(Ok(())) => Ok(true),
            Ok(Err(_)) | Err(_) => Err(Error::InvalidProof),
        }
    }

    fn hash_ext_data(env: &Env, ext: &ExtData) -> BytesN<32> {
        hash_ext_data(env, ext)
    }

    fn i256_abs_to_u256(env: &Env, v: &I256) -> U256 {
        let zero = I256::from_i32(env, 0);
        let abs = if *v >= zero { v.clone() } else { zero.sub(v) };
        U256::from_be_bytes(env, &abs.to_be_bytes())
    }

    /// Execute a shielded transaction with optional deposit.
    ///
    /// If `ext_amount > 0`, tokens are transferred from `sender` to the pool
    /// before the ZK proof is verified.
    pub fn transact(
        env: &Env,
        proof: Proof,
        ext_data: ExtData,
        sender: Address,
    ) -> Result<(), Error> {
        sender.require_auth();
        let token = Self::get_token(env)?;
        let token_client = TokenClient::new(env, &token);
        let zero = I256::from_i32(env, 0);

        // Handle deposit if ext_amount > 0
        if ext_data.ext_amount > zero {
            let deposit_u = U256::from_be_bytes(env, &ext_data.ext_amount.to_be_bytes());
            let max = Self::get_maximum_deposit(env)?;
            if deposit_u > max {
                return Err(Error::WrongExtAmount);
            }
            let this = env.current_contract_address();
            let amount = Self::i256_to_i128_nonneg(env, &ext_data.ext_amount)?;
            token_client.transfer(&sender, &this, &amount);
        }

        Self::internal_transact(env, proof, ext_data)
    }

    /// Process a private transaction
    ///
    /// Validates the proof and all public inputs, marks nullifiers as spent,
    /// processes withdrawals, and inserts new commitments into the Merkle tree.
    ///
    /// Validation steps:
    /// 1. Verify Merkle root is in recent history
    /// 2. Verify no nullifiers have been spent
    /// 3. Verify external data hash matches
    /// 4. Verify public amount calculation
    /// 5. Verify zero-knowledge proof (UltraHonk, via delegated verifier)
    fn internal_transact(env: &Env, proof: Proof, ext_data: ExtData) -> Result<(), Error> {
        // 1. Merkle root check
        if !MerkleTreeWithHistory::is_known_root(env, &proof.root)? {
            return Err(Error::UnknownRoot);
        }
        // 2. Nullifier checks (prevent double-spending — T-09-02)
        for n in proof.input_nullifiers.iter() {
            if Self::is_spent(env, &n)? {
                return Err(Error::AlreadySpentNullifier);
            }
        }
        // 3. External data hash check
        let ext_hash = Self::hash_ext_data(env, &ext_data);
        if ext_hash != proof.ext_data_hash {
            return Err(Error::WrongExtHash);
        }

        // 4. Public amount check
        let expected_public_amount =
            Self::calculate_public_amount(env, ext_data.ext_amount.clone())?;
        if proof.public_amount != expected_public_amount {
            return Err(Error::WrongExtAmount);
        }

        // 5. ZK proof verification (UltraHonk nativo)
        if !Self::verify_proof(env, &proof)? {
            return Err(Error::InvalidProof);
        }

        // 6. Mark nullifiers as spent
        for n in proof.input_nullifiers.iter() {
            let _ = Self::mark_spent(env, &n);
            NewNullifierEvent { nullifier: n }.publish(env);
        }

        // 7. Process withdrawal if ext_amount < 0
        let token = Self::get_token(env)?;
        let token_client = TokenClient::new(env, &token);
        let this = env.current_contract_address();
        let zero = I256::from_i32(env, 0);

        if ext_data.ext_amount < zero {
            let abs = zero.sub(&ext_data.ext_amount);
            let amount: i128 = Self::i256_to_i128_nonneg(env, &abs)?;
            token_client.transfer(&this, &ext_data.recipient, &amount);
        }

        // 8. Insert new commitments into Merkle tree (N outputs, inserted in pairs)
        let indices =
            MerkleTreeWithHistory::insert_n_leaves(env, proof.output_commitments.clone())?;

        // 9. Emit one commitment event per output
        let mut k: u32 = 0;
        for (commitment, index) in proof.output_commitments.iter().zip(indices.iter()) {
            let encrypted_output = ext_data
                .encrypted_outputs
                .get(k)
                .unwrap_or_else(|| Bytes::new(env));
            NewCommitmentEvent {
                commitment,
                index,
                encrypted_output,
            }
            .publish(env);
            k = k.saturating_add(1);
        }

        Ok(())
    }

    /// Register a user's public encryption key
    pub fn register(env: Env, account: Account) {
        account.owner.require_auth();
        PublicKeyEvent {
            owner: account.owner,
            encryption_key: account.encryption_key,
            note_key: account.note_key,
        }
        .publish(&env);
    }

    // ─── Storage Getters and Setters ────────────────────────────────────────

    fn get_nullifiers(env: &Env) -> Result<Map<U256, bool>, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Nullifiers)
            .ok_or(Error::NotInitialized)
    }

    fn set_nullifiers(env: &Env, m: &Map<U256, bool>) {
        env.storage().persistent().set(&DataKey::Nullifiers, m);
    }

    fn get_token(env: &Env) -> Result<Address, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)
    }

    fn get_maximum_deposit(env: &Env) -> Result<U256, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::MaximumDepositAmount)
            .ok_or(Error::NotInitialized)
    }

    fn get_verifier(env: &Env) -> Result<Address, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Verifier)
            .ok_or(Error::NotInitialized)
    }

    #[allow(dead_code)]
    fn get_admin(env: &Env) -> Result<Address, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    /// Get the latest root of the Merkle tree that defines the pool
    pub fn get_root(env: &Env) -> Result<U256, Error> {
        Ok(MerkleTreeWithHistory::get_last_root(env)?)
    }

    /// Update the contract administrator
    pub fn update_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        if !env.storage().persistent().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }
        soroban_utils::update_admin(&env, &DataKey::Admin, &new_admin);
        Ok(())
    }
}
