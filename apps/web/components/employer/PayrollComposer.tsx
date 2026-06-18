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
  countNotes,
  MAX_NOTES,
  type DenomNote,
} from '@/lib/zk/denominationBuilder'
import { usdcToBaseUnits, isHex64, USDC_SCALE } from '@/lib/csvParser'
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
  computeNullifier,
  computeMembershipLeaf,
  derivePublicKey,
  reconstructMerklePath,
} from '@/lib/zk/proverClient'
import {
  connectFreighter,
  submitDeposit,
} from '@/lib/employer-deposit'
import { readDeployments, fetchPoolRoot, fetchASPRoots, fetchUsdcBalance, formatUsdc } from '@/lib/rpc'

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
        return [{ name: '', amountUsdc, pubkeyHex: r.publicKey }]
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
    { amount: '', publicKey: '' },
  ])
  const [address, setAddress] = useState<string | null>(null)
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null)
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
  // Note budget is a property of the AMOUNTS alone — count every row with a
  // valid amount, even before its public key is filled in, so the 8-note limit
  // is enforced/shown the moment a too-large amount is typed (UNCAPPED so an
  // over-budget batch shows e.g. "22/8" instead of collapsing to 0).
  const usedNotes = rows.reduce((s, r) => {
    if (!r.amount || !/^\d+(\.\d{1,7})?$/.test(r.amount)) return s
    try {
      return s + countNotes(usdcToBaseUnits(r.amount))
    } catch {
      return s
    }
  }, 0)
  const overflow = usedNotes > MAX_NOTES
  // Minimum payment is 1 USDC, in whole units (the denominations are 1/10/100).
  const belowMin = rows.some((r) => {
    if (!r.amount || !/^\d+(\.\d{1,7})?$/.test(r.amount)) return false
    try {
      const base = usdcToBaseUnits(r.amount)
      return base > BigInt(0) && (base < USDC_SCALE || base % USDC_SCALE !== BigInt(0))
    } catch {
      return false
    }
  })
  // The committable batch: needs valid public keys (decomposeInput) and is null
  // when over budget or any amount is non-decomposable.
  const notes: DenomNote[] | null = decomposeInput.length > 0
    ? decompose(decomposeInput)
    : null
  const groupCount = decomposeInput.length

  const canSubmit =
    notes !== null &&
    !overflow &&
    !belowMin &&
    address !== null &&
    (composerState === 'idle' || composerState === 'composing')

  // ---------------------------------------------------------------------------
  // handleConnect
  // ---------------------------------------------------------------------------

  async function refreshUsdcBalance(addr: string) {
    setUsdcBalance(null)
    try {
      const base = await fetchUsdcBalance(addr)
      setUsdcBalance(formatUsdc(base))
    } catch {
      setUsdcBalance(null)
    }
  }

  async function handleConnect() {
    setConnecting(true)
    setConnectError(null)
    try {
      const addr = await connectFreighter()
      setAddress(addr)
      setComposerState('composing')
      void refreshUsdcBalance(addr)
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Could not connect.')
    } finally {
      setConnecting(false)
    }
  }

  // Disconnect clears the dapp's local connection state (Freighter has no
  // programmatic revoke). Resets the wallet + balance and returns to idle.
  function handleDisconnect() {
    setAddress(null)
    setUsdcBalance(null)
    setConnectError(null)
    setComposerState('idle')
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
      setStepState({ phase: 'downloading', loaded: 0, total: 0, message: 'Checking cache…' })

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

      // Real deposit: the employer funds the pool with the batch total in USDC.
      // ext_amount MUST equal the proof's publicAmount (= sum of note denominations).
      // The pool enforces proof.public_amount == calculate_public_amount(ext_amount)
      // (pool.rs) and transfers this many USDC base units from the sender into the pool.
      const totalBaseUnits = notes.reduce((s, n) => s + n.denomination, BigInt(0))

      // Hash ext_data (blobs must be frozen before computing this hash)
      const { bigInt: extDataHash } = hashExtDataSobre({
        recipient: address,
        ext_amount: totalBaseUnits, // real USDC moved from the employer into the pool (testnet)
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

      // Compute dummy-input nullifier via WASM Poseidon2 bridge.
      // The circuit enforces inNullifierHasher.out === inputNullifier[0] unconditionally
      // (policyTransaction.circom line 105). Using the pure-JS placeholder here causes
      // an unsatisfied constraint and proof failure. WASM chain:
      //   privKey=424242, amount=0, pathIndices=0 (deposit path, pool Merkle check disabled)
      // 424242 is the employer key whose pubkey seeds the on-chain ASP membership
      // leaf at index 8; the ASP policy checks run even for the dummy input, so the
      // pubkey derived here MUST match that leaf (see buildMembershipProof below).
      const DUMMY_PRIVKEY = BigInt(424242)
      const precomputedNullifier = await computeNullifier(DUMMY_PRIVKEY, dummyBlinding, BigInt(0))

      // ASP policy proof for the dummy input. The circuit verifies a membership
      // proof and a non-membership proof for every input unconditionally, so the
      // deposit needs valid proofs against the live ASP trees:
      //   1. pubkey = Poseidon2(424242, 0, domain=3) — the circuit's inKeypair.publicKey
      //   2. leaf   = Poseidon2(pubkey, 0, domain=1)  — the on-chain employer leaf
      //   3. path for index 8 of the known on-chain ASP membership tree
      //      (1024 leaves: empty = Poseidon2("XLM") zero leaf, leaves[0..7]=1..8,
      //      leaf[8]=leaf). reconstructMerklePath rebuilds with the SAME zero leaf
      //      and insertion order, so leaves go to indices 0..8 as on-chain.
      const employerPubkey = await derivePublicKey(DUMMY_PRIVKEY)
      const membershipLeaf = await computeMembershipLeaf(employerPubkey, BigInt(0))
      const ASP_MEMBERSHIP_LEAVES: bigint[] = [
        BigInt(1), BigInt(2), BigInt(3), BigInt(4),
        BigInt(5), BigInt(6), BigInt(7), BigInt(8),
        membershipLeaf,
      ]
      const EMPLOYER_LEAF_INDEX = 8
      const memberPath = await reconstructMerklePath(
        ASP_MEMBERSHIP_LEAVES,
        EMPLOYER_LEAF_INDEX,
        10,
      )
      const precomputedMembership = {
        publicKey: employerPubkey,
        leaf: membershipLeaf,
        pathElements: memberPath.pathElements,
        pathIndices: memberPath.pathIndices,
      }

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
        precomputedNullifier,   // WASM Poseidon2 nullifier — pure-JS stub overridden (gap closure)
        precomputedMembership,  // WASM ASP membership/non-membership policy proof for the dummy input
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
        totalBaseUnits, // real USDC moved from employer into the pool
        sender: address,
      })

      setTxHash(result.hash)
      setStepState({ phase: 'done', txHash: result.hash })
      setComposerState('done')
      isSubmittingRef.current = false
      // Balance dropped by the batch total — refresh so the employer sees it.
      void refreshUsdcBalance(address)
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
          onDisconnect={handleDisconnect}
          usdcBalance={usdcBalance}
        />
      </Reveal>

      {/* Note budget — between Connect and the table, so the 8-note cap is
          always visible while building the batch, including the empty 0/8 state. */}
      <Reveal delay={0.04}>
        <NoteBudgetMeter usedNotes={usedNotes} />
      </Reveal>

      {/* Editable payroll table */}
      <Reveal delay={0.05}>
        <PayrollEditableTable rows={rows} onChange={setRows} />
      </Reveal>

      {/* How it works — what the notes are, the budget, and the reassurance */}
      <Reveal delay={0.08}>
        <p className="text-sm text-ink-muted leading-relaxed max-w-2xl">
          Each salary is split into standard <span className="text-ink">1, 10 and 100 USDC</span> notes,
          so equal amounts look identical on-chain and no one can tell who earns what. A batch holds up to{' '}
          <span className="text-ink">8 notes</span>, so keep the breakdown within that budget (the meter
          below tracks it). Your team claims all their notes in one step, so the split costs them nothing.
        </p>
      </Reveal>

      {/* Anonymity — needs real recipients (valid public keys). */}
      {decomposeInput.length > 0 && (
        <Reveal delay={0.15}>
          <AnonymityMeter noteCount={usedNotes} groupCount={groupCount} />
        </Reveal>
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
            {isWorking ? 'Processing…' : isDone ? 'Payroll sent' : 'Send payroll'}
          </button>

          {overflow && (
            <p className="text-xs text-accent-warm">
              These amounts are too large for a single private batch. Reconfigure them to fit one batch.
            </p>
          )}


          {composerState === 'error' && errorMsg && (
            <p className="text-sm text-ink-muted">{errorMsg}</p>
          )}
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
