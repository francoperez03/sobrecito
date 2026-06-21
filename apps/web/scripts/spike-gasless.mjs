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
// Spike body (implementado en Task 2)
// ---------------------------------------------------------------------------

async function runSpike() {
  console.log('[spike] spike body placeholder — ver Task 2 (spike body no implementado aún)')
  console.log('[spike] Spike header completo: pool id cargado, API key presente.')
}

await runSpike()
