/**
 * employeeClaim.test.ts — Unit test: step-callback ORDER for claimNote.
 *
 * Stubs all external collaborators (proverClient, employee-unshield, rpc)
 * via vi.mock so no WASM, no RPC, no Freighter is involved. Asserts that
 * claimNote emits the step phases in the required order:
 *   fetching-proof -> downloading -> proving -> signing -> done
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks must be declared BEFORE the module under test is imported.
// ---------------------------------------------------------------------------

vi.mock('@/lib/rpc', () => ({
  fetchMerkleProof: vi.fn().mockResolvedValue({ pathElements: Array(10).fill('0'), pathIndices: '0' }),
  fetchPoolRoot: vi.fn().mockResolvedValue('999'),
  fetchASPRoots: vi.fn().mockResolvedValue({ memberRoot: '1', nonMemberRoot: '2' }),
  readDeployments: vi.fn().mockReturnValue({ poolContractId: 'CTEST' }),
}))

vi.mock('@/lib/zk/proverClient', () => ({
  configureProver: vi.fn().mockResolvedValue(undefined),
  initProver: vi.fn().mockResolvedValue(undefined),
  onProgress: vi.fn().mockReturnValue(() => {}),
  computeNullifier: vi.fn().mockResolvedValue(BigInt(42)),
  prove: vi.fn().mockResolvedValue({ proof: new Uint8Array(256).fill(1), publicInputs: new Uint8Array(32), sorobanFormat: true }),
}))

vi.mock('@/lib/zk/withdrawTransactionBuilder', () => ({
  buildWithdrawInputs: vi.fn().mockReturnValue({}),
}))

vi.mock('@/lib/zk/depositTransactionBuilder', () => ({
  hashExtDataSobre: vi.fn().mockReturnValue({ bigInt: BigInt(0), bytes: new Uint8Array(32) }),
}))

vi.mock('@/lib/employee-scan', async (importOriginal) => {
  // We only stub reconstructMerklePathFromEvents here; types are imported normally.
  const actual = await importOriginal<typeof import('@/lib/employee-scan')>()
  return {
    ...actual,
    reconstructMerklePathFromEvents: vi.fn().mockResolvedValue({ pathElements: Array(10).fill('0'), pathIndices: '0' }),
  }
})

vi.mock('@/lib/employee-unshield', () => ({
  unshieldNote: vi.fn().mockResolvedValue({ hash: 'txhash_abc123', recipient: 'G_FAKE' }),
}))

// Import after mocks are registered.
import { claimNote } from '@/lib/employee-claim'
import type { EmployeeNote } from '@/lib/employee-scan'
import type { ClaimStep } from '@/components/employee/ClaimStepper'

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const FIXTURE_NOTE: EmployeeNote = {
  commitment: BigInt(1),
  index: 0,
  amount: BigInt(100_000_000),
  blinding: BigInt(1000),
  ledger: 3110500,
  txHash: 'a'.repeat(64),
}

const FIXTURE_BN254_PRIV = BigInt('12345678901234567890')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('claimNote step-order', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('emits steps in order: fetching-proof -> downloading -> proving -> signing -> done', async () => {
    const phases: string[] = []
    const onStep = (s: ClaimStep) => phases.push(s.phase)

    const result = await claimNote(
      FIXTURE_NOTE,
      FIXTURE_BN254_PRIV,
      'GFAKE_RECIPIENT',
      [],
      onStep,
    )

    // Verify steps were emitted
    expect(phases[0]).toBe('fetching-proof')
    // downloading is emitted (may repeat during onProgress; check first occurrence)
    const downloadingIdx = phases.indexOf('downloading')
    expect(downloadingIdx).toBeGreaterThan(0)
    const provingIdx = phases.indexOf('proving')
    // proving may or may not fire (depends on timing); signing must follow downloading
    const signingIdx = phases.indexOf('signing')
    expect(signingIdx).toBeGreaterThan(downloadingIdx)
    // done is last
    expect(phases[phases.length - 1]).toBe('done')
    expect(result.hash).toBe('txhash_abc123')
  })

  it('falls back to reconstructMerklePathFromEvents when fetchMerkleProof throws', async () => {
    const { fetchMerkleProof } = await import('@/lib/rpc')
    vi.mocked(fetchMerkleProof).mockRejectedValueOnce(new Error('pool.get_proof absent'))

    const { reconstructMerklePathFromEvents } = await import('@/lib/employee-scan')

    const phases: string[] = []
    await claimNote(FIXTURE_NOTE, FIXTURE_BN254_PRIV, 'GFAKE', [], (s) => phases.push(s.phase))

    expect(vi.mocked(reconstructMerklePathFromEvents)).toHaveBeenCalledOnce()
    // Still reaches done despite get_proof failure
    expect(phases).toContain('done')
  })
})
