/**
 * Server-mode subscription scan (the path that regressed on prod).
 *
 * The scan fetched /api/transactions as a bare array, but the worker/
 * self-hosted backend returns a paginated envelope { rows, total } — so in
 * server mode the scan silently analyzed an empty list and always reported
 * "No known subscriptions found". Serverless (bare arrays) passed every test.
 *
 * This spec drives the REAL broken path end-to-end: seed recurring Netflix/
 * Spotify charges into a fresh profile via the API (isolation-safe — never
 * touches the shared seeded profile), open Bills → Subscriptions → Scan
 * transactions, and expect detections from the envelope-shaped response.
 */
import { expect, test } from '@playwright/test'
import { E2E_BASE } from './test-helpers'

const day = 24 * 60 * 60 * 1000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 10)

test.describe('subscription scan — server mode @smoke', () => {
  test('detects recurring charges from the paginated transactions envelope', async ({ page }) => {
    const ctx = page.context()

    const auth = await ctx.request.post(`${E2E_BASE}/api/auth/login`, {
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords
      data: { username: 'person', password: 'something-like-this' },
      headers: { 'x-skip-ratelimit': 'true' },
    })
    expect(auth.ok()).toBeTruthy()

    const res = await ctx.request.post(`${E2E_BASE}/api/profiles`, {
      headers: { 'Content-Type': 'application/json', 'X-Profile-Id': '1' },
      data: { name: `Sub Scan Probe ${Date.now()}` },
    })
    expect(res.ok()).toBeTruthy()
    const profile = (await res.json()) as { id: number }

    // Three monthly Netflix charges + three monthly Spotify charges.
    const charges = [
      { description: 'Netflix', amount: 9.99, agoDays: 5 },
      { description: 'Netflix', amount: 9.99, agoDays: 35 },
      { description: 'Netflix', amount: 9.99, agoDays: 65 },
      { description: 'Spotify', amount: 10.99, agoDays: 8 },
      { description: 'Spotify', amount: 10.99, agoDays: 38 },
      { description: 'Spotify', amount: 10.99, agoDays: 68 },
    ]
    for (const c of charges) {
      const created = await ctx.request.post(`${E2E_BASE}/api/transactions`, {
        headers: { 'Content-Type': 'application/json', 'X-Profile-Id': String(profile.id) },
        data: {
          description: c.description,
          amount: c.amount,
          type: 'expense',
          date: iso(c.agoDays * day),
        },
      })
      expect(created.ok()).toBeTruthy()
    }

    // Sanity-pin the regression's precondition: in server mode this endpoint
    // returns the envelope, NOT a bare array. If this ever changes, the fix
    // under test is moot and this spec should be revisited.
    const txnsRes = await ctx.request.get(`${E2E_BASE}/api/transactions`, {
      headers: { 'X-Profile-Id': String(profile.id) },
    })
    const txnsBody = (await txnsRes.json()) as { rows?: unknown[] }
    expect(Array.isArray(txnsBody)).toBe(false)
    expect(Array.isArray(txnsBody.rows)).toBe(true)

    await ctx.addInitScript((pid: number) => {
      localStorage.setItem('finance_storage_mode', 'self-hosted')
      localStorage.setItem('darkMode', 'false')
      localStorage.setItem('currentProfileId', String(pid))
      localStorage.setItem('selectedProfileIds', JSON.stringify([pid]))
      // A recorded decision keeps the onboarding wizard from covering the page.
      localStorage.setItem('finance_onboarding', 'skipped')
    }, profile.id)
    await page.goto(`${E2E_BASE}/#bills`, { waitUntil: 'domcontentloaded', timeout: 30000 })

    await page.getByTestId('bills-tab-subscriptions').click()
    await page.getByTestId('scan-subscriptions-btn').click()
    await expect(page.getByTestId('sub-scan-modal')).toBeVisible({ timeout: 15000 })

    // The regression rendered the empty state here. With the envelope handled,
    // both seeded services must surface as detected rows.
    const rows = page.getByTestId('sub-scan-row')
    await expect(rows.filter({ hasText: 'Netflix' })).toHaveCount(1, { timeout: 15000 })
    await expect(rows.filter({ hasText: 'Spotify' })).toHaveCount(1)
    await expect(page.getByTestId('sub-scan-empty')).toHaveCount(0)
  })
})
