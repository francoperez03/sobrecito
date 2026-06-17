import { test } from '@playwright/test'

/**
 * Employee claim dashboard e2e spec.
 * Scaffold from 06.3-01 Wave 0. Plans 02/03/04 implement these.
 *
 * CAP grep strings (from 06.3 VALIDATION.md) are embedded as test names.
 * Plan 02 implements the scan tests; plan 03 implements the UI tests;
 * plan 04 implements the claim / receipt / edge state tests.
 */

test.describe('Employee dashboard', () => {
  // Plan 02: scan implementation
  test.skip('lists all employee payments', async () => {
    // Plan 02 fills this in: scan pool with the test seed, verify all notes appear.
  })

  test.skip('shows balance summary', async () => {
    // Plan 03 fills this in: header shows total claimable / claimed / X of N counter.
  })

  // Plan 04: claim flow
  test.skip('claim stepper', async () => {
    // Plan 04 fills this in: click Claim, stepper shows proving progress, submit with Freighter mock.
  })

  test.skip('shows receipt', async () => {
    // Plan 04 fills this in: after successful claim, receipt shows txHash + explorer link.
  })

  test.skip('edge states', async () => {
    // Plan 04 fills this in: already-claimed note, pool empty, clave sin notas, tx rejected, prueba falla.
  })

  test.skip('disclosure', async () => {
    // Plan 03/04 fills this in: amber disclosure banner shown before CTA; confirms linkability warning.
  })
})
