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
import { E2E_BASE, firstProfileId } from './test-helpers'
import type { BrowserContext } from '@playwright/test'

const day = 24 * 60 * 60 * 1000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 10)

test.describe('subscription scan — server mode @smoke', () => {
  test('detects recurring charges from the paginated transactions envelope', async ({ page }) => {
    const ctx = page.context()

    // No sign-in here: the setup project saved a signed-in storageState and every context starts
    // from it, so ctx.request already carries the session cookie.
    const home = await firstProfileId(ctx)

    const res = await ctx.request.post(`${E2E_BASE}/api/profiles`, {
      headers: { 'Content-Type': 'application/json', 'X-Profile-Id': String(home) },
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

    // The fixture account's setup wizard is finished on its record (global.setup.ts), so the
    // wizard does not cover the page.
    await ctx.addInitScript(
      ({ pid }) => {
        localStorage.setItem('finance_storage_mode', 'self-hosted')
        localStorage.setItem('darkMode', 'false')
        localStorage.setItem('currentProfileId', String(pid))
        localStorage.setItem('selectedProfileIds', JSON.stringify([pid]))
      },
      { pid: profile.id }
    )
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

/** A fresh profile of the fixture account, holding `charges`, and the app pointed at it. */
async function profileWith(
  ctx: BrowserContext,
  charges: { description: string; beneficiary?: string; amount: number; agoDays: number }[]
): Promise<number> {
  const home = await firstProfileId(ctx)
  const res = await ctx.request.post(`${E2E_BASE}/api/profiles`, {
    headers: { 'Content-Type': 'application/json', 'X-Profile-Id': String(home) },
    data: { name: `Sub Scan Height ${Date.now()}` },
  })
  expect(res.ok()).toBeTruthy()
  const profile = (await res.json()) as { id: number }
  for (const c of charges) {
    const created = await ctx.request.post(`${E2E_BASE}/api/transactions`, {
      headers: { 'Content-Type': 'application/json', 'X-Profile-Id': String(profile.id) },
      data: {
        description: c.description,
        beneficiary: c.beneficiary,
        amount: c.amount,
        type: 'expense',
        date: iso(c.agoDays * day),
      },
    })
    expect(created.ok()).toBeTruthy()
  }
  await ctx.addInitScript(
    ({ pid }) => {
      localStorage.setItem('finance_storage_mode', 'self-hosted')
      localStorage.setItem('darkMode', 'false')
      localStorage.setItem('currentProfileId', String(pid))
      localStorage.setItem('selectedProfileIds', JSON.stringify([pid]))
    },
    { pid: profile.id }
  )
  return profile.id
}

// maff, 19 Nov: on a full-screen desktop the scan ran from the top of the screen to the bottom.
test.describe('the subscription scan modal on a tall screen @smoke', () => {
  test('stays 720 px at most, with its header and actions in view and the list scrolling between', async ({
    page,
  }) => {
    // 48 writes to seed, and the scan opened at three sizes.
    test.setTimeout(150_000)
    // Sixteen regular payments to payees the catalogue has no name for: more rows than fit. Named
    // by word, not number: the scan reads "Club 01" and "Club 02" as one payee.
    const payees = [
      'Alder',
      'Birch',
      'Cedar',
      'Elm',
      'Fir',
      'Hazel',
      'Juniper',
      'Larch',
      'Maple',
      'Oak',
      'Pine',
      'Rowan',
      'Spruce',
      'Willow',
      'Yew',
      'Poplar',
    ].map((tree) => `Example ${tree} Club`)
    await profileWith(
      page.context(),
      payees.flatMap((beneficiary, i) =>
        [65, 35, 5].map((agoDays) => ({
          description: 'MEMBERSHIP',
          beneficiary,
          amount: 20 + i,
          agoDays,
        }))
      )
    )

    for (const size of [
      { width: 2560, height: 1440, cap: 720 },
      { width: 1920, height: 1080, cap: 720 },
      { width: 390, height: 844, cap: 844 - 32 },
    ]) {
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.goto(`${E2E_BASE}/#bills`, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.getByTestId('bills-tab-subscriptions').click()
      await page.getByTestId('scan-subscriptions-btn').click()
      const modal = page.getByTestId('sub-scan-modal')
      await expect(modal).toBeVisible({ timeout: 15000 })
      await expect(page.getByTestId('sub-scan-row')).toHaveCount(16, { timeout: 15000 })
      // Measured once it has risen into place: it opens 8 px low and a hair small.
      await expect
        .poll(() => modal.evaluate((el) => getComputedStyle(el).transform))
        .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/)

      const box = (await modal.boundingBox())!
      expect(box.height, `${size.width}x${size.height}`).toBeLessThanOrEqual(size.cap + 0.5)
      const title = (await modal.locator('h2').boundingBox())!
      const add = page.getByTestId('sub-scan-add-btn')
      const before = (await add.boundingBox())!
      expect(title.y).toBeGreaterThanOrEqual(box.y)
      expect(before.y + before.height).toBeLessThanOrEqual(
        Math.min(box.y + box.height, size.height)
      )

      // Only the list scrolls: to its end, with the header and the add where they were.
      const list = page.getByTestId('sub-scan-scroll')
      const scrolls = await list.evaluate((el) => el.scrollHeight > el.clientHeight + 1)
      expect(scrolls, `the list scrolls at ${size.width}x${size.height}`).toBe(true)
      await list.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      expect((await add.boundingBox())!.y).toBeCloseTo(before.y, 0)
      expect((await modal.locator('h2').boundingBox())!.y).toBeCloseTo(title.y, 0)
      await expect(page.getByTestId('sub-scan-row').last()).toBeInViewport()
      // Closed, the overlay stays in the page, faded out and letting clicks through.
      await modal.getByRole('button', { name: 'Close' }).click()
      await expect
        .poll(() => modal.evaluate((el) => getComputedStyle(el.parentElement!).pointerEvents))
        .toBe('none')
    }
  })
})
