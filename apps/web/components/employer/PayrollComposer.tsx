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
import { motion, AnimatePresence } from 'motion/react'
import { ShieldCheck, Check, CaretDown } from '@phosphor-icons/react'
import { keyFromBase64 } from 'viewkey'
import { Reveal } from '@/components/motion/Reveal'
import { markStep } from '@/lib/progressStore'
import { ConnectFreighter } from './ConnectFreighter'
import { useWallet, connectWallet, disconnectWallet } from '@/lib/walletStore'
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
import { usdcToBaseUnits, isHex64, USDC_SCALE, parseEmployeePubkey } from '@/lib/csvParser'
import {
  buildFrozenBlobs,
  buildDepositInputs,
} from '@/lib/zk/depositTransactionBuilder'
import { getChainAdapter } from '@/lib/chain'
import {
  configureProver,
  initProver,
  onProgress,
  prove,
} from '@/lib/zk/proverClient'
import { submitDeposit } from '@/lib/employer-deposit'
import { loadAuditorPublicKey } from '@/lib/auditorKeyStore'
import { readDeployments, fetchPoolRoot, fetchUsdcBalance, formatUsdc } from '@/lib/rpc'

// ---------------------------------------------------------------------------
// State machine type
// ---------------------------------------------------------------------------

type ComposerState = 'idle' | 'composing' | 'proving' | 'submitting' | 'done' | 'error'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Translate raw fetch/network errors into human-readable messages.
 * "Failed to fetch" is a browser-level CORS or network error — the user
 * doesn't need to know about CORS headers; they need to know the endpoint
 * was unreachable and that retrying usually fixes it.
 */
function formatErrorMessage(raw: string): string {
  if (
    raw === 'Failed to fetch' ||
    raw.toLowerCase().includes('networkerror') ||
    raw.toLowerCase().includes('cors')
  ) {
    return 'Could not reach the Stellar testnet — the RPC endpoint was unreachable. Check your connection and try again.'
  }
  return raw
}

/**
 * Convert editable rows to the shape decompose() expects. Skips invalid rows.
 *
 * The row's public key is the COMBINED employee key (x25519Pub || bn254Pub, 128
 * hex). The x25519 half becomes pubkeyHex (the note is encrypted to it for
 * discovery); the bn254 half becomes bn254Pub (the commitment / withdraw-ownership
 * key). See parseEmployeePubkey + the key-model note in csvParser.
 */
function toDecomposeInput(
  rows: EditableRow[],
): { name: string; amountUsdc: bigint; pubkeyHex: string; bn254Pub: bigint }[] {
  return rows.flatMap((r) => {
    if (!r.amount || !r.publicKey) return []
    const parsed = parseEmployeePubkey(r.publicKey)
    if (!parsed) return []
    try {
      const amountUsdc = usdcToBaseUnits(r.amount)
      if (amountUsdc === BigInt(0)) return []
      return [
        { name: '', amountUsdc, pubkeyHex: parsed.x25519Hex, bn254Pub: parsed.bn254Pub },
      ]
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

/**
 * Parse a pasted auditor public key (64-char hex or base64) into a 64-char hex
 * string, or null when empty / malformed. The auditor publishes its X25519
 * public key as base64 (KeygenCard) or hex; both are accepted here.
 */
function parseAuditorKey(input: string): string | null {
  const clean = input.trim().replace(/^0x/, '')
  if (clean.length === 0) return null
  if (isHex64(clean)) return clean.toLowerCase()
  try {
    const bytes = keyFromBase64(input.trim())
    if (bytes.length !== 32) return null
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// PayrollComposer
// ---------------------------------------------------------------------------

export function PayrollComposer({ onSent }: { onSent?: () => void }) {
  const [composerState, setComposerState] = useState<ComposerState>('idle')
  const [rows, setRows] = useState<EditableRow[]>([
    { amount: '', publicKey: '' },
  ])
  // Wallet connection is shared app-wide (lib/walletStore): the global navbar
  // chip and this form drive ONE source of truth. We mirror the shared address
  // into a local `address` (read by submit/gating/balance below) via an effect.
  const { address: walletAddress, connecting, error: connectError } = useWallet()
  const [address, setAddress] = useState<string | null>(null)
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null)
  // Raw USDC balance in base units (7 decimals) — kept alongside the formatted
  // string so the batch total can be checked against it before submit.
  const [usdcBalanceBase, setUsdcBalanceBase] = useState<bigint | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [stepState, setStepState] = useState<StepState>({ phase: 'idle' })
  const [elapsed, setElapsed] = useState(0)

  // Optional auditor (selective disclosure / compliance): when enabled, the
  // employer pastes the auditor's PUBLIC key and the per-note amounts are
  // encrypted to it as well, so the auditor can reconstruct the detail. Off by
  // default; when off, deposits fall back to the deployments.json auditor key.
  const [auditEnabled, setAuditEnabled] = useState(false)
  const [auditorKey, setAuditorKey] = useState('')

  // "How privacy works" explainer is collapsed by default — the mechanism
  // (denominations, 8-note budget) is available but doesn't overwhelm the form.
  const [showHow, setShowHow] = useState(false)

  // Autofill the auditor public key from a previous auditor session in this
  // browser (public key only — see auditorKeyStore). The employer can still
  // overwrite it by hand. Runs once on mount; does not clobber manual edits.
  useEffect(() => {
    const stored = loadAuditorPublicKey()
    if (stored) setAuditorKey(stored)
  }, [])

  // Mirror the shared wallet address into local state: connecting (here or via
  // the global navbar chip) arms the composer and refreshes the USDC balance;
  // disconnecting returns the form to its locked state.
  useEffect(() => {
    if (walletAddress && walletAddress !== address) {
      setAddress(walletAddress)
      setComposerState('composing')
      void refreshUsdcBalance(walletAddress)
    } else if (!walletAddress && address) {
      setAddress(null)
      setUsdcBalance(null)
      setUsdcBalanceBase(null)
      setComposerState('idle')
    }
    // address/refreshUsdcBalance intentionally excluded — this reacts to the
    // shared address changing, not to local mirror updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress])

  // Blobs frozen exactly once — never regenerated on re-render (Pitfall 2)
  const frozenBlobsRef = useRef<{ blobs: Uint8Array[]; blindings: bigint[] } | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // After a successful send we hold the "Payroll sent" receipt for a beat, then
  // reset the form to a blank batch. This timer drives that delayed reset.
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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

  // Resolve the pasted auditor key (hex64 or base64) to a 64-char hex string, or
  // null when it is empty / malformed. Used both to gate Submit and to encrypt.
  const auditorKeyHex = parseAuditorKey(auditorKey)
  const auditorKeyValid = auditorKeyHex !== null
  // The audit option is "ready" unless it is enabled with an invalid key.
  const auditReady = !auditEnabled || auditorKeyValid

  // Total the employer is trying to fund (base units) — every row with a valid
  // amount, so the balance check fires as soon as a too-large amount is typed.
  const totalRequestedBase = rows.reduce((s, r) => {
    if (!r.amount || !/^\d+(\.\d{1,7})?$/.test(r.amount)) return s
    try {
      return s + usdcToBaseUnits(r.amount)
    } catch {
      return s
    }
  }, BigInt(0))
  // The deposit transfers real USDC from the employer; block submit when the batch
  // total exceeds the connected account's USDC balance.
  const insufficientFunds =
    usdcBalanceBase !== null &&
    totalRequestedBase > BigInt(0) &&
    totalRequestedBase > usdcBalanceBase

  const canSubmit =
    notes !== null &&
    !overflow &&
    !belowMin &&
    !insufficientFunds &&
    address !== null &&
    auditReady &&
    (composerState === 'idle' || composerState === 'composing' || composerState === 'error')

  // ---------------------------------------------------------------------------
  // handleConnect
  // ---------------------------------------------------------------------------

  async function refreshUsdcBalance(addr: string) {
    setUsdcBalance(null)
    setUsdcBalanceBase(null)
    try {
      const base = await fetchUsdcBalance(addr)
      setUsdcBalance(formatUsdc(base))
      setUsdcBalanceBase(base)
    } catch {
      setUsdcBalance(null)
      setUsdcBalanceBase(null)
    }
  }

  // Connect drives the shared store; the mirror effect above picks up the new
  // address, refreshes the balance, and arms the composer.
  function handleConnect() {
    void connectWallet()
  }

  // Disconnect clears the dapp's connection state (Freighter has no programmatic
  // revoke). Clears the shared store + local balance and returns to idle.
  function handleDisconnect() {
    disconnectWallet()
    setAddress(null)
    setUsdcBalance(null)
    setUsdcBalanceBase(null)
    setComposerState('idle')
  }

  // ---------------------------------------------------------------------------
  // handleSubmit — the freeze-once path (Pitfall 2 mitigated)
  // ---------------------------------------------------------------------------

  async function handleSubmit() {
    if (!notes || !address) return

    // A new run cancels any pending post-send reset so it can't wipe this batch.
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }

    // On retry: clear frozen blobs so a fresh encryption is generated
    if (composerState === 'error') {
      frozenBlobsRef.current = null
    }

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
        // Prefer the pasted auditor key (compliance toggle) over the default
        // published key from deployments.json.
        const { auditorPubkeyHex } = readDeployments()
        const effectiveAuditorHex =
          auditEnabled && auditorKeyHex ? auditorKeyHex : auditorPubkeyHex
        frozenBlobsRef.current = await buildFrozenBlobs(notes, effectiveAuditorHex)
      }
      const { blobs, blindings } = frozenBlobsRef.current

      // Step 2: Download engine (progress updates come via onProgress subscription)
      // The initProver() warm-up already started downloading; if it cached,
      // this phase is instant. The onProgress subscription updates stepState.
      setStepState({ phase: 'downloading', loaded: 0, total: 0, message: 'Checking cache…' })

      // Fetch pool root from chain
      const poolRoot = await fetchPoolRoot()

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
      const { bigInt: extDataHash, bytes: extDataHashBytes } = getChainAdapter().encoding.hashExtData({
        recipient: address,
        ext_amount: totalBaseUnits, // real USDC moved from the employer into the pool (testnet)
        encrypted_outputs: blobs,
      })

      // Fresh dummyBlinding per proof run (prevents AlreadySpentNullifier — Pitfall 4)
      const dummyBlinding = generateRandomBlinding()

      // Sobre_slim Noir ABI: commitments + nullifier are computed in JS via poseidon2Pool
      // (no worker COMPUTE_* calls — those handlers are dead in bb-prover.ts after D2 scope).
      // No ASP fields needed: sobre_slim intentionally drops the allowlist proofs.
      const inputs = buildDepositInputs({
        notes,
        blindings,
        encOutputs: blobs,
        extDataHash,
        poolRoot,
        senderAddress: address,
        dummyBlinding,
      })

      const { proof: proofBytes, publicInputs: publicInputsBlob } = await prove(inputs)

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
        publicInputs?: unknown
      }) => Promise<{ hash: string; sender: string }>
      const testSubmit: TestSubmitFn | undefined =
        typeof window !== 'undefined'
          ? (window as typeof window & { __SOBRE_TEST_SUBMIT__?: TestSubmitFn }).__SOBRE_TEST_SUBMIT__
          : undefined

      const result = await (testSubmit ?? submitDeposit)({
        // proof = the 14592-byte UltraHonk proof blob (passed as Proof.proof_bytes on-chain)
        proof: proofBytes,
        encOutputs: blobs,
        totalBaseUnits, // real USDC moved from employer into the pool
        sender: address,
        // UltraHonk ProofPublicInputs: the two opaque blobs from bb plus the
        // structured fields the pool validates independently (root, nullifiers,
        // commitments, public_amount, ext_data_hash).
        publicInputs: {
          root: inputs.root,
          publicAmount: totalBaseUnits,
          extDataHash: extDataHashBytes,
          inputNullifiers: [inputs.input_nullifier],
          outputCommitments: [0,1,2,3,4,5,6,7].map(i => (inputs as Record<string, string>)[`output_commitment_${i}`]),
          // The 384-byte public-inputs blob from bb (12 × 32-byte BE fields)
          publicInputsBlob,
          // The 14592-byte UltraHonk proof blob (same as proof above, carried for encoding)
          proofBytes,
        },
      })

      setTxHash(result.hash)
      setStepState({ phase: 'done', txHash: result.hash })
      setComposerState('done')
      markStep('pay')
      isSubmittingRef.current = false
      // Balance dropped by the batch total — refresh so the employer sees it.
      void refreshUsdcBalance(address)

      // Hold the "Payroll sent" receipt for a couple seconds, then return to a
      // blank batch: clear the address/amount fields and re-arm the composer
      // (wallet stays connected). The stepper's done receipt is intentionally
      // left up — it persists until the next submit replaces it. Refresh the
      // dashboard below (batches + pool total) via onSent.
      resetTimerRef.current = setTimeout(() => {
        resetTimerRef.current = null
        setRows([{ amount: '', publicKey: '' }])
        frozenBlobsRef.current = null
        setComposerState('composing')
        onSent?.()
      }, 2500)
    } catch (err) {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current)
        elapsedTimerRef.current = null
      }
      isSubmittingRef.current = false
      const raw = err instanceof Error ? err.message : 'Unknown error.'
      const msg = formatErrorMessage(raw)
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
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  const isWorking = composerState === 'proving' || composerState === 'submitting'
  const isDone = composerState === 'done'

  // Sticky footer summary: when the batch is ready, a "Pay N people · T USDC"
  // line; otherwise the single most relevant blocking reason (so a disabled CTA
  // is never silent about why).
  const recipientCount = decomposeInput.length
  const peopleWord = recipientCount === 1 ? 'person' : 'people'
  let footerHint: string
  if (isWorking) footerHint = 'Generating the proof and sending…'
  else if (isDone) footerHint = 'Sent. Refreshing the record…'
  else if (recipientCount === 0 || notes === null) footerHint = 'Add at least one recipient to pay'
  else if (belowMin) footerHint = 'Each amount must be a whole number, 1 USDC or more'
  else if (overflow) footerHint = 'Too many notes for one private batch'
  else if (insufficientFunds) footerHint = `Batch total is more than your ${usdcBalance ?? '0'} USDC balance`
  else if (!auditReady) footerHint = "Add the auditor's key, or turn the auditor off"
  else footerHint = `Pay ${recipientCount} ${peopleWord} · ${formatUsdc(totalRequestedBase)} USDC`

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-8" data-testid="payroll-composer">
      {/* Wallet. Connecting lives in the global navbar chip (top-right), out of
          the flow. Here we show the connected chip (with balance) once linked, or
          a "Connect to continue" gate that also drives the shared store. */}
      <Reveal delay={0}>
        {address ? (
          <ConnectFreighter
            address={address}
            connecting={false}
            error={null}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            usdcBalance={usdcBalance}
          />
        ) : (
          <div className="flex flex-col gap-3 self-start">
            <p className="text-sm text-ink-muted">
              Connect your wallet to continue, here or from the top-right.
            </p>
            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting}
              className="self-start bg-accent-fill text-white font-[900] text-base px-6 h-[52px] rounded-full hover:opacity-90 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-70"
            >
              {connecting ? 'Connecting…' : 'Connect Freighter'}
            </button>
            {connectError && <p className="text-xs text-accent-warm">{connectError}</p>}
          </div>
        )}
      </Reveal>

      {/* Everything below the Connect button is hidden until the wallet is
          connected — an unconnected employer sees only the Connect CTA. */}
      {address && (
        <>
      {/* Editable payroll table — the recipients */}
      <Reveal delay={0.05}>
        <PayrollEditableTable rows={rows} onChange={setRows} />
      </Reveal>

      {/* Note budget — feedback on the table's contents, so it sits BELOW the
          table and only appears once there's something to measure (no abstract
          empty 0/8 state up front). */}
      {usedNotes > 0 && (
        <Reveal delay={0.04}>
          <NoteBudgetMeter usedNotes={usedNotes} />
        </Reveal>
      )}

      {/* Reassurance — one line, with the mechanism behind a disclosure so the
          form isn't front-loaded with denomination/budget jargon. */}
      <Reveal delay={0.08}>
        <div className="max-w-2xl flex flex-col gap-2">
          <p className="text-sm text-ink-muted leading-relaxed">
            Equal salaries look identical on-chain, so no one can tell who earns what.
          </p>
          <button
            type="button"
            onClick={() => setShowHow((v) => !v)}
            aria-expanded={showHow}
            className="inline-flex items-center gap-1.5 self-start text-sm text-ink-muted hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md"
          >
            <CaretDown
              size={14}
              weight="bold"
              aria-hidden
              className={`transition-transform ${showHow ? 'rotate-180' : ''}`}
            />
            How privacy works
          </button>
          <AnimatePresence initial={false}>
            {showHow && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                className="overflow-hidden text-sm text-ink-muted leading-relaxed"
              >
                Each salary is split into standard{' '}
                <span className="text-ink">1, 10 and 100 USDC</span> notes. A batch holds
                up to <span className="text-ink">8 notes</span> (the meter tracks it). Your
                team claims all their notes in one step, so the split costs them nothing.
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </Reveal>

      {/* Anonymity — needs real recipients (valid public keys). */}
      {decomposeInput.length > 0 && (
        <Reveal delay={0.15}>
          <AnonymityMeter noteCount={usedNotes} groupCount={groupCount} />
        </Reveal>
      )}

      {/* Compliance toggle — opt in to give an auditor selective disclosure.
          Checking it reveals a field to paste the auditor's public key. Grouped
          under an "Options" rule so this optional step reads below the required
          recipients, not at equal weight. */}
      <Reveal delay={0.18}>
        <div className="flex flex-col gap-3 pt-6 border-t border-hairline">
          <span className="text-xs uppercase tracking-widest text-ink-muted/60">
            Options
          </span>
          <button
            type="button"
            role="checkbox"
            aria-checked={auditEnabled}
            data-testid="audit-toggle"
            onClick={() => setAuditEnabled((v) => !v)}
            className="group flex items-start gap-3 text-left w-fit focus-visible:outline-none"
          >
            <span
              className={[
                'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md ring-1 transition-colors',
                'group-focus-visible:ring-2 group-focus-visible:ring-accent',
                auditEnabled
                  ? 'bg-accent-fill ring-accent-fill text-white'
                  : 'bg-bg ring-hairline text-transparent group-hover:ring-ink-muted',
              ].join(' ')}
            >
              <Check size={13} weight="bold" aria-hidden />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-sm font-[700] text-ink">
                <ShieldCheck size={15} weight="fill" aria-hidden className="text-ink-muted" />
                Add an auditor for compliance
              </span>
              <span className="text-xs text-ink-muted leading-relaxed max-w-[52ch]">
                Encrypt each amount to an auditor&apos;s key so they can reconstruct the
                detail. Everyone else still sees only the proven total.
              </span>
            </span>
          </button>

          <AnimatePresence initial={false}>
            {auditEnabled && (
              <motion.div
                key="auditor-key-field"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-2 pt-1 pl-8">
                  <label
                    htmlFor="auditor-key"
                    className="text-xs text-ink-muted uppercase tracking-widest"
                  >
                    Auditor public key
                  </label>
                  <input
                    id="auditor-key"
                    data-testid="auditor-key-input"
                    value={auditorKey}
                    onChange={(e) => setAuditorKey(e.target.value)}
                    placeholder="Paste the auditor's public key (hex or base64)"
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="off"
                    className={[
                      'w-full max-w-xl bg-bg text-ink font-mono text-sm rounded-2xl h-[48px] px-4',
                      'ring-1 focus:outline-none transition-all placeholder:text-ink-muted/70',
                      auditorKey.length > 0 && !auditorKeyValid
                        ? 'ring-accent-warm focus:ring-accent-warm'
                        : 'ring-hairline focus:ring-2 focus:ring-accent',
                    ].join(' ')}
                  />
                  <p className="text-xs text-ink-muted">
                    {auditorKey.length > 0 && !auditorKeyValid
                      ? 'That is not a 32-byte key. Paste a 64-character hex string or the base64 key from the auditor.'
                      : 'The auditor shares this from their console (Generate keypair → public key).'}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Reveal>

      {/* Sticky send bar — always reachable while the form scrolls, with a live
          summary (or the blocking reason) so the CTA is never far away or silent. */}
      <Reveal delay={0.2}>
        <div className="sticky bottom-4 z-10">
          <div className="flex items-center gap-3 rounded-full bg-surface/90 backdrop-blur ring-1 ring-hairline-strong pl-5 pr-1.5 py-1.5 shadow-[0_14px_44px_rgba(0,0,0,0.5)]">
            <span
              className={`flex-1 min-w-0 truncate text-sm ${
                canSubmit && !isWorking && !isDone
                  ? 'text-ink'
                  : insufficientFunds || overflow || belowMin
                    ? 'text-accent-warm'
                    : 'text-ink-muted'
              }`}
              data-testid="submit-summary"
            >
              {footerHint}
            </span>
            <button
              type="button"
              data-testid="submit-payroll"
              onClick={handleSubmit}
              disabled={!canSubmit || isWorking || isDone}
              className="shrink-0 bg-accent-fill text-white font-[900] text-base px-7 h-[48px] rounded-full hover:opacity-90 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-40"
            >
              {isWorking ? 'Processing…' : isDone ? 'Payroll sent' : composerState === 'error' ? 'Try again' : 'Send payroll'}
            </button>
          </div>

          {composerState === 'error' && errorMsg && (
            <p className="mt-2 px-2 text-sm text-ink-muted">
              {formatErrorMessage(errorMsg)}
            </p>
          )}
        </div>
      </Reveal>

      {/* Proving stepper modal */}
      {stepState.phase !== 'idle' && (
        <Reveal delay={0}>
          <ProvingStepper step={stepState} />
        </Reveal>
      )}
        </>
      )}
    </div>
  )
}
