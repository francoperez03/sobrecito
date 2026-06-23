import { test, expect, type Page } from '@playwright/test'

// Employee claim surface (UI-SPEC Surface 4, STRETCH, RESEARCH D-12 fallback #1).
// The `Employee claim` describe name is the `--grep employee` target. The route
// decodes the note metadata from the `[token]` param entirely client-side; these
// tests build a valid base64url token and drive the sealed-card + amber-warning
// flow. The Freighter signature is a documented manual step (no extension in CI),
// so the Claim path is asserted to fail gracefully (error, never a crash) rather
// than to produce a live tx.

/** A valid NoteMeta encoded as the base64url claim token (the route's format). */
function makeToken(): string {
  const meta = {
    poolContractId: 'CDHJ6W5ZCK7STNED7AT7SKCURQDFVCFJL6ZBF6XW7QMPOIBKHAOLCVL2',
    commitmentIndex: 8,
    amount: '200',
    notePrivkeyHex: '42'.repeat(32),
    blinding: '12345',
  }
  const json = JSON.stringify(meta)
  const b64 = Buffer.from(json, 'utf8').toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function gotoClaim(page: Page) {
  await page.goto(`/employee/${makeToken()}`)
}

test.describe('Employee claim', () => {
  test('renders a single sealed-note claim card', async ({ page }) => {
    await gotoClaim(page)
    // Heading present.
    await expect(
      page.getByRole('heading', { name: 'Your salary is waiting.' }),
    ).toBeVisible()
    // The amount is SEALED behind the bar: the bar is in the DOM, the amount is not.
    await expect(page.locator('[data-testid="amount-bar"]')).toBeVisible()
    await expect(page.getByText('200', { exact: true })).toHaveCount(0)
  })

  test('amber warning fires BEFORE the Cash out CTA', async ({ page }) => {
    await gotoClaim(page)
    const warning = page.getByText(
      'Once you cash out, this amount becomes visible on-chain.',
    )
    const cta = page.getByRole('button', { name: 'Cash out' })
    await expect(warning).toBeVisible()
    await expect(cta).toBeVisible()
    // Source/DOM order: the amber chip precedes the CTA.
    const order = await warning.evaluate((w, c) => {
      const pos = w.compareDocumentPosition(c as Node)
      // DOCUMENT_POSITION_FOLLOWING (4) means the CTA comes after the warning.
      return (pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    }, await cta.elementHandle())
    expect(order).toBe(true)
  })

  test('clicking Cash out without a wallet fails gracefully (no crash)', async ({
    page,
  }) => {
    await gotoClaim(page)
    await page.getByRole('button', { name: 'Cash out' }).click()
    // No Freighter extension in CI: unshieldNote rejects, the card shows the error
    // state, and the page stays alive (heading still rendered, amount still sealed).
    await expect(
      page.getByRole('heading', { name: 'Your salary is waiting.' }),
    ).toBeVisible()
    await expect(page.getByText('200', { exact: true })).toHaveCount(0)
  })

  test('an invalid token shows the not-valid state', async ({ page }) => {
    await page.goto('/employee/not-a-real-token')
    await expect(
      page.getByRole('heading', { name: 'This claim link is not valid.' }),
    ).toBeVisible()
  })
})
