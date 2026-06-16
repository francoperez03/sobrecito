import { test, expect, type Page } from '@playwright/test'

// UX-03 (6-AUD-reveal, 6-AUD-amounts, 6-AUD-badkey). The `Auditor console`
// describe name is the `--grep auditor` target.
//
// The /auditor page calls `reconstructBatch` client-side (D-09): the auditor's
// view-key NEVER leaves the browser. `reconstructBatch` scans the live pool over
// Soroban JSON-RPC (`getEvents`) and decrypts the auditor half of each
// encrypted_output with the pasted key. These tests intercept that POST and
// return REAL dual-blob XDR fixtures generated against a FIXED test auditor key
// (0x42 × 32), so the genuine reconstruction engine runs — no `reconstructBatch`
// stub. The fixed privkey is pasted in the reveal/amounts tests; a malformed key
// is pasted in the bad-key test.

const RPC_HOST = 'soroban-testnet.stellar.org'

// FIXED test auditor X25519 private key (32 bytes of 0x42), hex-encoded. The
// fixtures below were encrypted to its public key, so pasting this hex decrypts
// them. Test material only — shielded BN254 field values, not real USDC.
const AUDITOR_PRIV =
  '4242424242424242424242424242424242424242424242424242424242424242'

// topic[0] = symbol("new_commitment_event"), base64 XDR.
const COMMIT_TOPIC0 = 'AAAADwAAABRuZXdfY29tbWl0bWVudF9ldmVudA=='

// 8 NewCommitmentEvents. topic[1] is a placeholder U256 commitment; value is an
// scvMap { encrypted_output: bytes (REAL dual blob), index: u32 }. The
// encrypted_output decrypts under AUDITOR_PRIV to amounts [50,80,120,60,200,90,
// 110,90], sum = 800 = T. Generated with @stellar/stellar-sdk nativeToScVal +
// the viewkey ECIES engine; they decode through scanCommitmentEvents +
// reconstructBatch exactly like a live event.
const FIXTURE_EVENTS = [
  { type: 'contract', contractId: '', ledger: 3110570, topic: [COMMIT_TOPIC0, 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPo'], value: 'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAQAAAAB8wiA2njq7abwhIJ36Y36o8uwmFb/UzBtrE+/4L+aWO3cD+ZF/7w6J9sAsesafDRZ/w315B38vAE3tnb9pHh4CXFbrdShqQwi3tuAE3LCyxxbYrdksKH4JWTPnu9q1kl7TtlWS59Cb8oFaYF/4+PlBQoYsqRRV+4lJDvB0IwAAAHynf8Hp+dzJfH7CmQwCgn/EgY2kJoYrwnf/A364yz90X5mFVpCe9FqhCfUMX4Pf4QDs3iBxQt/IAJakurakqU7D82U9XWMQaKFYCB9exLcbnsCQ7ACIUPjnnKuKR250TRLRHCKgiHTwDhHtQ2OcpBHswfoPPXdKnCBNQ8M3AAAADwAAAAVpbmRleAAAAAAAAAMAAAAA' },
  { type: 'contract', contractId: '', ledger: 3110571, topic: [COMMIT_TOPIC0, 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPp'], value: 'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAQAAAAB8/UhVQHsAh2Gban7XNI6VVyA0z4Ws/8ALbuh6DMNBGHCWb+LVvHlfTcoHSnI4kZZW1HhDgdYj42P2502xTu1qGks3klWO3TrAfGSpSRviOO4+hsb4SNlVLzZaYr93+tL3lKA/1B1GnTBHcFCy+BnUuACUTduVxic7Un51lAAAAHzDh+JKW3ZdJxzKsJfdApOApqgpmMpaqTvi6ElocyfaIVLmGcjJjdgKBUzA4EdsUPnIJfkLdyHvFpvz7Hl67Gcw30q7ojRzXlbV9VYATjH2XPiQOLP3H1ytxlOhZsA4aaUJvRDW9X+wKFKNcxlaAxnO0jIN60LRPSX0SCTXAAAADwAAAAVpbmRleAAAAAAAAAMAAAAB' },
  { type: 'contract', contractId: '', ledger: 3110572, topic: [COMMIT_TOPIC0, 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPq'], value: 'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAQAAAAB8humNVGy1MwOKm1UUmPZVYk2Lp83qN/m5hzVWI7otp2RGG+L243o/KjRnC9cfubxq+qmTm3hXFT9tnf3t5laUvhN4CYMWKQBa+PJ0PoHEtaG6tBKMumWyGRhqIz0S5k0JwDqYXhmedZMaN0+DW1SQoHbVCCtRaSA+9bWuPgAAAHzwM/edEmvLqbiStRwJFqETpyHVEpX+veLmJvftyZkEeR+0p3eg6r+kA59+ieeEGXyiJvyAwtE/vbSWaXZgLK48nIjssmO77kHYlHnRNTVZmG0Mah0GRHOSPPgp6Nh3WgRE5x/f6wh8YNb1MinTk0ca9vURzXtt425/n5xoAAAADwAAAAVpbmRleAAAAAAAAAMAAAAC' },
  { type: 'contract', contractId: '', ledger: 3110573, topic: [COMMIT_TOPIC0, 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPr'], value: 'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAQAAAAB87mn+6ACYtYY/u4OO7qkt5d9qbVn8ZjD1ePd8osMlOlPZaXAQUL3PNfPv3k0G+zqKjxt5UKnAPJUnQ92gAN4l+A6SKKTD+/9JJJF2092BswstT5hPz9PxIMc65CORnayuFjGqYyOeybwQ6kFHFCiEIas5ISmWnYmvPXKGrAAAAHwMRI2NJVThbTLs7n+QhNzMqfOvFmnGYbjxUA0B8Th2O5DDO7VPQNUgXWkyAs2Pyki0QuBSvLQZrg37KK0uOYdv05mABqM63U13aS5rT+B7VWPk2oHjcNH3VBLnqqc5Yg0mtaYZ7yP6WjduKwnVQ52YXbhm8VDEOHyhzDsrAAAADwAAAAVpbmRleAAAAAAAAAMAAAAD' },
  { type: 'contract', contractId: '', ledger: 3110574, topic: [COMMIT_TOPIC0, 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPs'], value: 'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAQAAAAB8QNIILVXZWt3qztW5wmovDI4mFp6VgLD4GlaKvD+8Fxj0hfRfFIcuHriM1/+/ci9iDqRP2W3A43TmF50PSdJogp/0PKpE0gIVJqcOA/15dbIu2HBMN6K7SwZuQ0/V8P6DSqsn6ZtDO7EqhaSwQDdxwAZfvE7idVfgbM+ALQAAAHyQciSPAy5Yqw+GcbrcjuoElVXfOVcNtqsPJp05hEoja6QKHpFXSN5mTyhj8SlpXLEc7DcCCzZfj+QQmOG0Nkl9ieKPNe7vcAMLdDrdkAAwamtnRhIXzZwH5qLF/kmteU/W/XyQP8oKPsWqGRhu9t2JMVR0lx4hFmpXApIkAAAADwAAAAVpbmRleAAAAAAAAAMAAAAE' },
  { type: 'contract', contractId: '', ledger: 3110575, topic: [COMMIT_TOPIC0, 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPt'], value: 'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAQAAAAB8PNNBGYczyDMo2/rbUj50ihrYoOdFTAdaiP1Nu6aKGRgPbvJzBuyZ8YzpUxmvHd+vowU4NVzeQZBmOFlhs0VKEjcdvHLBR2tablwaO1an9Rlpucocp2I8azmp+jkTZz8Nwlb57xRMnA/4pxr6pLM0rh4+l5MBbxC0o+c22AAAAHwOSiUo9tw/fhbjW/f8OS1ZvG/g8weBiQchxDVCo+xxLhl8gJUzSh8s/zBKQjsS8Zfl5xqfliyQiL4DChQMc8BIck056EbLyf63NVVP2RqBneLJjeu/HQoHUaWd7k8ifLo3zAYYYPIzzQtHlOy6hd/WEO2kEsJJIhb1yuy4AAAADwAAAAVpbmRleAAAAAAAAAMAAAAF' },
  { type: 'contract', contractId: '', ledger: 3110576, topic: [COMMIT_TOPIC0, 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPu'], value: 'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAQAAAAB8bZfBoecOe/wYbvhBc2r+vZ07uxHjblGWM5KLGi3z10dvAOdl+T6js5rXEOXwyUe9W5MxJgeMgDaKJCmuMgBie+YzCo/6d4urvBgZE0q4xt7N7Vt7A54GVbJS2HhFHOn/A2jXf4LgItiAJvlYA+Nnt3+TjTZS0gkF323OPgAAAHw7oR1+Ocbs7J2lML/T/b3iWxsU6FUsbP5RIwxcFtl2GyhbZySu8E6bvb1LhffZPJ7se+6a4DS2j9hR3fX/n+6ywTGmvfhW+WL9Kgt7Up29iIsncFM3dFD0muDvPBDsyjvqEfKJTz9tbsWCCzPzrSN4DAftBPnVg0PdRyNeAAAADwAAAAVpbmRleAAAAAAAAAMAAAAG' },
  { type: 'contract', contractId: '', ledger: 3110577, topic: [COMMIT_TOPIC0, 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPv'], value: 'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAQAAAAB8ou/Itjw//TuhfGRQwyXCjmY1vIiM//PgeOWOgTau1VjevCk+ntIki3USj9g8aK2/r80yLnSm27YcrM4LKVLBHVbwdxhwCJfDF1EWMyF12On+BLLErjnUo3H5t7qpszOjBE375rqjroFSsZM3iWkuVhksGNjDB8vRqR4rjAAAAHzXVgCOXCwy3BIU4WGRHFbgStqi6eGUHnByQVC4ILJ9f4RSqEbk4V8jsF3TcC+byc5pZOEH4M3duLaCVugcdGZ30ob3ivRpvsCxqCUHL1XCZI0ISc5pjFnFJtAKpxJunq/wr3oThMKmPL24qHBSv9B/vEO6aTa+cg9kn4ozAAAADwAAAAVpbmRleAAAAAAAAAMAAAAH' },
]

/**
 * Stub the Soroban RPC. Every `getEvents` call resolves to `events` with no
 * cursor (single page). Any other RPC method gets a benign empty result.
 */
async function mockRpc(page: Page, events: unknown[]) {
  await page.route(`**://${RPC_HOST}/**`, async (route) => {
    const request = route.request()
    let method = ''
    let id: unknown = 1
    try {
      const body = request.postDataJSON() as { method?: string; id?: unknown }
      method = body?.method ?? ''
      id = body?.id ?? 1
    } catch {
      method = ''
    }

    const result =
      method === 'getEvents'
        ? { events, latestLedger: 3110600, cursor: '' }
        : {}

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id, result }),
    })
  })
}

test.describe('Auditor console', () => {
  test('page loads', async ({ page }) => {
    await page.goto('/auditor')
    // The (demo) layout wraps the route in FloatingNav + MotionConfig.
    await expect(page.locator('body')).toBeVisible()
  })

  test('renders the view-key textarea and Reconstruct batch button', async ({
    page,
  }) => {
    await page.goto('/auditor')
    await expect(
      page.getByRole('textbox', {
        name: 'View-key (X25519 private key, base64)',
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Reconstruct batch' }),
    ).toBeVisible()
    // D-09 disclosure is present.
    await expect(
      page.getByText('Your key never leaves this browser.'),
    ).toBeVisible()
  })

  // 6-AUD-reveal + 6-AUD-reconcile: paste the fixed key, click Reconstruct, the
  // batch reconstructs client-side and reconciles sum(decrypted) === T → the
  // Match verdict becomes visible.
  test('reveals the batch and shows the Match verdict on reconstruct', async ({
    page,
  }) => {
    await mockRpc(page, FIXTURE_EVENTS)
    await page.goto('/auditor')

    await page
      .getByRole('textbox', { name: 'View-key (X25519 private key, base64)' })
      .fill(AUDITOR_PRIV)
    await page.getByRole('button', { name: 'Reconstruct batch' }).click()

    await expect(
      page.getByText('✓ Totals match — batch is sound.'),
    ).toBeVisible()
    // Post-reveal heading confirms the reconstruction path ran.
    await expect(
      page.getByRole('heading', { name: 'Batch reconstructed.' }),
    ).toBeVisible()
  })

  // 6-AUD-amounts: after reconstruction the revealed per-employee amounts appear
  // as font-mono text-accent-soft nodes (the Centerpiece reveal). The amounts are
  // BN254 field values (50, 80, …), no USDC suffix.
  test('reveals per-employee amounts as font-mono accent-soft nodes', async ({
    page,
  }) => {
    await mockRpc(page, FIXTURE_EVENTS)
    await page.goto('/auditor')

    await page
      .getByRole('textbox', { name: 'View-key (X25519 private key, base64)' })
      .fill(AUDITOR_PRIV)
    await page.getByRole('button', { name: 'Reconstruct batch' }).click()

    // Revealed amount nodes carry both classes (the auditor reveal styling).
    const revealed = page.locator('.font-mono.text-accent-soft')
    await expect(revealed.filter({ hasText: '200' })).toBeVisible()
    await expect(revealed.filter({ hasText: '120' })).toBeVisible()
  })

  // 6-AUD-badkey: a malformed key → reconstruct fails → the textarea gains the
  // amber ring (ring-accent-warm), the error copy shows, and the page does NOT
  // crash (D-09 / A2, T-06-15).
  test('bad key gives the textarea an amber ring without crashing', async ({
    page,
  }) => {
    await mockRpc(page, FIXTURE_EVENTS)
    await page.goto('/auditor')

    const textarea = page.getByRole('textbox', {
      name: 'View-key (X25519 private key, base64)',
    })
    await textarea.fill('invalid-key')
    await page.getByRole('button', { name: 'Reconstruct batch' }).click()

    // Amber invalid ring is applied (the only invalid-input signal, no red).
    await expect(textarea).toHaveClass(/ring-accent-warm/)
    await expect(
      page.getByText('View-key did not decrypt any outputs.'),
    ).toBeVisible()
    // The page is still alive: the input card and CTA remain interactive.
    await expect(
      page.getByRole('button', { name: 'Reconstruct batch' }),
    ).toBeVisible()
  })
})
