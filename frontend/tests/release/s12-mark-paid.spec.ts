/**
 * Release scope 5.16.1, section 12: in local-first, marking a bill paid writes the payment, as the
 * Worker's mark-paid does. Before, it stamped the bill and nothing else, so the payment never
 * reached Transactions, the balances, or anything counted from them.
 */
import { expect, localTest } from './release-fixtures'
import { goPage } from './release-helpers'
import {
  baseCurrency,
  categoryNamed,
  openTransactions,
  searchList,
  txNamed,
  txRows,
} from './transactions-helpers'
import type { Page } from '@playwright/test'
import type { Mode } from './release-fixtures'
import type { TxRow } from './transactions-helpers'

/** Every case in this section is local-first only (L). */
const test = localTest

/** An unpaid monthly bill in the active profile, sent as the Bills form sends one. */
async function addBill(m: Mode, name: string, amount: number, categoryId: number): Promise<void> {
  await m.api('/api/bills', {
    method: 'POST',
    body: {
      name,
      amount,
      dueDate: await m.page.evaluate(() => {
        const d = new Date(Date.now() + 5 * 86_400_000)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }),
      category_id: categoryId,
      frequency: 'monthly',
      autopay: false,
    },
  })
}

/** The bill's card among the unpaid ones. */
function unpaidBill(page: Page, name: string) {
  return page
    .getByTestId('bill-card')
    .filter({ has: page.getByTestId('bill-name').filter({ hasText: name }) })
}

function toast(page: Page, text: string) {
  return page.getByRole('region', { name: 'Notifications' }).getByText(text)
}

/** Bills > Mark Paid on the bill, and the page's own word that it worked. */
async function markPaid(page: Page, name: string): Promise<void> {
  const card = unpaidBill(page, name)
  await expect(card).toHaveCount(1, { timeout: 20_000 })
  await card.getByTestId('bill-mark-paid-btn').click()
  await expect(toast(page, 'Bill marked as paid')).toBeVisible()
}

/** Today in the browser's own zone, as the local handler dates the payment. */
async function today(page: Page): Promise<{ iso: string; shown: string }> {
  return page.evaluate(() => {
    const d = new Date()
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    // The list's own formatting (TransactionTable): `new Date(date).toLocaleDateString()`.
    return { iso, shown: new Date(iso).toLocaleDateString() }
  })
}

async function money(page: Page, amount: number, currency: string): Promise<string> {
  return page.evaluate(
    ([value, code]) =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(value),
    [amount, currency] as const
  )
}

test.describe('5.16.1 s12 mark paid [local]', () => {
  test("12.1 Mark Paid lists today's expense with the bill's name, amount and category @release", async ({
    m,
  }) => {
    const { page } = m
    const name = 'Zz Lantern Club'
    const category = await categoryNamed(m, m.a.id, 'Entertainment')
    await addBill(m, name, 42, category.id)

    // Transactions first, so the payment has to reach a page that stayed mounted.
    await openTransactions(page)
    await searchList(page, name)
    await expect(txRows(page, name)).toHaveCount(0)

    await goPage(page, 'bills', 'bills-header')
    await markPaid(page, name)

    await goPage(page, 'transactions', 'transactions-header')
    const row = txRows(page, name)
    await expect(row).toHaveCount(1)
    const base = await baseCurrency(page)
    const day = await today(page)
    await expect(row.getByTestId('transactions-cell-category')).toContainText(category.name)
    await expect(row.getByTestId('transactions-cell-amount')).toContainText(
      `-${await money(page, 42, base)}`
    )
    await expect(row.getByTestId('transactions-cell-date')).toHaveText(day.shown)

    const stored = await txNamed(m, m.a.id, name)
    expect(stored).toMatchObject({
      type: 'expense',
      amount: 42,
      category_id: category.id,
      date: day.iso,
      currency: base,
    })
  })

  test('12.2 the second of two tabs paying one bill is refused, and there is one payment @release', async ({
    m,
  }) => {
    const { page, context } = m
    const name = 'Zz Tandem Gym'
    const category = await categoryNamed(m, m.a.id, 'Entertainment')
    await addBill(m, name, 30, category.id)
    await goPage(page, 'bills', 'bills-header')
    await expect(unpaidBill(page, name)).toHaveCount(1, { timeout: 20_000 })

    const second = await context.newPage()
    const refusals: { status?: number; message?: string }[] = []
    second.on('console', (msg) => {
      if (msg.type() !== 'error' || !msg.text().includes('Failed to mark bill as paid')) return
      const err = msg.args().at(1)
      if (!err) {
        refusals.push({})
        return
      }
      void err
        .evaluate((e) => ({
          status: (e as { status?: number }).status,
          message: (e as Error).message,
        }))
        .then((r) => refusals.push(r))
    })
    try {
      await second.goto('/#bills', { waitUntil: 'domcontentloaded' })
      await expect(second.getByTestId('bills-header')).toBeVisible({ timeout: 30_000 })
      await expect(unpaidBill(second, name)).toHaveCount(1, { timeout: 20_000 })

      await markPaid(page, name)
      // The second tab has not heard of it (across tabs a change arrives only on resume,
      // section 9), so it still offers Mark Paid.
      await unpaidBill(second, name).getByTestId('bill-mark-paid-btn').click()
      await expect(toast(second, 'Failed to mark bill as paid')).toBeVisible()
      await expect.poll(() => refusals.length).toBe(1)
      expect(refusals[0]).toEqual({
        status: 409,
        message: 'Bill already paid for current period',
      })

      const payments = (await m.rows<TxRow>('transactions', m.a.id)).filter(
        (r) => r.description === name
      )
      expect(payments).toHaveLength(1)
    } finally {
      await second.close()
    }
  })

  test('12.3 the payment counts in spending on the Dashboard and Budgets @release', async ({
    m,
  }) => {
    const { page } = m
    const name = 'Zz Comet Arcade'
    const category = await categoryNamed(m, m.a.id, 'Entertainment')
    await addBill(m, name, 42, category.id)
    const base = await baseCurrency(page)
    const period = await page.evaluate(() => {
      const d = new Date()
      return { month: d.getMonth() + 1, year: d.getFullYear() }
    })
    const ym = `${period.year}-${String(period.month).padStart(2, '0')}`
    // What each page shows, read from the handlers they call (the focus period is this month).
    const expenses = async () =>
      (
        await m.api<{ totalExpenses: number }>(
          `/api/dashboard?month=${period.month}&year=${period.year}`
        )
      ).totalExpenses
    const spent = async () =>
      (await m.api<{ total_spent: number }>(`/api/budgets/zero-based/summary?month=${ym}`))
        .total_spent
    const expensesBefore = await expenses()
    const spentBefore = await spent()
    expect(typeof expensesBefore).toBe('number')
    expect(typeof spentBefore).toBe('number')

    // Both pages open before the payment, as in a tab that has been used.
    await goPage(page, 'dashboard', 'dashboard-container')
    await expect(page.getByTestId('dashboard-metric-expenses')).toContainText(
      await money(page, expensesBefore, base)
    )
    await goPage(page, 'budgets', 'budgets-header')
    await expect(page.getByTestId('budgets-summary-spent')).toContainText(
      await money(page, spentBefore, base)
    )

    await goPage(page, 'bills', 'bills-header')
    await markPaid(page, name)

    expect(await expenses()).toBeCloseTo(expensesBefore + 42, 2)
    expect(await spent()).toBeCloseTo(spentBefore + 42, 2)
    await goPage(page, 'dashboard', 'dashboard-container')
    await expect(page.getByTestId('dashboard-metric-expenses')).toContainText(
      await money(page, expensesBefore + 42, base)
    )
    await goPage(page, 'budgets', 'budgets-header')
    await expect(page.getByTestId('budgets-summary-spent')).toContainText(
      await money(page, spentBefore + 42, base)
    )
  })
})
