import { test, expect } from '@playwright/test'

// UX-03 scaffold. Plan 06-03 fills the auditor console and tightens the
// reveal/bad-key assertions. The `Auditor console` describe name is the
// `--grep auditor` target.
test.describe('Auditor console', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auditor')
  })

  test('page loads', async ({ page }) => {
    // The (demo) layout wraps the route in FloatingNav + MotionConfig.
    await expect(page.locator('body')).toBeVisible()
  })

  // Plan 06-03 builds ViewKeyInput; until then the textarea + CTA do not exist.
  test.skip('renders the view-key textarea and Reconstruct batch button', async ({ page }) => {
    await expect(
      page.getByRole('textbox', { name: 'View-key (X25519 private key, base64)' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reconstruct batch' })).toBeVisible()
  })
})
