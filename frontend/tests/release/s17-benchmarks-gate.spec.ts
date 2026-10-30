/**
 * The benchmarks gate in the production build (circles part 2, design.md section 3): until a lawyer
 * has read the copy, prod holds back the benchmark cards, the free-money question and check, the
 * Dashboard gauge's band, and setup's region and household questions. The ledger, the circle views
 * and the questions that feed them show. Dev and every local build show everything, so only a
 * production build can show the gate closed.
 *
 * Like s15, it needs a PRODUCTION build of the candidate and is skipped without one:
 *
 *   VITE_API_URL=http://127.0.0.1:9 pnpm exec vite build && cp -r dist <builds>/rc
 *   RELEASE_BUILDS_DIR=<builds> pnpm run test:e2e:release tests/release/s17-benchmarks-gate.spec.ts
 *
 * The build is served by a Playwright page route on a made-up origin, with service workers blocked
 * and every other request aborted, so nothing leaves the machine. Local-first, on the demo data.
 */
import { expect, test } from '@playwright/test'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'

const BUILDS = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env?.RELEASE_BUILDS_DIR
const ORIGIN = 'http://127.0.0.1:3812'

// Skipped unless a production build is given: dev opens the gate, so only prod shows it closed.
test.skip(!BUILDS, 'set RELEASE_BUILDS_DIR to a folder holding the candidate build as rc/')

/** Serve the candidate's production build to this tab, as a static host with an SPA fallback. */
async function serveCandidate(page: Page, fetched: string[]): Promise<void> {
  const root = join(BUILDS as string, 'rc')
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== ORIGIN) return route.abort()
    fetched.push(url.pathname)
    let file = join(root, decodeURIComponent(url.pathname))
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html')
    return route.fulfill({ path: file, headers: { 'Cache-Control': 'no-store' } })
  })
}

async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((to) => {
    window.location.hash = to
  }, hash)
}

test.describe('circles part 2: the benchmarks gate in the production build', () => {
  test('the gated pieces are held back, and the circles show @release', async ({ browser }) => {
    test.setTimeout(240_000)
    const context = await browser.newContext({ serviceWorkers: 'block' })
    await context.route('**/*', (route) => route.abort())
    const page = await context.newPage()
    const fetched: string[] = []
    await serveCandidate(page, fetched)
    try {
      await page.goto(`${ORIGIN}/robots.txt`)
      await page.evaluate(() => {
        localStorage.setItem('finance_storage_mode', 'serverless')
      })
      await page.goto(`${ORIGIN}/`)
      await expect(page.getByTestId('profile-dropdown-btn')).toContainText('Example', {
        timeout: 120_000,
      })

      // The circles show: the ledger's seven rows, and a circle's view with its checks.
      await go(page, 'progress')
      await expect(page.locator('[data-circle-row]')).toHaveCount(7, { timeout: 60_000 })
      await go(page, 'progress/4')
      const view = page.getByTestId('circle-view')
      await expect(view.getByTestId('circle-checks')).toBeVisible({ timeout: 60_000 })
      await expect(view.getByTestId('circle-numbers')).toBeVisible()

      // Held back: How you compare and its cards, and the free-money check.
      await expect(view.getByTestId('circle-compare')).toHaveCount(0)
      await expect(view.locator('[data-check="free-money"]')).toHaveCount(0)
      await expect(view).not.toContainText('How you compare')

      // About this space lists the circles' answers, without setup's region question.
      await go(page, 'settings')
      await page.getByTestId('settings-tab-general').click()
      const space = page.getByTestId('settings-about-space')
      await expect(space.getByTestId('settings-circle-answers')).toBeVisible({ timeout: 30_000 })
      await expect(space).not.toContainText('Where do you live?')
      await expect(space.getByTestId('settings-space-region')).toHaveCount(0)

      // The cards' chunk, benchmarks.json with it, was never fetched.
      expect(fetched.filter((path) => /\/(cards|benchmarks)[-.]/.test(path))).toEqual([])
    } finally {
      await context.close()
    }
  })
})
