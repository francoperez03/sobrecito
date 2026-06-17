'use client'

/**
 * PayrollComposer.tsx — top-level orchestrator for the employer pay flow.
 *
 * State machine: idle → composing → proving → submitting → done | error
 *
 * BLOB FREEZE RULE (Pitfall 2 / T-06.2-19):
 * frozenBlobsRef stores the blobs AND blindings from a SINGLE buildFrozenBlobs
 * call. The ref is set exactly once on Submit — never regenerated on re-render.
 * The SAME blindings flow into buildDepositInputs so that the output commitments
 * match the encrypted note contents.
 */

import { useState, useEffect, useRef } from 'react'
import { Reveal } from '@/components/motion/Reveal'
import { ConnectFreighter } from './ConnectFreighter'
import { PayrollEditableTable, type EditableRow } from './PayrollEditableTable'
import { NoteBudgetMeter } from './NoteBudgetMeter'
import { AnonymityMeter } from './AnonymityMeter'
import { ProvingStepper, type StepState } from './ProvingStepper'
import {
  decompose,
  type DenomNote,
} from '@/lib/zk/denominationBuilder'
import { usdcToBaseUnits, isHex64 } from '@/lib/csvParser'
import {
  buildFrozenBlobs,
  buildDepositInputs,
  hashExtDataSobre,
} from '@/lib/zk/depositTransactionBuilder'
import {
  configureProver,
  initProver,
  onProgress,
  prove,
  computeCommitment,
} from '@/lib/zk/proverClient'
import {
  connectFreighter,
  submitDeposit,
} from '@/lib/employer-deposit'
import { readDeployments, fetchPoolRoot, fetchASPRoots } from '@/lib/rpc'

// ---------------------------------------------------------------------------
// State machine type
// ---------------------------------------------------------------------------

type ComposerState = 'idle' | 'composing' | 'proving' | 'submitting' | 'done' | 'error'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert editable rows to the shape decompose() expects. Skips invalid rows. */
function toDecomposeInput(
  rows: EditableRow[],
): { name: string; amountUsdc: bigint; pubkeyHex: string }[] {
  return rows
    .filter((r) => r.amount && r.publicKey && isHex64(r.publicKey))
    .flatMap((r) => {
      try {
        const amountUsdc = usdcToBaseUnits(r.amount)
        if (amountUsdc === BigInt(0)) return []
        return [{ name: r.name, amountUsdc, pubkeyHex: r.publicKey }]
      } catch {
        return []
      }
    })
}

/** Generate a cryptographically random BN254 field element (for dummyBlinding). */
function generateRandomBlinding(): bigint {
  const BN254_MOD = BigInt(
    '21888242871839275222246405745257275088548364400416034343698204186575808495617',
  )
  const buf = new Uint8Array(32)
  globalThis.crypto.getRandomValues(buf)
  let v = BigInt(0)
  for (const b of buf) {
    v = (v << BigInt(8)) | BigInt(b)
  }
  return v % BN254_MOD
}

// ---------------------------------------------------------------------------
// PayrollComposer
// ---------------------------------------------------------------------------

export function PayrollComposer() {
  const [composerState, setComposerState] = useState<ComposerState>('idle')
  const [rows, setRows] = useState<EditableRow[]>([
    { name: '', amount: '', publicKey: '' },
  ])
  const [address, setAddress] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [stepState, setStepState] = useState<StepState>({ phase: 'idle' })
  const [elapsed, setElapsed] = useState(0)

  // Blobs frozen exactly once — never regenerated on re-render (Pitfall 2)
  const frozenBlobsRef = useRef<{ blobs: Uint8Array[]; blindings: bigint[] } | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // True while the submit flow is running (prevents warm-up progress from
  // overwriting the stepper state set by handleSubmit)
  const isSubmittingRef = useRef(false)

  // ---------------------------------------------------------------------------
  // Prover warm-up: configure + initProver on mount (SSR-safe)
  // Subscribe to progress to drive the stepper download step.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (typeof window === 'undefined') return

    let unsub: (() => void) | null = null

    async function warmUp() {
      try {
        await configureProver()
        unsub = onProgress((loaded, total, message) => {
          // Only update stepper during active submit flow
          if (isSubmittingRef.current) {
            setStepState({ phase: 'downloading', loaded, total, message })
          }
        })
        await initProver()
      } catch {
        // Warm-up failure is non-fatal; proving will re-init if needed.
      }
    }

    warmUp()

    return () => {
      unsub?.()
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const decomposeInput = toDecomposeInput(rows)
  const notes: DenomNote[] | null = decomposeInput.length > 0
    ? decompose(decomposeInput)
    : null
  const usedNotes = notes ? notes.filter((n) => n.denomination > BigInt(0)).length : 0
  const groupCount = decomposeInput.length
  const overflow = notes === null && decomposeInput.length > 0

  const canSubmit =
    notes !== null &&
    !overflow &&
    address !== null &&
    (composerState === 'idle' || composerState === 'composing')

  // ---------------------------------------------------------------------------
  // handleConnect
  // ---------------------------------------------------------------------------

  async function handleConnect() {
    setConnecting(true)
    setConnectError(null)
    try {
      const addr = await connectFreighter()
      setAddress(addr)
      setComposerState('composing')
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'No se pudo conectar.')
    } finally {
      setConnecting(false)
    }
  }

  // ---------------------------------------------------------------------------
  // handleSubmit — the freeze-once path (Pitfall 2 mitigated)
  // ---------------------------------------------------------------------------

  async function handleSubmit() {
    if (!notes || !address) return

    setErrorMsg(null)
    setElapsed(0)
    isSubmittingRef.current = true

    try {
      // Step 1: Preparing bills
      setStepState({ phase: 'preparing' })
      setComposerState('proving')

      // Freeze blobs EXACTLY ONCE — never regenerate on re-render.
      // frozenBlobsRef stores both the blobs AND the blindings from this single call.
      if (frozenBlobsRef.current === null) {
        const { auditorPubkeyHex } = readDeployments()
        frozenBlobsRef.current = await buildFrozenBlobs(notes, auditorPubkeyHex)
      }
      const { blobs, blindings } = frozenBlobsRef.current

      // Step 2: Download engine (progress updates come via onProgress subscription)
      // The initProver() warm-up already started downloading; if it cached,
      // this phase is instant. The onProgress subscription updates stepState.
      setStepState({ phase: 'downloading', loaded: 0, total: 0, message: 'Verificando caché…' })

      // Fetch roots from chain
      const [poolRoot, aspRoots] = await Promise.all([
        fetchPoolRoot(),
        fetchASPRoots(),
      ])

      // Step 3: Generate proof ZK (in-browser, nothing leaves the device)
      setStepState({ phase: 'proving', elapsed: 0 })

      // Start elapsed timer
      const startTs = Date.now()
      elapsedTimerRef.current = setInterval(() => {
        const secs = Math.floor((Date.now() - startTs) / 1000)
        setElapsed(secs)
        setStepState({ phase: 'proving', elapsed: secs })
      }, 1000)

      // Hash ext_data (blobs must be frozen before computing this hash)
      const { bigInt: extDataHash } = hashExtDataSobre({
        recipient: address,
        ext_amount: BigInt(0), // demo: no real USDC transferred (testnet cap = 1 USDC)
        encrypted_outputs: blobs,
      })

      // Compute real Poseidon2 commitments via WASM bridge.
      // This resolves the pure-JS stub from plan 04 (precomputedCommitments).
      // The SAME blindings used in buildFrozenBlobs flow in here — commitment
      // and encrypted blob are consistent (Pitfall 2 integrity check).
      const precomputedCommitments = await Promise.all(
        notes.map((n, i) =>
          computeCommitment(n.denomination, n.outPubkey, blindings[i]),
        ),
      )

      // Fresh dummyBlinding per proof run (prevents AlreadySpentNullifier — Pitfall 4)
      const dummyBlinding = generateRandomBlinding()

      const inputs = buildDepositInputs({
        notes,
        blindings,
        encOutputs: blobs,
        extDataHash,
        poolRoot,
        aspMemberRoot: aspRoots.memberRoot,
        aspNonMemberRoot: aspRoots.nonMemberRoot,
        senderAddress: address,
        dummyBlinding,
        precomputedCommitments, // WASM Poseidon2 values — pure-JS stub overridden
        // precomputedNullifier omitted: dummy input nullifier uses pure-JS fallback
        // (acceptable: dummy notes carry no real value; only output commitments need Poseidon2)
      })

      const { proof } = await prove(inputs)

      // Clear elapsed timer
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current)
        elapsedTimerRef.current = null
      }

      // Step 4: Sign in Freighter → submitting
      setStepState({ phase: 'signing' })
      setComposerState('submitting')

      // Allow e2e tests to stub the deposit call via window.__SOBRE_TEST_SUBMIT__.
      // In production this window variable is never set.
      type TestSubmitFn = (params: {
        proof: Uint8Array
        encOutputs: Uint8Array[]
        totalBaseUnits: bigint
        sender: string
      }) => Promise<{ hash: string; sender: string }>
      const testSubmit: TestSubmitFn | undefined =
        typeof window !== 'undefined'
          ? (window as typeof window & { __SOBRE_TEST_SUBMIT__?: TestSubmitFn }).__SOBRE_TEST_SUBMIT__
          : undefined

      const result = await (testSubmit ?? submitDeposit)({
        proof,
        encOutputs: blobs,
        totalBaseUnits: BigInt(0), // demo: ext_amount = 0 (no real USDC transfer)
        sender: address,
      })

      setTxHash(result.hash)
      setStepState({ phase: 'done', txHash: result.hash })
      setComposerState('done')
      isSubmittingRef.current = false
    } catch (err) {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current)
        elapsedTimerRef.current = null
      }
      isSubmittingRef.current = false
      const msg = err instanceof Error ? err.message : 'Error desconocido.'
      setErrorMsg(msg)
      setStepState({ phase: 'error', message: msg })
      setComposerState('error')
    }
  }

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current)
      }
    }
  }, [])

  const isWorking = composerState === 'proving' || composerState === 'submitting'
  const isDone = composerState === 'done'

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-8" data-testid="payroll-composer">
      {/* Connect wallet */}
      <Reveal delay={0}>
        <ConnectFreighter
          address={address}
          connecting={connecting}
          error={connectError}
          onConnect={handleConnect}
        />
      </Reveal>

      {/* Editable payroll table */}
      <Reveal delay={0.05}>
        <PayrollEditableTable rows={rows} onChange={setRows} />
      </Reveal>

      {/* Meters */}
      {decomposeInput.length > 0 && (
        <>
          <Reveal delay={0.1}>
            <NoteBudgetMeter usedNotes={usedNotes} />
          </Reveal>

          <Reveal delay={0.15}>
            <AnonymityMeter noteCount={usedNotes} groupCount={groupCount} />
          </Reveal>
        </>
      )}

      {/* Submit button */}
      <Reveal delay={0.2}>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            data-testid="submit-payroll"
            onClick={handleSubmit}
            disabled={!canSubmit || isWorking || isDone}
            className="bg-accent-fill text-white font-[900] text-base px-8 h-[52px] rounded-full hover:opacity-90 active:scale-[0.98] transition-all self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-40"
          >
            {isWorking ? 'Procesando…' : isDone ? 'Nómina enviada' : 'Enviar nómina'}
          </button>

          {overflow && (
            <p className="text-xs text-accent-warm">
              Los montos superan 8 notas. Ajustá los salarios para que entren en un batch.
            </p>
          )}

          {composerState === 'error' && errorMsg && (
            <p className="text-sm text-ink-muted">{errorMsg}</p>
          )}

          {/* Demo disclosure */}
          <div className="bg-accent-warm/10 text-accent-warm text-xs px-3 py-2 rounded-full self-start">
            Demo PoC · testnet · los montos son valores de campo BN254, no USDC real.
          </div>
        </div>
      </Reveal>

      {/* Proving stepper modal */}
      {stepState.phase !== 'idle' && (
        <Reveal delay={0}>
          <ProvingStepper step={stepState} />
        </Reveal>
      )}
    </div>
  )
}
