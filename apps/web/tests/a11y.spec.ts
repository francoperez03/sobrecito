import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Helper: wait until all Hero entrance animations have settled.
// Hero elements animate with delays up to 400ms over 800ms duration = 1200ms total.
// We poll until the subhead (second animated element) is also visible.
async function waitForHeroSettled(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => {
      // The subhead is the second text element in the hero section (a <p> after the h1)
      const h1 = document.querySelector('h1')
      const subhead = h1?.nextElementSibling as HTMLElement | null
      if (!h1 || !subhead) return false
      const h1Style = window.getComputedStyle(h1)
      const subStyle = window.getComputedStyle(subhead)
      return (
        parseFloat(h1Style.opacity) > 0.9 &&
        parseFloat(subStyle.opacity) > 0.9
      )
    },
    { timeout: 5000 }
  )
}

test.describe('a11y — WCAG contrast checks', () => {
  test('landing page passes axe-core checks for serious/critical violations', async ({ page }) => {
    await page.goto('/')

    // Wait for Hero entrance animations to settle so axe-core evaluates
    // the final rendered state rather than mid-animation opacity values.
    await waitForHeroSettled(page)

    const results = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze()

    const seriousOrCritical = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    )

    expect(seriousOrCritical).toEqual([])
  })

  test('body text meets WCAG AA contrast (4.5:1 minimum)', async ({ page }) => {
    await page.goto('/')

    // Wait for Hero entrance animations to settle before contrast analysis
    await waitForHeroSettled(page)

    const results = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze()

    const contrastViolations = results.violations.filter(
      (v) => v.id === 'color-contrast' && (v.impact === 'serious' || v.impact === 'critical')
    )

    expect(contrastViolations).toEqual([])
  })
})
