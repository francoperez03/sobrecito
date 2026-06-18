import { test, expect, type Page } from '@playwright/test'

/**
 * Employee claim dashboard e2e spec (Plan 06.3-04).
 *
 * Six CAP grep strings from 06.3 VALIDATION.md:
 *   CAP-2: lists all employee payments
 *   CAP-3: shows balance summary
 *   CAP-5: claim stepper
 *   CAP-6: shows receipt
 *   CAP-7: edge states
 *   CAP-8: disclosure
 *
 * Mocking strategy (mirrors employer-pay.spec.ts + auditor.spec.ts):
 *   1. RPC: page.route stubs getEvents + simulateTransaction (is_spent, roots).
 *   2. Prover: intercept /zk/prover-client.js with a stub module.
 *   3. Freighter: window.postMessage shim.
 *   4. fetch stub: covers getAccount/sendTransaction for the claim flow.
 *
 * Fixtures: pre-generated real dual-blob XDR bytes encrypted to the test seed
 * (EMPLOYEE_PRIV = 0x43 x 32). Generated via:
 *   encryptNote(x25519Pub, { amount, blinding }) + encodeDualBlob(empCt, audCt)
 * The employee side decrypts under x25519 derived from the 0x43 seed via HKDF.
 * Auditor side encrypted to 0x42 x 32 pub (not used by employee scanner).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RPC_HOST = 'soroban-testnet.stellar.org'
const FAKE_ADDRESS = 'GAN5EVKK6BULRZAFDUZW2DJJFCOSJSK5WUWKWAQCZMEGXPAMJYDLPWLE'
const FAKE_TX_HASH = 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1'

/**
 * Test employee seed: 32 bytes of 0x43. Paste this hex into the employee key
 * input to scan the FIXTURE_EVENTS below. Derived X25519 pub = 37dce3d8…1d001.
 */
const EMPLOYEE_TEST_SEED_HEX =
  '4343434343434343434343434343434343434343434343434343434343434343'

// topic[0] = symbol("new_commitment_event"), base64 XDR.
const COMMIT_TOPIC0 = 'AAAADwAAABRuZXdfY29tbWl0bWVudF9ldmVudA=='

/**
 * 3 NewCommitmentEvents encrypted to EMPLOYEE_TEST_SEED (0x43 x 32).
 * amounts = [100, 200, 300] base units (blinding = 1000, 1001, 1002).
 * Generated with encryptNote(x25519Pub, {amount, blinding}) + encodeDualBlob.
 * The employee scanner decrypts these under the HKDF-derived x25519Priv.
 */
const FIXTURE_EVENTS_EMPLOYEE = [
  {
    type: 'contract',
    contractId: '',
    ledger: 3110500,
    txHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0',
    topic: [
      COMMIT_TOPIC0,
      'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB',
    ],
    value:
      'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAQAAAAB8oTL1xVcC6FXYFJOcO7W0pzn/ss4tApddcIGSQNIl1T5n/IGVrQy7RLJBdJqCbGu5rb1zvHfgxCfe7lXvd2ZeJb6i3KHfbiyaROPntVd8e61+JEQGhe6UNw2XQzgFcT5z7CSgfaVk4VgjhKoFamyq9rBcpjEOidrSXhI4lAAAAHzApRyobBF5GUOR6Vlkwl1JuBo00FQwBy10STv9oLskEOydQqJUguUF0F6d5yEIgo7gLBJKHdLkxtPGyXQvM2LeFC/y9eDZRRiPwNEhgjeyZZpO3ahzckUxndH2U/WRplfmmiop5x1ujAqwKTHMgQSVkhuCeEcaxxPDv0LIAAAADwAAAAVpbmRleAAAAAAAAAUAAAAAAAAAAA==',
  },
  {
    type: 'contract',
    contractId: '',
    ledger: 3110501,
    txHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
    topic: [
      COMMIT_TOPIC0,
      'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC',
    ],
    value:
      'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAQAAAAB8wPl72wMZm7+93vn9GcmdSQ0ZE/RyDal4l+UsFAWJbhO5zbGMm6c/pt+yMd/F4J3NL7k7YBI8LgeSkZun6a3+7YGke8Zw83luilJJ5ttoYJlO354LyAY4DlBu8Fb1oVqlmg7DIAGux7FbzPzAwbcjwPtZ5V/npJZw/8EUAgAAAHy0ue14o12gc8KsVxRGOjureBv/QNBEpDXF55KYpZbAAiRHGcK50FGFDuImBZmJZgCs7ZU9TMdZLAHOvRyVULXg0eTcBxEqMBM0fDtxhhe8tHBX8U3EfMhsXGiVWRT374ZAOcDn8h9DGBPtUEPUaj04ryL2ROyRPMseaWaIAAAADwAAAAVpbmRleAAAAAAAAAUAAAAAAAAAAQ==',
  },
  {
    type: 'contract',
    contractId: '',
    ledger: 3110502,
    txHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2',
    topic: [
      COMMIT_TOPIC0,
      'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD',
    ],
    value:
      'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAQAAAAB8OmzvYGbvfuchjDCWIKRdGFI0K2S/EUb7StGpNU0/aHz/corveuLJfXO7fZEkUIopEtPQ4quM2151R+koyZ45tqPBbEw06inoTwrbpYbY2Vu2UNld3XlJK+UBWlffq6ipKoLHMuL/n6S+jIerNR1hGmn0XxT4+aLEK4TKzgAAAHyHiOcwkyP4qIauX6YqDbtdSX3zIyQksUbxwQzaSdHzSv9chazMLcC4uKjz3PVX79c3liW0qYrSGob7SGoj5j1WMIxC35XCZWd0mgWoZjHM0kh/dnE7gONDdVggxdWgHRES55vgu6WCayuVd5N85mfsfGmfVYIi37javWA1AAAADwAAAAVpbmRleAAAAAAAAAUAAAAAAAAAAg==',
  },
]

// ---------------------------------------------------------------------------
// mockRpcEmployee: stubs getEvents + simulateTransaction
// ---------------------------------------------------------------------------

/**
 * Stubs all Soroban RPC calls via page.route.
 *   getEvents: returns the supplied events.
 *   simulateTransaction: returns a ScvBool (is_spent=isSpent) or a U256 0 root.
 *     - When isSpent=true: ScvBool(true) XDR.
 *     - When isSpent=false: returns a U256 0 (serves both is_spent=false and root queries).
 */
async function mockRpcEmployee(page: Page, events: unknown[], isSpent = false) {
  // ScvBool XDR values for is_spent returns
  // ScvBool(false): type=0x00000014 (scvBool=20), value=0 -> AAAAAAAAFAA= (8 bytes)
  // Actually ScvBool in XDR: discriminant 0x00000014 (20), then bool 0 or 1
  // For is_spent=false: ScvBool(false)
  // For is_spent=true:  ScvBool(true)
  // U256(0) for roots: AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==
  // We use U256(0) as default since it works for both is_spent=false (BigInt(0)=false-ish)
  // and root queries (BigInt(0) as decimal root string)
  // U256(0) for root queries and as a falsy is_spent result (BigInt(0) -> Boolean = false)
  const u256zero = 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  const falseOrRootXdr = u256zero
  // ScvBool(true) for is_spent=true
  const trueXdr = 'AAAAAAAAAAE='

  await page.route(`**://${RPC_HOST}/**`, async (route) => {
    const request = route.request()
    let method = ''
    let id: unknown = 1
    try {
      const body = request.postDataJSON() as { method?: string; id?: unknown }
      method = body?.method ?? ''
      id = body?.id ?? 1
    } catch {
      method = ''
    }

    let result: unknown = {}
    if (method === 'getEvents') {
      result = { events, latestLedger: 3110600, cursor: '' }
    } else if (method === 'simulateTransaction' || method === 'prepareTransaction') {
      result = {
        results: [{ auth: [], xdr: isSpent ? trueXdr : falseOrRootXdr }],
        // Valid SorobanTransactionData XDR (from auditor.spec.ts SIM_BALANCE_800)
        transactionData: 'AAAAAAAAAAIAAAAGAAAAAVBFzV7Acpp2j9WtAlBYUt9PAo3Ogw5axSIJukhIOy8BAAAAEAAAAAEAAAACAAAADwAAAAdCYWxhbmNlAAAAABIAAAABzp9buRK/KbSD+Cf5KFSMBlqIqV+yEvr2/Bj3ICo4HLEAAAABAAAABgAAAAFQRc1ewHKado/VrQJQWFLfTwKNzoMOWsUiCbpISDsvAQAAABQAAAABAAAAAAADOF0AAAAAAAAAAAAAAAAAADMK',
        minResourceFee: '13066',
        latestLedger: 3110600,
      }
    } else if (method === 'getAccount') {
      result = {
        id: FAKE_ADDRESS,
        sequence: '0',
        balances: [],
        thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
        flags: { auth_required: false, auth_revocable: false, auth_immutable: false },
        signers: [],
        data: {},
      }
    } else if (method === 'getLedgerEntries') {
      result = {
        entries: [{
          key: 'AAAAAAAAAAAb0lVK8Gi45AUdM20NKSidJMldtSyrAgLLCGu8DE4Gtw==',
          xdr: 'AAAAAAAAAAAb0lVK8Gi45AUdM20NKSidJMldtSyrAgLLCGu8DE4GtwAAAAAF9eEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAA',
          lastModifiedLedgerSeq: 3110600,
        }],
        latestLedger: 3110600,
      }
    } else if (method === 'sendTransaction') {
      result = { status: 'PENDING', hash: FAKE_TX_HASH }
    } else if (method === 'getTransaction') {
      result = { status: 'SUCCESS', txHash: FAKE_TX_HASH }
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id, result }),
    })
  })
}

// ---------------------------------------------------------------------------
// Prover stub (mirrors employer-pay.spec.ts pattern)
// ---------------------------------------------------------------------------

async function injectProverStub(page: Page) {
  await page.route('**/zk/prover-client.js', (route) => {
    const stubModule = `
// Stub prover-client.js — e2e test, no real WASM
const _listeners = new Set();
export function configure() {}
export async function initializeProver() {
  for (const fn of _listeners) {
    fn(1024 * 1024, 1024 * 1024, 'Cached (test stub)', 100);
  }
}
export function onProgress(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
export async function prove(_inputs, _opts) {
  const proof = new Uint8Array(256).fill(42);
  const publicInputs = new Uint8Array(32).fill(0);
  return { proof, publicInputs, sorobanFormat: true, timings: {} };
}
export async function computeCommitment(_a, _p, _b) { return '1'; }
export async function computeNullifier(_priv, _blind, _idx) { return '2'; }
export async function derivePublicKey(_priv) { return new Uint8Array(32).fill(0); }
export async function reconstructMerklePath(_leaves, _targetIndex, depth = 10) {
  // Stub: return a decimal-string path of the requested depth (no real WASM).
  return { pathElements: Array(depth).fill('3'), pathIndices: '0' };
}
`
    route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: stubModule,
    })
  })
}

// ---------------------------------------------------------------------------
// Freighter + fetch stub (mirrors employer-pay.spec.ts)
// ---------------------------------------------------------------------------

async function injectFreighterStub(
  page: Page,
  address = FAKE_ADDRESS,
  txHash = FAKE_TX_HASH,
) {
  await page.addInitScript(
    ({ addr, hash }: { addr: string; hash: string }) => {
      const _origPostMessage = window.postMessage.bind(window)
      window.postMessage = function (
        data: unknown,
        targetOrOpts?: string | WindowPostMessageOptions,
        transfer?: Transferable[],
      ) {
        const msg = data as Record<string, unknown>
        if (msg?.source === 'FREIGHTER_EXTERNAL_MSG_REQUEST') {
          const messageId = msg.messagedId ?? msg.messageId
          const type = msg.type as string
          let responseData: Record<string, unknown> = {}
          if (type === 'REQUEST_ACCESS' || type === 'REQUEST_PUBLIC_KEY') {
            responseData = { publicKey: addr, apiError: null }
          } else if (type === 'REQUEST_NETWORK_DETAILS') {
            responseData = {
              networkDetails: {
                network: 'TESTNET',
                networkName: 'Test SDF Network',
                networkUrl: 'https://horizon-testnet.stellar.org',
                networkPassphrase: 'Test SDF Network ; September 2015',
                sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
              },
              apiError: null,
            }
          } else if (type === 'SUBMIT_TRANSACTION') {
            responseData = {
              signedTransaction: msg.transactionXdr ?? 'AAAAAgAAAA==',
              signerAddress: addr,
              apiError: null,
            }
          } else if (type === 'REQUEST_CONNECTION_STATUS') {
            responseData = { isConnected: true }
          } else if (type === 'REQUEST_ALLOWED_STATUS') {
            responseData = { isAllowed: true, apiError: null }
          }
          Promise.resolve().then(() => {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
                  messagedId: messageId,
                  ...responseData,
                },
                origin: window.location.origin,
                source: window,
              }),
            )
          })
          return
        }
        if (transfer) {
          _origPostMessage(data, targetOrOpts as string, transfer)
        } else {
          _origPostMessage(data, targetOrOpts as string)
        }
      }

      // Stub fetch for getAccount / sendTransaction in the claim flow.
      const _origFetch = window.fetch.bind(window)
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('soroban-testnet.stellar.org')) {
          let body: unknown
          try {
            body = init?.body ? JSON.parse(init.body as string) : {}
          } catch {
            body = {}
          }
          const method = (body as { method?: string }).method ?? ''
          const id = (body as { id?: unknown }).id ?? 1
          if (method === 'getAccount') {
            return new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                result: {
                  id: addr,
                  sequence: '0',
                  balances: [],
                  thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
                  flags: {
                    auth_required: false,
                    auth_revocable: false,
                    auth_immutable: false,
                  },
                  signers: [],
                  data: {},
                },
              }),
              { headers: { 'Content-Type': 'application/json' } },
            )
          }
          // StellarRpc.Server.getAccount() uses getLedgerEntries internally.
          // Return a minimal account ledger entry so TransactionBuilder can load the source.
          if (method === 'getLedgerEntries') {
            return new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                result: {
                  entries: [{
                    key: 'AAAAAAAAAAAb0lVK8Gi45AUdM20NKSidJMldtSyrAgLLCGu8DE4Gtw==',
                    xdr: 'AAAAAAAAAAAb0lVK8Gi45AUdM20NKSidJMldtSyrAgLLCGu8DE4GtwAAAAAF9eEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAA',
                    lastModifiedLedgerSeq: 3110600,
                  }],
                  latestLedger: 3110600,
                },
              }),
              { headers: { 'Content-Type': 'application/json' } },
            )
          }
          if (method === 'sendTransaction') {
            return new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                result: { status: 'PENDING', hash },
              }),
              { headers: { 'Content-Type': 'application/json' } },
            )
          }
          if (method === 'getTransaction') {
            return new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                result: { status: 'SUCCESS', txHash: hash },
              }),
              { headers: { 'Content-Type': 'application/json' } },
            )
          }
          if (method === 'simulateTransaction' || method === 'prepareTransaction') {
            // U256(0) works for all simulation calls: root queries return 0n, is_spent
            // returns 0n which Boolean(0n)=false (pending). Valid SorobanTransactionData
            // XDR prevents SorobanDataBuilder from throwing XDR parse errors.
            return new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                result: {
                  results: [{ auth: [], xdr: 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }],
                  transactionData: 'AAAAAAAAAAIAAAAGAAAAAVBFzV7Acpp2j9WtAlBYUt9PAo3Ogw5axSIJukhIOy8BAAAAEAAAAAEAAAACAAAADwAAAAdCYWxhbmNlAAAAABIAAAABzp9buRK/KbSD+Cf5KFSMBlqIqV+yEvr2/Bj3ICo4HLEAAAABAAAABgAAAAFQRc1ewHKado/VrQJQWFLfTwKNzoMOWsUiCbpISDsvAQAAABQAAAABAAAAAAADOF0AAAAAAAAAAAAAAAAAADMK',
                  minResourceFee: '13066',
                  latestLedger: 3110600,
                },
              }),
              { headers: { 'Content-Type': 'application/json' } },
            )
          }
        }
        return _origFetch(input, init)
      }
    },
    { addr: address, hash: txHash },
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Employee dashboard', () => {

  // CAP-2: scan with the test seed -> 3 notes appear with their ledger/txHash.
  test('lists all employee payments', async ({ page }) => {
    await mockRpcEmployee(page, FIXTURE_EVENTS_EMPLOYEE)
    await injectProverStub(page)
    await page.goto('/employee')

    await page
      .getByRole('textbox', { name: /employee key/i })
      .fill(EMPLOYEE_TEST_SEED_HEX)
    await page.getByRole('button', { name: 'Scan pool' }).click()

    // Three NoteCards with the fixture ledger numbers.
    await expect(page.getByText(/Ledger 3110500/)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/Ledger 3110501/)).toBeVisible()
    await expect(page.getByText(/Ledger 3110502/)).toBeVisible()

    // Each note is pending (isSpent=false default).
    const pendingChips = page.getByText('Pending')
    await expect(pendingChips).toHaveCount(3)
  })

  // CAP-3: DashboardSummary renders claimable amount and X/N counter.
  test('shows balance summary', async ({ page }) => {
    await mockRpcEmployee(page, FIXTURE_EVENTS_EMPLOYEE)
    await injectProverStub(page)
    await page.goto('/employee')

    await page
      .getByRole('textbox', { name: /employee key/i })
      .fill(EMPLOYEE_TEST_SEED_HEX)
    await page.getByRole('button', { name: 'Scan pool' }).click()

    await expect(page.getByTestId('summary-claimable')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('summary-counter')).toBeVisible()
    // All 3 pending -> 0 claimed out of 3.
    await expect(page.getByTestId('summary-counter')).toHaveText('0 / 3')
  })

  // CAP-5: clicking Claim drives the 4-step stepper to done (prover stubbed).
  test('claim stepper', async ({ page }) => {
    await mockRpcEmployee(page, FIXTURE_EVENTS_EMPLOYEE)
    await injectProverStub(page)
    await injectFreighterStub(page)
    await page.goto('/employee')

    await page
      .getByRole('textbox', { name: /employee key/i })
      .fill(EMPLOYEE_TEST_SEED_HEX)
    await page.getByRole('button', { name: 'Scan pool' }).click()

    // Wait for notes + CTA.
    await expect(page.getByTestId('claim-cta').first()).toBeVisible({ timeout: 15000 })
    await page.getByTestId('claim-cta').first().click()

    // ClaimStepper appears.
    await expect(page.getByTestId('claim-stepper')).toBeVisible({ timeout: 10000 })

    // Debug: if error phase appears, log the message before failing.
    const errorEl = page.getByTestId('stepper-error')
    const doneEl = page.getByTestId('stepper-done')
    await Promise.race([
      doneEl.waitFor({ timeout: 18000 }),
      errorEl.waitFor({ timeout: 18000 }).then(async () => {
        const msg = await errorEl.textContent()
        throw new Error(`Stepper error: ${msg}`)
      }),
    ])

    // With the prover stub the claim completes quickly -> stepper-done.
    await expect(page.getByTestId('stepper-done')).toBeVisible({ timeout: 20000 })
  })

  // CAP-6: after a successful claim the receipt-link appears with the tx hash.
  test('shows receipt', async ({ page }) => {
    await mockRpcEmployee(page, FIXTURE_EVENTS_EMPLOYEE, false)
    await injectProverStub(page)
    await injectFreighterStub(page)
    await page.goto('/employee')

    await page
      .getByRole('textbox', { name: /employee key/i })
      .fill(EMPLOYEE_TEST_SEED_HEX)
    await page.getByRole('button', { name: 'Scan pool' }).click()

    await expect(page.getByTestId('claim-cta').first()).toBeVisible({ timeout: 15000 })
    await page.getByTestId('claim-cta').first().click()

    // Receipt link visible after claim.
    await expect(page.getByTestId('receipt-link')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('receipt-link')).toContainText(FAKE_TX_HASH.slice(0, 10))
  })

  // CAP-7: edge states — empty pool, invalid key, already-claimed note.
  test('edge states', async ({ page }) => {
    // Sub-test A: empty pool.
    await mockRpcEmployee(page, [])
    await injectProverStub(page)
    await page.goto('/employee')

    await page
      .getByRole('textbox', { name: /employee key/i })
      .fill(EMPLOYEE_TEST_SEED_HEX)
    await page.getByRole('button', { name: 'Scan pool' }).click()

    await expect(page.getByTestId('employee-empty')).toBeVisible({ timeout: 15000 })

    // Sub-test B: invalid key -> amber ring.
    await page.goto('/employee')
    await page
      .getByRole('textbox', { name: /employee key/i })
      .fill('not-a-valid-key')
    await page.getByRole('button', { name: 'Scan pool' }).click()
    await expect(
      page.getByRole('textbox', { name: /employee key/i }),
    ).toHaveClass(/ring-accent-warm/, { timeout: 5000 })

    // Sub-test C: already-claimed (isSpent=true) -> Claimed chip, no CTA.
    await page.unrouteAll()
    await mockRpcEmployee(page, FIXTURE_EVENTS_EMPLOYEE, true)
    await injectProverStub(page)
    await page.goto('/employee')
    await page
      .getByRole('textbox', { name: /employee key/i })
      .fill(EMPLOYEE_TEST_SEED_HEX)
    await page.getByRole('button', { name: 'Scan pool' }).click()

    await expect(page.getByText('Claimed').first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('claim-cta')).toHaveCount(0)
  })

  // CAP-8: amber disclosure visible and DOM-ordered before the Claim CTA.
  test('disclosure', async ({ page }) => {
    await mockRpcEmployee(page, FIXTURE_EVENTS_EMPLOYEE, false)
    await injectProverStub(page)
    await page.goto('/employee')

    await page
      .getByRole('textbox', { name: /employee key/i })
      .fill(EMPLOYEE_TEST_SEED_HEX)
    await page.getByRole('button', { name: 'Scan pool' }).click()

    // Amber disclosure chip (data-testid="claim-disclosure") visible.
    await expect(page.getByTestId('claim-disclosure').first()).toBeVisible({ timeout: 15000 })

    // Ordered BEFORE the Claim CTA (load-bearing T-063-11).
    const disclosureBox = await page.getByTestId('claim-disclosure').first().boundingBox()
    const ctaBox = await page.getByTestId('claim-cta').first().boundingBox()
    expect(disclosureBox).not.toBeNull()
    expect(ctaBox).not.toBeNull()
    expect(disclosureBox!.y).toBeLessThan(ctaBox!.y)
  })

  // Key generator (06.3-04 onboarding deviation): clicking "Generate a new key"
  // mints a fresh seed in-browser, shows the seed + bn254Pub, and autofills the
  // key input so the employee can scan straight away.
  test('generates a key', async ({ page }) => {
    await mockRpcEmployee(page, FIXTURE_EVENTS_EMPLOYEE)
    // deriveEmployeeKeys derives bn254Pub via the prover WASM, which the stub
    // resolves (derivePublicKey -> 32 zero bytes), so generation completes offline.
    await injectProverStub(page)
    await page.goto('/employee')

    // Before generating, neither value is present.
    await expect(page.getByTestId('keygen-seed')).toHaveCount(0)

    await page.getByTestId('keygen-generate').click()

    // Seed + public key surface, both 64-char hex.
    const seedEl = page.getByTestId('keygen-seed')
    const pubEl = page.getByTestId('keygen-pubkey')
    await expect(seedEl).toBeVisible({ timeout: 10000 })
    await expect(pubEl).toBeVisible()

    const seedText = ((await seedEl.textContent()) ?? '').trim()
    const pubText = ((await pubEl.textContent()) ?? '').trim()
    expect(seedText).toMatch(/^[0-9a-f]{64}$/)
    expect(pubText).toMatch(/^[0-9a-f]{64}$/)
    // A random seed is overwhelmingly not all-zeros.
    expect(seedText).not.toBe('0'.repeat(64))

    // The key input is autofilled with the generated seed.
    await expect(page.getByRole('textbox', { name: /employee key/i })).toHaveValue(
      seedText,
    )

    // Copy controls are present for both values.
    await expect(page.getByTestId('keygen-copy-seed')).toBeVisible()
    await expect(page.getByTestId('keygen-copy-pub')).toBeVisible()
  })
})
