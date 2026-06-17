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
 * Testnet guard: unshieldNote (employee-unshield.ts) enforces that Freighter is on testnet.
 * Amount reveal: ext_amount = -note.amount (negative = withdrawal direction, amber-warned in UI).
 */
'use client'

import {
  prove,
  configureProver,
  initProver,
  onProgress,
  computeNullifier,
} from '@/lib/zk/proverClient'
import { buildWithdrawInputs } from '@/lib/zk/withdrawTransactionBuilder'
import { hashExtDataSobre } from '@/lib/zk/depositTransactionBuilder'
import {
  fetchMerkleProof,
  fetchPoolRoot,
  fetchASPRoots,
  readDeployments,
} from '@/lib/rpc'
import {
  reconstructMerklePathFromEvents,
  type EmployeeNote,
} from '@/lib/employee-scan'
import { unshieldNote } from '@/lib/employee-unshield'
import type { ClaimStep } from '@/components/employee/ClaimStepper'
import type { ScannedEvent } from 'viewkey'

/**
 * Claim a single employee note. Orchestrates the full claim path:
 *   1. Fetch the Merkle path from the pool (falls back to client-side reconstruction on failure).
 *   2. Download and initialize the in-browser WASM prover.
 *   3. Generate the ZK proof.
 *   4. Submit via Freighter (unshieldNote).
 *   5. Return the submitted tx hash.
 *
 * Reports each phase to `onStep` for the ClaimStepper UI. Throws a typed Error
 * on any failure (wrong network, proof failure, Freighter rejection).
 *
 * @param note           The EmployeeNote to claim (from scanEmployeeNotes).
 * @param bn254Priv      The employee's BN254 spending private key (from deriveEmployeeKeys).
 * @param recipientAddress  Freighter account address receiving the USDC.
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
  // Step 1: fetch the Merkle path. pool.get_proof is absent (A2); fall back to
  // client-side reconstruction from the scanned event history on any failure.
  onStep({ phase: 'fetching-proof' })
  let path: { pathElements: string[]; pathIndices: string }
  try {
    path = await fetchMerkleProof(note.index)
  } catch {
    // A2 fallback: reconstruct from event history (pool.get_proof absent in pool.rs).
    path = reconstructMerklePathFromEvents(scannedEvents, note.index)
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
  // computeNullifier uses the Poseidon2 WASM bridge so the circuit accepts it.
  const pathIndicesBigInt = BigInt(path.pathIndices)
  const inputNullifier = await computeNullifier(bn254Priv, note.blinding, pathIndicesBigInt)

  const poolRoot = await fetchPoolRoot()
  const { memberRoot, nonMemberRoot } = await fetchASPRoots()

  // ext_amount is NEGATIVE for a withdrawal (pool checks sign direction).
  // The withdrawn amount becomes visible on-chain — amber-warned in NoteCard.
  const extDataHashResult = hashExtDataSobre({
    recipient: recipientAddress,
    ext_amount: -note.amount,
    encrypted_outputs: [],
  })
  const extDataHash = extDataHashResult.toString()

  const witness = buildWithdrawInputs({
    note,
    bn254Priv,
    inputNullifier,
    pathElements: path.pathElements,
    pathIndices: path.pathIndices,
    recipientAddress,
    poolRoot,
    aspMemberRoot: memberRoot,
    aspNonMemberRoot: nonMemberRoot,
    extDataHash,
  })

  let elapsed = 0
  const timer = setInterval(() => {
    elapsed++
    onStep({ phase: 'proving', elapsed })
  }, 1000)

  let proof: Uint8Array
  try {
    const result = await prove(witness)
    proof = result.proof
  } finally {
    clearInterval(timer)
  }

  // Step 4: sign and submit with Freighter (employee pays their own fee).
  onStep({ phase: 'signing' })
  const { poolContractId } = readDeployments()
  const result = await unshieldNote({
    poolContractId,
    commitmentIndex: note.index,
    amount: note.amount.toString(),
    notePrivkeyHex: '',
    blinding: note.blinding.toString(),
    withdrawProofXdr: Buffer.from(proof).toString('base64'),
  })

  onStep({ phase: 'done', txHash: result.hash })
  return result
}
