/**
 * Release scope 5.16.0 section 7 and 5.16.1 section 15: the local-first database upgrade, with a
 * tab of the previous build still open. This is the one case dev cannot show any more and prod
 * will meet exactly once, on its first load of 5.16: a 5.15.1 tab holds IndexedDB at v12 while a
 * new tab upgrades it to v13 (#581). 5.16.1 (cd7ebdc7) makes the new tab say why it is waiting.
 *
 * It needs PRODUCTION builds of each version, so it runs only when they are provided:
 *
 *   RELEASE_BUILDS_DIR=<dir> pnpm run test:e2e:release tests/release/s15-two-tab-upgrade.spec.ts
 *
 * where <dir>/v5151, <dir>/v5160 and <dir>/rc are `vite build` outputs of v5.15.1, the 5.16.0
 * release commit and the candidate (build them with VITE_API_URL pointing at a dead local port).
 * Each tab is served from its own folder by Playwright routing on a made-up origin; every request
 * to anything else is aborted, so nothing leaves the machine. Service workers are blocked, which
 * isolates the database handshake from the service-worker update path.
 *
 * Routing is per tab, not per context. An old tab keeps loading lazy chunks after a new build is
 * live; served from the new build, such a request gets index.html, boot recovery reloads the tab
 * onto the new build, its v12 connection closes and the upgrade never blocks. In prod the service
 * worker's precache keeps the old tab's chunks, which is what serving each tab its own build models.
 */
import { expect, test } from '@playwright/test'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser, BrowserContext, Page } from '@playwright/test'

const BUILDS = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env?.RELEASE_BUILDS_DIR
const ORIGIN = 'http://127.0.0.1:3811'
const CLOSE_OTHER_TABS = 'Close your other Token Circles tabs to finish updating this one.'

// Skipped unless prebuilt bundles are given: the case needs three production builds side by side.
test.skip(!BUILDS, 'set RELEASE_BUILDS_DIR to folders of production builds (see the header)')

/** A context in which nothing reaches the network: each tab gets its files from `serve`. */
async function offlineContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  await context.route('**/*', (route) => route.abort())
  return context
}

/**
 * Serve one tab from whichever build `root()` names, as a static host with an SPA fallback would.
 * A page route wins over the context's abort-everything route.
 */
async function serve(page: Page, root: () => string): Promise<void> {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== ORIGIN) return route.abort()
    let file = join(root(), decodeURIComponent(url.pathname))
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root(), 'index.html')
    return route.fulfill({ path: file, headers: { 'Cache-Control': 'no-store' } })
  })
}

async function tabOn(context: BrowserContext, build: string): Promise<Page> {
  const page = await context.newPage()
  await serve(page, () => join(BUILDS as string, build))
  return page
}

/** Row counts of every store, read on a short-lived connection that never asks for a version. */
async function counts(page: Page): Promise<{ version: number; rows: Record<string, number> }> {
  return page.evaluate(
    () =>
      new Promise<{ version: number; rows: Record<string, number> }>((resolve, reject) => {
        // eslint-disable-next-line no-restricted-globals -- reading the stores is the point
        const req = indexedDB.open('finance-manager')
        req.onerror = () => {
          reject(new Error(String(req.error)))
        }
        req.onsuccess = () => {
          const db = req.result
          const names = [...db.objectStoreNames]
          const tx = db.transaction(names, 'readonly')
          const rows: Record<string, number> = {}
          let left = names.length
          for (const name of names) {
            const c = tx.objectStore(name).count()
            c.onsuccess = () => {
              rows[name] = c.result
              left -= 1
              if (left === 0) {
                const version = db.version
                db.close()
                resolve({ version, rows })
              }
            }
          }
        }
      })
  )
}

async function openOldTabWithDemo(page: Page): Promise<Page> {
  await page.goto(`${ORIGIN}/robots.txt`)
  await page.evaluate(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
  })
  await page.goto(`${ORIGIN}/`)
  await expect(page.getByTestId('profile-dropdown-btn')).toContainText('Example', {
    timeout: 120_000,
  })
  await expect(page.getByTestId('dashboard-container')).toBeVisible({ timeout: 60_000 })
  return page
}

function watchConsole(page: Page): string[] {
  const seen: string[] = []
  page.on('console', (m) => {
    if (/VersionError|Validation failed/.test(m.text())) seen.push(m.text())
  })
  page.on('pageerror', (e) => seen.push(`pageerror: ${e.message}`))
  return seen
}

const OLD_PENSION = 'Zz Old Pension'

/** Retirement > Add, filled in as a person would. The form's test ids are the same in 5.15.1. */
async function addRetirementGoal(page: Page, name: string): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = 'retirement'
  })
  await page.getByTestId('add-retirement-goal-btn').click({ timeout: 20_000 })
  const modal = page.getByTestId('retirement-modal')
  await expect(modal).toBeVisible()
  const inTwentySevenYears = new Date(Date.now() + 27 * 365 * 86_400_000).toISOString().slice(0, 10)
  await page.getByTestId('retirement-form-name').fill(name)
  await page.getByTestId('retirement-form-target-amount').fill('300000')
  await page.getByTestId('retirement-form-current-amount').fill('10000')
  await page.getByTestId('retirement-form-current-age').fill('40')
  await page.getByTestId('retirement-form-retirement-age').fill('67')
  await page.getByTestId('retirement-form-target-date').fill(inTwentySevenYears)
  await page.getByTestId('retirement-form-monthly-contribution').fill('400')
  await page.getByTestId('retirement-form-expected-return').fill('5')
  await page.getByTestId('retirement-modal-submit').click()
  await expect(modal).toBeHidden()
  await expect(page.getByTestId('retirement-goal-card').filter({ hasText: name })).toHaveCount(1)
}

/** Goals split in two at v13 (#581): retirement goals moved to a store of their own. */
function expectSameRows(before: Record<string, number>, after: Record<string, number>): void {
  for (const [store, n] of Object.entries(before)) {
    if (store === 'goals') continue
    expect(after[store], `rows in ${store}`).toBe(n)
  }
  expect((after.goals ?? 0) + (after.retirement_goals ?? 0), 'goals plus retirement goals').toBe(
    before.goals
  )
}

/** Nothing else is drawn over the centre of the text: shown, not just present in the DOM. */
async function isOnTop(page: Page, text: string): Promise<boolean> {
  return page.getByText(text).evaluate((el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    // The text's own wrapper (the toast) counts; anything else at that point covers it.
    return hit !== null && (el === hit || el.contains(hit) || hit.contains(el))
  })
}

test.describe('5.16 local-first upgrade with another tab open', () => {
  test.setTimeout(300_000)

  test('15 (prod first load): a 5.15.1 tab is open, the 5.16.1 tab says why it waits @release', async ({
    browser,
  }) => {
    // RELEASE BLOCKER for the 5.16.1 promise. The `blocked` handler (core/storage/idb.ts, getDB)
    // queues the notice as a toast, but <ToastContainer /> is mounted inside App's
    // `<Show when={!_isLoading()}>` (App.tsx:825, container at :1329), and boot is exactly what
    // the blocked open holds up. The tab shows "Preparing your orbit…" and nothing else, as
    // 5.16.0 does. Fix: render toasts outside the loading gate (mounting <ToastContainer /> beside
    // <App /> in index.tsx was verified to pass this case). Remove this line with the fix.
    test.fail(true, 'the notice is queued but never drawn: toasts mount only after boot')
    const context = await offlineContext(browser)
    const oldTab = await openOldTabWithDemo(await tabOn(context, 'v5151'))
    const before = await counts(oldTab)
    expect(before.version).toBe(12)

    const newTab = await tabOn(context, 'rc')
    const problems = watchConsole(newTab)
    await newTab.goto(`${ORIGIN}/`)

    // The upgrade is blocked by the old tab's open connection: the new tab must say so, on top of
    // the boot screen rather than somewhere under it.
    await expect(newTab.getByText(CLOSE_OTHER_TABS)).toBeVisible({ timeout: 60_000 })
    expect(await isOnTop(newTab, CLOSE_OTHER_TABS)).toBe(true)
    await expect(newTab.getByTestId('dashboard-container')).toBeHidden()

    // Closing the old tab lets the upgrade through, and the new tab finishes on its own.
    await oldTab.close()
    await expect(newTab.getByTestId('dashboard-container')).toBeVisible({ timeout: 120_000 })
    const after = await counts(newTab)
    expect(after.version).toBe(13)
    expectSameRows(before.rows, after.rows)
    expect(problems).toEqual([])
    await context.close()
  })

  test('7.1 and 7.2 a browser holding v12 loads the candidate: upgraded, nothing lost, goals apart @release', async ({
    browser,
  }) => {
    let build = 'v5151'
    const context = await offlineContext(browser)
    const page = await context.newPage()
    await serve(page, () => join(BUILDS as string, build))

    await openOldTabWithDemo(page)
    // 7.2 is about data the old build wrote, and 5.15.1 kept retirement goals in the savings-goal
    // store: add one there, through 5.15.1's own Retirement page.
    await addRetirementGoal(page, OLD_PENSION)
    const before = await counts(page)
    expect(before.version).toBe(12)
    // Leave the app (a static file holds no connection), then come back on the new build.
    await page.goto(`${ORIGIN}/robots.txt`)
    build = 'rc'
    const problems = watchConsole(page)
    await page.goto(`${ORIGIN}/`)
    await expect(page.getByTestId('dashboard-container')).toBeVisible({ timeout: 120_000 })
    const after = await counts(page)
    expect(after.version).toBe(13)
    expectSameRows(before.rows, after.rows)

    // 7.2: after the upgrade each page lists only its own kind.
    await page.evaluate(() => {
      window.location.hash = 'retirement'
    })
    const retirement = page.getByTestId('retirement-goals')
    await expect(
      retirement.getByTestId('retirement-goal-card').filter({ hasText: OLD_PENSION })
    ).toHaveCount(1, { timeout: 20_000 })
    await expect(retirement).not.toContainText('Emergency Fund')
    await page.evaluate(() => {
      window.location.hash = 'goals'
    })
    const savings = page
      .getByTestId('goal-card')
      .filter({ has: page.getByTestId('goal-name').filter({ hasText: 'Emergency Fund' }) })
    await expect(savings).toHaveCount(1, { timeout: 20_000 })
    await expect(page.getByTestId('goals-grid')).not.toContainText(OLD_PENSION)
    expect(problems).toEqual([])
    await context.close()
  })

  test('15 (the window between the two tags): 5.16.0 alone waits without saying why @release', async ({
    browser,
  }) => {
    // Informational: this is the 1 to 3 minutes between tagging v5.16.0 and v5.16.1, when a
    // local-first user with a 5.15.1 tab still open gets a new tab that waits on a blank screen.
    const context = await offlineContext(browser)
    const oldTab = await openOldTabWithDemo(await tabOn(context, 'v5151'))
    const newTab = await tabOn(context, 'v5160')
    await newTab.goto(`${ORIGIN}/`)
    await newTab.waitForTimeout(15_000)
    await expect(newTab.getByTestId('dashboard-container')).toBeHidden()
    await expect(newTab.getByText(CLOSE_OTHER_TABS)).toBeHidden()

    await oldTab.close()
    await expect(newTab.getByTestId('dashboard-container')).toBeVisible({ timeout: 120_000 })
    await context.close()
  })

  test('15.2 a 5.16.0 tab and a 5.16.1 tab share v13; the old one offers the update @release', async ({
    browser,
  }) => {
    const context = await offlineContext(browser)
    const oldTab = await openOldTabWithDemo(await tabOn(context, 'v5160'))
    expect((await counts(oldTab)).version).toBe(13)

    const newTab = await tabOn(context, 'rc')
    const problems = watchConsole(newTab)
    await newTab.goto(`${ORIGIN}/`)
    // Same database version: the new build loads normally, no waiting notice.
    await expect(newTab.getByTestId('dashboard-container')).toBeVisible({ timeout: 120_000 })
    await expect(newTab.getByText(CLOSE_OTHER_TABS)).toBeHidden()

    // The old tab learns of the new build when it is looked at again: version.json on focus. Its
    // own route serves its own build, so version.json comes from the candidate's folder here.
    await oldTab.unroute('**/*')
    await serve(oldTab, () => join(BUILDS as string, 'rc'))
    await oldTab.bringToFront()
    await oldTab.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    await expect(oldTab.getByText(/is ready\./)).toBeVisible({ timeout: 30_000 })

    // Both tabs keep working (15.1): each can still read its data.
    await expect(oldTab.getByTestId('dashboard-container')).toBeVisible()
    expect(problems).toEqual([])
    await context.close()
  })
})
