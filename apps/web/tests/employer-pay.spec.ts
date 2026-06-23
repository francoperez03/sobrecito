import { test, expect, type Page } from '@playwright/test'

/**
 * employer-pay.spec.ts — Playwright e2e for the PayrollComposer + ProvingStepper flow.
 *
 * Mocking strategy (bb.js worker era):
 *   1. Freighter: inject `window.freighterApi` shim before page load via
 *      page.addInitScript(). All Freighter calls (requestAccess, getAddress,
 *      getNetwork, signTransaction) return successful stubs.
 *   2. RPC: route `soroban-testnet.stellar.org` to return empty results.
 *   3. Submit hook: window.__SOBRE_TEST_SUBMIT__ returns a deterministic
 *      { hash, sender } so that non-proving assertions can reach the submit step.
 *
 * Worker interception (RESOLVED — Phase 09.1 plan 04):
 *   The old spec intercepted the ark-groth16 static worker file and stubbed
 *   compute functions (commitment, nullifier, membershipLeaf, merklePath,
 *   publicKey derivation). All of those stubs are DEAD in the new bb.js path:
 *     - proverClient.ts spawns: new Worker(new URL('../../workers/bb-prover.ts',
 *       import.meta.url)) — compiled by Turbopack at an unstable chunk URL.
 *     - page.route cannot reliably intercept a Turbopack worker chunk URL across
 *       builds (Open Question #3 of RESEARCH.md, resolved here).
 *     - PayrollComposer.tsx runs `const { proof } = await prove(inputs)` BEFORE
 *       it reads window.__SOBRE_TEST_SUBMIT__, so stubbing the submit hook alone
 *       does NOT bypass the ~2s WASM proving.
 *   Therefore the proving-path e2e test (E2E-03) is an explicit test.skip with
 *   a documented reason; the real employer→pago→claim verification is the
 *   human-verify checkpoint (Task 3) against the live slim noir_pool.
 *
 * No stale static-worker interception. No dead Groth16 stubs. No faked on-chain
 * success.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RPC_HOST = 'soroban-testnet.stellar.org'
const FAKE_ADDRESS = 'GAN5EVKK6BULRZAFDUZW2DJJFCOSJSK5WUWKWAQCZMEGXPAMJYDLPWLE'
const FAKE_TX_HASH = 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1'

/**
 * A small demo CSV for a valid batch (2 employees, ≤8 total notes).
 * Employee amounts: 10 USDC + 1 USDC = 2 notes total. Well within the 8-note budget.
 */
const DEMO_CSV =
  'name,amount,public_key\n' +
  'Alice,10,' +
  '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef\n' +
  'Bob,1,' +
  'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'

/**
 * A large CSV that decomposes to >8 notes (>8 USDC notes of $1 each).
 * 9 employees × $1 each = 9 notes — exceeds the 8-note circuit limit.
 */
function makeLargeCSV(): string {
  const lines = ['name,amount,public_key']
  for (let i = 0; i < 9; i++) {
    lines.push(
      `Employee ${i + 1},1,` +
        `${'0'.repeat(60)}${i.toString(16).padStart(4, '0')}`,
    )
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Helper: stub Freighter + RPC before page load
// ---------------------------------------------------------------------------

async function injectMocks(page: Page) {
  // Stub the Soroban RPC (same pattern as employer.spec.ts mockRpc)
  await page.route(`**://${RPC_HOST}/**`, async (route) => {
    const request = route.request()
    let method = ''
    try {
      method = (request.postDataJSON() as { method?: string })?.method ?? ''
    } catch {
      method = ''
    }
    const id = (() => {
      try {
        return (request.postDataJSON() as { id?: unknown })?.id ?? 1
      } catch {
        return 1
      }
    })()
    const result =
      method === 'getEvents'
        ? { events: [], latestLedger: 3107100, cursor: '' }
        : method === 'simulateTransaction'
          ? { result: { retval: 'AAAAAA==' } } // minimal ScVal for roots
          : {}
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id, result }),
    })
  })

  // Inject Freighter message protocol shim before any page script runs.
  // Freighter v6 uses window.postMessage with source='FREIGHTER_EXTERNAL_MSG_REQUEST'
  // and expects responses with source='FREIGHTER_EXTERNAL_MSG_RESPONSE'.
  await page.addInitScript(
    ({ address, txHash }: { address: string; txHash: string }) => {
      // Intercept window.postMessage calls from the @stellar/freighter-api package
      const _origPostMessage = window.postMessage.bind(window)
      window.postMessage = function (
        data: unknown,
        targetOriginOrOptions?: string | WindowPostMessageOptions,
        transfer?: Transferable[],
      ) {
        const msg = data as Record<string, unknown>
        if (msg?.source === 'FREIGHTER_EXTERNAL_MSG_REQUEST') {
          const messageId = msg.messagedId ?? msg.messageId
          const type = msg.type as string

          let responseData: Record<string, unknown> = {}

          if (type === 'REQUEST_ACCESS' || type === 'REQUEST_PUBLIC_KEY') {
            responseData = { publicKey: address, apiError: null }
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
            // Echo back the XDR as the signed transaction
            responseData = {
              signedTransaction: msg.transactionXdr ?? 'AAAAAgAAAA==',
              signerAddress: address,
              apiError: null,
            }
          } else if (type === 'REQUEST_CONNECTION_STATUS') {
            responseData = { isConnected: true }
          } else if (type === 'REQUEST_ALLOWED_STATUS') {
            responseData = { isAllowed: true, apiError: null }
          }

          // Dispatch response synchronously after microtask
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
        // Pass through non-Freighter messages
        if (transfer) {
          _origPostMessage(data, targetOriginOrOptions as string, transfer)
        } else {
          _origPostMessage(data, targetOriginOrOptions as string)
        }
      }

      // Stub the submitDeposit function via a window test hook.
      // The PayrollComposer checks window.__SOBRE_TEST_SUBMIT__ in test mode.
      // IMPORTANT: prove() runs BEFORE this hook is read (PayrollComposer.tsx:483-525),
      // so this stub only bypasses the on-chain submit, not the bb.js proving.
      // The proving-path test (E2E-03) is therefore test.skip — see note above.
      ;(window as typeof window & { __SOBRE_TEST_SUBMIT__?: unknown }).__SOBRE_TEST_SUBMIT__ = async (_params: unknown) => ({
        hash: txHash,
        sender: address,
      })

      // Also stub fetch for Soroban RPC calls (getAccount, prepareTransaction, sendTransaction)
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
                  id: address,
                  sequence: '0',
                  balances: [],
                  thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
                  flags: { auth_required: false, auth_revocable: false, auth_immutable: false },
                  signers: [],
                  data: {},
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
                result: { status: 'PENDING', hash: txHash },
              }),
              { headers: { 'Content-Type': 'application/json' } },
            )
          }

          if (method === 'prepareTransaction') {
            const txXdr =
              (body as { params?: { transaction?: string } }).params?.transaction ??
              'AAAAAgAAAA=='
            return new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                result: {
                  transaction: txXdr,
                  minResourceFee: '100',
                  cost: { cpuInsns: '0', memBytes: '0' },
                  results: [{ auth: [], xdr: 'AAAAAA==' }],
                },
              }),
              { headers: { 'Content-Type': 'application/json' } },
            )
          }

          if (method === 'simulateTransaction') {
            // Return a valid ScVal (u256 = 1) as the simulation result.
            const U256_ONE_XDR = 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB'
            return new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                result: {
                  results: [{ auth: [], xdr: U256_ONE_XDR }],
                  cost: { cpuInsns: '0', memBytes: '0' },
                  latestLedger: 3107100,
                },
              }),
              { headers: { 'Content-Type': 'application/json' } },
            )
          }
        }
        return _origFetch(input, init)
      }
    },
    { address: FAKE_ADDRESS, txHash: FAKE_TX_HASH },
  )
}

// ---------------------------------------------------------------------------
// Helper: fill table rows by typing each row (CSV import removed from UI)
// ---------------------------------------------------------------------------

async function importCsv(page: Page, csvContent: string) {
  const rows = csvContent
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^name\s*,\s*amount\s*,\s*public_key$/i.test(l))
    .map((l) => l.split(','))
    .map((fields) => ({ amount: fields[1].trim(), publicKey: fields[2].trim() }))

  for (let i = 0; i < rows.length; i++) {
    if (i > 0) await page.getByRole('button', { name: '+ Add row' }).click()
    await page.getByTestId('employee-key-input').nth(i).fill(rows[i].publicKey)
    await page.getByPlaceholder('e.g. 100').nth(i).fill(rows[i].amount)
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('PayrollComposer employer pay flow', () => {
  /**
   * E2E-01: navigate to /employer, click Connect Freighter, import a small CSV
   * (2 rows summing to ≤8 notes), assert denomination chips render and
   * NoteBudgetMeter shows the correct X/8.
   */
  test('E2E-01: connect + import CSV → chips and budget meter visible', async ({ page }) => {
    await injectMocks(page)
    await page.goto('/employer')

    // PayrollComposer is on the page
    await expect(page.locator('[data-testid="payroll-composer"]')).toBeVisible()

    // Click "Connect Freighter"
    await page.getByRole('button', { name: 'Connect Freighter' }).click()
    // After connect, the wallet address should appear in the button
    await expect(
      page.locator('[data-testid="payroll-composer"]').getByRole('button').first(),
    ).not.toHaveText('Connect Freighter', { timeout: 5000 })

    // Import the demo CSV
    await importCsv(page, DEMO_CSV)

    // The breakdown is collapsed by default — open the first row's "View details"
    await page.getByRole('button', { name: /View details/ }).first().click()

    // Denomination chips should appear for Alice (10 USDC → one $10 chip)
    // and Bob (1 USDC → one $1 chip)
    await expect(page.locator('[data-testid="denom-chip"]').first()).toBeVisible({
      timeout: 3000,
    })

    // NoteBudgetMeter: Alice = 1 note ($10), Bob = 1 note ($1) → 2/8
    await expect(page.getByText('2/8')).toBeVisible({ timeout: 3000 })
  })

  /**
   * E2E-02: load rows that decompose to >8 notes; assert the meter is amber
   * and the Submit button is disabled.
   */
  test('E2E-02: overflow batch → meter amber + Submit disabled', async ({ page }) => {
    await injectMocks(page)
    await page.goto('/employer')

    // Connect first
    await page.getByRole('button', { name: 'Connect Freighter' }).click()
    await page.waitForTimeout(300)

    // Import the large CSV (9 notes → overflow)
    await importCsv(page, makeLargeCSV())
    await page.waitForTimeout(300)

    // Submit button must be disabled
    const submitBtn = page.locator('[data-testid="submit-payroll"]')
    await expect(submitBtn).toBeDisabled({ timeout: 3000 })
  })

  /**
   * E2E-03 (SKIPPED): with a valid batch, click Submit; assert the ProvingStepper
   * advances through proving to done and a tx hash + explorer link appears.
   *
   * WHY SKIPPED: The real bb.js proving (UltraHonk, ~2s) runs BEFORE PayrollComposer
   * reads window.__SOBRE_TEST_SUBMIT__ (see PayrollComposer.tsx:483-525). The new
   * proverClient spawns `new Worker(new URL('../../workers/bb-prover.ts', import.meta.url))`
   * which Turbopack bundles at an unstable chunk URL — page.route cannot intercept it
   * reliably across builds (RESEARCH.md Open Question #3, resolved in Phase 09.1 plan 04).
   * Stubbing the submit hook alone does not bypass the ~2s WASM proving.
   *
   * This path is verified by the HUMAN-VERIFY CHECKPOINT (Task 3) against the live
   * slim noir_pool (CCZKS7KD…) and UltraHonk verifier (CCIMHTM4…). See plan 04,
   * Task 3 for the exact step-by-step live round-trip instructions.
   */
  test.skip('E2E-03: valid batch + bb.js prover → stepper advances to done', async ({ page }) => {
    await injectMocks(page)
    await page.goto('/employer')

    // Connect
    await page.getByRole('button', { name: 'Connect Freighter' }).click()
    await page.waitForTimeout(500)

    // Import CSV
    await importCsv(page, DEMO_CSV)
    await page.waitForTimeout(500)

    // Submit
    const submitBtn = page.locator('[data-testid="submit-payroll"]')
    await expect(submitBtn).not.toBeDisabled({ timeout: 8000 })
    await submitBtn.click()

    // The proving stepper should become visible
    await expect(page.locator('[data-testid="proving-stepper"]')).toBeVisible({
      timeout: 5000,
    })

    // Wait for the "done" state — tx hash and explorer link should appear
    await expect(page.locator('[data-testid="stepper-done"]')).toBeVisible({
      timeout: 30000,
    })

    // Explorer link must include the fake tx hash
    const explorerLink = page.locator('[data-testid="explorer-link"]')
    await expect(explorerLink).toBeVisible()
    await expect(explorerLink).toHaveText(FAKE_TX_HASH)
  })

  // 06.3-04: with the auditor public key persisted (from the auditor console in
  // the same browser), enabling the compliance toggle autofills the field.
  test('compliance field autofills the persisted auditor public key', async ({ page }) => {
    await injectMocks(page)
    // Seed localStorage before any page script runs (simulates a prior auditor
    // session). Use a valid base64 32-byte key, matching what the auditor stores.
    const auditorPub = Buffer.alloc(32, 7).toString('base64')
    await page.addInitScript((pub) => {
      window.localStorage.setItem('sobre.auditorPublicKey', pub as string)
    }, auditorPub)

    await page.goto('/employer')
    await expect(page.locator('[data-testid="payroll-composer"]')).toBeVisible()

    // Connect Freighter first — the audit toggle is only rendered once the
    // wallet is connected (PayrollComposer.tsx: {address && (...)}).
    await page.getByRole('button', { name: 'Connect Freighter' }).click()
    await expect(
      page.locator('[data-testid="payroll-composer"]').getByRole('button').first(),
    ).not.toHaveText('Connect Freighter', { timeout: 5000 })

    // Enable "Add an auditor for compliance".
    await page.getByTestId('audit-toggle').click()

    // The field appears already filled with the persisted public key.
    const field = page.getByTestId('auditor-key-input')
    await expect(field).toBeVisible()
    await expect(field).toHaveValue(auditorPub)
  })
})
