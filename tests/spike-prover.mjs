/**
 * SPIKE: policy_tx_1_8 browser proof generation
 *
 * Verifica que prover_bg.wasm (ark-groth16) puede generar una prueba Groth16 válida
 * para el circuito policy_tx_1_8 en un contexto de browser (Web Worker + WASM).
 *
 * Mide:
 *   - Cold init: primera descarga+init de proving_key.bin (4.8MB) + r1cs (3.4MB)
 *   - N=8 prove time: generación de prueba con 1 input dummy + 8 outputs
 *   - Warm init: segunda inicialización desde Cache API
 *   - proof.length: debe ser 256 (formato Soroban)
 *   - verifyProofLocal: debe ser true
 *
 * Cómo correr (desde apps/web):
 *   npx playwright test tests/spike-prover.spec.mjs --project=chromium
 */

import { test, expect } from '@playwright/test'

test.setTimeout(300_000)

test('policy_tx_1_8 browser proof spike', async ({ page }) => {
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error('[browser:error]', msg.text())
    } else {
      console.log(`[browser:${msg.type()}]`, msg.text())
    }
  })

  page.on('pageerror', err => {
    console.error('[browser:pageerror]', err.message)
  })

  await page.goto('/')
  await page.waitForLoadState('networkidle', { timeout: 30_000 })

  const spikeResult = await page.evaluate(async () => {
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

    const BN254_MOD = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617')
    const LEVELS = 10  // circuit levels for membership tree (nIns x nMembershipProofs x levels)

    function bigIntToLE32(n) {
      const arr = new Uint8Array(32)
      let v = n
      for (let j = 0; j < 32; j++) {
        arr[j] = Number(v & 0xFFn)
        v >>= 8n
      }
      return arr
    }

    function bytesToBigIntLE(bytes) {
      let result = 0n
      for (let i = bytes.length - 1; i >= 0; i--) {
        result = (result << 8n) | BigInt(bytes[i])
      }
      return result
    }

    // ---------------------------------------------------------------------------
    // 1. Inicializar prover.js WASM en main thread para crypto utilities
    // ---------------------------------------------------------------------------
    let wasm
    try {
      wasm = await import('/zk/prover.js')
      await wasm.default() // initProverModule()
      console.log('[spike] prover.js WASM initialized in main thread')
    } catch (e) {
      return { error: `prover.js WASM init failed: ${e.message || String(e)}` }
    }

    // ---------------------------------------------------------------------------
    // 2. Importar prover-client.js (worker API)
    // ---------------------------------------------------------------------------
    let pc
    try {
      pc = await import('/zk/prover-client.js')
    } catch (e) {
      return { error: `prover-client.js import failed: ${e.message || String(e)}` }
    }

    // ---------------------------------------------------------------------------
    // 3. Cold init (worker + artifacts download)
    // ---------------------------------------------------------------------------
    console.log('[spike] Starting cold initProver...')
    const coldStart = performance.now()
    try {
      await pc.initializeProver({
        onProgress: (loaded, total, message) => {
          const pct = total ? Math.round(loaded / total * 100) : '?'
          console.log(`[spike:progress] ${pct}% — ${message}`)
        }
      })
    } catch (err) {
      return { error: `Cold initProver failed: ${err.message || String(err)}` }
    }
    const coldMs = performance.now() - coldStart
    console.log(`[spike] Cold init: ${coldMs.toFixed(0)}ms`)

    // ---------------------------------------------------------------------------
    // 4. Build a VALID witness for policy_tx_1_8 (1 dummy input → 8 outputs)
    //
    //    The circuit ALWAYS checks membership and non-membership proofs.
    //    We must provide valid proofs against a merkle tree we construct ourselves.
    //
    //    Per RESEARCH Pattern 4 + policyTransaction.circom:
    //    a) membership leaf = poseidon2(pubKey, blinding=0, domainSep=0x01)
    //    b) membership tree: depth=10, insert membership_leaf, get root + path
    //    c) non-membership: use SMT zero root (root=0, isOld0=1, all zeros)
    //    d) inputNullifier = compute_nullifier(commitment, pathIndices, signature)
    //    e) outputCommitment[i] = compute_commitment(outAmount[i], outPubkey[i], outBlinding[i])
    // ---------------------------------------------------------------------------

    // Random blindings for 8 outputs
    const blindings = []
    for (let i = 0; i < 8; i++) {
      const rb = new Uint8Array(32)
      crypto.getRandomValues(rb)
      blindings.push(bytesToBigIntLE(rb) % BN254_MOD)
    }

    // Fresh dummy blinding for input (prevents nullifier reuse)
    const dummyBlindingBytes = new Uint8Array(32)
    crypto.getRandomValues(dummyBlindingBytes)
    const dummyBlinding = bytesToBigIntLE(dummyBlindingBytes) % BN254_MOD

    // 8 output pubkeys (BN254 scalars, CLI test values: 1001..1008)
    const outPubkeys = Array.from({ length: 8 }, (_, i) => BigInt(1001 + i))

    // 8 dummy output amounts (field values for spike)
    const outAmounts = [50n, 10n, 10n, 10n, 10n, 10n, 5n, 5n] // sum = 110

    // Dummy input privKey = 1
    const dummyPrivKeyLE = bigIntToLE32(1n)
    const dummyPubkeyBytes = wasm.derive_public_key(dummyPrivKeyLE)
    const dummyPubkey = bytesToBigIntLE(dummyPubkeyBytes)
    console.log('[spike] dummyPubkey:', dummyPubkey.toString())

    // Dummy input commitment (amount=0)
    const zeroAmtBytes = bigIntToLE32(0n)
    const dummyBlindLE = bigIntToLE32(dummyBlinding)
    const dummyCommitBytes = wasm.compute_commitment(zeroAmtBytes, dummyPubkeyBytes, dummyBlindLE)
    const dummyCommit = bytesToBigIntLE(dummyCommitBytes) % BN254_MOD

    // Compute signature: compute_signature(private_key, commitment, path_indices)
    const pathIndicesLE = bigIntToLE32(0n)
    const sigBytes = wasm.compute_signature(dummyPrivKeyLE, dummyCommitBytes, pathIndicesLE)

    // Compute nullifier: compute_nullifier(commitment, path_indices, signature)
    const nullBytes = wasm.compute_nullifier(dummyCommitBytes, pathIndicesLE, sigBytes)
    const nullifier = bytesToBigIntLE(nullBytes) % BN254_MOD
    console.log('[spike] nullifier:', nullifier.toString())

    // Compute 8 output commitments
    const outputCommitments = []
    for (let i = 0; i < 8; i++) {
      const amtBytes = bigIntToLE32(outAmounts[i])
      const pkBytes = bigIntToLE32(outPubkeys[i])
      const blBytes = bigIntToLE32(blindings[i])
      const cBytes = wasm.compute_commitment(amtBytes, pkBytes, blBytes)
      outputCommitments.push(bytesToBigIntLE(cBytes) % BN254_MOD)
    }
    console.log('[spike] output commitments computed:', outputCommitments.length)

    // ---------------------------------------------------------------------------
    // Membership tree construction
    //
    // The membership leaf is: poseidon2(pubKey, blinding=0, domainSep=0x01)
    // per policyTransaction.circom line 130-134:
    //   policyMembershipHasher.inputs[0] <== inKeypair[tx].publicKey
    //   policyMembershipHasher.inputs[1] <== membershipProofs[tx][i].blinding
    //   policyMembershipHasher.domainSeparation <== 0x01
    //   membershipProofs[tx][i].leaf === policyMembershipHasher.out
    //
    // We set membershipProofs[0][0].blinding = 0, so:
    //   memLeaf = poseidon2(dummyPubkey, 0n, 0x01)
    // ---------------------------------------------------------------------------
    const memLeafBytes = wasm.poseidon2_hash2(dummyPubkeyBytes, bigIntToLE32(0n), 1) // domainSep=1=0x01
    const memLeaf = bytesToBigIntLE(memLeafBytes)
    console.log('[spike] membership leaf:', memLeaf.toString())

    // Build membership tree (depth=10) with this leaf
    // Use the zero_leaf from WASM (matches what the contract uses: poseidon2(88,76,77) for XLM)
    // For a LOCAL spike, we can use a simple new MerkleTree(LEVELS) with default zero=0
    const memTree = new wasm.MerkleTree(LEVELS)
    const leafIndex = memTree.insert(memLeafBytes)
    console.log('[spike] inserted membership leaf at index:', leafIndex)
    const memProof = memTree.get_proof(leafIndex)

    // Extract path elements (LEVELS * 32 bytes concatenated) and path indices (32 bytes)
    const memPathElementsRaw = memProof.path_elements // Uint8Array, LEVELS*32 bytes
    const memPathIndicesRaw = memProof.path_indices   // Uint8Array, 32 bytes
    const memRoot = memProof.root                      // Uint8Array, 32 bytes

    const memRootBig = bytesToBigIntLE(memRoot) % BN254_MOD
    const memPathIdx = bytesToBigIntLE(memPathIndicesRaw)

    // Convert path_elements (concatenated 32-byte chunks) to array of BigInt strings
    const memPathElements = []
    for (let i = 0; i < LEVELS; i++) {
      const chunk = memPathElementsRaw.slice(i * 32, (i + 1) * 32)
      memPathElements.push(bytesToBigIntLE(chunk).toString())
    }
    console.log('[spike] membership root:', memRootBig.toString())
    console.log('[spike] membership pathIdx:', memPathIdx.toString())

    // ---------------------------------------------------------------------------
    // Non-membership: SMT empty (root=0, isOld0=1, key=0, oldKey=0, oldValue=0, siblings=0)
    // per payroll-proof-gen: --zero-input + use_onchain_state uses empty SMT (root=0)
    // The circuit checks: nonMembershipProofs[tx][i].key === inKeypair[tx].publicKey
    // So we must set key = dummyPubkey
    // ---------------------------------------------------------------------------
    const nonMemProof = {
      key: dummyPubkey.toString(),
      siblings: Array(LEVELS).fill('0'),
      oldKey: '0',
      oldValue: '0',
      isOld0: '1',
    }

    // publicAmount = sum(outAmounts)
    const publicAmount = outAmounts.reduce((a, b) => a + b, 0n) // 110n

    // extDataHash = 0 for this spike
    const extDataHash = 0n

    // Pool root = 1 (dummy; inAmount=0 so root check is disabled by `inCheckRoot.enabled <== inAmount`)
    const poolRoot = '1'

    // Witness input object
    const inputs = {
      root: poolRoot,
      publicAmount: publicAmount.toString(),
      extDataHash: extDataHash.toString(),
      inputNullifier: [nullifier.toString()],
      outputCommitment: outputCommitments.map(c => c.toString()),
      membershipRoots: [[memRootBig.toString()]],
      nonMembershipRoots: [['0']], // empty SMT root = 0
      // private signals:
      inAmount: ['0'],
      inPrivateKey: ['1'],
      inBlinding: [dummyBlinding.toString()],
      inPathIndices: ['0'],
      inPathElements: [Array(LEVELS).fill('0')],
      membershipProofs: [[{
        leaf: memLeaf.toString(),
        blinding: '0', // must match what we used to compute memLeaf
        pathElements: memPathElements,
        pathIndices: memPathIdx.toString(),
      }]],
      nonMembershipProofs: [[nonMemProof]],
      outAmount: outAmounts.map(a => a.toString()),
      outPubkey: outPubkeys.map(p => p.toString()),
      outBlinding: blindings.map(b => b.toString()),
    }

    // ---------------------------------------------------------------------------
    // 5. Prove (N=8) con sorobanFormat=true → 256 bytes
    // ---------------------------------------------------------------------------
    console.log('[spike] Starting N=8 prove (soroban format)...')
    const proveStart = performance.now()
    let proveResult
    try {
      proveResult = await pc.prove(inputs, { sorobanFormat: true })
    } catch (err) {
      return {
        error: `prove() failed: ${err.message || String(err)}`,
        coldInitMs: Math.round(coldMs),
      }
    }
    const proveMs = performance.now() - proveStart
    console.log(`[spike] N=8 prove: ${proveMs.toFixed(0)}ms`)

    const proofLength = proveResult.proof.length
    console.log(`[spike] proof.length = ${proofLength} (expected 256)`)

    // ---------------------------------------------------------------------------
    // 6. verifyProofLocal usando compressed proof
    // ---------------------------------------------------------------------------
    console.log('[spike] Running explicit verify...')
    let verifyResult = false
    try {
      const proveCompressed = await pc.prove(inputs, { sorobanFormat: false })
      verifyResult = await pc.verify(proveCompressed.proof, proveCompressed.publicInputs)
    } catch (err) {
      console.error('[spike] verify failed:', err.message || String(err))
    }
    console.log(`[spike] verifyProofLocal = ${verifyResult}`)

    // ---------------------------------------------------------------------------
    // 7. Warm init — Cache API hit (artifacts already cached)
    // ---------------------------------------------------------------------------
    pc.terminate()
    await sleep(300)
    const warmStart = performance.now()
    try {
      const pc2 = await import('/zk/prover-client.js?w=2')
      await pc2.initializeProver()
      pc2.terminate()
    } catch (err) {
      console.error('[spike] warm init error:', err.message || String(err))
    }
    const warmMs = performance.now() - warmStart
    console.log(`[spike] Warm init: ${warmMs.toFixed(0)}ms`)

    return {
      coldInitMs: Math.round(coldMs),
      proveMs: Math.round(proveMs),
      warmInitMs: Math.round(warmMs),
      proofLength,
      verifyProofLocal: verifyResult,
      publicInputsLength: proveResult.publicInputs.length,
    }
  })

  console.log('\n=== SPIKE RESULTS ===')
  console.log(JSON.stringify(spikeResult, null, 2))
  console.log('====================\n')

  if (spikeResult.error) {
    throw new Error(`Spike failed: ${spikeResult.error}`)
  }

  expect(spikeResult.proofLength, 'proof must be 256 bytes (Soroban format)').toBe(256)
  expect(spikeResult.verifyProofLocal, 'verifyProofLocal must be true').toBe(true)
  expect(spikeResult.coldInitMs, 'cold init must be > 0').toBeGreaterThan(0)
  expect(spikeResult.proveMs, 'prove time must be > 0').toBeGreaterThan(0)

  const proveSeconds = spikeResult.proveMs / 1000
  if (proveSeconds > 60) {
    console.warn(`\nWARNING: N=8 prove time ${proveSeconds.toFixed(1)}s exceeds 60s demo pacing (A2 risk). Consider pre-generated proof fallback.\n`)
  } else {
    console.log(`\nProve time ${proveSeconds.toFixed(1)}s is within demo pacing (<=60s). GO.\n`)
  }
})
