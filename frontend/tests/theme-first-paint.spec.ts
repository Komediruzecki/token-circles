/**
 * The first paint is the theme the screen settles on, signed out and signed in, with the system on
 * light or dark and a stored choice or none.
 *
 * Before: with the system on light and no stored choice, the sign-in screen painted light and
 * turned dark about 50 to 100 ms later (App's start-up set dark over theme-init.js's system stamp),
 * and a signed-in boot went light, dark, light (then core/theme.ts set the system theme back).
 *
 * Each case boots twice, as a returning visitor: theme-init.js reads the screen App recorded last
 * time, because before first paint nothing can ask the Worker whether the session is live. The
 * second boot is measured: `data-theme` is stamped once, before paint, and never changes after.
 */
import { expect, test } from '@playwright/test'
import { E2E_BASE, STORAGE_STATE } from './e2e-constants'

type Case = { signedIn: boolean; system: 'light' | 'dark'; stored: 'light' | 'dark' | null }

const cases: Case[] = []
for (const signedIn of [false, true])
  for (const system of ['light', 'dark'] as const)
    for (const stored of [null, 'light', 'dark'] as const) cases.push({ signedIn, system, stored })

/** Signed-out screens are dark unless a theme was chosen; the app follows the system. */
const settles = ({ signedIn, system, stored }: Case) => stored ?? (signedIn ? system : 'dark')

for (const c of cases) {
  const name = `${c.signedIn ? 'signed in' : 'signed out'}, system ${c.system}, stored ${c.stored ?? 'none'}`
  test(`${name}: paints ${settles(c)} first and stays`, async ({ browser }) => {
    const context = await browser.newContext({
      colorScheme: c.system,
      storageState: c.signedIn ? STORAGE_STATE : { cookies: [], origins: [] },
    })
    await context.addInitScript((stored) => {
      localStorage.setItem('finance_storage_mode', 'self-hosted')
      if (stored) localStorage.setItem('finance-theme', stored)
      else localStorage.removeItem('finance-theme')
      const w = window as unknown as { __themes: string[] }
      w.__themes = []
      // <html> does not exist yet when this runs; watching the document catches its first stamp.
      new MutationObserver((records) => {
        for (const r of records) {
          const now = (r.target as Element).getAttribute('data-theme')
          if (r.oldValue !== now) w.__themes.push(String(now))
        }
      }).observe(document, {
        subtree: true,
        attributes: true,
        attributeFilter: ['data-theme'],
        attributeOldValue: true,
      })
    }, c.stored)
    const page = await context.newPage()
    const settled = c.signedIn
      ? page.getByTestId('dashboard-views')
      : page.locator('button[type="submit"]')

    await page.goto(`${E2E_BASE}/`)
    await expect(settled).toBeVisible({ timeout: 30_000 })
    await page.goto(`${E2E_BASE}/`)
    await expect(settled).toBeVisible({ timeout: 30_000 })
    // Long enough for the lazy pages behind sign-in to load core/theme.ts and run its init.
    await page.waitForTimeout(1500)

    const themes = await page.evaluate(() => (window as unknown as { __themes: string[] }).__themes)
    expect(themes, `${name}: every theme the page showed`).toEqual([settles(c)])
    await context.close()
  })
}

test('signed in, system light, on the first visit since the screen was recorded: paints light and stays', async ({
  browser,
}) => {
  // The first boot after this release: no `finance-screen` yet, but the profile a signed-in
  // browser keeps.
  const context = await browser.newContext({ colorScheme: 'light', storageState: STORAGE_STATE })
  await context.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'self-hosted')
    localStorage.removeItem('finance-theme')
    localStorage.removeItem('finance-screen')
    localStorage.setItem('currentProfileId', localStorage.getItem('currentProfileId') ?? '1')
    const w = window as unknown as { __themes: string[] }
    w.__themes = []
    new MutationObserver((records) => {
      for (const r of records) {
        const now = (r.target as Element).getAttribute('data-theme')
        if (r.oldValue !== now) w.__themes.push(String(now))
      }
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-theme'],
      attributeOldValue: true,
    })
  })
  const page = await context.newPage()
  await page.goto(`${E2E_BASE}/`)
  await expect(page.getByTestId('dashboard-views')).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(1500)
  const themes = await page.evaluate(() => (window as unknown as { __themes: string[] }).__themes)
  expect(themes).toEqual(['light'])
  await context.close()
})
