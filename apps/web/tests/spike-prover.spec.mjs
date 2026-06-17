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
 * Inputs: obtenidos via payroll-proof-gen --dump-inputs --zero-input --ext-data-hash 0...0
 * El tool Rust verifica el proof localmente (verified_locally: true) antes de que
 * los valores se hardcodeen aquí, garantizando que satisfacen las R1CS constraints.
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

  // Check cross-origin isolation (required for SharedArrayBuffer in witness WASM)
  const isCOI = await page.evaluate(() => window.crossOriginIsolated)
  console.log(`[spike] crossOriginIsolated = ${isCOI}`)
  const hasSharedArrayBuffer = await page.evaluate(() => typeof SharedArrayBuffer !== 'undefined')
  console.log(`[spike] hasSharedArrayBuffer = ${hasSharedArrayBuffer}`)

  const spikeResult = await page.evaluate(async () => {
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

    // ---------------------------------------------------------------------------
    // 1. Importar prover-client.js (worker API)
    // ---------------------------------------------------------------------------
    let pc
    try {
      pc = await import('/zk/prover-client.js')
    } catch (e) {
      return { error: `prover-client.js import failed: ${e.message || String(e)}` }
    }

    // ---------------------------------------------------------------------------
    // 2. Cold init (worker + artifacts download)
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
    // 3. Hardcoded valid inputs for policy_tx_1_8 (zero-input case, extDataHash=0)
    //
    //    Generated via:
    //      payroll-proof-gen --zero-input --ext-data-hash 000...0 --dump-inputs
    //
    //    The Rust tool verified the proof locally (verified_locally: true) confirming
    //    these inputs satisfy ALL R1CS constraints of policy_tx_1_8.
    //
    //    Circuit: PolicyTransaction(nIns=1, nOuts=8, nMemberProofs=1, nNonMemberProofs=1,
    //                               levels=10, smtLevels=10)
    //    inAmount=0 -> pool merkle root check disabled (inCheckRoot.enabled <== inAmount)
    //    publicAmount=0 -> amount invariant: 0 + 0 = sum(outAmounts=0)
    //
    //    The flat-key format used here matches what ark-circom's builder.push_input()
    //    uses in Rust, and is accepted by the browser's compute_witness JSON parser,
    //    which flattens nested objects to the same flat-path format.
    // ---------------------------------------------------------------------------
    const inputs = {
      // Public inputs
      root: '0',
      publicAmount: '0',
      extDataHash: '0',
      inputNullifier: ['10750441395378640351657048998234664946407212920486280317664290047085770603502'],
      outputCommitment: [
        '6598968747609044301287791487680131637207335724766472642030855543293332998703',
        '5307568197866304202866682264771277887571928225109364476454523485756312947458',
        '13513549717940813671455596062633255756397017126020655926699419851911902801829',
        '360098509097231575176828263104772092336936958860251011333477615464617839434',
        '3793537864092133166954310424220455378200694657008626939833248800577914997509',
        '21493541725416265409796050211178348092340331544030988121219605160630853240300',
        '13549628593492339367686539431975748442771629846338253914594059917212031874382',
        '10510791208479734664652732474427612827141116544412083058555157277602004730142',
      ],
      membershipRoots: [['21469248025944430904811230013963704341332885446897450976146734701928101288715']],
      nonMembershipRoots: [['0']],

      // Private inputs: input note (inAmount=0, pool Merkle check disabled)
      inAmount: ['0'],
      inPrivateKey: ['424242'],
      inBlinding: ['515151'],
      inPathIndices: ['11'],
      inPathElements: [[
        '0',
        '15621590199821056450610068202457788725601603091791048810523422053872049975191',
        '15180302612178352054084191513289999058431498575847349863917170755410077436260',
        '20846426933296943402289409165716903143674406371782261099735847433924593192150',
        '19570709311100149041770094415303300085749902031216638721752284824736726831172',
        '2228324872857501911302113615008765872803935554954657770529611363966611619305',
        '20416443549622666710233975593556113378154989695856435611928054834435941395398',
        '12569915650234273506358566713337180006575902738181966114015666972516618110668',
        '10760583946844578960511197660626836206814268757087348940265781932673199486090',
        '13259685456536416976294895654007569436222517679987932079162454207895698164241',
      ]],

      // Private inputs: output notes (all zero amounts, fixed pubkeys+blindings)
      outAmount: ['0', '0', '0', '0', '0', '0', '0', '0'],
      outPubkey: ['1000', '1001', '1002', '1003', '1004', '1005', '1006', '1007'],
      outBlinding: ['2000', '2001', '2002', '2003', '2004', '2005', '2006', '2007'],

      // Membership proof (flat-key format matches ark-circom builder.push_input paths)
      // Leaf: poseidon2(pubkey(424242), blinding=0, domainSep=1) - verified by Rust tool
      'membershipProofs[0][0].leaf': '6799258402115901949608087973981428867466362583773158470615191365995989285381',
      'membershipProofs[0][0].blinding': '0',
      'membershipProofs[0][0].pathIndices': '8',
      'membershipProofs[0][0].pathElements': [
        '16820622405745174042249830601237189755928192602553897283642901160942722677198',
        '15359050681704068253727521732087759823223946488317706303920832946299986235400',
        '6671095670782301971433680779252611368794999320551466812674353318786817161024',
        '6916313619167403688849602073223335054266628613380478544182480260933072247447',
        '2879429835226299550189553787486868267114983869369763300964302542438202562182',
        '11566551566833248982804491834987496395634853997927932418962431202486620538724',
        '18312102343585188862241826829911822382205993342087453656483747193932088506816',
        '14224209785328822587607423535934963302697475128513779413243648192259251120844',
        '11095627874297306182376029332709185052812444271679323433770968369044736864771',
        '18704999456835296287788791351223869084488976505945213474169158574576063641344',
      ],

      // Non-membership proof (empty SMT, root=0, isOld0=1)
      // key = pubkey(424242), proving key is NOT in the empty sanctioned-addresses tree
      'nonMembershipProofs[0][0].key': '430441881861402007315334860956977145795171156495387641622836002198432238715',
      'nonMembershipProofs[0][0].oldKey': '0',
      'nonMembershipProofs[0][0].oldValue': '0',
      'nonMembershipProofs[0][0].isOld0': '1',
      'nonMembershipProofs[0][0].siblings': ['0', '0', '0', '0', '0', '0', '0', '0', '0', '0'],
    }

    // ---------------------------------------------------------------------------
    // 4. Prove (N=8) con sorobanFormat=true -> 256 bytes
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
    // 5. verifyProofLocal usando compressed proof
    // ---------------------------------------------------------------------------
    console.log('[spike] Running explicit verify...')
    let verifyResult = false
    let publicInputsHex = []
    try {
      const proveCompressed = await pc.prove(inputs, { sorobanFormat: false })
      // Decode public inputs (14 x 32 bytes LE) to decimal strings for comparison
      const piBytes = proveCompressed.publicInputs
      for (let i = 0; i < piBytes.length; i += 32) {
        const chunk = piBytes.slice(i, i + 32)
        // Convert LE bytes to BigInt
        let val = 0n
        for (let j = 31; j >= 0; j--) {
          val = (val << 8n) | BigInt(chunk[j])
        }
        publicInputsHex.push(val.toString(10))
      }
      console.log('[spike] Public inputs from browser:')
      const piNames = ['root','publicAmount','extDataHash','inputNullifier[0]',
        'outputCommitment[0]','outputCommitment[1]','outputCommitment[2]','outputCommitment[3]',
        'outputCommitment[4]','outputCommitment[5]','outputCommitment[6]','outputCommitment[7]',
        'membershipRoots[0][0]','nonMembershipRoots[0][0]']
      publicInputsHex.forEach((v, i) => console.log(`  [${i}] ${piNames[i] || '?'} = ${v}`))
      verifyResult = await pc.verify(proveCompressed.proof, proveCompressed.publicInputs)
    } catch (err) {
      console.error('[spike] verify failed:', err.message || String(err))
    }
    console.log(`[spike] verifyProofLocal = ${verifyResult}`)

    // ---------------------------------------------------------------------------
    // 6. Warm init — Cache API hit (artifacts already cached)
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
      publicInputsDecimal: publicInputsHex,
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
