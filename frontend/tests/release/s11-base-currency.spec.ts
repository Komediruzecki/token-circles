/**
 * Release scope 5.16.1, section 11: money in the base currency (ab49792d).
 *
 * The scope sets Settings > Base currency to GBP first. The app locks the base currency once there
 * are accounts or transactions (worker/src/base-currency.ts, core/storage/baseCurrency.ts), and the
 * case's own profiles carry the seed's, so each case starts somewhere empty and sets it there, as a
 * new user would: in cloud a profile of its own, in local-first a reset workspace (the base
 * currency is one for the whole browser there, and the demo has data). The data a case looks at is
 * arranged after the currency is set, in pounds.
 */
import { arrangeCategory, arrangeExpense, localIso, reloadOn, shownPage } from './follow-helpers'
import { recurringSection } from './page-handles'
import { both, expect } from './release-fixtures'
import { createProfileFromSidebar, goPage } from './release-helpers'
import type { Locator, Page } from '@playwright/test'
import type { Mode } from './release-fixtures'

/** Settings > Base currency, through the select, confirmed by the app's own toast. */
async function setBaseCurrency(page: Page, currency: string): Promise<void> {
  await goPage(page, 'settings', 'settings-header')
  const select = page.locator('[data-tour="settings-currency"] select')
  await expect(select).toBeEnabled()
  await select.selectOption(currency)
  await expect(
    page
      .getByRole('region', { name: 'Notifications' })
      .getByRole('status')
      .filter({ hasText: `Base currency set to ${currency}` })
  ).toBeVisible({ timeout: 15_000 })
}

/** An empty place to keep books in `currency`: see the file comment. */
async function emptyBooksIn(m: Mode, currency: string): Promise<void> {
  const { page } = m
  // This device has seen the setup wizard, so it does not open over the empty books.
  await page.evaluate(() => {
    localStorage.setItem('finance_onboarding', 'skipped')
  })
  if (m.kind === 'cloud') {
    await createProfileFromSidebar(page, `zz-books${m.suffix}`)
    await expect(page.getByTestId('profile-dropdown-btn')).toContainText(`zz-books${m.suffix}`)
  } else {
    // Settings > Danger zone's reset: every row goes, the profiles stay.
    await m.api('/api/clear-all', { method: 'DELETE' })
  }
  await reloadOn(page, 'settings', 'settings-header')
  await setBaseCurrency(page, currency)
}

/** An account in the base currency: the only kind the app takes once one is set. */
async function arrangeAccountIn(m: Mode, currency: string): Promise<void> {
  await m.api('/api/accounts', {
    method: 'POST',
    body: {
      name: `zz-books-acc${m.suffix}`,
      type: 'giro',
      currency,
      bank_name: '',
      balance: 1000,
      starting_balance: 1000,
    },
  })
}

/** The centre of the heatmap's cell for today, in page coordinates. */
async function todaysHeatmapCell(page: Page): Promise<{ x: number; y: number }> {
  const centre = await page.locator('[data-tour="analytics-heatmap"]').evaluate((root) => {
    const today = new Date()
    for (const cell of root.querySelectorAll('rect.cell')) {
      const day = (cell as Element & { __data__?: unknown }).__data__
      if (
        day instanceof Date &&
        day.getFullYear() === today.getFullYear() &&
        day.getMonth() === today.getMonth() &&
        day.getDate() === today.getDate()
      ) {
        const box = cell.getBoundingClientRect()
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      }
    }
    return null
  })
  expect(centre, 'the heatmap has a cell for today').not.toBeNull()
  return centre ?? { x: 0, y: 0 }
}

/** The catalog's price field for a picked service, and the currency shown before it. */
function catalogPrefix(catalog: Locator, service: string): Locator {
  return catalog
    .getByRole('textbox', { name: `${service} price`, exact: true })
    .locator('xpath=preceding-sibling::span[1]')
}

/** Bills > Subscriptions > Browse catalog. */
async function openCatalog(page: Page): Promise<Locator> {
  await goPage(page, 'bills', 'bills-header')
  await page.getByTestId('bills-tab-subscriptions').click()
  await page.getByTestId('browse-catalog-btn').click()
  const catalog = page.getByRole('dialog', { name: 'Subscription catalog' })
  await expect(catalog).toBeVisible()
  return catalog
}

/** Pick the catalog's first `n` services not picked yet; returns their names. */
async function pickServices(catalog: Locator, n: number): Promise<string[]> {
  const picked: string[] = []
  for (let i = 0; i < n; i++) {
    // A service's row toggles it; its check button only shows once the row is picked.
    const row = catalog.locator('[role="button"][aria-pressed="false"]').first()
    const label =
      (await row.getByRole('button', { name: /^Add / }).getAttribute('aria-label')) ?? ''
    await row.click()
    const service = label.replace(/^Add /, '')
    await expect(
      catalog.getByRole('textbox', { name: `${service} price`, exact: true })
    ).toBeVisible()
    picked.push(service)
  }
  return picked
}

for (const [pass, test] of both) {
  test.describe(`5.16.1 s11 base currency [${pass}]`, () => {
    test('11.1 the spending heatmap’s tooltip shows pounds @release', async ({ m }) => {
      const { page } = m
      await emptyBooksIn(m, 'GBP')
      await arrangeAccountIn(m, 'GBP')
      const categoryId = await arrangeCategory(m, `zz-heat${m.suffix}`)
      await arrangeExpense(m, {
        description: 'zz heat',
        amount: 20,
        categoryId,
        currency: 'GBP',
      })
      await reloadOn(page, 'analytics', 'analytics-header')
      await expect(page.locator('[data-tour="analytics-heatmap"] rect.cell').first()).toBeVisible({
        timeout: 20_000,
      })

      await page.locator('[data-tour="analytics-heatmap"]').scrollIntoViewIfNeeded()
      const cell = await todaysHeatmapCell(page)
      await page.mouse.move(cell.x, cell.y)
      const tooltip = page.locator('#heatmap-tooltip')
      await expect(tooltip).toBeVisible()
      await expect(tooltip).toContainText('£20.00')
      await expect(tooltip).not.toContainText('€')
    })

    test('11.2 the Recurring section shows rule amounts in pounds @release', async ({ m }) => {
      const { page } = m
      const rule = `zz-gbp-rule${m.suffix}`
      await emptyBooksIn(m, 'GBP')
      await m.api('/api/recurring', {
        method: 'POST',
        body: {
          description: rule,
          amount: 25,
          type: 'expense',
          frequency: 'monthly',
          day_of_month: null,
          next_date: localIso(),
          category_id: null,
          notes: null,
        },
      })
      await reloadOn(page, 'transactions', 'transactions-header')
      const section = recurringSection(page)
      await section.getByRole('heading', { name: 'Recurring Transactions' }).click()
      // name > info > item
      const item = section.getByText(rule, { exact: true }).locator('xpath=../..')
      await expect(item).toContainText('£25.00')
      await expect(item).not.toContainText('$')
    })

    test('11.3 every Rent vs Buy result shows pounds @release', async ({ m }) => {
      const { page } = m
      await emptyBooksIn(m, 'GBP')
      await goPage(page, 'rentBuy', 'rent-buy-header')
      const results = ['rent-scenario-card', 'buy-scenario-card', 'comparison-card'].map((id) =>
        page.getByTestId(id)
      )
      for (const card of results) await expect(card).toBeVisible({ timeout: 20_000 })
      for (const card of results) {
        const text = await card.innerText()
        expect(text, 'a result card').toContain('£')
        expect(text, 'a result card').not.toMatch(/[€$]/)
      }
      const chart = page.getByTestId('rent-buy-chart')
      if (await chart.isVisible()) expect(await chart.innerText()).not.toMatch(/[€$]/)
    })

    test('11.4 the subscription catalog prices in the base currency, and follows it to CHF @release', async ({
      m,
    }) => {
      const { page } = m
      await emptyBooksIn(m, 'GBP')
      const catalog = await openCatalog(page)
      const picked = await pickServices(catalog, 2)
      for (const service of picked) await expect(catalogPrefix(catalog, service)).toHaveText('£')
      await expect(catalog).toContainText(/2 selected · £[\d.,]+\/mo/)
      await catalog.getByRole('button', { name: 'Close' }).click()
      // Closed, the catalog stays in the page, transparent and click-through.
      await expect(catalog.locator('xpath=..')).not.toHaveClass(/open/)

      // Still no financial data, so the base currency can move again.
      await setBaseCurrency(page, 'CHF')
      // A service picked now prices in CHF, and so does the total it moves. (The two picked before
      // the switch are still picked: what their fields read is 11.4b.)
      const again = await openCatalog(page)
      const [service] = await pickServices(again, 1)
      await expect(catalogPrefix(again, service)).toHaveText('CHF')
      await expect(again).toContainText(/3 selected · CHF\s?[\d.,]+\/mo/)
    })

    test('11.4b price fields picked before a switch to CHF read CHF after it @release', async ({
      m,
    }) => {
      // The catalog lives on the Bills page, which stays mounted, and it keeps its picks when it
      // closes; only adding them clears it. A picked service's prefix is
      // {currencySymbol(getLocalCurrency())} (SubscriptionCatalogModal.tsx:269) and the footer is
      // money(total()) (:405, formatting with getLocalCurrency() at :125). getLocalCurrency reads
      // localStorage, which nothing tracks, so both keep the currency they were drawn in: after a
      // switch to CHF the open fields still read £, and the total only changes when total() does.
      // Part of the 5.16.1 fix (ab49792d), which replaced a literal € prefix; nothing older.
      test.fail(
        true,
        'the catalog keeps the currency a price field was drawn in (SubscriptionCatalogModal.tsx:269, :405)'
      )
      const { page } = m
      await emptyBooksIn(m, 'GBP')
      const catalog = await openCatalog(page)
      const picked = await pickServices(catalog, 2)
      for (const service of picked) await expect(catalogPrefix(catalog, service)).toHaveText('£')
      await catalog.getByRole('button', { name: 'Close' }).click()
      await expect(catalog.locator('xpath=..')).not.toHaveClass(/open/)

      await setBaseCurrency(page, 'CHF')
      const again = await openCatalog(page)
      // The same two, still picked: their fields and the total read CHF.
      for (const service of picked) await expect(catalogPrefix(again, service)).toHaveText('CHF')
      await expect(again).toContainText(/2 selected · CHF\s?[\d.,]+\/mo/)
    })

    test('11.5 auto-categorize shows pounds on a row with no currency, euros on a EUR row @release', async ({
      m,
    }) => {
      const { page } = m
      const plain = `Zz Corner Bakery${m.suffix}`
      const euro = `Zz Euro Cafe${m.suffix}`
      await emptyBooksIn(m, 'GBP')
      await arrangeAccountIn(m, 'GBP')

      // Imported from a pasted statement: one row with no currency of its own, one in EUR. (The
      // import stores the first in the base currency, so this reads what a user sees; neither
      // mode can store a transaction with no currency at all any more.)
      await goPage(page, 'import', 'import-header')
      await page.getByTestId('import-tab-paste-csv').click()
      await page
        .getByTestId('import-paste-textarea')
        .fill(
          [
            'Date,Description,Amount,Currency',
            `${localIso(-2)},${plain},-12.00,`,
            `${localIso(-1)},${euro},-40.00,EUR`,
          ].join('\n')
        )
      await page.getByTestId('import-paste-parse').click()
      await page.getByTestId('import-continue-mapping').click()
      await expect(page.getByTestId('import-map-currency')).toHaveValue('3')
      await page.getByTestId('import-continue-preview').click()
      await expect(page.getByTestId('import-preview-total')).toHaveText('2')
      await page.getByTestId('import-execute-all').click()
      await expect(page.getByTestId('import-result')).toContainText('Imported 2', {
        timeout: 20_000,
      })

      await goPage(page, 'transactions', 'transactions-header')
      await shownPage(page).getByRole('button', { name: 'Auto', exact: true }).click()
      const row = (description: string) =>
        page.getByTestId('auto-cat-row').filter({ hasText: description })
      await expect(row(plain)).toHaveCount(1, { timeout: 15_000 })
      await expect(row(plain).getByTestId('auto-cat-meta')).toContainText('£12.00')
      await expect(row(euro).getByTestId('auto-cat-meta')).toContainText('€40.00')
    })
  })
}
