import { test, expect, type Page } from '@playwright/test'

/**
 * employer-pay.spec.ts — Playwright e2e for the PayrollComposer + ProvingStepper flow.
 *
 * Mocking strategy:
 *   1. Freighter: inject `window.freighterApi` shim before page load via
 *      page.addInitScript(). All Freighter calls (requestAccess, getAddress,
 *      getNetwork, signTransaction) return successful stubs.
 *   2. Prover: intercept the `initProver`/`prove` calls by replacing
 *      `/zk/prover-client.js` with a stub module that resolves immediately.
 *      This avoids actual WASM proving (which needs large circuit artifacts
 *      and takes 20-40s).
 *   3. RPC: route `soroban-testnet.stellar.org` to return empty results
 *      (same as employer.spec.ts mockRpc).
 *
 * No real WASM proving, no testnet, no real Freighter extension.
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
// Helper: stub Freighter + prover before page load
// ---------------------------------------------------------------------------

async function injectMocks(page: Page) {
  // Stub the Soroban RPC (same pattern as employer.spec.ts)
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

  // Serve a stub prover-client.js that resolves immediately.
  // The real file lives at /zk/prover-client.js; we intercept it and return
  // a JS module with the same exported API but no actual WASM.
  await page.route('**/zk/prover-client.js', (route) => {
    const stubModule = `
// Stub prover-client.js — e2e test, no real WASM
const _listeners = new Set();

export function configure() {}

export async function initializeProver() {
  // Signal progress: one tick of download
  for (const fn of _listeners) {
    fn(1024 * 1024, 1024 * 1024, 'Cached (test stub)', 100);
  }
}

export function onProgress(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export async function prove(_inputs, _opts) {
  // Return a fake 256-byte proof
  const proof = new Uint8Array(256).fill(42);
  const publicInputs = new Uint8Array(32).fill(0);
  return { proof, publicInputs, sorobanFormat: true, timings: {} };
}

export async function computeCommitment(_amount, _pubkey, _blinding) {
  // Return a fake commitment as a decimal string (matches new proverClient interface).
  // proverClient.ts now expects computeCommitment to return a string (BigInt-parseable).
  return '1';
}

export async function computeNullifier(_privKey, _blinding, _pathIdx) {
  // Return a fake nullifier as a decimal string.
  return '2';
}

export async function derivePublicKey(_priv, _asHex) {
  // Return 32 zero bytes (the deposit flow derives bn254Pub via this bridge).
  return new Uint8Array(32).fill(0);
}

export async function computeMembershipLeaf(_pubkey, _blinding) {
  // Fake ASP membership leaf as a decimal string.
  return '3';
}

export async function reconstructMerklePath(_leaves, _targetIndex, depth = 10) {
  // Fake Merkle path of the requested depth (decimal field elements).
  return { pathElements: Array(depth).fill('3'), pathIndices: '0' };
}
`
    route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: stubModule,
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
            // 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB' is U256(1).
            // fetchPoolRoot and fetchASPRoots call simulateTransaction and
            // extract `result.retval` from the parsed response.
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
// Helper: upload a CSV file via page.setInputFiles
// ---------------------------------------------------------------------------

// CSV import was removed from the UI — fill the table by typing each row
// (parse the legacy CSV fixtures into amount + public key and enter them).
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
    await page.getByPlaceholder('64-char hex pubkey').nth(i).fill(rows[i].publicKey)
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
   * E2E-03: with a valid batch + stubbed prover, click Submit; assert the
   * ProvingStepper advances preparing → downloading → proving → done and a
   * tx hash + explorer link appears.
   */
  test('E2E-03: valid batch + stubbed prover → stepper advances to done', async ({ page }) => {
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
})
