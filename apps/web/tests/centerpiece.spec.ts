import { test, expect } from '@playwright/test'

test.describe('Centerpiece toggle interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  // Scope amount assertions to the Centerpiece itself. The same demo amounts now
  // also appear in the ThreeLevels per-role views (RoleView), so a page-wide
  // getByText would match multiple nodes — these checks are about the Centerpiece
  // toggle specifically.
  const centerpiece = (page: import('@playwright/test').Page) =>
    page.locator('[data-testid="centerpiece"]')

  test('default load shows public view with amount bars, no numeric amounts', async ({ page }) => {
    // Amount bars should be visible in public state
    await expect(centerpiece(page).locator('[data-testid="amount-bar"]').first()).toBeVisible()
    // Numeric amounts like "$34,200" should NOT be visible in the Centerpiece
    await expect(centerpiece(page).getByText('$34,200')).not.toBeVisible()
  })

  test('click Auditor tab reveals amounts', async ({ page }) => {
    await page.getByRole('tab', { name: 'Auditor' }).click()
    await expect(centerpiece(page).getByText('$34,200')).toBeVisible()
  })

  test('click Public tab hides amounts again', async ({ page }) => {
    await page.getByRole('tab', { name: 'Auditor' }).click()
    await expect(centerpiece(page).getByText('$34,200')).toBeVisible()

    await page.getByRole('tab', { name: 'Public' }).click()
    await expect(centerpiece(page).getByText('$34,200')).not.toBeVisible()
  })

  test('keyboard: Tab + Enter switches to Auditor view and reveals amounts', async ({ page }) => {
    // Focus the toggle control
    await page.getByRole('tablist').focus()
    // Navigate to Auditor tab using arrow key
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(centerpiece(page).getByText('$34,200')).toBeVisible()
  })

  test('reduced-motion: toggling still reveals amounts (functions without animation)', async ({ page }) => {
    // This test runs in the reduced-motion project variant
    await page.getByRole('tab', { name: 'Auditor' }).click()
    await expect(centerpiece(page).getByText('$34,200')).toBeVisible()
  })
})
