import { test, expect } from '@playwright/test'

/**
 * surfaces-smoke.spec.ts — 3-route smoke test (no HTTP 500)
 *
 * Verifies that /employer, /employee, and /auditor each render in next dev
 * without an HTTP 500 or Next.js error overlay. Each test asserts:
 *   1. HTTP response status < 500.
 *   2. No Next.js "Unhandled Runtime Error" overlay visible.
 *   3. No "Internal Server Error" text visible.
 *   4. The surface's MOUNT-TIME anchor is visible (proving the page actually
 *      mounted, not just returned a 200 shell).
 *
 * Mount-time anchors (pinned against page sources — Phase 09.1 plans 01-03):
 *   /employer: data-testid="payroll-composer"   (PayrollComposer.tsx:581, unconditional)
 *   /employee: data-testid="employee-key-reveal" (EmployeeKeyInput.tsx:70, unconditional)
 *   /auditor : placeholder "Paste your view-key" (ViewKeyInput.tsx:35, no data-testid)
 *
 * These smoke tests do NOT require Freighter, a live pool, or any wallet
 * connection. They only verify that the route compiles and mounts cleanly
 * after the import-path fixes in plans 01-03.
 */

test.describe('Surface smoke — no HTTP 500', () => {
  test('/employer renders without HTTP 500 or error overlay', async ({ page }) => {
    const resp = await page.goto('/pay')
    expect(resp?.status()).toBeLessThan(500)

    await expect(page.locator('text=Unhandled Runtime Error')).toHaveCount(0)
    await expect(page.locator('text=Internal Server Error')).toHaveCount(0)

    // Mount-time anchor: PayrollComposer.tsx renders data-testid="payroll-composer"
    // unconditionally on mount — visible confirms the route fully rendered.
    await expect(page.getByTestId('payroll-composer')).toBeVisible({ timeout: 15000 })
  })

  test('/employee renders without HTTP 500 or error overlay', async ({ page }) => {
    const resp = await page.goto('/receive')
    expect(resp?.status()).toBeLessThan(500)

    await expect(page.locator('text=Unhandled Runtime Error')).toHaveCount(0)
    await expect(page.locator('text=Internal Server Error')).toHaveCount(0)

    // Mount-time anchor: EmployeeKeyInput.tsx renders data-testid="employee-key-reveal"
    // unconditionally via employee/page.tsx — visible confirms the route fully rendered.
    await expect(page.getByTestId('employee-key-reveal')).toBeVisible({ timeout: 15000 })
  })

  test('/auditor renders without HTTP 500 or error overlay', async ({ page }) => {
    const resp = await page.goto('/audit')
    expect(resp?.status()).toBeLessThan(500)

    await expect(page.locator('text=Unhandled Runtime Error')).toHaveCount(0)
    await expect(page.locator('text=Internal Server Error')).toHaveCount(0)

    // Mount-time anchor: ViewKeyInput.tsx has no data-testid; use placeholder text
    // (ViewKeyInput.tsx:35, rendered unconditionally on mount).
    // Do NOT use auditor-empty/auditor-invalid/auditor-error — those are state-conditional.
    await expect(page.getByPlaceholder(/Paste your view-key/)).toBeVisible({ timeout: 15000 })
  })
})
