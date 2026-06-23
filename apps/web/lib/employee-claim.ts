/**
 * employee-claim.ts — claimNote orchestrator: fetch path -> nullifier -> witness -> prove -> Freighter.
 *
 * Threads the confirmed contract fallbacks:
 *   A2: pool.get_proof is ABSENT from pool.rs (plan 01 Wave 0). On failure this
 *       module falls back to reconstructMerklePathFromEvents (client-side Merkle
 *       path reconstruction from event history).
 *
 * Step callback order:
 *   fetching-proof -> downloading -> proving -> signing -> done (or error on any step).
 *
 * Security: the seed and bn254Priv are NEVER logged. No console.log of key material.
 * Testnet guard: the network check happens during the signing step (inside unshieldNote).
 * Amount reveal: ext_amount = -note.amount (negative = withdrawal direction, amber-warned in UI).
 */
'use client'

import {
  prove,
  configureProver,
  initProver,
  onProgress,
} from '@/lib/zk/proverClient'
import { buildWithdrawInputs } from '@/lib/zk/withdrawTransactionBuilder'
import { fetchMerkleProof, fetchPoolRoot, readDeployments } from '@/lib/rpc'
import {
  reconstructMerklePathFromEvents,
  type EmployeeNote,
} from '@/lib/employee-scan'
import { getChainAdapter } from '@/lib/chain'
import type { ClaimStep } from '@/components/employee/ClaimStepper'
import type { ScannedEvent } from 'viewkey'

/**
 * Claim a single employee note. Orchestrates the full claim path:
 *   0. Request Freighter access to get the recipient address (for the witness ext_data_hash).
 *   1. Fetch the Merkle path from the pool (falls back to client-side reconstruction on failure).
 *   2. Download and initialize the in-browser WASM prover.
 *   3. Generate the ZK proof (ext_data_hash binds recipient + negative ext_amount).
 *   4. Submit via unshieldNote (Freighter connect+sign+send).
 *   5. Return the submitted tx hash.
 *
 * Reports each phase to `onStep` for the ClaimStepper UI. Throws a typed Error
 * on any failure (wrong network, proof failure, Freighter rejection).
 *
 * @param note           The EmployeeNote to claim (from scanEmployeeNotes).
 * @param bn254Priv      The employee's BN254 spending private key (from deriveEmployeeKeys).
 * @param recipientAddress  Freighter account address. Pass '' to auto-resolve from Freighter.
 * @param scannedEvents  All events from the scan (used for the A2 Merkle path fallback).
 * @param onStep         Step callback invoked at each phase transition.
 */
export async function claimNote(
  note: EmployeeNote,
  bn254Priv: bigint,
  recipientAddress: string,
  scannedEvents: ScannedEvent[],
  onStep: (s: ClaimStep) => void,
): Promise<{ hash: string }> {
  // Step 0: resolve recipient via the wallet (access + testnet guard). The recipient
  // binds into the ext_data_hash the circuit verifies — must be the real address
  // before proving. connect() is idempotent, so an explicit recipientAddress still
  // grants access for the later signature.
  const connected = await getChainAdapter().wallet.connect()
  const recipient = recipientAddress || connected

  // Step 1: fetch the Merkle path. pool.get_proof is absent (A2); fall back to
  // client-side reconstruction from the scanned event history on any failure.
  onStep({ phase: 'fetching-proof' })
  let path: { pathElements: string[]; pathIndices: string }
  try {
    path = await fetchMerkleProof(note.index)
  } catch {
    // A2 fallback: reconstruct from event history (pool.get_proof absent in pool.rs).
    // Uses the WASM MerkleTree (real Poseidon2) so the path elements are valid
    // field elements the withdraw witness generator accepts.
    path = await reconstructMerklePathFromEvents(scannedEvents, note.index)
  }

  // Step 2: download and initialize the in-browser WASM prover.
  onStep({ phase: 'downloading', loaded: 0, total: 0, message: '' })
  await configureProver()
  const unsub = onProgress((loaded, total, message) =>
    onStep({ phase: 'downloading', loaded, total, message }),
  )
  await initProver()
  unsub()

  // Step 3: generate the ZK proof in-browser.
  // Sobre_slim Noir ABI: nullifier, zero-note commitments, and in_path_bits are
  // computed in JS via poseidon2Pool inside buildWithdrawInputs (no COMPUTE_* worker
  // calls — those handlers are dead in bb-prover.ts after D2 scope drop).
  // No ASP fields: sobre_slim intentionally drops the allowlist proofs.
  const poolRoot = await fetchPoolRoot()

  // ext_amount is NEGATIVE for a withdrawal (pool checks sign direction).
  // The withdrawn amount becomes visible on-chain — amber-warned in NoteCard.
  const extDataHashResult = getChainAdapter().encoding.hashExtData({
    recipient,
    ext_amount: -note.amount,
    encrypted_outputs: [],
  })
  const extDataHash = extDataHashResult.bigInt.toString()

  const witness = buildWithdrawInputs({
    note,
    bn254Priv,
    pathElements: path.pathElements,
    pathIndices: path.pathIndices,
    recipientAddress: recipient,
    poolRoot,
    extDataHash,
  })

  let elapsed = 0
  const timer = setInterval(() => {
    elapsed++
    onStep({ phase: 'proving', elapsed })
  }, 1000)

  let proofBytes: Uint8Array
  let publicInputsBlob: Uint8Array
  try {
    const result = await prove(witness)
    proofBytes = result.proof        // 14592-byte UltraHonk proof blob
    publicInputsBlob = result.publicInputs  // 384-byte public-inputs blob (12 × 32 BE)
  } finally {
    clearInterval(timer)
  }

  // Step 4: sign and submit (employee pays their own fee). The recipient bound into
  // ext_data_hash above is passed through so the writer signs with the same address.
  onStep({ phase: 'signing' })
  const { poolContractId } = readDeployments()
  const txResult = await getChainAdapter().writer.withdraw({
    poolId: poolContractId,
    commitmentIndex: note.index,
    amount: note.amount.toString(),
    recipient,
    // proof = the 14592-byte UltraHonk proof blob (Proof.proof_bytes on-chain)
    proof: proofBytes,
    // UltraHonk ProofPublicInputs: two opaque blobs from bb plus the structured
    // fields the pool validates independently (root, nullifiers, etc.).
    publicInputs: {
      root: witness.root,
      publicAmount: witness.public_amount,
      extDataHash: extDataHashResult.bytes,
      inputNullifiers: [witness.input_nullifier],
      outputCommitments: [0,1,2,3,4,5,6,7].map(i => (witness as Record<string, string>)[`output_commitment_${i}`]),
      // The 384-byte public-inputs blob from bb (passed as Proof.public_inputs on-chain)
      publicInputsBlob,
      // The 14592-byte UltraHonk proof blob (same as proof, carried for encoding)
      proofBytes,
    },
  })

  onStep({ phase: 'done', txHash: txResult.hash })
  return txResult
}
