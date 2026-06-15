import { test, expect } from '@playwright/test'

test.describe('Landing page smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('hero h1 renders', async ({ page }) => {
    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toContainText("Payroll that doesn't dox your team.")
  })

  test('problem section renders', async ({ page }) => {
    await expect(page.getByText('every salary is public forever')).toBeVisible()
    await expect(page.getByText('Sobrecito holds both.')).toBeVisible()
  })

  test('three levels renders', async ({ page }) => {
    await expect(page.getByText('You see the breakdown.')).toBeVisible()
    await expect(page.getByText('They see the total, proven.')).toBeVisible()
    await expect(page.getByText('Auditor reconstructs detail via view-key.')).toBeVisible()
  })

  test('why stellar section renders', async ({ page }) => {
    await expect(page.getByText('Built for the moment Stellar made it possible.')).toBeVisible()
    await expect(page.getByText('Protocol')).toBeVisible()
  })

  test('differentiation focuses on sobrecito', async ({ page }) => {
    await expect(page.getByText('Prove the total without showing a single salary.')).toBeVisible()
    await expect(page.getByText('Only the auditor can open it.')).toBeVisible()
  })

  test('nav links have valid href attributes', async ({ page }) => {
    // Use .first() because "Watch the demo" appears in both FloatingNav and Hero
    const watchDemo = page.getByRole('link', { name: 'Watch the demo' }).first()
    const viewGithub = page.getByRole('link', { name: 'View on GitHub' }).first()

    await expect(watchDemo).toBeVisible()
    await expect(viewGithub).toBeVisible()

    const demoHref = await watchDemo.getAttribute('href')
    const githubHref = await viewGithub.getAttribute('href')

    expect(demoHref).toBeTruthy()
    expect(demoHref).not.toBe('#')
    expect(githubHref).toBeTruthy()
    expect(githubHref).not.toBe('#')
  })
})
