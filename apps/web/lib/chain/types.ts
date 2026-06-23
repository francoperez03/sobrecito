/**
 * lib/chain/types.ts — chain-agnostic contracts for the Sobre web app.
 *
 * The app's domain (ZK proving, note crypto, CSV parsing) talks to the chain
 * ONLY through these interfaces. The Stellar/Soroban implementation lives in
 * lib/chain/stellar/*; a future EvmAdapter (or any other chain) implements the
 * same surface so the domain never imports a chain SDK directly.
 *
 * Value types are deliberately chain-neutral: the domain passes semantic values
 * (proof bytes, public inputs, amounts, commitments) and the adapter owns the
 * per-chain encoding (Soroban ScVal/XDR today). No `xdr.ScVal` ever leaks here.
 */

import type { ScannedEvent } from 'viewkey'

export type { ScannedEvent }

/** Decimal string or bigint accepted for field-element / U256 values. */
export type U256Like = bigint | string

/**
 * Resolved chain configuration (network endpoints + deployed contract ids).
 * The Stellar implementation reads this from ops/deployments/testnet.
 */
export interface ChainConfig {
  /** Soroban/EVM RPC endpoint. */
  rpcUrl: string
  /** Network identity (Stellar: the SEP-0005 passphrase; EVM: chainId string). */
  networkId: string
  /** Base fee for a submitted transaction, in the chain's smallest fee unit. */
  baseFee: string
  /** Privacy pool contract id. */
  poolId: string
  /** Payment token contract id (USDC SAC on Stellar). */
  usdcId: string
  /** ASP membership tree contract id. */
  aspMembershipId: string
  /** ASP non-membership tree contract id. */
  aspNonMembershipId: string
  /** Deployer / placeholder source account for read-only simulations. */
  deployer: string
  /** Published auditor X25519 pubkey (64-char hex), or '' before keygen. */
  auditorPubkeyHex: string
  /** Ledger/block the pool was deployed at — default start for event scans. */
  deploymentLedger: number
}

/** Merkle inclusion path for a pool commitment. */
export interface MerklePath {
  /** Sibling hashes per tree level (decimal-string field elements). */
  pathElements: string[]
  /** Direction bitmask (decimal string; bit i = left/right at level i). */
  pathIndices: string
}

/** A keccak-bound ext_data hash, as both reduced field value and 32 bytes. */
export interface ExtDataHash {
  bigInt: bigint
  bytes: Uint8Array
}

/** Input to the chain-specific ext_data hashing (binds a transact's metadata). */
export interface ExtDataInput {
  recipient: string
  ext_amount: bigint
  encrypted_outputs: Uint8Array[]
}

/**
 * Semantic public-input values that the on-chain `Proof` carries. These are the
 * SAME values the proof was generated against; the adapter encodes them into the
 * chain's proof representation.
 *
 * UltraHonk / sobre_slim (D2 scope): ASP membership fields dropped. The Proof
 * struct now carries two opaque blobs (public_inputs + proof_bytes) in addition
 * to the structured fields the pool validates independently (root, nullifiers,
 * commitments, public_amount, ext_data_hash).
 */
export interface ProofPublicInputs {
  /** Pool Merkle root the proof targets. */
  root: U256Like
  /** Net public amount (deposit = +sum(outputs); withdrawal = field-negative). */
  publicAmount: U256Like
  /** 32-byte keccak ext_data hash. */
  extDataHash: Uint8Array
  /** One nullifier per input. */
  inputNullifiers: U256Like[]
  /** Output commitments. */
  outputCommitments: U256Like[]
  /**
   * 384-byte public-inputs blob from bb (12 × 32-byte big-endian U256 fields):
   *   [root, public_amount, ext_data_hash, input_nullifier,
   *    output_commitment_0 .. output_commitment_7]
   * Passed directly to the UltraHonk verifier via the pool's Proof.public_inputs.
   */
  publicInputsBlob: Uint8Array
  /**
   * 14592-byte UltraHonk proof blob from bb 0.87.0. Passed directly to the
   * verifier via the pool's Proof.proof_bytes.
   */
  proofBytes: Uint8Array
}

/** Arguments for an employer deposit (employer funds the pool). */
export interface DepositArgs {
  /**
   * 14592-byte UltraHonk proof blob from bb 0.87.0 (passed as Proof.proof_bytes
   * on-chain). The 384-byte public-inputs blob travels in publicInputs.publicInputsBlob.
   */
  proof: Uint8Array
  /** Public inputs the proof was generated against. */
  publicInputs: ProofPublicInputs
  /** 8 dual-blob encrypted outputs (frozen before hashing + proving). */
  encOutputs: Uint8Array[]
  /** Total deposit in token base units (7 decimals). 0 for the field-only PoC. */
  totalBaseUnits: bigint
  /** Funding account. If omitted, resolved from the connected wallet. */
  sender?: string
}

export interface DepositResult {
  hash: string
  sender: string
}

/**
 * Arguments for an employee withdraw (unshield). Two shapes are supported:
 *  - Structured: pass `proof` + `publicInputs` and the adapter encodes them
 *    (the live claim flow that proves client-side).
 *  - Pre-built: pass opaque base64 `proofXdr` / `extDataXdr` blobs embedded in a
 *    claim link (the bearer-token path). They are opaque bytes to the domain.
 */
export interface WithdrawArgs {
  /** Pool contract id holding the note (a note carries its own pool). */
  poolId: string
  /** Commitment leaf index of the note being unshielded. */
  commitmentIndex: number
  /** Note amount (base units / field value), revealed on-chain by the withdraw. */
  amount: string
  /** Recipient address. If omitted, resolved from the connected wallet. */
  recipient?: string
  /** Structured proof (preferred for the live claim flow). */
  proof?: Uint8Array
  /** Public inputs for the structured proof. */
  publicInputs?: ProofPublicInputs
  /** Pre-built proof blob (base64 chain-native encoding) from a claim link. */
  proofXdr?: string
  /** Pre-built ext_data blob (base64 chain-native encoding) from a claim link. */
  extDataXdr?: string
}

export interface WithdrawResult {
  hash: string
  recipient: string
}

/** Wallet connection + signing capability (Freighter on Stellar). */
export interface WalletAdapter {
  /** Request access, resolve the address, and assert the expected network. */
  connect(): Promise<string>
  /** Current account address (no network assertion). */
  getAddress(): Promise<string>
  /** Network identity reported by the wallet. */
  getNetworkId(): Promise<string>
  /** Throw a user-facing error if the wallet is not on the expected network. */
  assertExpectedNetwork(): Promise<void>
  /** Sign an unsigned transaction (chain-native base64) for `address`. */
  signXdr(xdr: string, address: string): Promise<string>
}

/** Read-only on-chain state (Soroban simulations on Stellar). */
export interface ChainReader {
  /** Live pool Merkle root as a decimal string. */
  poolRoot(): Promise<string>
  /** Live ASP membership + non-membership roots (decimal strings). */
  aspRoots(): Promise<{ memberRoot: string; nonMemberRoot: string }>
  /** Token balance of an arbitrary account, in base units. */
  usdcBalance(address: string): Promise<bigint>
  /** Token balance held by the pool contract, in base units. */
  poolUsdcBalance(): Promise<bigint>
  /** Best-effort spent check for a nullifier (may be conservatively false). */
  nullifierSpent(nullifier: bigint): Promise<boolean>
  /** Merkle path for a commitment; throws MerkleProofUnavailableError if absent. */
  merkleProof(index: number): Promise<MerklePath>
  /** Funded amount of a batch (base units), read from its transact tx. */
  batchExtAmount(txHash: string): Promise<bigint | null>
}

/** Write operations: build + sign + submit a pool transact. */
export interface ChainWriter {
  deposit(args: DepositArgs): Promise<DepositResult>
  withdraw(args: WithdrawArgs): Promise<WithdrawResult>
}

/** Options for an event scan (defaults come from ChainConfig). */
export interface ScanRange {
  fromLedger?: number
  toLedger?: number
}

/** Pool event scanning (Soroban getEvents on Stellar, via the viewkey package). */
export interface ChainEventScanner {
  /** Scan NewCommitmentEvent over a ledger range (defaults to deploymentLedger). */
  scanCommitments(range?: ScanRange): Promise<ScannedEvent[]>
  /** Scan NewNullifierEvent: map each spent nullifier (decimal) → its claim txHash. */
  scanSpentNullifiers(range?: ScanRange): Promise<Map<string, string>>
}

/** Chain-specific binary encoding the domain needs for witness/proof building. */
export interface ChainEncoding {
  /** keccak(serialize(extData)) reduced into the field (binds a transact). */
  hashExtData(input: ExtDataInput): ExtDataHash
}

/** The full chain surface the app depends on. */
export interface ChainAdapter {
  config: ChainConfig
  wallet: WalletAdapter
  reader: ChainReader
  writer: ChainWriter
  events: ChainEventScanner
  encoding: ChainEncoding
  /** Block-explorer URL for a transaction hash. */
  explorerTxUrl(hash: string): string
}

/**
 * Thrown by ChainReader.merkleProof when the pool exposes no get_proof (Stellar
 * pool.rs omits it). Callers fall back to client-side reconstruction from events.
 */
export class MerkleProofUnavailableError extends Error {
  constructor() {
    super('merkleProof unavailable; reconstruct from events instead')
    this.name = 'MerkleProofUnavailableError'
  }
}
