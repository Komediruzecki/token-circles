/**
 * Adding subscriptions from Bills, in both storage modes: from the catalog and from a scan of the
 * transactions. A price the rules refuse is marked under its subscription and nothing is sent;
 * a refusal no price can fix, a category deleted in another tab, is said in the notice, naming
 * the subscription.
 *
 * Both said "Fix the highlighted subscription prices" or "Some subscriptions could not be added"
 * in a toast, naming nothing, and the catalog had closed by then. Now each price is checked by
 * the rules both runtimes run for a bill (shared/billSchema.ts) before anything is sent.
 *
 * A subscription is filed under the first of its catalog categories the profile has: "Software"
 * for Linear, "Security" for NordVPN. Neither is a category a profile starts with, so each case
 * adds its own, and deletes it behind the page's back.
 *
 * Every case runs signed in (the Worker) and local-first (the IndexedDB router). Main runs them
 * all; none is `@smoke`.
 */
import { expect, test } from '@playwright/test'
import {
  caseStamp,
  daysFromToday,
  elsewhere,
  errorToasts,
  goTo,
  MODES,
  sweepProfiles,
  viaApp,
  watchErrors,
  watchWrites,
} from './form-errors-helpers'
import type { Locator, Page } from '@playwright/test'

interface Bill {
  id: number
  name: string
}

/** What the catalog and the scan log for each subscription the runtime refuses. */
const REFUSAL_LOG = /^Failed to add subscription/

const shell = (page: Page): Locator => page.getByTestId('profile-dropdown-btn')
const billsHeader = (page: Page): Locator => page.getByTestId('bills-header')

/** Adds an expense category named `name` through the app, and answers its id. */
async function addCategory(page: Page, name: string): Promise<number> {
  const created = await viaApp<{ id: number }>(page, 'POST', '/api/categories', {
    name,
    type: 'expense',
    color: '#0ea5e9',
    icon: 'tag',
  })
  return created.id
}

/** The bills called `name`, as the app lists them. */
async function billsNamed(page: Page, name: string): Promise<Bill[]> {
  return (await viaApp<Bill[]>(page, 'GET', '/api/bills')).filter((bill) => bill.name === name)
}

for (const mode of MODES) {
  test.describe(`adding subscriptions, ${mode.name}`, () => {
    /** In the name of everything a case makes, so the sweep can find it. */
    let stamp = ''

    test.beforeEach(() => {
      test.setTimeout(120_000)
      stamp = caseStamp()
    })

    test.afterEach(async ({ page }) => {
      await sweepProfiles(page, mode, stamp)
    })

    test('the catalog marks a price of zero under its token and sends nothing, and says in its notice why a subscription was refused', async ({
      page,
    }) => {
      const errors = watchErrors(page, REFUSAL_LOG)
      const profileId = await mode.open(page, 'dashboard', shell, `zz-catalog-${stamp}`)
      const category = await addCategory(page, 'Software')
      await goTo(page, 'bills', billsHeader(page))
      const writes = watchWrites(page, /^\/api\/bills/)
      const before = (await billsNamed(page, 'Linear')).length

      await page.getByTestId('bills-tab-subscriptions').click()
      await page.getByTestId('browse-catalog-btn').click()
      const catalog = page.getByRole('dialog', { name: 'Subscription catalog' })
      await expect(catalog).toBeVisible()
      await catalog.getByLabel('Search the catalog').fill('Linear')
      await catalog
        .locator('[role="button"][aria-pressed="false"]')
        .filter({ hasText: 'Linear' })
        .click()
      const price = catalog.getByRole('textbox', { name: 'Linear price', exact: true })
      const add = catalog.getByRole('button', { name: 'Add 1', exact: true })

      await price.fill('0')
      await add.click()

      await expect(price).toHaveAttribute('aria-invalid', 'true')
      await expect(price).toHaveAccessibleDescription('Enter an amount more than zero.')
      await expect(price).toBeFocused()
      expect(writes).toEqual([])
      await expect(errorToasts(page)).toHaveCount(0)

      // Its category, deleted in another tab: no price would fix that.
      await price.fill('8')
      await elsewhere(page, mode, 'DELETE', `/api/categories/${String(category)}`, profileId)
      await add.click()

      await expect(catalog.getByTestId('catalog-notice')).toHaveText(
        `Couldn't add "Linear". Choose a category from the list, or leave it blank.`
      )
      await expect(price).not.toHaveAttribute('aria-invalid', 'true')
      await expect(catalog).toBeVisible()
      await expect(errorToasts(page)).toHaveCount(0)
      expect(await billsNamed(page, 'Linear')).toHaveLength(before)
      expect(errors).toEqual([])
    })

    test('the scan marks a blank price under its row and sends nothing, and says in its notice why a subscription was refused', async ({
      page,
    }) => {
      const errors = watchErrors(page, REFUSAL_LOG)
      const profileId = await mode.open(page, 'dashboard', shell, `zz-scan-${stamp}`)
      // Four monthly charges the scan reads as a NordVPN subscription.
      for (const days of [95, 65, 35, 5]) {
        await viaApp(page, 'POST', '/api/transactions', {
          description: 'NordVPN',
          amount: 11.99,
          type: 'expense',
          date: daysFromToday(-days),
        })
      }
      const category = await addCategory(page, 'Security')
      await goTo(page, 'bills', billsHeader(page))
      const writes = watchWrites(page, /^\/api\/bills/)
      const before = (await billsNamed(page, 'NordVPN')).length

      await page.getByTestId('bills-tab-subscriptions').click()
      await page.getByTestId('scan-subscriptions-btn').click()
      const scan = page.getByTestId('sub-scan-modal')
      const row = scan.locator('[data-test-id="sub-scan-row"][data-name="NordVPN"]')
      await expect(row).toBeVisible({ timeout: 15_000 })
      // Only NordVPN is added: the demo's own charges can be found too.
      for (const other of await scan.getByTestId('sub-scan-row').all()) {
        if ((await other.getAttribute('data-name')) === 'NordVPN') continue
        const box = other.getByTestId('sub-scan-row-checkbox')
        if ((await box.isChecked()) && (await box.isEnabled())) await box.uncheck()
      }
      const price = row.getByTestId('sub-scan-price')
      const add = scan.getByTestId('sub-scan-add-btn')
      await expect(add).toHaveText('Add 1')

      await price.fill('')
      await add.click()

      await expect(price).toHaveAttribute('aria-invalid', 'true')
      await expect(price).toHaveAccessibleDescription('Enter the amount.')
      await expect(price).toBeFocused()
      expect(writes).toEqual([])
      await expect(errorToasts(page)).toHaveCount(0)

      // Its category, deleted in another tab: no price would fix that.
      await price.fill('11.99')
      await elsewhere(page, mode, 'DELETE', `/api/categories/${String(category)}`, profileId)
      await add.click()

      await expect(scan.getByTestId('sub-scan-notice')).toHaveText(
        `Couldn't add "NordVPN". Choose a category from the list, or leave it blank.`
      )
      await expect(price).not.toHaveAttribute('aria-invalid', 'true')
      await expect(scan).toBeVisible()
      await expect(errorToasts(page)).toHaveCount(0)
      expect(await billsNamed(page, 'NordVPN')).toHaveLength(before)
      expect(errors).toEqual([])
    })
  })
}
