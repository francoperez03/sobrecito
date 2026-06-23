import { test, expect, type Page } from '@playwright/test'

// UX-02 (6-EMP-render, 6-EMP-empty). The `Employer dashboard` describe name is
// the `--grep employer` target. The page scans the live pool over Soroban
// JSON-RPC (`getEvents`); these tests intercept that POST so the suite is
// deterministic and offline.

const RPC_HOST = 'soroban-testnet.stellar.org'

/**
 * Stub the Soroban RPC. Every `getEvents` call resolves to `events` with no
 * cursor (single page). Any other RPC method gets a benign empty result.
 */
async function mockRpc(page: Page, events: unknown[]) {
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
        ? { events, latestLedger: 3107100, cursor: '' }
        : {}

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id, result }),
    })
  })
}

test.describe('Employer dashboard', () => {
  test('page loads', async ({ page }) => {
    await mockRpc(page, [])
    await page.goto('/employer')
    // The (demo) layout wraps the route in FloatingNav + MotionConfig.
    await expect(page.locator('body')).toBeVisible()
  })

  // 6-EMP-empty: RPC mocked to 0 events → empty-state copy is shown.
  test('shows empty-state copy when no payroll is on-chain', async ({ page }) => {
    await mockRpc(page, [])
    await page.goto('/employer')
    await expect(page.getByText('No payroll yet')).toBeVisible()
  })

  // 6-EMP-render: the record rail heading renders. The empty-state copy carries
  // the public-lens framing (sealed + proven).
  test('renders the payroll record heading and sealed framing', async ({ page }) => {
    await mockRpc(page, [])
    await page.goto('/employer')
    await expect(
      page.getByRole('heading', { name: 'Payroll record' }),
    ).toBeVisible()
    // The empty record explains the sealed-and-proven model.
    await expect(page.getByText('sealed and proven')).toBeVisible()
  })

  // UX-02 A1 (T-06-09): no individual amount node anywhere on /employer, even
  // with a populated batch. The employer view matches the public view (status +
  // commitment, no amounts). Mock 8 commitment events (one per demo note) and
  // assert the table renders with zero amount leakage.
  test('does not expose any individual amount', async ({ page }) => {
    // Base64 XDR fixtures generated with @stellar/stellar-sdk (nativeToScVal),
    // so they decode through scanCommitmentEvents exactly like a live event.
    // topic[0] = scvSymbol("new_commitment_event"); topic[1] = U256 commitment;
    // value = scvMap { index: u32, encrypted_output: bytes("") }. The value
    // carries NO amount — amounts live only in encrypted_output, never decoded.
    const COMMIT_XDR =
      'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB'
    // One value per index 0..7 (differ only in the trailing u32 index byte).
    const VALUE_XDR = [
      'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAAAAAAAPAAAABWluZGV4AAAAAAAAAwAAAAA=',
      'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAAAAAAAPAAAABWluZGV4AAAAAAAAAwAAAAE=',
      'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAAAAAAAPAAAABWluZGV4AAAAAAAAAwAAAAI=',
      'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAAAAAAAPAAAABWluZGV4AAAAAAAAAwAAAAM=',
      'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAAAAAAAPAAAABWluZGV4AAAAAAAAAwAAAAQ=',
      'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAAAAAAAPAAAABWluZGV4AAAAAAAAAwAAAAU=',
      'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAAAAAAAPAAAABWluZGV4AAAAAAAAAwAAAAY=',
      'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAAAAAAAPAAAABWluZGV4AAAAAAAAAwAAAAc=',
    ]
    const events = Array.from({ length: 8 }, (_, i) => ({
      type: 'contract',
      // Empty contractId so the SDK parser skips Contract construction.
      contractId: '',
      ledger: 3107053 + i,
      topic: ['AAAADwAAABRuZXdfY29tbWl0bWVudF9ldmVudA==', COMMIT_XDR],
      value: VALUE_XDR[i],
    }))
    await mockRpc(page, events)
    await page.goto('/employer')

    // The populated record renders the ready-state rail (proves we are exercising
    // the data path, not silently falling back to empty/error state). The proven
    // total is the public predicate; per-employee amounts never render here.
    await expect(page.getByText('Proven total')).toBeVisible()

    // No amount-bar reveal elements (that pattern lives only in the auditor
    // table). The employer dashboard has zero.
    await expect(page.locator('[data-testid="amount-bar"]')).toHaveCount(0)

    // No per-employee amount text leaks: a sample salary like "200" (a demo
    // amount from ops/fixtures/demo.csv) is NOT visible anywhere in the DOM.
    // The only number the page shows is the declared total T (800 USDC), which
    // is the public predicate, not an individual amount.
    await expect(page.getByText('200', { exact: true })).toHaveCount(0)
    await expect(page.getByText('120', { exact: true })).toHaveCount(0)
  })
})
