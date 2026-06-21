/**
 * SPIKE: gasless claim via OZ Channels hosted relayer
 *
 * Verifica que el relayer OZ Channels acepta una SorobanAuthorizationEntry
 * firmada (clave de prueba Ed25519, no Freighter) para pool.transact y
 * paga el fee de la transacción (el empleado no necesita XLM).
 *
 * Mide:
 *   - Validez de la API key (primer indicador de la cuenta)
 *   - Construcción del HostFunction XDR para pool.transact (Approach B: manual)
 *   - Latencia de submitSorobanTransaction (desde la llamada hasta result.hash)
 *   - Si el contrato del pool es aceptado por el endpoint hosted
 *
 * Veredicto:
 *   GO   — tx confirma en testnet Y latencia < 30s
 *   Plan-B — contrato no whitelisted / latencia > 30s / auth entry fallida / key no provisionada
 *
 * Cómo correr (desde la raíz del repo):
 *   RELAYER_API_KEY=<tu-key> node sobrecito/apps/web/scripts/spike-gasless.mjs
 *
 * Cómo obtener la key:
 *   1. Registrarse en https://relayer.openzeppelin.com
 *   2. Crear un proyecto testnet y copiar la API key
 *   3. Confirmar que https://channels.openzeppelin.com/testnet responde 200
 *
 * Notas de disclosure:
 *   - Este spike firma con una clave Ed25519 de prueba (Keypair.random()), NO con
 *     Freighter. El objetivo es probar que el relayer acepta una auth entry firmada
 *     y paga el fee. El plan 02 porta el signing a Freighter.signAuthEntry.
 *   - Prueba ZK de spike: dummy (zeros). El plan 03 conecta la prueba real.
 *   - PoC, no auditado, solo testnet.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Config — leer pool contract id del deployments.json (nunca hardcodeado)
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const deploymentsPath = path.resolve(
  __dirname,
  '../../../ops/deployments/testnet/deployments.json',
)
const deployments = JSON.parse(readFileSync(deploymentsPath, 'utf8'))
const poolId = deployments.pools[0].poolContractId

console.log(`[spike] pool contract id (live from deployments.json): ${poolId}`)

// ---------------------------------------------------------------------------
// API key guard — sin key no hay nada que correr (checkpoint humano A3)
// ---------------------------------------------------------------------------

const RELAYER_API_KEY = process.env.RELAYER_API_KEY
const RELAYER_URL =
  process.env.RELAYER_URL ?? 'https://channels.openzeppelin.com/testnet'

if (!RELAYER_API_KEY) {
  console.error('')
  console.error('[spike] ERROR: RELAYER_API_KEY no está configurada.')
  console.error('[spike] Pasos para obtener la key:')
  console.error('[spike]   1. Registrarse en https://relayer.openzeppelin.com')
  console.error('[spike]   2. Crear un proyecto testnet → copiar la API key')
  console.error('[spike]   3. Confirmar: GET https://channels.openzeppelin.com/testnet → 200')
  console.error('[spike]   4. Correr: RELAYER_API_KEY=<key> node sobrecito/apps/web/scripts/spike-gasless.mjs')
  console.error('')
  process.exit(1)
}

console.log(`[spike] RELAYER_API_KEY presente (${RELAYER_API_KEY.slice(0, 4)}...)`)
console.log(`[spike] RELAYER_URL: ${RELAYER_URL}`)

// ---------------------------------------------------------------------------
// Imports dinámicos — después del guard para que el error de key sea claro
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url)

const {
  ChannelsClient,
  PluginTransportError,
  PluginExecutionError,
  PluginUnexpectedError,
} = await import('@openzeppelin/relayer-plugin-channels')

const {
  Address,
  Keypair,
  Networks,
  SorobanDataBuilder,
  nativeToScVal,
  xdr,
  XdrLargeInt,
  rpc: StellarRpc,
} = await import('@stellar/stellar-sdk')

// ---------------------------------------------------------------------------
// Constantes de testnet
// ---------------------------------------------------------------------------

const NETWORK_PASSPHRASE = Networks.TESTNET
const RPC_URL = 'https://soroban-testnet.stellar.org'
const SPIKE_RECIPIENT = 'GBWJZZ3XSNAY3WLFNLXUZXEEYMZCYVG4TW6Z5VSASJS2TOWF7GGPPKMW' // deployer, prueba
const SPIKE_AMOUNT = BigInt(1) // 1 stroop, spike-grade

console.log(`[spike] network: testnet`)
console.log(`[spike] recipient (spike-grade, no real funds): ${SPIKE_RECIPIENT}`)

// ---------------------------------------------------------------------------
// Helpers de encoding (versión mínima spike-grade)
// ---------------------------------------------------------------------------

function u256(v) {
  return new XdrLargeInt('u256', typeof v === 'bigint' ? v.toString() : String(v)).toScVal()
}

function bytes32(v) {
  return xdr.ScVal.scvBytes(Buffer.alloc(32, 0))
}

function entry(key, val) {
  return new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })
}

/**
 * buildSpikeProofScVal — versión spike-grade con zeros.
 * El objetivo es que el relayer acepte la invocación y pague el fee.
 * Si el contrato requiere una prueba ZK válida para simular, se registra
 * como Plan-B (Critical Unknown #2: contrato no acepta invocación dummy).
 */
function buildSpikeProofScVal() {
  const zeroBytes64 = Buffer.alloc(64, 0)
  const zeroBytes128 = Buffer.alloc(128, 0)
  const groth16Proof = xdr.ScVal.scvMap([
    entry('a', xdr.ScVal.scvBytes(zeroBytes64)),
    entry('b', xdr.ScVal.scvBytes(zeroBytes128)),
    entry('c', xdr.ScVal.scvBytes(zeroBytes64)),
  ])
  return xdr.ScVal.scvMap([
    entry('asp_membership_root', u256(0n)),
    entry('asp_non_membership_root', u256(0n)),
    entry('ext_data_hash', xdr.ScVal.scvBytes(Buffer.alloc(32, 0))),
    entry('input_nullifiers', xdr.ScVal.scvVec([u256(0n)])),
    entry('output_commitments', xdr.ScVal.scvVec(Array(8).fill(u256(0n)))),
    entry('proof', groth16Proof),
    entry('public_amount', u256(SPIKE_AMOUNT)),
    entry('root', u256(0n)),
  ])
}

function buildSpikeExtDataScVal() {
  return nativeToScVal(
    {
      encrypted_outputs: xdr.ScVal.scvVec([]),
      ext_amount: nativeToScVal((-SPIKE_AMOUNT).toString(), { type: 'i256' }),
      recipient: new Address(SPIKE_RECIPIENT).toScVal(),
    },
    {
      type: {
        encrypted_outputs: ['symbol', null],
        ext_amount: ['symbol', null],
        recipient: ['symbol', null],
      },
    },
  )
}

// ---------------------------------------------------------------------------
// Spike body — build func XDR + sign auth entry + submit + verdict
// ---------------------------------------------------------------------------

/**
 * Construye el HostFunction XDR para pool.transact (spike-grade).
 * Approach B: construcción manual de InvokeContractArgs con una prueba dummy.
 * El relayer puede rechazar si el contrato exige simulación válida
 * (Critical Unknown #2); eso se registra como Plan-B.
 */
function buildPoolTransactHostFunctionXdr() {
  const proofArg = buildSpikeProofScVal()
  const extDataArg = buildSpikeExtDataScVal()
  const recipientScVal = new Address(SPIKE_RECIPIENT).toScVal()

  const hf = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: new Address(poolId).toScAddress(),
      functionName: 'transact',
      args: [proofArg, extDataArg, recipientScVal],
    }),
  )
  return hf.toXDR('base64')
}

/**
 * Construye una SorobanAuthorizationEntry para el test keypair.
 *
 * Approach B (plan 08-01 Task 2 step 2): construcción manual con
 * xdr.SorobanAuthorizationEntry. Usada en el spike con una clave Ed25519
 * de prueba en lugar de Freighter (que necesita la extensión del browser).
 * El plan 02 porta esta lógica a Freighter.signAuthEntry.
 *
 * Approach A (authorizeEntry del SDK) queda documentada como alternativa;
 * el spike prueba B primero por ser más directa para Node.
 *
 * Critical Unknown #1: ¿puede construirse la auth entry sin simular contra
 * la cuenta canal del relayer? Este spike valida que sí (Approach B).
 */
async function buildAndSignAuthEntry(testKey, funcXdrBase64, currentLedger) {
  // T-08-03 mitigation: signatureExpirationLedger = currentLedger + 200 (~10 min)
  const signatureExpirationLedger = currentLedger + 200
  console.log(`[spike] signatureExpirationLedger = ${signatureExpirationLedger} (current + 200)`)

  // Construir el InvocationTree para pool.transact
  const contractInvocation = xdr.SorobanAuthorizedInvocation.sorobanAuthorizedInvocationV0(
    new xdr.SorobanAuthorizedInvocationV0({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(poolId).toScAddress(),
          functionName: 'transact',
          args: [],  // args vacíos en el auth tree (el relayer los obtiene del func XDR)
        }),
      ),
      subInvocations: [],
    }),
  )

  // Preimage de la auth entry para firmar
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: Buffer.from(
        require('node:crypto').createHash('sha256').update(NETWORK_PASSPHRASE).digest(),
      ),
      nonce: BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)),
      signatureExpirationLedger,
      invocation: contractInvocation,
    }),
  )

  const preimageBytes = preimage.toXDR()
  const { createHash } = require('node:crypto')
  const preimageHash = createHash('sha256').update(preimageBytes).digest()

  // Firmar con la clave de prueba (Ed25519, no Freighter)
  const signature = testKey.sign(preimageHash)

  // Construir la SorobanAuthorizationEntry firmada
  const authEntry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(testKey.publicKey()).toScAddress(),
        nonce: preimage.value().nonce(),
        signatureExpirationLedger,
        signature: xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('public_key'),
            val: xdr.ScVal.scvBytes(testKey.rawPublicKey()),
          }),
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('signature'),
            val: xdr.ScVal.scvBytes(signature),
          }),
        ]),
      }),
    ),
    rootInvocation: contractInvocation,
  })

  return authEntry.toXDR('base64')
}

async function runSpike() {
  const t0 = performance.now()

  // 1. Test keypair (spike-grade, throwaway — T-08-04: no clave de producción)
  const testKey = Keypair.random()
  console.log(`[spike] test keypair (throwaway): ${testKey.publicKey()}`)

  // 2. Obtener ledger actual del RPC para calcular signatureExpirationLedger
  let currentLedger
  try {
    const server = new StellarRpc.Server(RPC_URL)
    const latestLedger = await server.getLatestLedger()
    currentLedger = latestLedger.sequence
    console.log(`[spike] current ledger: ${currentLedger}`)
  } catch (err) {
    console.error(`[spike] ERROR: no se pudo obtener ledger actual: ${err.message}`)
    process.exit(1)
  }

  // 3. Construir HostFunction XDR (Approach B, manual InvokeContractArgs)
  // Critical Unknown #1 probe: construir sin simular contra la cuenta canal
  console.log('[spike] Construyendo HostFunction XDR para pool.transact (Approach B)...')
  const funcXdr = buildPoolTransactHostFunctionXdr()
  console.log(`[spike] funcXdr length (base64): ${funcXdr.length}`)
  console.log(`[spike] funcXdr contains hostFunctionTypeInvokeContract: verificado en código`)

  // 4. Construir y firmar SorobanAuthorizationEntry (Approach B: manual)
  console.log('[spike] Construyendo SorobanAuthorizationEntry (Approach B: manual + clave prueba)...')
  let signedAuthEntryBase64
  let authApproach = 'B-manual-test-key'
  try {
    signedAuthEntryBase64 = await buildAndSignAuthEntry(testKey, funcXdr, currentLedger)
    console.log(`[spike] auth entry construida OK (Approach ${authApproach})`)
    console.log(`[spike] signedAuthEntry length (base64): ${signedAuthEntryBase64.length}`)
  } catch (err) {
    console.error(`[spike] ERROR construyendo auth entry (Approach B): ${err.message}`)
    console.error('[spike] Plan-B trigger: auth entry construction failed')
    process.exit(1)
  }

  // 5. Inicializar ChannelsClient
  const client = new ChannelsClient({
    baseUrl: RELAYER_URL,
    apiKey: RELAYER_API_KEY,
  })
  console.log(`[spike] ChannelsClient creado (baseUrl: ${RELAYER_URL})`)

  // 6. Submit con medición de latencia
  // T-08-02 mitigation: el func XDR ya tiene el poolId codificado en contractAddress
  let submitResult
  let submitMs
  let poolAccepted = false
  let txHash = null
  let apiKeyValid = false
  let errorCode = null
  let errorClass = null

  console.log('[spike] Llamando submitSorobanTransaction (skipWait: false)...')
  const tSubmit = performance.now()

  try {
    submitResult = await client.submitSorobanTransaction({
      func: funcXdr,
      auth: [signedAuthEntryBase64],
      skipWait: false,
    })
    submitMs = performance.now() - tSubmit
    poolAccepted = true
    apiKeyValid = true
    txHash = submitResult.hash
    console.log(`[spike] submitSorobanTransaction OK en ${(submitMs / 1000).toFixed(2)}s`)
    console.log(`[spike] txHash: ${txHash}`)
    console.log(`[spike] latestLedger: ${submitResult.latestLedger}`)
    console.log(`[spike] status: ${submitResult.status}`)
  } catch (err) {
    submitMs = performance.now() - tSubmit

    if (err instanceof PluginTransportError) {
      errorClass = 'PluginTransportError'
      errorCode = err.statusCode ?? 'unknown'
      apiKeyValid = errorCode !== 401
      console.error(`[spike] PluginTransportError (status ${errorCode}): ${err.message}`)
      if (errorCode === 401) {
        console.error('[spike] Plan-B trigger: API key inválida (401 Unauthorized)')
      } else {
        console.error('[spike] Plan-B trigger: error de transporte (red / endpoint)')
      }
    } else if (err instanceof PluginExecutionError) {
      errorClass = 'PluginExecutionError'
      errorCode = err.errorDetails?.code ?? 'unknown'
      apiKeyValid = true  // 401 es PluginTransportError, no PluginExecutionError
      console.error(`[spike] PluginExecutionError (code ${errorCode}): ${err.message}`)
      if (errorCode === 'INVALID_PARAMS' || errorCode === 'CONTRACT_NOT_ALLOWED') {
        console.error('[spike] Plan-B trigger: contrato no whitelisted — considerar self-host del relayer')
      } else if (errorCode === 'ONCHAIN_FAILED') {
        console.error('[spike] Plan-B trigger: auth entry falló on-chain — revisar construcción (Approach A con authorizeEntry)')
      } else {
        console.error(`[spike] Plan-B trigger: ejecución rechazada (${errorCode})`)
      }
    } else if (err instanceof PluginUnexpectedError) {
      errorClass = 'PluginUnexpectedError'
      apiKeyValid = true
      console.error(`[spike] PluginUnexpectedError: ${err.message}`)
      console.error('[spike] Plan-B trigger: error inesperado del plugin')
    } else {
      errorClass = 'UnexpectedError'
      console.error(`[spike] Error inesperado (no plugin): ${err.message}`)
      console.error('[spike] Stack:', err.stack)
    }
  }

  const totalMs = performance.now() - t0

  // ---------------------------------------------------------------------------
  // Bloque de resultados estructurado
  // ---------------------------------------------------------------------------

  const spikeResult = {
    // Critical Unknown #5: API key válida
    apiKeyValid,
    // Critical Unknown #1: qué approach de auth entry funcionó
    authApproach,
    // Critical Unknown #2: contrato pool aceptado por el relayer
    poolAccepted,
    // Resultado de la tx
    txHash,
    // Critical Unknown #3: latencia
    submitMs: Math.round(submitMs),
    // Ledger y status si hubo éxito
    latestLedger: submitResult?.latestLedger ?? null,
    status: submitResult?.status ?? null,
    // Error si hubo fallo
    errorClass,
    errorCode,
    // Metadata
    currentLedger,
    signatureExpirationLedger: currentLedger + 200,
    poolId,
    relayerUrl: RELAYER_URL,
    totalMs: Math.round(totalMs),
  }

  console.log('\n=== SPIKE RESULTS ===')
  console.log(JSON.stringify(spikeResult, null, 2))
  console.log('====================\n')

  // ---------------------------------------------------------------------------
  // Veredicto GO / Plan-B
  // ---------------------------------------------------------------------------

  const latencySeconds = submitMs / 1000

  if (!apiKeyValid) {
    console.error('Plan-B: API key inválida (401). Provisionar en https://relayer.openzeppelin.com.\n')
    process.exit(1)
  }

  if (!poolAccepted) {
    if (errorCode === 'INVALID_PARAMS' || errorCode === 'CONTRACT_NOT_ALLOWED') {
      console.warn(`Plan-B: contrato pool no whitelisted (${errorCode}). Recomendación: self-host del OZ Relayer.\n`)
    } else if (errorCode === 'ONCHAIN_FAILED') {
      console.warn('Plan-B: auth entry falló on-chain. Investigar construcción (probar Approach A con authorizeEntry del SDK).\n')
    } else {
      console.warn(`Plan-B: relayer rechazó la tx (${errorClass} ${errorCode}). Revisar logs del relayer.\n`)
    }
    process.exit(1)
  }

  if (latencySeconds > 30) {
    console.warn(`Plan-B: latencia ${latencySeconds.toFixed(1)}s excede el umbral de 30s. Considerar skipWait:true + polling o documentar en UX.\n`)
  } else {
    console.log(`GO: relayer aceptó pool.transact, tx ${txHash} confirmada en ${latencySeconds.toFixed(1)}s (< 30s umbral). Approach auth entry: ${authApproach}. Desbloquea planes 08-02 y 08-03.\n`)
  }
}

await runSpike()
