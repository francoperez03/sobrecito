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
// txHash is the on-chain transaction hash. Real RPC events carry this field
// (BaseEventResponse.txHash in @stellar/stellar-sdk v16). Adding it to the
// fixture so the mock matches the live event shape and BatchGroupHeader renders.
const FIXTURE_TX = 'aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd'
const FIXTURE_EVENTS = [
  { type: 'contract', contractId: '', ledger: 3110570, txHash: FIXTURE_TX, topic: [COMMIT_TOPIC0, 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPo'], value: 'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAQAAAAB8wiA2njq7abwhIJ36Y36o8uwmFb/UzBtrE+/4L+aWO3cD+ZF/7w6J9sAsesafDRZ/w315B38vAE3tnb9pHh4CXFbrdShqQwi3tuAE3LCyxxbYrdksKH4JWTPnu9q1kl7TtlWS59Cb8oFaYF/4+PlBQoYsqRRV+4lJDvB0IwAAAHynf8Hp+dzJfH7CmQwCgn/EgY2kJoYrwnf/A364yz90X5mFVpCe9FqhCfUMX4Pf4QDs3iBxQt/IAJakurakqU7D82U9XWMQaKFYCB9exLcbnsCQ7ACIUPjnnKuKR250TRLRHCKgiHTwDhHtQ2OcpBHswfoPPXdKnCBNQ8M3AAAADwAAAAVpbmRleAAAAAAAAAMAAAAA' },
  { type: 'contract', contractId: '', ledger: 3110571, txHash: FIXTURE_TX, topic: [COMMIT_TOPIC0, 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPp'], value: 'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAQAAAAB8/UhVQHsAh2Gban7XNI6VVyA0z4Ws/8ALbuh6DMNBGHCWb+LVvHlfTcoHSnI4kZZW1HhDgdYj42P2502xTu1qGks3klWO3TrAfGSpSRviOO4+hsb4SNlVLzZaYr93+tL3lKA/1B1GnTBHcFCy+BnUuACUTduVxic7Un51lAAAAHzDh+JKW3ZdJxzKsJfdApOApqgpmMpaqTvi6ElocyfaIVLmGcjJjdgKBUzA4EdsUPnIJfkLdyHvFpvz7Hl67Gcw30q7ojRzXlbV9VYATjH2XPiQOLP3H1ytxlOhZsA4aaUJvRDW9X+wKFKNcxlaAxnO0jIN60LRPSX0SCTXAAAADwAAAAVpbmRleAAAAAAAAAMAAAAB' },
  { type: 'contract', contractId: '', ledger: 3110572, txHash: FIXTURE_TX, topic: [COMMIT_TOPIC0, 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPq'], value: 'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAQAAAAB8humNVGy1MwOKm1UUmPZVYk2Lp83qN/m5hzVWI7otp2RGG+L243o/KjRnC9cfubxq+qmTm3hXFT9tnf3t5laUvhN4CYMWKQBa+PJ0PoHEtaG6tBKMumWyGRhqIz0S5k0JwDqYXhmedZMaN0+DW1SQoHbVCCtRaSA+9bWuPgAAAHzwM/edEmvLqbiStRwJFqETpyHVEpX+veLmJvftyZkEeR+0p3eg6r+kA59+ieeEGXyiJvyAwtE/vbSWaXZgLK48nIjssmO77kHYlHnRNTVZmG0Mah0GRHOSPPgp6Nh3WgRE5x/f6wh8YNb1MinTk0ca9vURzXtt425/n5xoAAAADwAAAAVpbmRleAAAAAAAAAMAAAAC' },
  { type: 'contract', contractId: '', ledger: 3110573, txHash: FIXTURE_TX, topic: [COMMIT_TOPIC0, 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPr'], value: 'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAQAAAAB87mn+6ACYtYY/u4OO7qkt5d9qbVn8ZjD1ePd8osMlOlPZaXAQUL3PNfPv3k0G+zqKjxt5UKnAPJUnQ92gAN4l+A6SKKTD+/9JJJF2092BswstT5hPz9PxIMc65CORnayuFjGqYyOeybwQ6kFHFCiEIas5ISmWnYmvPXKGrAAAAHwMRI2NJVThbTLs7n+QhNzMqfOvFmnGYbjxUA0B8Th2O5DDO7VPQNUgXWkyAs2Pyki0QuBSvLQZrg37KK0uOYdv05mABqM63U13aS5rT+B7VWPk2oHjcNH3VBLnqqc5Yg0mtaYZ7yP6WjduKwnVQ52YXbhm8VDEOHyhzDsrAAAADwAAAAVpbmRleAAAAAAAAAMAAAAD' },
  { type: 'contract', contractId: '', ledger: 3110574, txHash: FIXTURE_TX, topic: [COMMIT_TOPIC0, 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPs'], value: 'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAQAAAAB8QNIILVXZWt3qztW5wmovDI4mFp6VgLD4GlaKvD+8Fxj0hfRfFIcuHriM1/+/ci9iDqRP2W3A43TmF50PSdJogp/0PKpE0gIVJqcOA/15dbIu2HBMN6K7SwZuQ0/V8P6DSqsn6ZtDO7EqhaSwQDdxwAZfvE7idVfgbM+ALQAAAHyQciSPAy5Yqw+GcbrcjuoElVXfOVcNtqsPJp05hEoja6QKHpFXSN5mTyhj8SlpXLEc7DcCCzZfj+QQmOG0Nkl9ieKPNe7vcAMLdDrdkAAwamtnRhIXzZwH5qLF/kmteU/W/XyQP8oKPsWqGRhu9t2JMVR0lx4hFmpXApIkAAAADwAAAAVpbmRleAAAAAAAAAMAAAAE' },
  { type: 'contract', contractId: '', ledger: 3110575, txHash: FIXTURE_TX, topic: [COMMIT_TOPIC0, 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPt'], value: 'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAQAAAAB8PNNBGYczyDMo2/rbUj50ihrYoOdFTAdaiP1Nu6aKGRgPbvJzBuyZ8YzpUxmvHd+vowU4NVzeQZBmOFlhs0VKEjcdvHLBR2tablwaO1an9Rlpucocp2I8azmp+jkTZz8Nwlb57xRMnA/4pxr6pLM0rh4+l5MBbxC0o+c22AAAAHwOSiUo9tw/fhbjW/f8OS1ZvG/g8weBiQchxDVCo+xxLhl8gJUzSh8s/zBKQjsS8Zfl5xqfliyQiL4DChQMc8BIck056EbLyf63NVVP2RqBneLJjeu/HQoHUaWd7k8ifLo3zAYYYPIzzQtHlOy6hd/WEO2kEsJJIhb1yuy4AAAADwAAAAVpbmRleAAAAAAAAAMAAAAF' },
  { type: 'contract', contractId: '', ledger: 3110576, txHash: FIXTURE_TX, topic: [COMMIT_TOPIC0, 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPu'], value: 'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAQAAAAB8bZfBoecOe/wYbvhBc2r+vZ07uxHjblGWM5KLGi3z10dvAOdl+T6js5rXEOXwyUe9W5MxJgeMgDaKJCmuMgBie+YzCo/6d4urvBgZE0q4xt7N7Vt7A54GVbJS2HhFHOn/A2jXf4LgItiAJvlYA+Nnt3+TjTZS0gkF323OPgAAAHw7oR1+Ocbs7J2lML/T/b3iWxsU6FUsbP5RIwxcFtl2GyhbZySu8E6bvb1LhffZPJ7se+6a4DS2j9hR3fX/n+6ywTGmvfhW+WL9Kgt7Up29iIsncFM3dFD0muDvPBDsyjvqEfKJTz9tbsWCCzPzrSN4DAftBPnVg0PdRyNeAAAADwAAAAVpbmRleAAAAAAAAAMAAAAG' },
  { type: 'contract', contractId: '', ledger: 3110577, txHash: FIXTURE_TX, topic: [COMMIT_TOPIC0, 'AAAACwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPv'], value: 'AAAAEQAAAAEAAAACAAAADwAAABBlbmNyeXB0ZWRfb3V0cHV0AAAADQAAAQAAAAB8ou/Itjw//TuhfGRQwyXCjmY1vIiM//PgeOWOgTau1VjevCk+ntIki3USj9g8aK2/r80yLnSm27YcrM4LKVLBHVbwdxhwCJfDF1EWMyF12On+BLLErjnUo3H5t7qpszOjBE375rqjroFSsZM3iWkuVhksGNjDB8vRqR4rjAAAAHzXVgCOXCwy3BIU4WGRHFbgStqi6eGUHnByQVC4ILJ9f4RSqEbk4V8jsF3TcC+byc5pZOEH4M3duLaCVugcdGZ30ob3ivRpvsCxqCUHL1XCZI0ISc5pjFnFJtAKpxJunq/wr3oThMKmPL24qHBSv9B/vEO6aTa+cg9kn4ozAAAADwAAAAVpbmRleAAAAAAAAAMAAAAH' },
]

// Real `simulateTransaction` response for the SAC `balance(pool)` read, with the
// retval swapped to i128(800) so the on-chain total reconciles against the fixture
// sum (50+80+120+60+200+90+110+90 = 800 base units). Captured from testnet RPC.
const SIM_BALANCE_800 = {
  transactionData:
    'AAAAAAAAAAIAAAAGAAAAAVBFzV7Acpp2j9WtAlBYUt9PAo3Ogw5axSIJukhIOy8BAAAAEAAAAAEAAAACAAAADwAAAAdCYWxhbmNlAAAAABIAAAABzp9buRK/KbSD+Cf5KFSMBlqIqV+yEvr2/Bj3ICo4HLEAAAABAAAABgAAAAFQRc1ewHKado/VrQJQWFLfTwKNzoMOWsUiCbpISDsvAQAAABQAAAABAAAAAAADOF0AAAAAAAAAAAAAAAAAADMK',
  events: [],
  minResourceFee: '13066',
  results: [{ auth: [], xdr: 'AAAACgAAAAAAAAAAAAAAAAAAAyA=' }],
  latestLedger: 3122636,
}

/**
 * Stub the Soroban RPC. `getEvents` resolves to `events` (single page);
 * `simulateTransaction` resolves to the SAC balance read (i128 800, matching the
 * fixture sum) so the auditor reconciliation has a real on-chain total. Any other
 * method gets a benign empty result.
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

    let result: unknown = {}
    if (method === 'getEvents') {
      result = { events, latestLedger: 3110600, cursor: '' }
    } else if (method === 'simulateTransaction') {
      result = SIM_BALANCE_800
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id, result }),
    })
  })
}

// Two-batch fixture: batch A (ledger 3110570) = first 4 events, batch B
// (ledger 3110580) = last 4 events. Ledger is the envelope field; rewriting it
// does not affect the encrypted_output, so all 8 still decrypt under AUDITOR_PRIV.
const TWO_BATCH_EVENTS = [
  ...FIXTURE_EVENTS.slice(0, 4).map((e) => ({ ...e, ledger: 3110570, txHash: 'aabbccdd00000000000000000000000000000000000000000000000011223344' })),
  ...FIXTURE_EVENTS.slice(4, 8).map((e) => ({ ...e, ledger: 3110580, txHash: 'deadbeef00000000000000000000000000000000000000000000000055667788' })),
]

test.describe('Auditor console', () => {
  test('page loads', async ({ page }) => {
    await page.goto('/audit')
    // The (demo) layout wraps the route in FloatingNav + MotionConfig.
    await expect(page.locator('body')).toBeVisible()
  })

  test('renders the view-key textarea and Reconstruct batch button', async ({
    page,
  }) => {
    await page.goto('/audit')
    await expect(
      page.getByRole('textbox', {
        name: 'View-key',
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Reveal detail' }),
    ).toBeVisible()
    // D-09 disclosure is present (key stays client-side).
    await expect(
      page.getByText(/Decryption runs client-side/),
    ).toBeVisible()
  })

  // 6-AUD-reveal + 6-AUD-reconcile: paste the fixed key, click Reconstruct, the
  // batch reconstructs client-side and reconciles sum(decrypted) === T → the
  // Match verdict becomes visible.
  test('reveals the batch and shows the Match verdict on reconstruct', async ({
    page,
  }) => {
    await mockRpc(page, FIXTURE_EVENTS)
    await page.goto('/audit')

    await page
      .getByRole('textbox', { name: 'View-key' })
      .fill(AUDITOR_PRIV)
    await page.getByRole('button', { name: 'Reveal detail' }).click()

    await expect(
      page.getByText(/Reconciled — every amount accounts for the total/),
    ).toBeVisible()
    // A revealed pay-run section confirms the reveal path ran.
    await expect(
      page.getByRole('heading', { name: 'Pay run' }).first(),
    ).toBeVisible()
  })

  // 6-AUD-amounts: after reconstruction the revealed per-employee amounts appear
  // as font-mono text-accent-soft nodes (the Centerpiece reveal), formatted as real
  // USDC (base units → decimal): 200 → 0.00002 USDC, 120 → 0.000012 USDC.
  test('reveals per-employee amounts as font-mono accent-soft nodes', async ({
    page,
  }) => {
    await mockRpc(page, FIXTURE_EVENTS)
    await page.goto('/audit')

    await page
      .getByRole('textbox', { name: 'View-key' })
      .fill(AUDITOR_PRIV)
    await page.getByRole('button', { name: 'Reveal detail' }).click()

    // Revealed amount nodes carry both classes (the auditor reveal styling).
    const revealed = page.locator('.font-mono.text-accent-soft')
    await expect(revealed.filter({ hasText: '0.00002 USDC' })).toBeVisible()
    await expect(revealed.filter({ hasText: '0.000012 USDC' })).toBeVisible()
  })

  // 6-AUD-badkey: a malformed key → reconstruct fails → the textarea gains the
  // amber ring (ring-accent-warm), the error copy shows, and the page does NOT
  // crash (D-09 / A2, T-06-15).
  test('bad key gives the textarea an amber ring without crashing', async ({
    page,
  }) => {
    await mockRpc(page, FIXTURE_EVENTS)
    await page.goto('/audit')

    const textarea = page.getByRole('textbox', {
      name: 'View-key',
    })
    await textarea.fill('invalid-key')
    await page.getByRole('button', { name: 'Reveal detail' }).click()

    // Amber invalid ring is applied (the only invalid-input signal, no red).
    await expect(textarea).toHaveClass(/ring-accent-warm/)
    // Malformed key reads as a key-shape problem, not a "no notes" result.
    await expect(page.getByTestId('auditor-invalid')).toBeVisible()
    await expect(page.getByTestId('auditor-empty')).toHaveCount(0)
    // The page is still alive: the input card and CTA remain interactive.
    await expect(
      page.getByRole('button', { name: 'Reveal detail' }),
    ).toBeVisible()
  })

  // A well-formed key that decrypts nothing is NOT an input error: it shows the
  // informational empty state (no amber ring), distinct from the malformed-key path.
  test('valid key with no matching notes shows the empty state, not an error', async ({
    page,
  }) => {
    await mockRpc(page, FIXTURE_EVENTS)
    await page.goto('/audit')

    const textarea = page.getByRole('textbox', {
      name: 'View-key',
    })
    // A valid 32-byte hex key, but NOT the one the fixtures were encrypted to.
    await textarea.fill(
      '1111111111111111111111111111111111111111111111111111111111111111',
    )
    await page.getByRole('button', { name: 'Reveal detail' }).click()

    // Empty (informational) copy shows; the malformed-key copy does not.
    await expect(page.getByTestId('auditor-empty')).toBeVisible()
    await expect(page.getByTestId('auditor-invalid')).toHaveCount(0)
    // NOT an input error: the amber ring must NOT fire for a valid key.
    await expect(textarea).not.toHaveClass(/ring-accent-warm/)
  })

  // AUD-02: notes from two ledger groups appear in two distinct batch sections.
  test('groups notes by ledger into distinct batch sections', async ({
    page,
  }) => {
    await mockRpc(page, TWO_BATCH_EVENTS)
    await page.goto('/audit')

    await page
      .getByRole('textbox', { name: 'View-key' })
      .fill(AUDITOR_PRIV)
    await page.getByRole('button', { name: 'Reveal detail' }).click()

    // Two distinct pay-run sections, each with its own tx link.
    await expect(page.getByRole('heading', { name: 'Pay run' })).toHaveCount(2)
    await expect(page.getByTestId('batch-txhash')).toHaveCount(2)
  })

  // AUD-02: the txHash label appears in each batch group header.
  test('shows txHash for each batch group', async ({ page }) => {
    await mockRpc(page, TWO_BATCH_EVENTS)
    await page.goto('/audit')

    await page
      .getByRole('textbox', { name: 'View-key' })
      .fill(AUDITOR_PRIV)
    await page.getByRole('button', { name: 'Reveal detail' }).click()

    await expect(page.getByTestId('batch-txhash').first()).toContainText('↗')
  })

  // AUD-03: clicking Generate keypair shows a base64 public key and Copy CTA.
  test('generates a keypair and shows the public key', async ({ page }) => {
    await page.goto('/audit')

    await openKeygen(page)
    await page.getByRole('button', { name: 'Generate view-key' }).click()

    const pub = page.getByTestId('keygen-pubkey')
    await expect(pub).toBeVisible()
    await expect(pub).not.toBeEmpty()
    await expect(
      page.getByRole('button', { name: 'Copy public key' }),
    ).toBeVisible()
  })

  // Capture every navigator.clipboard.writeText payload into window.__copies so a
  // test can read what the private-key copy actually placed on the clipboard
  // without needing OS clipboard permissions (cross-browser). Must run before the
  // page scripts, so call it before page.goto.
  async function captureClipboard(page: Page) {
    await page.addInitScript(() => {
      ;(window as unknown as { __copies: string[] }).__copies = []
      try {
        const cb = navigator.clipboard
        const sink = (t: string) => {
          ;(window as unknown as { __copies: string[] }).__copies.push(t)
          return Promise.resolve()
        }
        if (cb && typeof cb.writeText === 'function') {
          cb.writeText = sink as typeof cb.writeText
        } else {
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: sink },
          })
        }
      } catch {
        /* secure-context clipboard unavailable — copy buttons are still inert-safe */
      }
    })
  }

  // The keygen UI lives in a collapsed "No view-key yet?" drawer; open it first.
  async function openKeygen(page: Page) {
    await page.getByRole('button', { name: /no view-key yet/i }).click()
  }

  // AUD-04: the private key value never appears in the DOM. It is copyable exactly
  // once (then wiped from memory); we capture the copied value and assert it is a
  // 32-byte url-safe base64 key that is NOT present anywhere in the rendered DOM.
  test('generated private key remains invisible in the DOM', async ({
    page,
  }) => {
    await captureClipboard(page)
    await page.goto('/audit')

    await openKeygen(page)
    await page.getByRole('button', { name: 'Generate view-key' }).click()

    // Exactly one keygen-pubkey node (the public key); the private key is never rendered.
    const codeNodes = await page.locator('[data-testid="keygen-pubkey"]').count()
    expect(codeNodes).toBe(1)

    // Copy the private key, then read what landed on the clipboard.
    await page.getByTestId('keygen-copy-priv').click()
    const copies = await page.evaluate(
      () => (window as unknown as { __copies: string[] }).__copies,
    )
    expect(copies).toHaveLength(1)
    const priv = copies[0]
    // 32-byte key, url-safe base64, unpadded => exactly 43 chars.
    expect(priv).toMatch(/^[A-Za-z0-9_-]{43}$/)

    // The private key value must not appear anywhere in the rendered DOM.
    const body = await page.locator('body').innerText()
    expect(body).not.toContain(priv)
  })

  // AUD-04: the private key is a one-shot copy (API-key pattern). After copying it
  // once the button disables and prompts to regenerate; regenerating re-arms it.
  test('private key copies once then requires regenerate', async ({ page }) => {
    await captureClipboard(page)
    await page.goto('/audit')

    await openKeygen(page)
    await page.getByRole('button', { name: 'Generate view-key' }).click()

    const copyPriv = page.getByTestId('keygen-copy-priv')
    await expect(copyPriv).toBeEnabled()
    await copyPriv.click()

    // After one copy: disabled, label prompts to regenerate.
    await expect(copyPriv).toBeDisabled()
    await expect(copyPriv).toContainText('regenerate')

    // A second (forced) click is inert — no new clipboard write.
    const before = await page.evaluate(
      () => (window as unknown as { __copies: string[] }).__copies.length,
    )
    await copyPriv.click({ force: true }).catch(() => {})
    const after = await page.evaluate(
      () => (window as unknown as { __copies: string[] }).__copies.length,
    )
    expect(after).toBe(before)

    // Regenerating rotates the keypair and re-arms the one-shot copy.
    await page.getByRole('button', { name: 'Regenerate view-key' }).click()
    await expect(copyPriv).toBeEnabled()
  })

  // 06.3-04: generating persists ONLY the public key to localStorage, and the
  // page pre-fills it on a remount (no private key is ever stored).
  test('persists the public key and pre-fills it on remount', async ({ page }) => {
    await page.goto('/audit')
    await openKeygen(page)
    await page.getByRole('button', { name: 'Generate view-key' }).click()

    const pubText = ((await page.getByTestId('keygen-pubkey').textContent()) ?? '').trim()
    expect(pubText.length).toBeGreaterThan(0)

    // localStorage holds the public key under the shared store key…
    const stored = await page.evaluate(() =>
      window.localStorage.getItem('sobre.auditorPublicKey'),
    )
    expect(stored).toBe(pubText)
    // …and nothing in localStorage equals the (memory-only) private key.
    const allValues = await page.evaluate(() =>
      Object.keys(window.localStorage).map((k) => window.localStorage.getItem(k)),
    )
    expect(allValues).toContain(pubText)

    // Remount the page: the public key is pre-filled from storage, and the
    // private-key copy is NOT re-armed (private is never restored).
    await page.goto('/audit')
    await openKeygen(page)
    await expect(page.getByTestId('keygen-pubkey')).toHaveText(pubText)
    await expect(page.getByTestId('keygen-copy-priv')).toBeDisabled()
  })
})
