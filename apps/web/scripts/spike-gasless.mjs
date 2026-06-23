/**
 * SPIKE: gasless claim via OZ Channels plugin (self-hosted relayer)
 *
 * Verifica que el OZ Relayer auto-hospedado (con el Channels plugin) acepta
 * una SorobanAuthorizationEntry firmada con una clave Ed25519 de prueba para
 * pool.transact y paga el fee — el empleado no necesita XLM.
 *
 * Mide:
 *   - Validez de la API key (header x-api-key)
 *   - Construcción del HostFunction XDR para pool.transact (Approach B: manual)
 *   - Latencia de submitSorobanTransaction (desde la llamada hasta result.hash)
 *   - Si el contrato del pool es aceptado por el relayer
 *
 * Veredicto:
 *   GO     — tx confirma en testnet Y latencia < 30s
 *   Plan-B — contrato rechazado / latencia > 30s / auth entry fallida /
 *            relayer no disponible / API key ausente
 *
 * Cómo correr (desde la raíz del repo):
 *   RELAYER_URL=http://localhost:8080 RELAYER_API_KEY=<tu-key> \
 *     node sobrecito/apps/web/scripts/spike-gasless.mjs
 *
 * Cómo levantar el relayer:
 *   Ver sobrecito/apps/web/scripts/RELAYER-SETUP.md
 *
 * Modo managed (alternativa):
 *   Obtener key en https://channels.openzeppelin.com/testnet/gen y usar:
 *   RELAYER_URL=https://channels.openzeppelin.com/testnet RELAYER_API_KEY=<key> ...
 *   (En modo managed se omite pluginId — ver comentario inline.)
 *
 * Notas de disclosure:
 *   - Firma con una clave Ed25519 de prueba (Keypair.random()), no Freighter.
 *     El objetivo es probar que el relayer acepta auth entry + paga el fee.
 *     Plan 02 porta el signing a Freighter.signAuthEntry.
 *   - Prueba ZK de spike: dummy (zeros). Plan 03 conecta la prueba real.
 *   - PoC, no auditado, solo testnet.
 */

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
// Env guards — sin URL y API key no hay nada que correr
// ---------------------------------------------------------------------------

const RELAYER_URL = process.env.RELAYER_URL ?? 'http://localhost:8080'
const RELAYER_API_KEY = process.env.RELAYER_API_KEY

// Detectar si es managed (channels.openzeppelin.com) o self-hosted (localhost / custom)
const IS_MANAGED = RELAYER_URL.includes('channels.openzeppelin.com')

if (!RELAYER_API_KEY) {
  console.error('')
  console.error('[spike] ERROR: RELAYER_API_KEY no está configurada.')
  if (IS_MANAGED) {
    console.error('[spike] Para el servicio managed de OZ:')
    console.error('[spike]   1. Obtener key (self-serve): GET https://channels.openzeppelin.com/testnet/gen')
    console.error('[spike]   2. RELAYER_API_KEY=<key> node sobrecito/apps/web/scripts/spike-gasless.mjs')
  } else {
    console.error('[spike] Para el relayer self-hosted:')
    console.error('[spike]   1. Seguir sobrecito/apps/web/scripts/RELAYER-SETUP.md')
    console.error('[spike]   2. Definir RELAYER_API_KEY con el Bearer token del relayer')
    console.error('[spike]   3. RELAYER_URL=http://localhost:8080 RELAYER_API_KEY=<key> node ...')
  }
  console.error('')
  process.exit(1)
}

console.log(`[spike] RELAYER_URL: ${RELAYER_URL}`)
console.log(`[spike] RELAYER_API_KEY: ${RELAYER_API_KEY.slice(0, 4)}...`)
console.log(`[spike] modo: ${IS_MANAGED ? 'managed (channels.openzeppelin.com)' : 'self-hosted'}`)

// ---------------------------------------------------------------------------
// Imports dinámicos — después de los guards para que los errores sean claros
// ---------------------------------------------------------------------------

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
const SPIKE_RECIPIENT = deployments.deployer // address conocida, spike-grade
const SPIKE_AMOUNT = BigInt(1) // 1 stroop, spike-grade

console.log(`[spike] network: testnet`)
console.log(`[spike] recipient (spike-grade, deployer address): ${SPIKE_RECIPIENT}`)

// ---------------------------------------------------------------------------
// Helpers de encoding — versión spike-grade con zeros en la prueba ZK
// ---------------------------------------------------------------------------

function u256(v) {
  return new XdrLargeInt('u256', typeof v === 'bigint' ? v.toString() : String(v)).toScVal()
}

function entry(key, val) {
  return new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })
}

/**
 * buildSpikeProofScVal — prueba ZK con zeros (spike-grade).
 *
 * El objetivo del spike es validar que el relayer acepta la invocación y
 * paga el fee. Si la simulación del contrato requiere una prueba ZK válida,
 * eso se registra como Plan-B (SIMULATION_FAILED — Critical Unknown #2).
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
// HostFunction XDR para pool.transact
// T-08-02 mitigation: poolId codificado en contractAddress (el relayer no puede redirigir)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SorobanAuthorizationEntry (Approach B: manual + test key)
//
// Critical Unknown #1: ¿se puede construir la auth entry sin simular contra
// la cuenta canal del relayer? Este spike valida que sí (Approach B).
//
// T-08-03 mitigation: signatureExpirationLedger = currentLedger + 200 (~10 min).
// El plugin valida que el buffer sea >= MIN_SIGNATURE_EXPIRATION_LEDGER_BUFFER
// (default: 2 ledgers). Con +200 hay margen suficiente.
//
// En producción (plan 02) Freighter.signAuthEntry hace este paso con la clave
// real del empleado; aquí se usa una clave throwaway (T-08-04).
// ---------------------------------------------------------------------------

async function buildAndSignAuthEntry(testKey, currentLedger) {
  const signatureExpirationLedger = currentLedger + 200
  console.log(`[spike] signatureExpirationLedger = ${signatureExpirationLedger} (current + 200)`)

  const contractFn = xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
    new xdr.InvokeContractArgs({
      contractAddress: new Address(poolId).toScAddress(),
      functionName: 'transact',
      args: [],
    }),
  )
  const invocation = xdr.SorobanAuthorizedInvocation.sorobanAuthorizedInvocationV0(
    new xdr.SorobanAuthorizedInvocationV0({
      function: contractFn,
      subInvocations: [],
    }),
  )

  // Nonce aleatorio (i64)
  const nonceBytes = Buffer.alloc(8)
  for (let i = 0; i < 8; i++) nonceBytes[i] = Math.floor(Math.random() * 256)
  const nonce = nonceBytes.readBigInt64BE(0)

  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: Buffer.from(createHash('sha256').update(NETWORK_PASSPHRASE).digest()),
      nonce,
      signatureExpirationLedger,
      invocation,
    }),
  )

  const preimageHash = createHash('sha256').update(preimage.toXDR()).digest()
  const signature = testKey.sign(preimageHash)

  const authEntry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(testKey.publicKey()).toScAddress(),
        nonce,
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
    rootInvocation: invocation,
  })

  return authEntry.toXDR('base64')
}

// ---------------------------------------------------------------------------
// Spike body principal
// ---------------------------------------------------------------------------

async function runSpike() {
  const t0 = performance.now()

  // Clave de prueba throwaway (T-08-04: no clave de producción)
  const testKey = Keypair.random()
  console.log(`[spike] test keypair (throwaway): ${testKey.publicKey()}`)

  // Obtener ledger actual
  let currentLedger
  try {
    const server = new StellarRpc.Server(RPC_URL)
    const latest = await server.getLatestLedger()
    currentLedger = latest.sequence
    console.log(`[spike] current ledger: ${currentLedger}`)
  } catch (err) {
    console.error(`[spike] ERROR: no se pudo obtener ledger actual del RPC: ${err.message}`)
    process.exit(1)
  }

  // HostFunction XDR
  console.log('[spike] Construyendo HostFunction XDR para pool.transact...')
  const funcXdr = buildPoolTransactHostFunctionXdr()
  console.log(`[spike] funcXdr OK (base64, ${funcXdr.length} chars)`)

  // SorobanAuthorizationEntry firmada
  console.log('[spike] Construyendo SorobanAuthorizationEntry (Approach B: manual + clave prueba)...')
  let signedAuthEntryBase64
  try {
    signedAuthEntryBase64 = await buildAndSignAuthEntry(testKey, currentLedger)
    console.log(`[spike] auth entry OK (${signedAuthEntryBase64.length} chars base64)`)
  } catch (err) {
    console.error(`[spike] ERROR construyendo auth entry: ${err.message}`)
    console.error('[spike] Plan-B trigger: auth entry construction failed')
    process.exit(1)
  }

  // ChannelsClient:
  //   - Self-hosted: pluginId requerido (enruta a /api/v1/plugins/channels/call)
  //   - Managed: sin pluginId (endpoint directo, con load balancer de OZ)
  const clientConfig = IS_MANAGED
    ? { baseUrl: RELAYER_URL, apiKey: RELAYER_API_KEY }
    : { baseUrl: RELAYER_URL, pluginId: 'channels', apiKey: RELAYER_API_KEY }

  const client = new ChannelsClient(clientConfig)
  console.log(`[spike] ChannelsClient creado (pluginId: ${clientConfig.pluginId ?? 'none (managed)'})`)

  // Submit
  let submitResult
  let submitMs = 0
  let poolAccepted = false
  let txHash = null
  let txStatus = null
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
    txStatus = submitResult.status
    console.log(`[spike] submitSorobanTransaction OK en ${(submitMs / 1000).toFixed(2)}s`)
    console.log(`[spike] txHash: ${txHash}`)
    console.log(`[spike] status: ${txStatus}`)
    console.log(`[spike] transactionId: ${submitResult.transactionId}`)
  } catch (err) {
    submitMs = performance.now() - tSubmit

    if (err instanceof PluginTransportError) {
      errorClass = 'PluginTransportError'
      errorCode = String(err.statusCode ?? 'unknown')
      apiKeyValid = errorCode !== '401'
      console.error(`[spike] PluginTransportError (status ${errorCode}): ${err.message}`)
      if (errorCode === '401') {
        console.error('[spike] Plan-B trigger: API key inválida (401 Unauthorized)')
      } else {
        console.error(`[spike] Plan-B trigger: error de transporte (${errorCode}). ¿Está corriendo el relayer en ${RELAYER_URL}?`)
      }
    } else if (err instanceof PluginExecutionError) {
      errorClass = 'PluginExecutionError'
      errorCode = err.errorDetails?.code ?? 'unknown'
      apiKeyValid = true
      console.error(`[spike] PluginExecutionError (code ${errorCode}): ${err.message}`)
      if (errorCode === 'SIMULATION_FAILED' || errorCode === 'INVALID_PARAMS') {
        console.error('[spike] Plan-B trigger: simulación rechazó proof dummy (Critical Unknown #2).')
        console.error('[spike]   El contrato puede requerir una prueba ZK válida para simular.')
      } else if (errorCode === 'AUTH_EXPIRY_TOO_SHORT') {
        console.error('[spike] Plan-B trigger: signatureExpirationLedger muy corto para el relayer.')
      } else if (errorCode === 'NO_CHANNELS_CONFIGURED') {
        console.error('[spike] Plan-B trigger: channel accounts no configuradas. Completar RELAYER-SETUP.md §setChannelAccounts.')
      } else if (errorCode === 'ONCHAIN_FAILED') {
        console.error('[spike] Plan-B trigger: auth entry falló on-chain. Investigar Approach A (authorizeEntry del SDK).')
      } else {
        console.error(`[spike] Plan-B trigger: ejecución rechazada (${errorCode})`)
      }
    } else if (err instanceof PluginUnexpectedError) {
      errorClass = 'PluginUnexpectedError'
      apiKeyValid = true
      console.error(`[spike] PluginUnexpectedError: ${err.message}`)
    } else {
      errorClass = 'UnknownError'
      console.error(`[spike] Error inesperado: ${err.message}`)
      console.error('[spike] Stack:', err.stack)
    }
  }

  const totalMs = performance.now() - t0

  // ---------------------------------------------------------------------------
  // Bloque de resultados estructurado
  // ---------------------------------------------------------------------------

  const spikeResult = {
    apiKeyValid,
    authApproach: 'B-manual-test-key',
    poolAccepted,
    txHash,
    txStatus,
    submitMs: Math.round(submitMs),
    errorClass,
    errorCode,
    currentLedger,
    signatureExpirationLedger: currentLedger + 200,
    poolId,
    relayerUrl: RELAYER_URL,
    relayerMode: IS_MANAGED ? 'managed' : 'self-hosted',
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
    console.error('Plan-B: API key inválida (401). Verificar RELAYER_API_KEY contra el relayer configurado.\n')
    process.exit(1)
  }

  if (!poolAccepted) {
    if (errorCode === 'SIMULATION_FAILED' || errorCode === 'INVALID_PARAMS') {
      console.warn(`Plan-B: simulación rechazó la invocación (${errorCode}). El contrato puede requerir proof ZK válida para simular. Evaluar si se necesita generar proof real antes del spike o usar el smoke test contract del ejemplo oficial.\n`)
    } else if (errorCode === 'AUTH_EXPIRY_TOO_SHORT') {
      console.warn('Plan-B: auth entry expira muy pronto según el relayer. Ajustar el buffer.\n')
    } else if (errorCode === 'NO_CHANNELS_CONFIGURED') {
      console.warn('Plan-B: channel accounts no configuradas. Completar el paso setChannelAccounts de RELAYER-SETUP.md.\n')
    } else if (errorCode === 'ONCHAIN_FAILED') {
      console.warn('Plan-B: auth entry falló on-chain. Investigar construcción — probar Approach A (authorizeEntry del SDK).\n')
    } else if (errorClass === 'PluginTransportError') {
      console.warn(`Plan-B: relayer no disponible (${errorCode}). Verificar que esté corriendo en ${RELAYER_URL}.\n`)
    } else {
      console.warn(`Plan-B: relayer rechazó la tx (${errorClass} / ${errorCode}). Ver logs del relayer.\n`)
    }
    process.exit(1)
  }

  if (latencySeconds > 30) {
    console.warn(`Plan-B: latencia ${latencySeconds.toFixed(1)}s excede el umbral de 30s. Considerar skipWait:true + polling, o documentar en UX.\n`)
  } else {
    console.log(`GO: relayer aceptó pool.transact, tx ${txHash} con status "${txStatus}" en ${latencySeconds.toFixed(1)}s (< 30s umbral). Auth approach: B-manual-test-key. Desbloquea planes 08-02 y 08-03.\n`)
  }
}

await runSpike()
