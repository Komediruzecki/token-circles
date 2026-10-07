/**
 * Release scope 5.16.0, section 2, cases 2.10 to 2.17: pages follow writes (#578), continued.
 *
 * The same shape as s02-pages-follow-writes.spec.ts: mount the pages a case names, write, look
 * again without a reload. These cases add the writes that come from somewhere the page cannot
 * see (another tab, a resume, a reconnect) and the edits a reload must not throw away.
 */
import {
  accountCard,
  accountsOf,
  arrangeAccountOf,
  arrangeCategory,
  backgroundOf,
  countFrom,
  dashboardNetWorth,
  emergencyTotal,
  expectGets,
  expectNoRepeats,
  getsDuring,
  goEmergency,
  localIso,
  money,
  reloadOn,
  rgb,
  settledValue,
  showFollower,
  shownPage,
  unfoldDashboardWidgets,
  writeElsewhere,
  writeInTab,
} from './follow-helpers'
import {
  addExpenseUI,
  analyticsMonthExpense,
  calendarDot,
  calendarPopoverRow,
  categoryCard,
  closeCalendarPopover,
  commandBarExpense,
  counterparty,
  dotAbove,
  dotBeside,
  dueThisMonth,
  goalCard,
  openBillCalendar,
  recurringCard,
  recurringSection,
  renameCategory,
  reportYearOptions,
} from './page-handles'
import { both, cloudTest, expect } from './release-fixtures'
import { awayAndBack, dismissOnboardingIfOpen, goPage, switchProfile } from './release-helpers'
import type { Locator, Page } from '@playwright/test'
import type { Mode } from './release-fixtures'

const DASHBOARD_METRICS = /^\/api\/dashboard(\?|$)/
const STATS_MONTHLY = /^\/api\/stats\/monthly/
const CATEGORY_TRENDS = /^\/api\/analytics\/category-trends/
const EMERGENCY = /^\/api\/calculator\/emergency-fund/

function thisMonthStart(): string {
  const now = new Date()
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

/** The Retirement page: its planner's net worth field and save button, once the plan has loaded. */
async function openPlanner(page: Page): Promise<{ input: Locator; save: Locator }> {
  await goPage(page, 'retirement', 'retirement-planner')
  const input = page.getByTestId('retirement-input-networth')
  const save = page.getByTestId('retirement-save-settings')
  // Loaded and clean: the button reads "Saved" until something is typed.
  await expect(save).toHaveText('Saved', { timeout: 20_000 })
  await settledValue(page, () => input.inputValue())
  return { input, save }
}

/** Save a net worth into the active profile's retirement plan, through the API. */
async function arrangePlanNetWorth(m: Mode, netWorth: number): Promise<void> {
  const current = await m.api<{ settings: Record<string, unknown> }>('/api/retirement/settings')
  await m.api('/api/retirement/settings', {
    method: 'PUT',
    body: { ...current.settings, netWorth },
  })
}

function retirementGoal(page: Page, name: string): Locator {
  return page
    .getByTestId('retirement-goal-card')
    .filter({ has: page.getByTestId('retirement-goal-name').getByText(name, { exact: true }) })
}

for (const [pass, test] of both) {
  test.describe(`5.16.0 s2 pages follow writes [${pass}]`, () => {
    test('2.10 a transaction in a year with none reaches Reports, Counterparties and Emergency fund @release', async ({
      m,
    }) => {
      const { page } = m
      const account = `zz-save${m.suffix}`
      const payee = `zz-payee${m.suffix}`
      // Neither the case's own profile (data from three months ago) nor the demo (from 2000) has
      // a transaction in 1999. A savings account, so the Emergency fund total moves with it.
      const year = '1999'
      const category = `zz-cat${m.suffix}`
      await arrangeAccountOf(m, { name: account, type: 'savings', balance: 2000 })
      await arrangeCategory(m, category)
      await reloadOn(page, 'settings', 'settings-header')
      await page.getByTestId('settings-tab-exports').click()
      await expect.poll(() => reportYearOptions(page)).toContain(String(new Date().getFullYear()))
      expect(await reportYearOptions(page)).not.toContain(year)
      await goPage(page, 'counterparties')
      await expect(page.locator('[data-tour="counterparties-header"]')).toBeVisible()
      await expect(counterparty(page, payee)).toHaveCount(0)
      const fund0 = await goEmergency(page)

      await addExpenseUI(page, {
        description: 'zz old receipt',
        amount: 40,
        date: `${year}-06-15`,
        account: `${account} (savings)`,
        category,
        beneficiary: payee,
      })

      await showFollower(m, 'settings', 'settings-header', [/^\/api\/analytics\/distinct-years/])
      await expect.poll(() => reportYearOptions(page)).toContain(year)
      await showFollower(m, 'counterparties', null, [/^\/api\/counterparties$/])
      await expect(counterparty(page, payee)).toHaveCount(1)
      await showFollower(m, 'emergency', null, [EMERGENCY])
      await expect.poll(() => emergencyTotal(page)).toBe(fund0 - 40)
    })

    test('2.11 the budget flow is filled the first time Analytics opens @release', async ({
      m,
    }) => {
      const { page } = m
      // First visit of the session, and nothing picked: the flow shows last month as it opens.
      await goPage(page, 'analytics', 'analytics-header')
      const flow = page.locator('[data-tour="analytics-sankey"]')
      await expect(flow.locator('svg rect').first()).toBeVisible({ timeout: 20_000 })
      await expect(flow.getByText(/^No transactions for/)).toHaveCount(0)
      expect(await flow.locator('svg title').count()).toBeGreaterThan(0)
    })

    test('2.12 an unsaved planner edit survives a resume @release', async ({ m }) => {
      const { page } = m
      const goal = `zz-ret${m.suffix}`
      const { input, save } = await openPlanner(page)
      const loaded = await input.inputValue()
      const typed = loaded === '123456' ? '654321' : '123456'
      await input.fill(typed)
      // Off the field: NumberField never rewrites the field that has focus, which would hide a
      // reload behind the caret.
      await input.blur()
      await expect(save).toBeEnabled()

      // Away for over a minute, while a retirement goal is added somewhere else.
      await awayAndBack(page, 61_000, async () => {
        await writeElsewhere(m, '/api/retirement-goals', {
          method: 'POST',
          body: {
            name: goal,
            target_amount: 500000,
            current_amount: 0,
            target_date: '2050-01-01',
            monthly_contribution: 500,
            expected_return_rate: 5,
            current_age: 40,
            retirement_age: 65,
          },
        })
      })

      // The resume reached this page (the goals list shows what was added while away) ...
      await expect(retirementGoal(page, goal)).toHaveCount(1, { timeout: 15_000 })
      // ... and did not reload the planner over the edit.
      await expect(input).toHaveValue(typed)
      await expect(save).toBeEnabled()
      await expect(save).toHaveText('Save assumptions')
    })

    test('2.13 an unsaved planner edit gives way to the next profile’s plan @release', async ({
      m,
    }) => {
      const { page } = m
      // Profile b's plan, saved with a net worth nobody would type by accident.
      await switchProfile(page, m.b.id)
      await arrangePlanNetWorth(m, 222222)
      await switchProfile(page, m.a.id)

      const { input, save } = await openPlanner(page)
      expect(await input.inputValue()).not.toBe('222222')
      await input.fill('123456')
      await input.blur()
      await expect(save).toBeEnabled()

      await switchProfile(page, m.b.id)
      await expect(input).toHaveValue('222222', { timeout: 15_000 })
      await expect(save).toHaveText('Saved')
      await expect(save).toBeDisabled()
    })

    test('2.15 offline then online: the page on screen refetches once, a hidden one on its next show @release', async ({
      m,
    }) => {
      const { page } = m
      const name = `zz-off${m.suffix}`
      const netWorth0 = await settledValue(page, () => dashboardNetWorth(page))
      await goPage(page, 'accounts', 'accounts-header')
      await settledValue(page, () => page.getByTestId('account-card').count())

      // Written from somewhere this tab is not told about.
      await writeElsewhere(m, '/api/accounts', {
        method: 'POST',
        body: {
          name,
          type: 'giro',
          currency: 'EUR',
          bank_name: '',
          balance: 300,
          starting_balance: 300,
        },
      })
      await expect(accountCard(page, name)).toHaveCount(0)

      const reconnect = await getsDuring(m, /^\/api\/accounts$/, async () => {
        await m.context.setOffline(true)
        await m.context.setOffline(false)
        await expect(accountCard(page, name)).toHaveCount(1, { timeout: 15_000 })
      })
      expectGets(m, reconnect, 1, 'Accounts, on screen, refetches once on reconnect')

      await showFollower(m, 'dashboard', 'dashboard-container', [DASHBOARD_METRICS])
      await expect.poll(() => dashboardNetWorth(page)).toBeCloseTo(netWorth0 + 300, 2)
    })

    test('2.16 a goal linked to a category moves with a command-bar expense @release', async ({
      m,
    }) => {
      const { page } = m
      const cat = `zz-goalcat${m.suffix}`
      const goal = `zz-linked${m.suffix}`
      await arrangeCategory(m, cat, '#c9a0ff')
      await reloadOn(page, 'goals', 'page-goals')

      // Link a goal to the category in the Goals form.
      await page.getByTestId('add-goal-btn').click()
      const modal = page.getByTestId('goals-modal')
      await expect(modal).toBeVisible()
      await modal.getByTestId('goals-form-name').fill(goal)
      await modal.getByTestId('goals-form-target').fill('500')
      await modal.locator('select').selectOption({ label: `${cat} (expense)` })
      await modal.getByTestId('goals-modal-submit').click()
      await expect(modal).toBeHidden({ timeout: 15_000 })
      const progress = goalCard(page, goal).getByTestId('goal-progress-current')
      await expect(progress).toContainText(`${money(0)} of ${money(500)}`)

      // The command bar (Ctrl+K): an expense of 50 in that category.
      await commandBarExpense(page, 'zz lunch 50', cat)

      await expect(progress).toContainText(`${money(50)} of ${money(500)}`, { timeout: 15_000 })
    })

    test('2.17 a renamed, recoloured category reaches the recurring lists and Housing @release', async ({
      m,
    }) => {
      const { page } = m
      const oldName = `zz-old${m.suffix}`
      const newName = `zz-new${m.suffix}`
      const sub = `zz-catsub${m.suffix}`
      const recur = `zz-catrec${m.suffix}`
      const [before, after] = ['#6e9bff', '#e0708a']
      const catId = await arrangeCategory(m, oldName, before)
      await m.api('/api/bills', {
        method: 'POST',
        body: {
          name: sub,
          amount: 12,
          dueDate: dueThisMonth(),
          frequency: 'monthly',
          type: 'subscription',
          category_id: catId,
        },
      })
      await m.api('/api/recurring', {
        method: 'POST',
        body: {
          description: recur,
          amount: 25,
          type: 'expense',
          frequency: 'monthly',
          day_of_month: null,
          next_date: localIso(),
          category_id: catId,
          notes: null,
        },
      })
      await unfoldDashboardWidgets(page, ['recurring-insights'])
      await reloadOn(page, 'dashboard', 'dashboard-container')

      // These three show the category as a coloured dot (no name).
      const cardDot = dotAbove(recurringCard(page).getByText(recur, { exact: true }))
      const sectionDot = dotBeside(recurringSection(page).getByText(recur, { exact: true }))
      const housingDot = () => dotAbove(shownPage(page).getByText(sub, { exact: true }))

      // Each shows the category as it is now.
      // Not a 5.16 regression: v5.15.1 has the same handlers. In local-first nothing joins a
      // recurring row or a subscription to its category: recurringList returns the stored rows
      // and billsList (core/storage/handlers/bills.ts:48) the stored bill, and no create path
      // writes `category_name`/`category_color` onto either. So these views never show a
      // category's colour, before a rename or after it.
      // Marked here, not at the top: a failure before this point is retried, not taken for the bug.
      test.fail(
        m.kind === 'local',
        'local-first: recurring rows and subscriptions carry no category colour (since 5.15.1)'
      )
      await expect.poll(() => backgroundOf(cardDot)).toBe(rgb(before))
      await goPage(page, 'transactions', 'transactions-header')
      await recurringSection(page).getByRole('heading', { name: 'Recurring Transactions' }).click()
      await expect.poll(() => backgroundOf(sectionDot)).toBe(rgb(before))
      await goPage(page, 'housing', 'housing-header')
      await expect.poll(() => backgroundOf(housingDot())).toBe(rgb(before))

      await renameCategory(page, oldName, newName, after)

      // Each follows.
      await showFollower(m, 'transactions', 'transactions-header', [/^\/api\/recurring$/])
      await expect.poll(() => backgroundOf(sectionDot)).toBe(rgb(after))
      await showFollower(m, 'dashboard', 'dashboard-container', [/^\/api\/recurring$/])
      await expect.poll(() => backgroundOf(cardDot)).toBe(rgb(after))
      await showFollower(m, 'housing', 'housing-header', [/^\/api\/bills\?type=subscription$/])
      await expect.poll(() => backgroundOf(housingDot())).toBe(rgb(after))
    })

    test('2.17b the bill calendar shows a renamed, recoloured category @release', async ({ m }) => {
      const { page } = m
      const oldName = `zz-old${m.suffix}`
      const newName = `zz-new${m.suffix}`
      const bill = `zz-catbill${m.suffix}`
      const [before, after] = ['#6e9bff', '#e0708a']
      const catId = await arrangeCategory(m, oldName, before)
      await m.api('/api/bills', {
        method: 'POST',
        body: {
          name: bill,
          amount: 30,
          dueDate: dueThisMonth(),
          frequency: 'monthly',
          type: 'bill',
          category_id: catId,
        },
      })
      await reloadOn(page, 'bills', 'bills-header')
      await openBillCalendar(page)
      // Local-first: as in 2.17, no bill carries its category. billsCalendar
      // (core/storage/handlers/bills.ts:147) reads `category_name`/`category_color` off the
      // stored bill row, which no create path writes. Same in v5.15.1.
      // Marked here, not at the top: a failure before this point is retried, not taken for the bug.
      test.fail(
        m.kind === 'local',
        'local-first: bills carry no category name or colour (since 5.15.1)'
      )
      await expect.poll(() => backgroundOf(calendarDot(page, bill))).toBe(rgb(before))
      const row = await calendarPopoverRow(page, bill)
      await expect(row).toContainText(oldName)
      await closeCalendarPopover(row)

      await renameCategory(page, oldName, newName, after)

      // Back on Bills, the calendar still open: its dot and its popover follow.
      await showFollower(m, 'bills', 'bills-header', [/^\/api\/bills\/calendar/])
      // Cloud: the calendar refetches on the category write (it tracks `categories` since #578,
      // and the refetched month carries the new name and colour), but the grid does not redraw.
      // BillCalendar.tsx:255-257 renders the days with <For each={daysArray()}> over day numbers
      // and reads `cal()!.days[String(day)]` once, when a day's cell is created; a refetch of the
      // same month gives the same day numbers, so every cell keeps the bills it read first, and
      // the day popover is opened with that same array. Reopening the calendar shows the new
      // data. The grid code is the same in v5.15.1, where nothing refetched an open calendar.
      // Marked here, not at the top: a failure before this point is retried, not taken for the bug.
      test.fail(
        m.kind === 'cloud',
        'the open bill calendar keeps its old bills after a refetch (BillCalendar.tsx:257)'
      )
      await expect.poll(() => backgroundOf(calendarDot(page, bill))).toBe(rgb(after))
      const renamed = await calendarPopoverRow(page, bill)
      await expect(renamed).toContainText(newName)
      await closeCalendarPopover(renamed)
    })
  })
}

// 2.14 is a cloud case: a second tab of the same signed-in browser.
cloudTest.describe('5.16.0 s2 pages follow writes [cloud]', () => {
  cloudTest(
    '2.14 tab A shows what tab B wrote, after B was in front for over a minute @release',
    async ({ m }) => {
      const { page, context } = m
      const cat = `zz-tab${m.suffix}`
      const acc = `zz-tabacc${m.suffix}`
      // A budget on the category, so Categories has a "spent" figure to move.
      const catId = await arrangeCategory(m, cat, '#59d2a2')
      await m.api('/api/budgets', {
        method: 'POST',
        body: { category_id: catId, amount: 200, period: 'monthly', start_date: thisMonthStart() },
      })
      const spendFrom = (await accountsOf(m))[0]?.id ?? null

      // Tab A: the four pages mounted, ending on the Dashboard.
      await reloadOn(page, 'analytics', 'analytics-header')
      const expense0 = await settledValue(page, () => analyticsMonthExpense(page))
      await goPage(page, 'accounts', 'accounts-header')
      await expect(accountCard(page, acc)).toHaveCount(0)
      await goPage(page, 'categories', 'categories-header')
      const spending = categoryCard(page, cat).getByTestId('category-spending')
      await expect(spending).toContainText(/€0\.00\s*of €200\.00/)
      await goPage(page, 'dashboard', 'dashboard-container')
      const netWorth0 = await settledValue(page, () => dashboardNetWorth(page))

      // Tab B, the same browser: the app, open on its Dashboard.
      const tabB = await context.newPage()
      await tabB.goto('/#dashboard', { waitUntil: 'domcontentloaded' })
      await expect(tabB.getByTestId('profile-dropdown-btn')).toBeVisible({ timeout: 30_000 })
      await dismissOnboardingIfOpen(tabB)

      // A is left for over a minute while B adds an account and a transaction.
      await awayAndBack(page, 61_000, async () => {
        await tabB.bringToFront()
        await writeInTab(tabB, '/api/accounts', {
          method: 'POST',
          body: {
            name: acc,
            type: 'giro',
            currency: 'EUR',
            bank_name: '',
            balance: 500,
            starting_balance: 500,
          },
        })
        await writeInTab(tabB, '/api/transactions', {
          method: 'POST',
          body: {
            description: 'zz tab b expense',
            amount: 75,
            date: localIso(),
            beneficiary: '',
            payor: '',
            category_id: catId,
            currency: 'EUR',
            amount_local: 75,
            exchange_rate: 1,
            type: 'expense',
            notes: '',
            account_id: spendFrom,
          },
        })
        await page.bringToFront()
      })

      // Back on A. The Dashboard, on screen, catches up; the other three on their next show.
      await expect
        .poll(() => dashboardNetWorth(page), { timeout: 15_000 })
        .toBeCloseTo(netWorth0 + 500 - 75, 2)
      // Analytics asks two things twice on every refresh: 2.14b pins that, so here they may.
      await showFollower(
        m,
        'analytics',
        'analytics-header',
        [STATS_MONTHLY, CATEGORY_TRENDS],
        [STATS_MONTHLY, CATEGORY_TRENDS]
      )
      await expect.poll(() => analyticsMonthExpense(page)).toBeCloseTo(expense0 + 75, 2)
      await showFollower(m, 'accounts', 'accounts-header', [/^\/api\/accounts$/])
      await expect(accountCard(page, acc)).toHaveCount(1)
      await showFollower(m, 'categories', 'categories-header', [
        /^\/api\/categories$/,
        /^\/api\/budgets\/summary/,
      ])
      await expect(spending).toContainText(/€75\.00\s*of €200\.00/)
      await tabB.close()
    }
  )

  cloudTest(
    '2.14b Analytics asks for each thing once when it follows a transaction @release',
    async ({ m }) => {
      const { page } = m
      const category = await arrangeCategory(m, `zz-an${m.suffix}`)
      await reloadOn(page, 'analytics', 'analytics-header')
      const expense0 = await settledValue(page, () => analyticsMonthExpense(page))
      await goPage(page, 'accounts', 'accounts-header')
      await writeInTab(page, '/api/transactions', {
        method: 'POST',
        body: {
          description: 'zz analytics expense',
          amount: 60,
          date: localIso(),
          beneficiary: '',
          payor: '',
          category_id: category,
          currency: 'EUR',
          amount_local: 60,
          exchange_rate: 1,
          type: 'expense',
          notes: '',
          account_id: (await accountsOf(m))[0]?.id ?? null,
        },
      })

      const since = await countFrom(page)
      await goPage(page, 'analytics', 'analytics-header')
      await expect.poll(() => analyticsMonthExpense(page)).toBeCloseTo(expense0 + 60, 2)
      // Three loaders of Analytics.tsx overlap. The analyticsData resource (:105) fetches
      // category-trends?type&year (:121) and stats/monthly?months=24 (:124); monthlyStatsResource
      // (:285) fetches the same stats/monthly URL again (:297); loadStackedData, run by
      // refetchOnActive (:532), fetches category-trends with the same year and type in the other
      // order (:442). The overlap is older (v5.15.1 runs all three on mount), but #578 made all
      // three follow every write, so each write that reaches Analytics now asks both twice. Not
      // in section 9; the double fetches it lists are a tag, a cash account and quick add.
      // Marked here, not at the top: a failure before this point is retried, not taken for the bug.
      cloudTest.fail(
        true,
        'Analytics fetches stats/monthly and category-trends twice per refresh (Analytics.tsx:124, :297, :442)'
      )
      expectNoRepeats(m, await since(), 'showing Analytics after one expense')
    }
  )
})
