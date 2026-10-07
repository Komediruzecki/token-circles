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
 * Each tab is served from those folders by Playwright routing on a made-up origin; every request
 * to anything else is aborted, so nothing leaves the machine. Service workers are blocked, which
 * isolates the database handshake from the service-worker update path.
 */
import { expect, test } from '@playwright/test'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserContext, Page } from '@playwright/test'

const BUILDS = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env?.RELEASE_BUILDS_DIR
const ORIGIN = 'http://127.0.0.1:3811'
const CLOSE_OTHER_TABS = 'Close your other Token Circles tabs to finish updating this one.'

test.skip(!BUILDS, 'set RELEASE_BUILDS_DIR to folders of production builds (see the header)')

/** Serve whichever build `root()` names, as a static host with an SPA fallback would. */
async function serve(context: BrowserContext, root: () => string): Promise<void> {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== ORIGIN) return route.abort()
    let file = join(root(), decodeURIComponent(url.pathname))
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root(), 'index.html')
    return route.fulfill({ path: file, headers: { 'Cache-Control': 'no-store' } })
  })
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

async function openOldTabWithDemo(context: BrowserContext): Promise<Page> {
  const page = await context.newPage()
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

test.describe('5.16 local-first upgrade with another tab open', () => {
  test.setTimeout(300_000)

  test('15 (prod first load): a 5.15.1 tab is open, the 5.16.1 tab says why it waits @release', async ({
    browser,
  }) => {
    // RELEASE BLOCKER for the 5.16.1 promise. The `blocked` handler (core/storage/idb.ts, getDB)
    // queues the notice as a toast, but <ToastContainer /> is mounted inside App's
    // `<Show when={!_isLoading()}>` (App.tsx:825, container at :1329), and boot is exactly what
    // the blocked open holds up. The tab shows "Preparing your orbit…" and nothing else, as
    // 5.16.0 does. Fix: render toasts (or this notice) outside the loading gate.
    test.fail(true, 'the notice is queued but never drawn: toasts mount only after boot')
    let root = join(BUILDS as string, 'v5151')
    const context = await browser.newContext({ serviceWorkers: 'block' })
    await serve(context, () => root)

    const oldTab = await openOldTabWithDemo(context)
    const before = await counts(oldTab)
    expect(before.version).toBe(12)

    root = join(BUILDS as string, 'rc')
    const newTab = await context.newPage()
    const problems = watchConsole(newTab)
    await newTab.goto(`${ORIGIN}/`)

    // The upgrade is blocked by the old tab's open connection: the new tab must say so.
    await expect(newTab.getByText(CLOSE_OTHER_TABS)).toBeVisible({ timeout: 60_000 })

    // Closing the old tab lets the upgrade through, and the new tab finishes on its own.
    await oldTab.close()
    await expect(newTab.getByTestId('dashboard-container')).toBeVisible({ timeout: 120_000 })
    const after = await counts(newTab)
    expect(after.version).toBe(13)
    expectSameRows(before.rows, after.rows)
    expect(problems).toEqual([])
    await context.close()
  })

  test('7.1 a browser holding v12 loads the candidate: upgraded, nothing lost @release', async ({
    browser,
  }) => {
    let root = join(BUILDS as string, 'v5151')
    const context = await browser.newContext({ serviceWorkers: 'block' })
    await serve(context, () => root)

    const page = await openOldTabWithDemo(context)
    const before = await counts(page)
    expect(before.version).toBe(12)
    // Leave the app (a static file holds no connection), then come back on the new build.
    await page.goto(`${ORIGIN}/robots.txt`)
    root = join(BUILDS as string, 'rc')
    const problems = watchConsole(page)
    await page.goto(`${ORIGIN}/`)
    await expect(page.getByTestId('dashboard-container')).toBeVisible({ timeout: 120_000 })
    const after = await counts(page)
    expect(after.version).toBe(13)
    expectSameRows(before.rows, after.rows)
    expect(problems).toEqual([])
    await context.close()
  })

  test('15 (the window between the two tags): 5.16.0 alone waits without saying why @release', async ({
    browser,
  }) => {
    // Informational: this is the 1 to 3 minutes between tagging v5.16.0 and v5.16.1, when a
    // local-first user with a 5.15.1 tab still open gets a new tab that waits on a blank screen.
    let root = join(BUILDS as string, 'v5151')
    const context = await browser.newContext({ serviceWorkers: 'block' })
    await serve(context, () => root)

    const oldTab = await openOldTabWithDemo(context)
    root = join(BUILDS as string, 'v5160')
    const newTab = await context.newPage()
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
    let root = join(BUILDS as string, 'v5160')
    const context = await browser.newContext({ serviceWorkers: 'block' })
    await serve(context, () => root)

    const oldTab = await openOldTabWithDemo(context)
    expect((await counts(oldTab)).version).toBe(13)

    root = join(BUILDS as string, 'rc')
    const newTab = await context.newPage()
    const problems = watchConsole(newTab)
    await newTab.goto(`${ORIGIN}/`)
    // Same database version: the new build loads normally, no waiting notice.
    await expect(newTab.getByTestId('dashboard-container')).toBeVisible({ timeout: 120_000 })
    await expect(newTab.getByText(CLOSE_OTHER_TABS)).toBeHidden()

    // The old tab learns of the new build when it is looked at again (version.json on focus).
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
