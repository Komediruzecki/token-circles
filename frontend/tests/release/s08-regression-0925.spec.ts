/**
 * Release scope 5.16.0, section 8: the regression spot-check from 2026-09-25.
 *
 * #578 and #579 reworked the machinery these 09-25 cases tested, so they run again: 2.2 (a
 * dropdown keeps its pick across a reconnect), 3.6 (a goal names its renamed category), 4.1 (the
 * First budget badge), and 5.2 to 5.4 (resume, reconnect, one request per endpoint). The case
 * numbers are the 09-25 scope's.
 */
import {
  accountsOf,
  arrangeAccountOf,
  arrangeCategory,
  countFrom,
  ensureFetchLog,
  expectGets,
  getsDuring,
  localIso,
  reloadOn,
  settledValue,
  settleFetches,
  shownPage,
  writeElsewhere,
  writeInTab,
} from './follow-helpers'
import { dataVersions } from './import-helpers'
import { goalCard, renameCategory } from './page-handles'
import { both, cloudTest, expect } from './release-fixtures'
import {
  awayAndBack,
  createProfileFromSidebar,
  dismissOnboardingIfOpen,
  goPage,
} from './release-helpers'
import type { Locator, Page } from '@playwright/test'

const TX_LIST = /^\/api\/transactions(\?|$)/

/** A row of the Transactions list, by its (unique) description. */
function txRow(page: Page, description: string): Locator {
  return page.getByTestId('transactions-row').filter({ hasText: description })
}

/** An expense dated today, as the app's quick entry posts it (see arrangeExpense). */
function expenseBody(
  description: string,
  amount: number,
  categoryId: number,
  accountId: number | null
): Record<string, unknown> {
  return {
    description,
    amount,
    date: localIso(),
    beneficiary: '',
    payor: '',
    category_id: categoryId,
    currency: 'EUR',
    amount_local: amount,
    exchange_rate: 1,
    type: 'expense',
    notes: '',
    account_id: accountId,
  }
}

/** The options of a select, as value and label. */
async function optionsOf(select: Locator): Promise<{ value: string; label: string }[]> {
  return select.evaluate((el) =>
    [...(el as HTMLSelectElement).options].map((o) => ({
      value: o.value,
      label: (o.textContent ?? '').trim(),
    }))
  )
}

/** What a select shows: its selected option's label. */
async function shownOption(select: Locator): Promise<string> {
  return select.evaluate((el) =>
    ((el as HTMLSelectElement).selectedOptions[0]?.textContent ?? '').trim()
  )
}

/** Budgets: a category's card (h3 > info > header > card). */
function budgetsCard(page: Page, category: string): Locator {
  return shownPage(page)
    .getByRole('heading', { level: 3, name: category, exact: true })
    .locator('xpath=../../..')
}

function thisMonthStart(): string {
  const now = new Date()
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

for (const [pass, test] of both) {
  test.describe(`5.16.0 s8 regression 09-25 [${pass}]`, () => {
    test('2.2 the add-transaction form keeps its picks across offline and online @release', async ({
      m,
    }) => {
      const { page } = m
      // Two categories and two accounts of this case's own at least, so a category that is not
      // first and an account that is not the default can be picked.
      await arrangeCategory(m, `zz-first${m.suffix}`)
      await arrangeCategory(m, `zz-second${m.suffix}`)
      await arrangeAccountOf(m, { name: `zz-other${m.suffix}`, type: 'giro', balance: 100 })
      await reloadOn(page, 'transactions', 'transactions-header')
      await page.getByTestId('add-transaction-btn').click()
      const modal = page.getByTestId('tx-modal')
      await expect(modal).toBeVisible()
      await modal.getByTestId('tx-type-expense').click()

      // A category that is not first in the list, and an account other than the default.
      const category = modal.getByTestId('tx-category')
      const listed = async () => (await optionsOf(category)).filter((o) => o.value !== '')
      await expect.poll(async () => (await listed()).length).toBeGreaterThan(1)
      const categories = await listed()
      const pickedCategory = categories[categories.length - 1]
      await category.selectOption(pickedCategory.value)
      const account = modal.getByTestId('tx-account')
      await expect.poll(async () => (await optionsOf(account)).length).toBeGreaterThan(2)
      const preset = await account.inputValue()
      const accounts = (await optionsOf(account)).filter(
        (o) => o.value !== '' && o.value !== preset
      )
      expect(accounts.length).toBeGreaterThan(0)
      const pickedAccount = accounts[accounts.length - 1]
      await account.selectOption(pickedAccount.value)

      const counters = await settledValue(page, () => dataVersions(page))
      const since = await countFrom(page)
      await m.context.setOffline(true)
      await m.context.setOffline(false)

      // The reconnect refreshed both lists: their counters moved, and in cloud the form's two
      // lists were fetched again.
      const after = await settledValue(page, () => dataVersions(page))
      expect(after.categories ?? 0).toBeGreaterThan(counters.categories ?? 0)
      expect(after.accounts ?? 0).toBeGreaterThan(counters.accounts ?? 0)
      if (m.kind === 'cloud') {
        const gets = await since()
        const log = `\n    ${gets.join('\n    ')}`
        expect(
          gets.filter((p) => /^\/api\/categories(\?|$)/.test(p)).length,
          `categories refetched${log}`
        ).toBeGreaterThan(0)
        expect(
          gets.filter((p) => /^\/api\/accounts(\?|$)/.test(p)).length,
          `accounts refetched${log}`
        ).toBeGreaterThan(0)
      }

      // Both dropdowns still hold, and show, the picks.
      await expect(category).toHaveValue(pickedCategory.value)
      expect(await shownOption(category)).toBe(pickedCategory.label)
      await expect(account).toHaveValue(pickedAccount.value)
      expect(await shownOption(account)).toBe(pickedAccount.label)
      await modal.getByTestId('tx-cancel-btn').click()
      await expect(modal).toBeHidden()
    })

    test('3.6 a goal names its category’s new name after a rename @release', async ({ m }) => {
      const { page } = m
      const before = `zz-before${m.suffix}`
      const after = `zz-after${m.suffix}`
      const goal = `zz-named${m.suffix}`
      const categoryId = await arrangeCategory(m, before)
      // The body the Goals form posts for a goal linked to a category (Goals.tsx handleSubmit).
      await m.api('/api/savings-goals', {
        method: 'POST',
        body: {
          name: goal,
          target_amount: 500,
          target_date: '',
          monthly_contribution: null,
          category_id: categoryId,
          tracking_start_date: localIso(),
        },
      })
      await reloadOn(page, 'goals', 'page-goals')
      const line = goalCard(page, goal).getByTestId('goal-date')
      await expect(line).toContainText(before)

      await renameCategory(page, before, after)
      await goPage(page, 'goals', 'page-goals')
      await expect(line).toContainText(after)
      await expect(line).not.toContainText(before)
    })

    test('4.1 a first budget unlocks the First budget badge @release', async ({ m }) => {
      const { page } = m
      // Badges are per profile, and the case's own may have earned this one already.
      const profile = `zz-badges${m.suffix}`
      const category = `zz-budgeted${m.suffix}`
      // This device has seen the setup wizard, so it does not open over the empty profile.
      await page.evaluate(() => {
        localStorage.setItem('finance_onboarding', 'skipped')
      })
      await createProfileFromSidebar(page, profile)
      await expect(page.getByTestId('profile-dropdown-btn')).toContainText(profile)
      await arrangeCategory(m, category)
      await reloadOn(page, 'budgets', 'budgets-page')
      // Let the new profile's first badge evaluation finish, as it would before a person got to
      // the button. This host is not one of the app's own, so in cloud it counts as self-hosted
      // and that evaluation earns Own the stack; run together with the budget's, the two would
      // be announced as one "badges earned from your history" toast.
      await ensureFetchLog(page)
      await settleFetches(page, 3000)

      await budgetsCard(page, category).getByTitle('Set Budget').click()
      await page.getByPlaceholder('500.00').fill('100')
      await page.getByRole('button', { name: 'Save Budget' }).click()

      await expect(
        page
          .getByRole('region', { name: 'Notifications' })
          .getByRole('status')
          .filter({ hasText: 'Badge unlocked: First budget' })
      ).toBeVisible({ timeout: 15_000 })
    })

    test('5.2 back after over a minute in another tab: the new transaction is listed @release', async ({
      m,
    }) => {
      const { page, context } = m
      const description = `zz tab b${m.suffix}`
      const categoryId = await arrangeCategory(m, `zz-tabcat${m.suffix}`)
      const accountId = (await accountsOf(m))[0]?.id ?? null
      await reloadOn(page, 'transactions', 'transactions-header')
      await expect(txRow(page, description)).toHaveCount(0)

      const tabB = await context.newPage()
      await tabB.goto('/#transactions', { waitUntil: 'domcontentloaded' })
      await expect(tabB.getByTestId('profile-dropdown-btn')).toBeVisible({ timeout: 30_000 })
      await dismissOnboardingIfOpen(tabB)

      const asked = await getsDuring(m, TX_LIST, async () => {
        await awayAndBack(page, 61_000, async () => {
          await tabB.bringToFront()
          await writeInTab(tabB, '/api/transactions', {
            method: 'POST',
            body: expenseBody(description, 20, categoryId, accountId),
          })
          await page.bringToFront()
        })
        await expect(txRow(page, description)).toHaveCount(1, { timeout: 15_000 })
      })
      expectGets(m, asked, 1, 'Transactions refetches its list once on the resume')
      await tabB.close()
    })

    test('5.3 offline then online: Transactions refetches at once @release', async ({ m }) => {
      const { page } = m
      const description = `zz reconnect${m.suffix}`
      const categoryId = await arrangeCategory(m, `zz-netcat${m.suffix}`)
      const accountId = (await accountsOf(m))[0]?.id ?? null
      await reloadOn(page, 'transactions', 'transactions-header')

      // Written from somewhere this tab is not told about, and no time away at all.
      await writeElsewhere(m, '/api/transactions', {
        method: 'POST',
        body: expenseBody(description, 30, categoryId, accountId),
      })
      await expect(txRow(page, description)).toHaveCount(0)

      const asked = await getsDuring(m, TX_LIST, async () => {
        await m.context.setOffline(true)
        await m.context.setOffline(false)
        await expect(txRow(page, description)).toHaveCount(1, { timeout: 15_000 })
      })
      expectGets(m, asked, 1, 'Transactions refetches its list once on reconnect')
    })
  })
}

// 5.4 counts requests, which only cloud makes.
cloudTest.describe('5.16.0 s8 regression 09-25 [cloud]', () => {
  cloudTest(
    '5.4 Budgets on screen through a reconnect asks each endpoint once @release',
    async ({ m }) => {
      const { page } = m
      const categoryId = await arrangeCategory(m, `zz-budcat${m.suffix}`)
      await m.api('/api/budgets', {
        method: 'POST',
        body: {
          category_id: categoryId,
          amount: 300,
          period: 'monthly',
          start_date: thisMonthStart(),
        },
      })
      const accountId = (await accountsOf(m))[0]?.id ?? null
      await reloadOn(page, 'budgets', 'budgets-page')
      await writeElsewhere(m, '/api/transactions', {
        method: 'POST',
        body: expenseBody(`zz budget spend${m.suffix}`, 45, categoryId, accountId),
      })

      // Budgets' list follows two counters (categories and budgets); a reconnect bumps every
      // counter, in one update, so each of the page's endpoints is asked once.
      const asked = await getsDuring(m, /^\/api\/categories(\?|$)/, async () => {
        await m.context.setOffline(true)
        await m.context.setOffline(false)
      })
      expectGets(m, asked, 1, 'Budgets asks for its categories once on reconnect')
      const log = `\n    ${(asked?.seen ?? []).join('\n    ')}`
      for (const endpoint of [
        /^\/api\/budgets\/summary\?/,
        /^\/api\/budgets\/zero-based\?/,
        /^\/api\/budgets\/zero-based\/summary\?/,
        /^\/api\/budgets\/forecast\?/,
        /^\/api\/budgets\/improvements\?/,
      ]) {
        expect(
          (asked?.gets ?? []).filter((p) => endpoint.test(p)),
          `${String(endpoint)} once on reconnect${log}`
        ).toHaveLength(1)
      }
    }
  )
})
