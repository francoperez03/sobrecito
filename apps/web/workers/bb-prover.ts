/**
 * bb-prover.ts — Web Worker UltraHonk (bb.js 0.87.0)
 *
 * Reemplaza el worker ark-groth16 (public/zk/worker.js) manteniendo el mismo
 * protocolo de mensajes: { type, messageId, data } / { type, messageId, ...result }
 * y el mismo shape de respuesta de handleProve.
 *
 * Protocolo preservado:
 *   INIT_PROVER  → { success, proverReady }
 *   PROVE        → { success, proof, publicInputs, sorobanFormat, timings }
 *   VERIFY       → { success, verified }
 *   READY        (emitido al cargar)
 *   PROGRESS     (emitido durante INIT_PROVER si demora)
 *
 * Corrección NOIR-05 (09-03):
 *   bb 0.87.0 produce publicInputs como Field[] de 12 elementos; el PPO va
 *   embebido en proof. El blob serializado mide 12 × 32 = 384 bytes.
 *   proof mide 14 592 bytes.
 */

import { UltraHonkBackend } from '@aztec/bb.js'

// ---------------------------------------------------------------------------
// Estado del worker
// ---------------------------------------------------------------------------

let backend: UltraHonkBackend | null = null
let backendReady = false

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convierte un field element hex (con o sin '0x') a un Buffer de 32 bytes BE.
 * Usado para serializar los 12 Field[] de publicInputs a un blob de 384 bytes.
 */
function hexToBytes32(field: string): Uint8Array {
  const hex = field.startsWith('0x') ? field.slice(2) : field
  const padded = hex.padStart(64, '0')
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function sendProgress(
  messageId: string | number | undefined,
  loaded: number,
  total: number,
  message: string,
): void {
  self.postMessage({
    type: 'PROGRESS',
    messageId,
    loaded,
    total,
    message,
    percent: total > 0 ? Math.round((loaded / total) * 100) : 0,
  })
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleInitProver(
  _data: unknown,
  messageId: string | number | undefined,
): Promise<{ success: boolean; proverReady?: boolean; error?: string }> {
  try {
    if (backendReady && backend) {
      return { success: true, proverReady: true }
    }

    sendProgress(messageId, 0, 100, 'Fetching circuit bytecode...')
    const resp = await fetch('/zk/sobre_slim.json')
    if (!resp.ok) {
      throw new Error(`Failed to fetch sobre_slim.json: ${resp.status}`)
    }

    sendProgress(messageId, 30, 100, 'Parsing circuit...')
    const circuitJson = await resp.json() as { bytecode: string }

    sendProgress(messageId, 60, 100, 'Initializing UltraHonk backend...')
    const threads =
      typeof navigator !== 'undefined' && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 1

    backend = new UltraHonkBackend(circuitJson.bytecode, { threads })

    backendReady = true
    sendProgress(messageId, 100, 100, 'Prover ready')
    return { success: true, proverReady: true }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[bb-prover] handleInitProver error:', msg)
    return { success: false, error: msg }
  }
}

async function handleProve(
  data: { inputs: Record<string, unknown>; sorobanFormat?: boolean },
  messageId: string | number | undefined,
): Promise<{
  success: boolean
  proof?: number[]
  publicInputs?: number[]
  sorobanFormat?: boolean
  timings?: Record<string, number>
  error?: string
}> {
  try {
    if (!backendReady || !backend) {
      // Inicialización lazy
      await handleInitProver(null, messageId)
      if (!backend) {
        throw new Error('Backend no inicializado tras lazy init')
      }
    }

    const startTotal = performance.now()

    sendProgress(messageId, 0, 100, 'Generating proof...')
    const proveStart = performance.now()

    const { proof: rawProof, publicInputs: rawPublicInputs } =
      await backend.generateProof(data.inputs)

    const proveMs = performance.now() - proveStart

    // rawProof: Uint8Array (14592 bytes)
    // rawPublicInputs: string[] (Field[], hex strings, 12 elementos con bb 0.87.0)
    // Serializar publicInputs: concatenar los 12 fields como 32-byte BE cada uno => 384 bytes
    const piChunks = rawPublicInputs.map((f: string) => hexToBytes32(f))
    const publicInputsFlat = new Uint8Array(piChunks.length * 32)
    piChunks.forEach((chunk, i) => publicInputsFlat.set(chunk, i * 32))

    const totalMs = performance.now() - startTotal

    console.log(
      `[bb-prover] proof=${rawProof.length} bytes, publicInputs=${publicInputsFlat.length} bytes (${rawPublicInputs.length} fields)`,
    )

    sendProgress(messageId, 100, 100, 'Proof complete')

    return {
      success: true,
      proof: Array.from(rawProof),
      publicInputs: Array.from(publicInputsFlat),
      sorobanFormat: true,
      timings: {
        prove: proveMs,
        total: totalMs,
      },
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[bb-prover] handleProve error:', msg)
    return { success: false, error: msg }
  }
}

async function handleVerify(data: {
  proofBytes: number[]
  publicInputsBytes: number[]
}): Promise<{ success: boolean; verified?: boolean; error?: string }> {
  try {
    if (!backendReady || !backend) {
      return { success: false, error: 'Backend no inicializado' }
    }

    const proofArr = new Uint8Array(data.proofBytes)

    // Deserializar publicInputsBytes (384 bytes BE) de vuelta a Field[] hex para bb.js
    const numFields = data.publicInputsBytes.length / 32
    const pubBytes = new Uint8Array(data.publicInputsBytes)
    const publicInputsFields: string[] = []
    for (let i = 0; i < numFields; i++) {
      const slice = pubBytes.slice(i * 32, i * 32 + 32)
      const hex =
        '0x' +
        Array.from(slice)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      publicInputsFields.push(hex)
    }

    const verified = await backend.verifyProof({
      proof: proofArr,
      publicInputs: publicInputsFields,
    })

    return { success: true, verified }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[bb-prover] handleVerify error:', msg)
    return { success: false, error: msg }
  }
}

// ---------------------------------------------------------------------------
// Dispatcher — mismo protocolo que el worker ark-groth16
// ---------------------------------------------------------------------------

self.onmessage = async (event: MessageEvent) => {
  const { type, messageId, data } = event.data as {
    type: string
    messageId: string | number | undefined
    data: unknown
  }

  let result: Record<string, unknown>

  switch (type) {
    case 'INIT_PROVER':
      result = await handleInitProver(data, messageId)
      break
    case 'PROVE':
      result = await handleProve(
        data as { inputs: Record<string, unknown>; sorobanFormat?: boolean },
        messageId,
      )
      break
    case 'VERIFY':
      result = await handleVerify(
        data as { proofBytes: number[]; publicInputsBytes: number[] },
      )
      break
    default:
      result = { success: false, error: `Unknown message type: ${type}` }
  }

  self.postMessage({ type, messageId, ...result })
}

// Señal de ready al cargar (protocolo preservado)
self.postMessage({ type: 'READY' })
