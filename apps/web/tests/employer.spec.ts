import { test, expect } from '@playwright/test'

// UX-02 scaffold. Plan 06-02 fills the employer dashboard and tightens these
// assertions. The `Employer dashboard` describe name is the `--grep employer` target.
test.describe('Employer dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/employer')
  })

  test('page loads', async ({ page }) => {
    // The (demo) layout wraps the route in FloatingNav + MotionConfig.
    await expect(page.locator('body')).toBeVisible()
  })

  // Plan 06-02 wires live RPC; until then the dashboard renders the empty state.
  test.skip('shows empty-state copy when no batch is on-chain', async ({ page }) => {
    await expect(page.getByText('No batch on-chain yet.')).toBeVisible()
  })

  // UX-02 A1: no individual amount nodes — the employer view matches the public
  // view (status + commitment, no amounts). Plan 06-02 fills the amount-leak guard.
  test.skip('does not expose any individual amount', async ({ page }) => {
    // Plan 06-02: assert no numeric amount cells render in the payroll table.
    await expect(page.locator('[data-testid="amount"]')).toHaveCount(0)
  })
})
