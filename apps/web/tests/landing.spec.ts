import { test, expect } from '@playwright/test'

test.describe('Landing page smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('hero h1 renders', async ({ page }) => {
    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toContainText('Private payroll in stablecoins.')
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

  test('trust model section renders', async ({ page }) => {
    await expect(page.getByText('Verifiable by anyone. Owned by no one.')).toBeVisible()
    await expect(page.getByText('Sobrecito never touches your funds or your keys.')).toBeVisible()
    await expect(page.getByText('If the provider disappears tomorrow', { exact: false })).toBeVisible()
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
