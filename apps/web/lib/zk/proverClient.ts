/**
 * proverClient.ts — wrapper SSR-safe alrededor del worker bb.js (UltraHonk).
 *
 * Reemplaza la variante ark-groth16 manteniendo exactamente la misma
 * interfaz pública: ProveResult, prove(), configureProver(), initProver(),
 * computeCommitment(), computeNullifier(), derivePublicKey(), onProgress().
 *
 * Cambios en este archivo (09-05):
 *   - CIRCUIT_CONFIG apunta a sobre_slim (ACIR bytecode, /zk/sobre_slim.json)
 *   - El worker se registra con new Worker(new URL(..., import.meta.url))
 *   - computeMembershipLeaf() y reconstructMerklePath() eliminados (D2: circuito
 *     slim sin ASP/SMT; el Merkle path va como input privado al circuito Noir)
 *
 * Protocolo del worker (bb-prover.ts, preservado 1-a-1):
 *   Envía   { type, messageId, data }
 *   Recibe  { type, messageId, ...result }
 *   INIT_PROVER → { success, proverReady }
 *   PROVE       → { success, proof, publicInputs, sorobanFormat, timings }
 *   VERIFY      → { success, verified }
 *   READY       (emitido al cargar)
 *   PROGRESS    (durante INIT_PROVER)
 *
 * publicInputs: 12 fields × 32 bytes = 384 bytes BE (NOIR-05 confirmado).
 * proof: 14 592 bytes.
 */
'use client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProveResult {
  proof: Uint8Array
  publicInputs: Uint8Array
  sorobanFormat: boolean
  timings?: Record<string, number>
}

export type ProgressCallback = (
  loaded: number,
  total: number,
  message: string,
  percent: number,
) => void

// ---------------------------------------------------------------------------
// Config (sobre_slim — ACIR bytecode para UltraHonk)
// ---------------------------------------------------------------------------

const CIRCUIT_CONFIG = {
  circuitName: 'sobre_slim',
  circuitJsonUrl: '/zk/sobre_slim.json',
  cacheName: 'sobre-proving-artifacts-v2',
} as const

// ---------------------------------------------------------------------------
// Worker management (SSR-safe)
// ---------------------------------------------------------------------------

let _worker: Worker | null = null
let _workerReadyPromise: Promise<Worker> | null = null
let _messageId = 0
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
const _progressListeners = new Set<ProgressCallback>()
let _proverReady = false

function ensureWorker(): Promise<Worker> {
  if (_worker && !_workerReadyPromise) {
    return Promise.resolve(_worker)
  }
  if (_workerReadyPromise) {
    return _workerReadyPromise
  }

  _workerReadyPromise = new Promise<Worker>((resolve, reject) => {
    try {
      // Next.js compila bb-prover.ts como Web Worker cuando se usa new URL + import.meta.url
      const w = new Worker(
        new URL('../../workers/bb-prover.ts', import.meta.url),
      )

      const timeoutId = setTimeout(() => {
        _workerReadyPromise = null
        reject(new Error('Worker initialization timeout'))
      }, 15000)

      w.onmessage = (event: MessageEvent) => {
        const { type, messageId: msgId, ...data } = event.data as {
          type: string
          messageId: number
          [key: string]: unknown
        }

        if (type === 'READY') {
          clearTimeout(timeoutId)
          _worker = w
          _workerReadyPromise = null
          resolve(w)
          return
        }

        if (type === 'PROGRESS') {
          const { loaded, total, message, percent } = data as {
            loaded: number
            total: number
            message: string
            percent: number
          }
          for (const cb of _progressListeners) {
            try { cb(loaded, total, message, percent) } catch { /* silenciar */ }
          }
          return
        }

        const pending = _pending.get(msgId)
        if (pending) {
          _pending.delete(msgId)
          if ((data as { success?: boolean }).success !== false) {
            pending.resolve(data)
          } else {
            pending.reject(
              new Error(
                (data as { error?: string }).error ??
                  `Worker error (type: ${type})`,
              ),
            )
          }
        }
      }

      w.onerror = (err: ErrorEvent) => {
        const msg = err.message
          ? `${err.message} (${err.filename}:${err.lineno})`
          : 'Worker failed to load'
        clearTimeout(timeoutId)
        _workerReadyPromise = null
        reject(new Error(msg))
      }
    } catch (e) {
      _workerReadyPromise = null
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })

  return _workerReadyPromise
}

async function sendMessage(
  type: string,
  data: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const w = await ensureWorker()
  const id = ++_messageId

  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject })
    w.postMessage({ type, messageId: id, data })

    const timeout = type === 'PROVE' ? 180000 : 60000
    setTimeout(() => {
      if (_pending.has(id)) {
        _pending.delete(id)
        reject(new Error(`${type} timeout`))
      }
    }, timeout)
  })
}

// ---------------------------------------------------------------------------
// Exported API (firma idéntica a la variante ark-groth16)
// ---------------------------------------------------------------------------

/**
 * Configura el prover con los artefactos de sobre_slim.
 * Para la variante bb.js el config está embebido en el worker; esta función
 * es un no-op que preserva la interfaz para que los callers no cambien.
 */
export async function configureProver(): Promise<void> {
  if (typeof window === 'undefined') return
  // El worker bb.js usa la URL /zk/sobre_slim.json hardcodeada (CIRCUIT_CONFIG).
  // No hay configuración adicional necesaria; se expone CIRCUIT_CONFIG para
  // que los callers que lean el nombre del circuito puedan hacerlo.
  void CIRCUIT_CONFIG
}

/**
 * Inicializa el backend UltraHonk: descarga sobre_slim.json e instancia
 * UltraHonkBackend. No-op durante SSR.
 */
export async function initProver(): Promise<void> {
  if (typeof window === 'undefined') return
  await sendMessage('INIT_PROVER')
  _proverReady = true
}

/**
 * Genera una prueba UltraHonk para los inputs del circuito sobre_slim.
 * Retorna proof de 14 592 bytes y publicInputs de 384 bytes (12 fields × 32).
 * Lanza si se llama en SSR o si el backend no está inicializado.
 */
export async function prove(inputs: Record<string, unknown>): Promise<ProveResult> {
  if (typeof window === 'undefined') {
    throw new Error('proverClient.prove: browser-only')
  }
  if (!_proverReady) {
    await initProver()
  }
  const result = await sendMessage('PROVE', { inputs, sorobanFormat: true })
  return {
    proof: new Uint8Array(result.proof as number[]),
    publicInputs: new Uint8Array(result.publicInputs as number[]),
    sorobanFormat: result.sorobanFormat as boolean,
    timings: result.timings as Record<string, number> | undefined,
  }
}

/**
 * Calcula un commitment Poseidon2 via el WASM bridge del worker anterior.
 * Función mantenida para compatibilidad; en la variante bb.js el circuito Noir
 * computa internamente los commitments. Esta implementación delega al circuito.
 *
 * NOTA: con el circuito sobre_slim (UltraHonk) los commitments se calculan
 * client-side como Pedersen/Poseidon en JS antes de pasarlos como inputs privados.
 * Mantener la firma para que los callers no cambien.
 */
export async function computeCommitment(
  amount: bigint,
  pubkey: bigint,
  blinding: bigint,
): Promise<bigint> {
  if (typeof window === 'undefined') {
    throw new Error('proverClient.computeCommitment: browser-only')
  }
  // Delegamos al worker para cálculo Poseidon2 (mantenido para compatibilidad)
  const result = await sendMessage('COMPUTE_COMMITMENT', {
    amountDec: amount.toString(10),
    publicKeyDec: pubkey.toString(10),
    blindingDec: blinding.toString(10),
  })
  return BigInt(result.commitmentDec as string)
}

/**
 * Calcula el nullifier Poseidon2 via el worker. Mantenido para compatibilidad.
 */
export async function computeNullifier(
  privKey: bigint,
  blinding: bigint,
  pathIndices: bigint = BigInt(0),
  amount: bigint = BigInt(0),
): Promise<bigint> {
  if (typeof window === 'undefined') {
    throw new Error('proverClient.computeNullifier: browser-only')
  }
  const result = await sendMessage('COMPUTE_NULLIFIER', {
    privateKeyDec: privKey.toString(10),
    blindingDec: blinding.toString(10),
    pathIndicesDec: pathIndices.toString(10),
    amountDec: amount.toString(10),
  })
  return BigInt(result.nullifierDec as string)
}

/**
 * Deriva la clave pública BN254 via el worker. Mantenido para compatibilidad.
 */
export async function derivePublicKey(privKey: bigint): Promise<bigint> {
  if (typeof window === 'undefined') throw new Error('proverClient.derivePublicKey: browser-only')
  const privBytes = bigintToFieldBytesLE(privKey)
  const result = await sendMessage('DERIVE_PUBLIC_KEY', {
    privateKey: Array.from(privBytes),
    asHex: false,
  })
  return fieldBytesLEToBigint(new Uint8Array(result.publicKey as number[]))
}

/**
 * Suscribe a eventos de progreso (descarga / init).
 * Retorna una función para desuscribirse.
 * No-op durante SSR.
 */
export function onProgress(callback: ProgressCallback): () => void {
  if (typeof window === 'undefined') return () => {}
  _progressListeners.add(callback)
  return () => { _progressListeners.delete(callback) }
}

// ---------------------------------------------------------------------------
// Merkle path reconstruction (pure JS — no worker, no WASM)
// ---------------------------------------------------------------------------

/**
 * Reconstructs the Merkle membership path for a note at `targetIndex` in a
 * depth-`levels` incremental Merkle tree seeded with the pool ZERO_LEAF.
 *
 * Pure JS implementation using compress + ZERO_LEAF from poseidon2Pool.ts.
 * Importable in Node (Vitest) without the bb.js worker.
 *
 * Return shape: { pathElements, pathIndices, root }
 *   pathElements[k]: sibling at level k (decimal string)
 *   pathIndices: decimal bitmask (sum of bit_k << k) where bit_k = direction
 *   root: computed tree root (decimal string)
 *
 * Matches compute_root semantics from circuits/sobre_slim/src/main.nr:
 *   bit==0 => current is left child: compress(cur, sib)
 *   bit==1 => current is right child: compress(sib, cur)
 */
export async function reconstructMerklePath(
  leaves: bigint[],
  targetIndex: number,
  levels: number,
): Promise<{ pathElements: string[]; pathIndices: string; root: string }> {
  const { compress, ZERO_LEAF } = await import('./poseidon2Pool')

  // Precompute zero-hash chain: zeros[k] is the root of an empty subtree of depth k
  const zeros: bigint[] = new Array(levels + 1)
  zeros[0] = ZERO_LEAF
  for (let k = 1; k <= levels; k++) {
    zeros[k] = compress(zeros[k - 1], zeros[k - 1])
  }

  // Build the bottom level: fill in given leaves, pad with zeros[0]
  const size = 1 << levels
  const tree: bigint[][] = new Array(levels + 1)
  tree[0] = new Array(size)
  for (let i = 0; i < size; i++) {
    tree[0][i] = i < leaves.length ? leaves[i] : zeros[0]
  }

  // Build up each level
  for (let k = 1; k <= levels; k++) {
    const levelSize = 1 << (levels - k)
    tree[k] = new Array(levelSize)
    for (let i = 0; i < levelSize; i++) {
      tree[k][i] = compress(tree[k - 1][i * 2], tree[k - 1][i * 2 + 1])
    }
  }

  // Extract path for targetIndex
  const pathElements: string[] = []
  let idx = targetIndex
  let bitmask = BigInt(0)

  for (let k = 0; k < levels; k++) {
    const bit = idx & 1
    if (bit === 1) {
      // current is right child — sibling is left
      pathElements.push(tree[k][idx - 1].toString(10))
    } else {
      // current is left child — sibling is right
      const sibIdx = idx + 1
      const sibCount = 1 << (levels - k)
      pathElements.push(
        sibIdx < sibCount ? tree[k][sibIdx].toString(10) : zeros[k].toString(10),
      )
    }
    if (bit === 1) {
      bitmask |= BigInt(1) << BigInt(k)
    }
    idx = idx >> 1
  }

  const root = tree[levels][0].toString(10)
  return { pathElements, pathIndices: bitmask.toString(10), root }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function bigintToFieldBytesLE(v: bigint): Uint8Array {
  const out = new Uint8Array(32)
  let val = v
  for (let i = 0; i < 32; i++) {
    out[i] = Number(val & BigInt(0xff))
    val >>= BigInt(8)
  }
  return out
}

function fieldBytesLEToBigint(bytes: Uint8Array): bigint {
  let result = BigInt(0)
  for (let i = 31; i >= 0; i--) result = (result << BigInt(8)) | BigInt(bytes[i])
  return result
}
