/**
 * Handles for the pages the "pages follow writes" cases look at, where a page has no test id of
 * its own for the thing a case reads. Each says what it leans on (a heading, a title attribute,
 * the element order) so a markup change that breaks one is quick to find.
 */
import { parseMoney, shownPage } from './follow-helpers'
import { expect } from './release-fixtures'
import { goPage } from './release-helpers'
import type { Locator, Page } from '@playwright/test'

export function categoryCard(page: Page, name: string): Locator {
  return page
    .getByTestId('category-card')
    .filter({ has: page.getByTestId('category-name').getByText(name, { exact: true }) })
}

/** Bills > Calendar: the tab after Subscriptions. The calendar is rebuilt each time it opens. */
export async function openBillCalendar(page: Page): Promise<void> {
  await goPage(page, 'bills', 'bills-header')
  await page
    .getByTestId('bills-tab-subscriptions')
    .locator('xpath=following-sibling::button[1]')
    .click()
}

/** A bill's dot on the calendar grid (each dot carries its bill's name as a title). */
export function calendarDot(page: Page, billName: string): Locator {
  return shownPage(page).locator(`[title="${billName}"]`)
}

/** Open the calendar day of a bill and return its row in the day's popover. */
export async function calendarPopoverRow(page: Page, billName: string): Promise<Locator> {
  await calendarDot(page, billName).first().click()
  const name = shownPage(page).getByText(billName, { exact: true })
  await expect(name).toBeVisible()
  // name > info > left > row
  return name.locator('xpath=../../..')
}

/** Close the day popover with its own close button (row > body > popover > header). */
export async function closeCalendarPopover(row: Locator): Promise<void> {
  await row.locator('xpath=../..').locator('h3 + button').click()
  await expect(row).toBeHidden()
}

/**
 * The 28th of this month: on the calendar on screen, and a day the local-first demo has no bill
 * on (a day cell shows four dots at most, so a busy day could hide one).
 */
export function dueThisMonth(): string {
  const now = new Date()
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-28`
}

/** The Recurring section on Transactions. */
export function recurringSection(page: Page): Locator {
  // h2 > header > section
  return page
    .getByTestId('page-transactions')
    .getByRole('heading', { name: 'Recurring Transactions' })
    .locator('xpath=../..')
}

/** Dashboard > Recurring Insights. */
export function recurringCard(page: Page): Locator {
  // title > header > card
  return page
    .getByTestId('dashboard-container')
    .getByText('Recurring Insights', { exact: true })
    .locator('xpath=../..')
}

export function goalCard(page: Page, name: string): Locator {
  return page
    .getByTestId('goal-card')
    .filter({ has: page.getByTestId('goal-name').getByText(name, { exact: true }) })
}

/** Settings > Exports > PDF reports: the years its Year picker offers. */
export async function reportYearOptions(page: Page): Promise<string[]> {
  // The label is not tied to its select (no for/id): the select is the label's next sibling.
  const select = shownPage(page)
    .locator('label', { hasText: /^Year$/ })
    .locator('xpath=following-sibling::select[1]')
  return select.evaluate((el) => [...(el as HTMLSelectElement).options].map((o) => o.value))
}

/**
 * Counterparties: one name's cell in the table, which lists everyone. (The Balance Meridian chart
 * above it shows only the top few by net, so a name may or may not be there too.)
 */
export function counterparty(page: Page, name: string): Locator {
  return page
    .locator('[data-tour="counterparties-content"]')
    .getByRole('cell', { name, exact: true })
}

/** Analytics > Monthly Expense, as a number: the card's value, its second child. */
export async function analyticsMonthExpense(page: Page): Promise<number> {
  const value = page.getByTestId('analytics-monthly-expense').locator(':scope > div').nth(1)
  return parseMoney(await value.innerText())
}

/** Transactions > Add Transaction: an expense, saved with the form's own button. */
export async function addExpenseUI(
  page: Page,
  fields: {
    description: string
    amount: number
    date: string
    /** The account option's label: "<name> (<type>)". */
    account: string
    /** The category's name: the form requires one for an expense. */
    category: string
    beneficiary?: string
  }
): Promise<void> {
  await goPage(page, 'transactions', 'transactions-header')
  await page.getByTestId('add-transaction-btn').click()
  const modal = page.getByTestId('tx-modal')
  await expect(modal).toBeVisible()
  await modal.getByTestId('tx-type-expense').click()
  await modal.getByTestId('tx-description').fill(fields.description)
  await modal.getByTestId('tx-amount').fill(String(fields.amount))
  await modal.getByTestId('tx-date').fill(fields.date)
  await modal.getByTestId('tx-category').selectOption({ label: fields.category })
  await modal.getByTestId('tx-account').selectOption({ label: fields.account })
  if (fields.beneficiary !== undefined) {
    await modal.getByTestId('tx-advanced-toggle').click()
    await modal.getByTestId('tx-beneficiary').fill(fields.beneficiary)
  }
  await modal.getByTestId('tx-save-btn').click()
  await expect(modal).toBeHidden({ timeout: 15_000 })
}

/** The colour dot beside a name in a list row: the row's first span (recurring rows). */
export function dotBeside(name: Locator): Locator {
  return name.locator('xpath=preceding-sibling::span[1]')
}

/** The colour dot of a list item whose name sits one level down (recurring card, Housing). */
export function dotAbove(name: Locator): Locator {
  return name.locator('xpath=../preceding-sibling::span[1]')
}

/**
 * Quick add through the command bar (Ctrl+K): the entry typed as "<description> <amount>" and
 * the category picked from its Category chip. Returns once the save's toast is up: the bar closes
 * by fading out and stays in the DOM, so its own visibility says nothing.
 */
export async function commandBarExpense(page: Page, text: string, category: string): Promise<void> {
  await page.keyboard.press('Control+k')
  const bar = page.getByRole('dialog', { name: 'Quick entry command bar' })
  const entry = bar.getByLabel('Quick entry')
  await expect(entry).toBeFocused()
  await entry.fill(text)
  await bar.getByRole('combobox', { name: 'Category' }).selectOption({ label: category })
  await entry.press('Enter')
  await expect(
    page
      .getByRole('region', { name: 'Notifications' })
      .getByRole('status')
      .filter({ hasText: 'Entry added' })
  ).toBeVisible({ timeout: 15_000 })
}
