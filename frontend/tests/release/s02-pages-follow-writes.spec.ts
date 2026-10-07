/**
 * Release scope 5.16.0, section 2, cases 2.1 to 2.9: pages follow writes (#578).
 *
 * Every page a case names is visited first, so it is mounted (pages stay mounted after their first
 * visit), then the write is made, then each page is looked at again without a reload. The scope
 * also asks for one request per endpoint on a page that follows a write, not two: in cloud,
 * `showFollower` checks that showing each page refetched its endpoints once, and `getsDuring`
 * counts the requests a write makes on the page it was made on. Local-first reads never touch the
 * network, so there the visible outcome is the whole check.
 */
import {
  acceptConfirm,
  accountCard,
  addAccountUI,
  arrangeCategory,
  arrangeExpense,
  dashboardNetWorth,
  emergencyTotal,
  expectGets,
  getsDuring,
  goEmergency,
  localIso,
  money,
  parseMoney,
  reloadOn,
  settledValue,
  showFollower,
  shownPage,
  unfoldDashboardWidgets,
} from './follow-helpers'
import { addBankStatement, importAccountOptions, revolutStatement } from './import-helpers'
import {
  calendarDot,
  calendarPopoverRow,
  categoryCard,
  closeCalendarPopover,
  dueThisMonth,
  goalCard,
  openBillCalendar,
  recurringCard,
  recurringSection,
} from './page-handles'
import { both, expect } from './release-fixtures'
import { goPage } from './release-helpers'
import type { Locator, Page } from '@playwright/test'
import type { Mode } from './release-fixtures'

/** A one-row statement, so the Import page has an account picker on screen. */
const STATEMENT = revolutStatement([
  { date: localIso(-3), description: 'Zz Corner Bakery', amount: -12 },
])

const DASHBOARD_METRICS = /^\/api\/dashboard(\?|$)/
const ACCOUNTS = /^\/api\/accounts$/
const EMERGENCY = /^\/api\/calculator\/emergency-fund/

// ---------------------------------------------------------------------------------------------
// Page handles
// ---------------------------------------------------------------------------------------------

/** Dashboard > Budget radar: "Budget · €spent of €budget", as numbers. */
async function radarTotals(page: Page): Promise<{ spent: number; budget: number }> {
  const radar = page
    .getByTestId('dashboard-container')
    .locator('section', { has: page.getByRole('heading', { name: 'Budget radar' }) })
  const line = await radar.locator('li').first().innerText()
  const match = /·\s*(.+?)\s+of\s+(.+)$/.exec(line.trim())
  expect(match, `radar legend "${line}"`).toBeTruthy()
  return { spent: parseMoney(match?.[1] ?? ''), budget: parseMoney(match?.[2] ?? '') }
}

/** Dashboard > Budget Alerts: the row of one category, if it is alerting. */
function budgetAlert(page: Page, category: string): Locator {
  // title > header > card
  const card = page
    .getByTestId('dashboard-container')
    .getByText('Budget Alerts', { exact: true })
    .locator('xpath=../..')
  return card.getByText(category, { exact: true })
}

/** Analytics > Budget flow, set to show this month (it opens on the previous one). */
async function budgetFlowOnThisMonth(page: Page): Promise<void> {
  await goPage(page, 'analytics', 'analytics-header')
  const flow = page.locator('[data-tour="analytics-sankey"]').locator('xpath=..')
  const now = new Date()
  const [year, month] = [flow.locator('select').nth(0), flow.locator('select').nth(1)]
  // Each select loads the flow as it changes, and a slower first answer can land last (the loader
  // keeps whichever arrives last). So change the year only when it is wrong, and let that answer
  // land before the month changes.
  if ((await year.inputValue()) !== String(now.getFullYear())) {
    await year.selectOption(String(now.getFullYear()))
    await settledValue(page, () => budgetFlowTitles(page))
  }
  await month.selectOption(String(now.getMonth() + 1))
}

/** The budget flow's link and node titles: "Total Budget → Groceries\n100.00" and the like. */
async function budgetFlowTitles(page: Page): Promise<string[]> {
  return page.locator('[data-tour="analytics-sankey"] svg title').allTextContents()
}

/** Budgets > a category card's "Set Budget", saved with an amount. */
async function setBudgetUI(page: Page, category: string, amount: number): Promise<void> {
  await goPage(page, 'budgets', 'budgets-page')
  // The card's name heading sits beside its actions: h3 > info > header > actions.
  const header = page
    .getByTestId('budgets-page')
    .getByRole('heading', { name: category, exact: true })
    .locator('xpath=../..')
  await header.getByTestId('budgets-category-actions').getByTitle('Set Budget').click()
  const input = page.getByPlaceholder('500.00')
  await expect(input).toBeVisible()
  await input.fill(String(amount))
  await page.getByRole('button', { name: 'Save Budget' }).click()
  await expect(input).toBeHidden({ timeout: 15_000 })
}

function loanItem(page: Page, name: string): Locator {
  return page
    .getByTestId('loans-item')
    .filter({ has: page.getByTestId('loans-item-name').getByText(name, { exact: true }) })
}

function holdingRow(page: Page, ticker: string): Locator {
  return page
    .getByTestId('portfolio-holding-row')
    .filter({ has: page.getByTestId('portfolio-ticker').getByText(ticker, { exact: true }) })
}

/** Dashboard > Portfolio card. */
function dashboardPortfolio(page: Page): Locator {
  return page
    .getByTestId('dashboard-container')
    .locator('section', { has: page.getByRole('heading', { name: 'Portfolio', exact: true }) })
}

/** Dashboard > Portfolio: the row of one ticker. */
function dashboardHolding(page: Page, ticker: string): Locator {
  return dashboardPortfolio(page).locator('li', { has: page.getByText(ticker, { exact: true }) })
}

async function holdingForm(
  page: Page,
  fields: { ticker?: string; shares?: number; price?: number; date?: string }
): Promise<void> {
  const modal = page.getByTestId('portfolio-modal')
  await expect(modal).toBeVisible()
  if (fields.ticker !== undefined)
    await modal.getByTestId('portfolio-form-ticker').fill(fields.ticker)
  if (fields.shares !== undefined)
    await modal.getByTestId('portfolio-form-shares').fill(String(fields.shares))
  if (fields.price !== undefined)
    await modal.getByTestId('portfolio-form-price').fill(String(fields.price))
  if (fields.date !== undefined) await modal.getByTestId('portfolio-form-date').fill(fields.date)
  await modal.getByTestId('portfolio-modal-submit').click()
}

function housingCard(page: Page, name: string): Locator {
  return page
    .getByTestId('housing-card')
    .filter({ has: page.getByTestId('housing-card-name').getByText(name, { exact: true }) })
}

function billCard(page: Page, section: 'upcoming' | 'paid', name: string): Locator {
  if (section === 'upcoming') {
    return page
      .getByTestId('bills-upcoming-section')
      .getByTestId('bill-card')
      .filter({ has: page.getByTestId('bill-name').getByText(name, { exact: true }) })
  }
  // A paid card has no bill-card id, and its name heading also holds a "Paid" badge:
  // h3 > info > main > card.
  return page
    .getByTestId('bills-paid-section')
    .getByTestId('bill-name')
    .filter({ hasText: name })
    .locator('xpath=../../..')
}

function subCard(page: Page, name: string): Locator {
  return page.getByTestId('sub-card').filter({ hasText: name })
}

/** Bills > Add bill. */
async function addBillUI(
  page: Page,
  fields: { name: string; amount: number; date: string; type: 'bill' | 'subscription' }
): Promise<void> {
  await goPage(page, 'bills', 'bills-header')
  await page.getByTestId('add-bill-btn').click()
  const modal = page.getByTestId('bill-modal')
  await expect(modal).toBeVisible()
  await modal.getByTestId('bill-form-name').fill(fields.name)
  await modal.getByTestId('bill-form-amount').fill(String(fields.amount))
  await modal.getByTestId('bill-form-date').fill(fields.date)
  await modal
    .locator('select', { has: page.locator('option[value="subscription"]') })
    .selectOption(fields.type)
  await modal.getByTestId('bill-form-submit').click()
  await expect(modal).toBeHidden({ timeout: 15_000 })
}

/** Recurring Insights is off by default and folded away: switch it on and reload. */
async function enableRecurringCard(page: Page): Promise<void> {
  await unfoldDashboardWidgets(page, ['recurring-insights'])
  await reloadOn(page, 'dashboard', 'dashboard-container')
  await expect(recurringCard(page)).toBeVisible({ timeout: 20_000 })
}

async function arrangeAccount(m: Mode, name: string, balance: number): Promise<void> {
  await m.api('/api/accounts', {
    method: 'POST',
    body: { name, type: 'savings', bank_name: '', balance, starting_balance: balance },
  })
}

for (const [pass, test] of both) {
  test.describe(`5.16.0 s2 pages follow writes [${pass}]`, () => {
    test('2.1 a new account reaches the Dashboard, Emergency fund and Import @release', async ({
      m,
    }) => {
      const { page } = m
      const name = `zz-acc${m.suffix}`
      const netWorth0 = await settledValue(page, () => dashboardNetWorth(page))
      const fund0 = await goEmergency(page)
      await addBankStatement(page, 'zz-statement.csv', STATEMENT)
      expect(await importAccountOptions(page)).not.toContain(name)

      await addAccountUI(page, name, 'savings', 1000)
      await expect(accountCard(page, name)).toHaveCount(1)

      await showFollower(m, 'dashboard', 'dashboard-container', [DASHBOARD_METRICS])
      await expect.poll(() => dashboardNetWorth(page)).toBeCloseTo(netWorth0 + 1000, 2)
      await showFollower(m, 'emergency', null, [EMERGENCY])
      await expect.poll(() => emergencyTotal(page)).toBe(fund0 + 1000)
      await showFollower(m, 'import', 'import-header', [ACCOUNTS])
      await expect.poll(() => importAccountOptions(page)).toContain(name)
    })

    test('2.2 an edited then deleted account reaches the same pages, one GET each @release', async ({
      m,
    }) => {
      const { page } = m
      const name = `zz-acc${m.suffix}`
      await arrangeAccount(m, name, 1000)
      await reloadOn(page, 'dashboard', 'dashboard-container')
      const netWorth0 = await settledValue(page, () => dashboardNetWorth(page))
      const fund0 = await goEmergency(page)
      await addBankStatement(page, 'zz-statement.csv', STATEMENT)
      expect(await importAccountOptions(page)).toContain(name)
      await goPage(page, 'accounts', 'accounts-header')
      const card = accountCard(page, name)
      await expect(card).toHaveCount(1)

      const editGets = await getsDuring(m, ACCOUNTS, async () => {
        await card.getByTestId('account-edit-btn').click()
        const modal = page.getByTestId('edit-account-modal')
        await expect(modal).toBeVisible()
        await modal.getByPlaceholder('0.00').fill('1500')
        await modal.locator('button[type="submit"]').click()
        await expect(modal).toBeHidden({ timeout: 15_000 })
        await expect(card.getByTestId('account-balance')).toHaveText(money(1500))
      })
      expectGets(m, editGets, 1, 'Accounts fetches its list once for the edit')

      await showFollower(m, 'dashboard', 'dashboard-container', [DASHBOARD_METRICS])
      await expect.poll(() => dashboardNetWorth(page)).toBeCloseTo(netWorth0 + 500, 2)
      await showFollower(m, 'emergency', null, [EMERGENCY])
      await expect.poll(() => emergencyTotal(page)).toBe(fund0 + 500)
      await showFollower(m, 'import', 'import-header', [ACCOUNTS])
      expect(await importAccountOptions(page)).toContain(name)

      await goPage(page, 'accounts', 'accounts-header')
      const deleteGets = await getsDuring(m, ACCOUNTS, async () => {
        await card.getByTestId('account-delete-btn').getByRole('button').click()
        await acceptConfirm(page)
        await expect(card).toHaveCount(0)
      })
      expectGets(m, deleteGets, 1, 'Accounts fetches its list once for the delete')

      await showFollower(m, 'dashboard', 'dashboard-container', [DASHBOARD_METRICS])
      await expect.poll(() => dashboardNetWorth(page)).toBeCloseTo(netWorth0 - 1000, 2)
      await showFollower(m, 'emergency', null, [EMERGENCY])
      await expect.poll(() => emergencyTotal(page)).toBe(fund0 - 1000)
      await showFollower(m, 'import', 'import-header', [ACCOUNTS])
      await expect.poll(() => importAccountOptions(page)).not.toContain(name)
    })

    test('2.3 a budget reaches Categories, the Dashboard cards and the budget flow @release', async ({
      m,
    }) => {
      const { page } = m
      const cat = `zz-bud${m.suffix}`
      const catId = await arrangeCategory(m, cat, '#f97316')
      // Spent well past the budget about to be set: the alerts card lists the five highest
      // percentages, and the local-first demo has budgets of its own near or over 100%.
      await arrangeExpense(m, { description: 'zz-budget-spend', amount: 450, categoryId: catId })
      // Budget Alerts is one of the widgets below "Show more".
      await unfoldDashboardWidgets(page, [])
      await reloadOn(page, 'dashboard', 'dashboard-container')
      const radar0 = await settledValue(page, () => radarTotals(page))
      await expect(
        page.getByTestId('dashboard-container').getByText('Budget Alerts', { exact: true })
      ).toBeVisible()
      await expect(budgetAlert(page, cat)).toHaveCount(0)
      await goPage(page, 'categories', 'categories-header')
      const card = categoryCard(page, cat)
      await expect(card).toHaveCount(1)
      // No budget yet: no "of €…" limit and no meter. (Categories shows spending only against a
      // budget: the summary it reads has one row per budget.)
      await expect(card.getByTestId('category-spending')).not.toContainText('of')
      await expect(card.getByTestId('category-remaining')).toHaveCount(0)
      await budgetFlowOnThisMonth(page)
      // Before a budget, the flow uses the spending as the category's budget.
      await expect.poll(() => budgetFlowTitles(page)).toContain(`Total Budget → ${cat}\n450.00`)

      await setBudgetUI(page, cat, 100)

      await showFollower(m, 'categories', 'categories-header', [
        /^\/api\/categories$/,
        /^\/api\/budgets\/summary/,
      ])
      await expect(card.getByTestId('category-spending')).toContainText(`of ${money(100)}`)
      // 100 budgeted, 450 spent: the meter's note carries the 350 gap. It reads "-€350.00 left",
      // not "€350.00 over": the summary caps `percentage` at 100 (worker/src/routes/budgets.ts:182)
      // and Categories only says "over" past 100. That wording is outside this case.
      await expect(card.getByTestId('category-remaining')).toContainText(money(350))
      await showFollower(m, 'dashboard', 'dashboard-container', [
        /^\/api\/budgets\/alerts\?threshold=0$/,
        /^\/api\/budgets\/alerts\?threshold=80$/,
      ])
      await expect
        .poll(async () => {
          const r = await radarTotals(page)
          return [Math.round(r.spent - radar0.spent), Math.round(r.budget - radar0.budget)]
        })
        .toEqual([450, 100])
      await expect(budgetAlert(page, cat)).toHaveCount(1)
      await showFollower(m, 'analytics', 'analytics-header', [/^\/api\/analytics\/sankey/])
      await expect.poll(() => budgetFlowTitles(page)).toContain(`Total Budget → ${cat}\n100.00`)
    })

    test('2.4 the loan list updates once per write @release', async ({ m }) => {
      const { page } = m
      const name = `zz-loan${m.suffix}`
      const loan = loanItem(page, name)
      const modal = page.getByTestId('loans-modal')
      const LOANS = /^\/api\/loans$/
      await goPage(page, 'loans', 'loans-header')

      const addGets = await getsDuring(m, LOANS, async () => {
        await page.getByTestId('add-loan-btn').click()
        await expect(modal).toBeVisible()
        await modal.getByPlaceholder('e.g., Auto Loan, Student Loan').fill(name)
        await modal.getByPlaceholder('15000.00').fill('12000')
        await modal.getByPlaceholder('5.5').fill('4')
        await modal.getByTestId('loans-form-term').fill('48')
        await modal.getByTestId('loans-form-start-date').fill(localIso(-30))
        await modal.locator('button[type="submit"]').click()
        await expect(modal).toBeHidden({ timeout: 15_000 })
        await expect(loan).toHaveCount(1)
      })
      expectGets(m, addGets, 1, 'Loans fetches its list once for the add')

      const editGets = await getsDuring(m, LOANS, async () => {
        await loan.getByTestId('loans-item-edit').click()
        await expect(modal).toBeVisible()
        await modal.getByPlaceholder('15000.00').fill('15000')
        await modal.locator('button[type="submit"]').click()
        await expect(modal).toBeHidden({ timeout: 15_000 })
        await expect(loan.getByTestId('loans-item-principal')).toHaveText(money(15000))
      })
      expectGets(m, editGets, 1, 'Loans fetches its list once for the edit')

      const deleteGets = await getsDuring(m, LOANS, async () => {
        await loan.getByTestId('loans-item-delete').getByRole('button').click()
        await acceptConfirm(page)
        await expect(loan).toHaveCount(0)
      })
      expectGets(m, deleteGets, 1, 'Loans fetches its list once for the delete')
    })

    test('2.5 holdings: the list and the Dashboard card follow each write @release', async ({
      m,
    }) => {
      const { page } = m
      // Worth more than anything in the demo, so the Dashboard's top five always shows it.
      const ticker = 'ZZQX'
      const row = holdingRow(page, ticker)
      const onDashboard = dashboardHolding(page, ticker)
      const HOLDINGS = [/^\/api\/portfolio\/holdings$/]
      await expect(dashboardPortfolio(page)).toBeVisible({ timeout: 20_000 })
      await expect(onDashboard).toHaveCount(0)
      await goPage(page, 'portfolio', 'portfolio-header')

      // Add.
      await page.getByTestId('add-holding-btn').click()
      await holdingForm(page, { ticker, shares: 100, price: 5000, date: localIso(-10) })
      await expect(row).toHaveCount(1)
      await expect(row.locator('td').nth(1)).toHaveText('100')
      await showFollower(m, 'dashboard', 'dashboard-container', HOLDINGS)
      await expect(onDashboard).toContainText('100 shares')

      // Edit.
      await goPage(page, 'portfolio', 'portfolio-header')
      await row.locator('button[title="Edit"]').click()
      await holdingForm(page, { shares: 120 })
      await expect(row.locator('td').nth(1)).toHaveText('120')
      await showFollower(m, 'dashboard', 'dashboard-container', HOLDINGS)
      await expect(onDashboard).toContainText('120 shares')

      // Merge: a second buy of the same ticker, merged into the one position.
      await goPage(page, 'portfolio', 'portfolio-header')
      await page.getByTestId('add-holding-btn').click()
      await holdingForm(page, { ticker, shares: 30, price: 5000, date: localIso(-5) })
      await acceptConfirm(page)
      await expect(row).toHaveCount(1)
      await expect(row.locator('td').nth(1)).toHaveText('150')
      await showFollower(m, 'dashboard', 'dashboard-container', HOLDINGS)
      await expect(onDashboard).toContainText('150 shares')

      // Delete (a native confirm).
      await goPage(page, 'portfolio', 'portfolio-header')
      page.once('dialog', (dialog) => void dialog.accept())
      await row.locator('button[title="Delete"]').click()
      await expect(row).toHaveCount(0)
      await showFollower(m, 'dashboard', 'dashboard-container', HOLDINGS)
      await expect(onDashboard).toHaveCount(0)
    })

    // Housing has no subscription form of its own: its Subscription Tracker lists the bills of
    // type subscription. So the subscription half is saved and deleted on Bills, and Housing's
    // list has to follow it.
    test('2.6 Housing follows a home and a subscription; the subscription is on Bills @release', async ({
      m,
    }) => {
      const { page } = m
      const home = `zz-home${m.suffix}`
      const sub = `zz-sub${m.suffix}`
      const HOUSING = /^\/api\/housing$/
      const SUBS = /^\/api\/bills\?type=subscription$/
      await goPage(page, 'bills', 'bills-header')
      await goPage(page, 'housing', 'housing-header')

      // A home: its list follows each write.
      const homeCard = housingCard(page, home)
      const saveHome = await getsDuring(m, HOUSING, async () => {
        await page.getByTestId('add-housing-btn').click()
        const modal = page.getByTestId('housing-modal')
        await expect(modal).toBeVisible()
        await modal.getByTestId('housing-type-select').selectOption('rent')
        await modal.getByTestId('housing-property-input').fill(home)
        await modal.getByTestId('housing-amount-input').fill('900')
        await modal.getByTestId('housing-due-day-input').fill('5')
        await modal.getByTestId('housing-submit-btn').click()
        await expect(modal).toBeHidden({ timeout: 15_000 })
        await expect(homeCard).toHaveCount(1)
      })
      expectGets(m, saveHome, 1, 'Housing fetches its list once for the save')
      const deleteHome = await getsDuring(m, HOUSING, async () => {
        await homeCard.getByTestId('housing-card-delete').getByRole('button').click()
        await acceptConfirm(page)
        await expect(homeCard).toHaveCount(0)
      })
      expectGets(m, deleteHome, 1, 'Housing fetches its list once for the delete')

      // A subscription: listed on Bills, and Housing's tracker follows it in and out.
      await addBillUI(page, { name: sub, amount: 15, date: localIso(5), type: 'subscription' })
      await page.getByTestId('bills-tab-subscriptions').click()
      await expect(subCard(page, sub)).toHaveCount(1)
      await showFollower(m, 'housing', 'housing-header', [SUBS])
      await expect(shownPage(page).getByText(sub, { exact: true }).first()).toBeVisible()

      await goPage(page, 'bills', 'bills-header')
      await subCard(page, sub).getByTestId('sub-menu-btn').click()
      await page.getByTestId('overflow-menu').getByRole('menuitem', { name: 'Delete' }).click()
      await acceptConfirm(page)
      await expect(subCard(page, sub)).toHaveCount(0)
      await showFollower(m, 'housing', 'housing-header', [SUBS])
      await expect(shownPage(page).getByText(sub, { exact: true })).toHaveCount(0)
    })

    test('2.7 the bill list and the calendar follow pause, paid, pay and delete @release', async ({
      m,
    }) => {
      const { page } = m
      const due = dueThisMonth()
      const toPause = `zz-pause${m.suffix}`
      const toMark = `zz-mark${m.suffix}`
      const toPay = `zz-pay${m.suffix}`
      for (const [name, type] of [
        [toPause, 'subscription'],
        [toMark, 'bill'],
        [toPay, 'bill'],
      ] as const) {
        await m.api('/api/bills', {
          method: 'POST',
          body: { name, amount: 20, dueDate: due, frequency: 'monthly', type },
        })
      }
      await reloadOn(page, 'bills', 'bills-header')
      await openBillCalendar(page)
      for (const name of [toPause, toMark, toPay])
        await expect(calendarDot(page, name)).toHaveCount(1)

      // Pause the subscription: the gallery's All filter lists active ones only, so it moves to
      // the Paused filter, and it leaves the calendar.
      await page.getByTestId('bills-tab-subscriptions').click()
      await subCard(page, toPause).getByTestId('sub-menu-btn').click()
      await page.getByTestId('overflow-menu').getByRole('menuitem', { name: 'Pause' }).click()
      await expect(subCard(page, toPause)).toHaveCount(0)
      await shownPage(page)
        .getByRole('button', { name: /^Paused/ })
        .click()
      await expect(subCard(page, toPause)).toContainText('Paused')
      await openBillCalendar(page)
      await expect(calendarDot(page, toPause)).toHaveCount(0)

      // Mark one paid on the list: the calendar shows it paid.
      await page.getByTestId('bills-tab-all').click()
      await billCard(page, 'upcoming', toMark).getByTestId('bill-mark-paid-btn').click()
      await expect(billCard(page, 'paid', toMark)).toHaveCount(1)
      await openBillCalendar(page)
      const marked = await calendarPopoverRow(page, toMark)
      await expect(marked).toContainText('Paid')
      await closeCalendarPopover(marked)

      // Pay one from the calendar: the list shows it paid, after one refetch.
      await openBillCalendar(page)
      const paying = await calendarPopoverRow(page, toPay)
      const listGets = await getsDuring(m, /^\/api\/bills$/, async () => {
        await paying.getByRole('button', { name: 'Pay' }).click()
        await expect(paying).toContainText('✓')
      })
      expectGets(m, listGets, 1, 'the bill list refetches once for a payment made on the calendar')
      // The calendar's data follows too (whether its grid redraws is 2.7b).
      if (listGets) {
        expect(
          listGets.gets.filter((p) => /^\/api\/bills\/calendar/.test(p)),
          `the calendar refetches once for the payment:\n    ${listGets.seen.join('\n    ')}`
        ).toHaveLength(1)
      }
      await closeCalendarPopover(paying)
      await page.getByTestId('bills-tab-all').click()
      await expect(billCard(page, 'paid', toPay)).toHaveCount(1)
      await expect(billCard(page, 'upcoming', toPay)).toHaveCount(0)

      // Delete one: it leaves the list and the calendar.
      await billCard(page, 'paid', toMark)
        .getByTestId('bill-delete-btn')
        .getByRole('button')
        .click()
      await acceptConfirm(page)
      await expect(billCard(page, 'paid', toMark)).toHaveCount(0)
      await openBillCalendar(page)
      await expect(calendarDot(page, toMark)).toHaveCount(0)
      await expect(calendarDot(page, toPay)).toHaveCount(1)
    })

    test('2.7b a bill paid on the calendar shows paid on it without reopening it @release', async ({
      m,
    }) => {
      const { page } = m
      const toPay = `zz-pay${m.suffix}`
      await m.api('/api/bills', {
        method: 'POST',
        body: {
          name: toPay,
          amount: 20,
          dueDate: dueThisMonth(),
          frequency: 'monthly',
          type: 'bill',
        },
      })
      await reloadOn(page, 'bills', 'bills-header')
      await openBillCalendar(page)
      const dot = calendarDot(page, toPay)
      await expect(dot).toHaveCount(1)
      await expect(dot).not.toHaveClass(/dotPaid/)

      const row = await calendarPopoverRow(page, toPay)
      await row.getByRole('button', { name: 'Pay' }).click()
      await expect(row).toContainText('✓')
      await closeCalendarPopover(row)

      // Still on the calendar: its dot shows the bill paid. The payment refetches the calendar
      // (2.7 counts it), but the grid does not redraw. BillCalendar.tsx:255-257 renders the days
      // with <For each={daysArray()}> over day numbers and reads `cal()!.days[String(day)]` once,
      // when a day's cell is created. A refetch of the same month gives the same day numbers, so
      // <For> keeps every cell and the bills it read first. Only reopening the calendar (a
      // remount) shows the payment. The grid code is the same in v5.15.1, where nothing refetched
      // an open calendar; #578 added the refetch.
      // Marked here, not at the top: a failure before this point is retried, not taken for the bug.
      test.fail(
        true,
        'the open bill calendar keeps its old bills after a refetch (BillCalendar.tsx:257)'
      )
      await expect(dot).toHaveClass(/dotPaid/, { timeout: 10_000 })
    })

    test('2.8 goals: one refetch per add, contribution and delete @release', async ({ m }) => {
      const { page } = m
      const name = `zz-goal${m.suffix}`
      const card = goalCard(page, name)
      const GOALS = /^\/api\/savings-goals$/
      await goPage(page, 'goals', 'page-goals')

      const addGets = await getsDuring(m, GOALS, async () => {
        await page.getByTestId('add-goal-btn').click()
        const modal = page.getByTestId('goals-modal')
        await expect(modal).toBeVisible()
        await modal.getByTestId('goals-form-name').fill(name)
        await modal.getByTestId('goals-form-target').fill('500')
        await modal.getByTestId('goals-modal-submit').click()
        await expect(modal).toBeHidden({ timeout: 15_000 })
        await expect(card).toHaveCount(1)
      })
      expectGets(m, addGets, 1, 'Goals fetches its list once for the add')

      const contributeGets = await getsDuring(m, GOALS, async () => {
        await card.getByTestId('goal-contribute-btn').click()
        await card.getByPlaceholder('Amount...').fill('50')
        await card.getByPlaceholder('Amount...').press('Enter')
        await expect(card.getByTestId('goal-progress-current')).toContainText(
          `${money(50)} of ${money(500)}`
        )
      })
      expectGets(m, contributeGets, 1, 'Goals fetches its list once for the contribution')

      const deleteGets = await getsDuring(m, GOALS, async () => {
        await card.getByTestId('goal-delete-btn').getByRole('button').click()
        await acceptConfirm(page)
        await expect(card).toHaveCount(0)
      })
      expectGets(m, deleteGets, 1, 'Goals fetches its list once for the delete')
    })

    test('2.9 the Recurring section and the Dashboard card follow a save and a delete @release', async ({
      m,
    }) => {
      const { page } = m
      const name = `zz-recur${m.suffix}`
      await enableRecurringCard(page)
      await expect(recurringCard(page).getByText(name, { exact: true })).toHaveCount(0)
      await goPage(page, 'transactions', 'transactions-header')
      const section = recurringSection(page)
      await section.getByRole('heading', { name: 'Recurring Transactions' }).click()
      // Neither the case's own profile nor the demo has a recurring item yet.
      await expect(section.getByText('No recurring items', { exact: true })).toBeVisible()

      await section.getByRole('button', { name: 'Add' }).click()
      const modal = page.getByRole('heading', { name: 'Add Recurring' }).locator('xpath=../..')
      await expect(modal).toBeVisible()
      await modal.locator('input[type="text"]').first().fill(name)
      await modal.locator('input[type="number"]').first().fill('25')
      await modal.locator('input[type="date"]').fill(localIso())
      await modal.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(modal).toBeHidden({ timeout: 15_000 })
      await expect(section.getByText(name, { exact: true })).toBeVisible()

      await showFollower(m, 'dashboard', 'dashboard-container', [/^\/api\/recurring$/])
      await expect(recurringCard(page).getByText(name, { exact: true })).toBeVisible()

      await goPage(page, 'transactions', 'transactions-header')
      // name > info > row
      const row = section.getByText(name, { exact: true }).locator('xpath=../..')
      await row.locator('button[title="Delete"]').click()
      await acceptConfirm(page)
      await expect(section.getByText(name, { exact: true })).toHaveCount(0)

      await showFollower(m, 'dashboard', 'dashboard-container', [/^\/api\/recurring$/])
      await expect(recurringCard(page).getByText(name, { exact: true })).toHaveCount(0)
    })
  })
}
