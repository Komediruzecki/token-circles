/**
 * The Portfolio dialog, in both storage modes: a holding without a ticker, shares, a price or a
 * date is marked at each field and nothing is sent, and a buy merged into a holding the runtime
 * then refuses is marked at the shares, in the runtime's words.
 *
 * The dialog said "Please fill all required fields" or "Failed to save holding" in a toast, with
 * nothing marked. Now it checks with the rules both runtimes run (shared/holdingSchema.ts) before
 * it sends anything. What only the runtime can tell is the merged holding: a buy of a ticker
 * already held is added to it, and shares that come to one trillion or more are refused.
 *
 * Every case runs signed in (the Worker) and local-first (the IndexedDB router). Pull requests
 * run the `@smoke` one; main runs them all.
 */
import { expect, test } from '@playwright/test'
import {
  caseStamp,
  daysFromToday,
  errorToasts,
  MODES,
  sweepProfiles,
  viaApp,
  watchErrors,
  watchWrites,
} from './form-errors-helpers'
import type { Locator, Page } from '@playwright/test'

interface Holding {
  id: number
  ticker: string
  shares: number
}

/** A made-up ticker: nothing real is held in a fixture. */
const TICKER = 'ZZQX'

const header = (page: Page): Locator => page.getByTestId('portfolio-header')
const dialog = (page: Page): Locator => page.getByTestId('portfolio-modal')
const tickerField = (page: Page): Locator => page.getByTestId('portfolio-form-ticker')
const sharesField = (page: Page): Locator => page.getByTestId('portfolio-form-shares')
const priceField = (page: Page): Locator => page.getByTestId('portfolio-form-price')
const dateField = (page: Page): Locator => page.getByTestId('portfolio-form-date')
const submit = (page: Page) => page.getByTestId('portfolio-modal-submit').click()

for (const mode of MODES) {
  test.describe(`the holding dialog, ${mode.name}`, () => {
    /** In the name of everything a case makes, so the sweep can find it. */
    let stamp = ''

    test.beforeEach(() => {
      test.setTimeout(120_000)
      stamp = caseStamp()
    })

    test.afterEach(async ({ page }) => {
      await sweepProfiles(page, mode, stamp)
    })

    test('a holding without its fields is marked at each and nothing is sent, and a merge past one trillion shares is marked at the shares @smoke', async ({
      page,
    }) => {
      const errors = watchErrors(page)
      await mode.open(page, 'portfolio', header, `zz-portfolio-${stamp}`)
      const writes = watchWrites(page, /^\/api\/portfolio\/holdings/)

      await page.getByTestId('add-holding-btn').click()
      await expect(dialog(page)).toBeVisible()
      await submit(page)

      await expect(tickerField(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(tickerField(page)).toHaveAccessibleDescription('Enter the ticker symbol.')
      await expect(sharesField(page)).toHaveAccessibleDescription('Enter the number of shares.')
      await expect(priceField(page)).toHaveAccessibleDescription(
        'Enter the price you paid per share.'
      )
      await expect(dateField(page)).toHaveAccessibleDescription(
        'Choose the date you bought the shares.'
      )
      await expect(tickerField(page)).toBeFocused()
      expect(writes).toEqual([])
      await expect(errorToasts(page)).toHaveCount(0)

      // A holding one share short of a trillion, added through the app: the page lists it, so a
      // buy of the same ticker is offered as a merge.
      await viaApp(page, 'POST', '/api/portfolio/holdings', {
        ticker: TICKER,
        shares: 999_999_999_999,
        purchase_price: 1,
        purchase_date: daysFromToday(-30),
      })
      await expect(
        page.getByTestId('portfolio-ticker').filter({ hasText: TICKER }).first()
      ).toBeVisible({ timeout: 15_000 })

      await tickerField(page).fill(TICKER.toLowerCase())
      await sharesField(page).fill('1')
      await priceField(page).fill('1')
      await dateField(page).fill(daysFromToday(0))
      await submit(page)
      await page.getByTestId('confirm-accept').click()

      await expect(sharesField(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(sharesField(page)).toHaveAccessibleDescription(
        'Enter fewer than one trillion shares.'
      )
      await expect(sharesField(page)).toBeFocused()
      await expect(tickerField(page)).not.toHaveAttribute('aria-invalid', 'true')
      await expect(dialog(page)).toBeVisible()
      await expect(errorToasts(page)).toHaveCount(0)
      const held = (await viaApp<Holding[]>(page, 'GET', '/api/portfolio/holdings')).filter(
        (holding) => holding.ticker === TICKER
      )
      expect(held.map((holding) => holding.shares)).toEqual([999_999_999_999])
      expect(errors).toEqual([])
    })
  })
}
