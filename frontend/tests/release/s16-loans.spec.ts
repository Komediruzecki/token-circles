/**
 * Release scope 5.17.0, section 16: the Loans page after its relayout (plan 03 of the brand
 * redesign). A loan added through the form; What if on it; each mode of an extra payment; both
 * modes side by side; the comparison surviving a reload, because it lives in the address; Use as
 * A; and an extra payment saved on Extra payments moving A. Every case runs in both storage modes.
 *
 * The loan is plan 03's example: 100,000 at 5 % over 120 months, first payment due on the first
 * of the month after next, so the next payment is the first one whatever today is. In payment
 * numbers its figures never change, and shared/loanScenarios is tested on them in closed form:
 * 50 more a month ends after 114 payments, 6 months sooner; 10,000 with payment 12 ends after 106,
 * 14 months sooner, saving 5,236.32 in interest, or instead lowers the installment from 1,060.66
 * to 945.48 from payment 13, saving 2,438.66. Only the month names depend on the date.
 */
import { money, reloadOn } from './follow-helpers'
import { both, expect } from './release-fixtures'
import { goPage } from './release-helpers'
import type { Locator, Page } from '@playwright/test'
import type { Mode } from './release-fixtures'

/** The first of the month after next, as YYYY-MM-DD: always ahead of today, in any zone. */
function startDate(): string {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1))
  return d.toISOString().slice(0, 10)
}

/** The month of payment `n` of a loan starting on `start`: "October 2034", or "Oct 2034". */
function paymentMonth(start: string, n: number, style: 'long' | 'short' = 'long'): string {
  const [year, month] = start.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 + n - 1, 1)).toLocaleDateString('en-US', {
    month: style,
    year: 'numeric',
    timeZone: 'UTC',
  })
}

const LOAN = { principal: 100000, interest_rate: 5, term_months: 120 }
const ONE_OFF = 'one-payment.10000.12'

function loanCard(page: Page, name: string): Locator {
  return page
    .getByTestId('loans-item')
    .filter({ has: page.getByTestId('loans-item-name').getByText(name, { exact: true }) })
}

/** The comparison in the address: `b` or `a`. */
async function pick(page: Page, key: 'a' | 'b'): Promise<string | null> {
  const hash = await page.evaluate(() => window.location.hash)
  return new URLSearchParams(hash.split('?')[1] ?? '').get(key)
}

/** Arrange the example loan in the active profile, as the form sends it, and open Loans. */
async function arrangeLoan(m: Mode, name: string): Promise<{ id: number; start: string }> {
  const start = startDate()
  const saved = await m.api<{ id: number }>('/api/loans', {
    method: 'POST',
    body: { name, ...LOAN, start_date: start, rate_periods: [] },
  })
  await goPage(m.page, 'loans', 'loans-header')
  await expect(loanCard(m.page, name)).toHaveCount(1, { timeout: 20_000 })
  return { id: saved.id, start }
}

/** One-off payment, 10,000 with payment 12 (a year from the next payment). */
async function pickOneOff(page: Page): Promise<void> {
  await page.getByTestId('loans-template-one-payment').click()
  await page.getByTestId('loans-preset-amount').selectOption('10000')
  await page.getByTestId('loans-preset-inMonths').selectOption('12')
  await expect.poll(() => pick(page, 'b')).toMatch(new RegExp(`^${ONE_OFF}\\.`))
}

for (const [pass, test] of both) {
  test.describe(`5.17.0 s16 loans [${pass}]`, () => {
    test('16.1 a new loan: What if shows the golden payoff date, then the golden installment @release', async ({
      m,
    }) => {
      const { page } = m
      const name = `zz-loan${m.suffix}`
      const start = startDate()
      const modal = page.getByTestId('loans-modal')
      await goPage(page, 'loans', 'loans-header')

      await test.step('add the loan through the form', async () => {
        await page.getByTestId('add-loan-btn').click()
        await expect(modal).toBeVisible()
        await modal.getByPlaceholder('e.g., Auto Loan, Student Loan').fill(name)
        await modal.getByPlaceholder('15000.00').fill('100000')
        await modal.getByPlaceholder('5.5').fill('5')
        await modal.getByTestId('loans-form-term').fill('120')
        await modal.getByTestId('loans-form-start-date').fill(start)
        await modal.locator('button[type="submit"]').click()
        await expect(modal).toBeHidden({ timeout: 15_000 })
        const card = loanCard(page, name)
        await expect(card).toHaveCount(1)
        await expect(card.getByTestId('loans-item-monthly')).toHaveText(money(1060.66))
        await expect(card.getByTestId('loans-item-payoff')).toHaveText(
          `Done in ${paymentMonth(start, 120)}`
        )
      })

      await test.step('What if opens Compare on 50 more each month: 6 months sooner', async () => {
        await loanCard(page, name).getByTestId('loans-item-what-if').click()
        await expect(page.getByTestId('loans-compare-sentence')).toContainText(
          `Done in ${paymentMonth(start, 114)}, 6 months sooner.`
        )
        expect(await pick(page, 'b')).toBe('more-each-month.50.shorten')
        await expect(page.getByTestId('loans-compare-a-payoff')).toHaveText(
          paymentMonth(start, 120, 'short')
        )
        await expect(page.getByTestId('loans-compare-b-payoff')).toHaveText(
          `${paymentMonth(start, 114, 'short')}6 months sooner`
        )
        await expect(page.getByTestId('loans-compare-chart')).toBeVisible()
      })

      await test.step('10,000 with payment 12: finish sooner, then pay less each month', async () => {
        await pickOneOff(page)
        await expect(page.getByTestId('loans-compare-sentence')).toHaveText(
          `You pay €10,000 extra and €5,236 less interest. Done in ${paymentMonth(start, 106)}, 14 months sooner.`
        )
        await page.getByTestId('loans-mode-lower').click()
        await expect(page.getByTestId('loans-compare-sentence')).toHaveText(
          `You pay €10,000 extra and €2,439 less interest. From ${paymentMonth(start, 13)} the installment is €945.48 instead of €1,060.66.`
        )
        await expect(page.getByTestId('loans-compare-b-installment')).toHaveText(
          `${money(1060.66)}then ${money(945.48)} from ${paymentMonth(start, 13, 'short')}`
        )
        expect(await pick(page, 'b')).toBe(`${ONE_OFF}.lower`)
      })
    })

    test('16.2 Compare both modes, and a reload brings the comparison back @release', async ({
      m,
    }) => {
      const { page } = m
      const { start } = await arrangeLoan(m, `zz-both${m.suffix}`)
      await loanCard(page, `zz-both${m.suffix}`).getByTestId('loans-item-what-if').click()
      await pickOneOff(page)
      await page.getByTestId('loans-mode-both').click()

      const sentence = `Finishing sooner saves €2,798 more interest and ends in ${paymentMonth(start, 106)}. Paying less each month frees €115.17 a month from ${paymentMonth(start, 13)}.`
      await expect(page.getByTestId('loans-compare-sentence')).toHaveText(sentence)
      await expect(page.getByTestId('loans-compare-shorten-title')).toHaveText('Finish sooner')
      await expect(page.getByTestId('loans-compare-lower-title')).toHaveText('Pay less each month')
      await expect(page.getByTestId('loans-compare-shorten-saved')).toHaveText(money(5236.32))
      await expect(page.getByTestId('loans-compare-lower-saved')).toHaveText(money(2438.66))
      expect(await pick(page, 'b')).toBe(`${ONE_OFF}.both`)

      const route = (await page.evaluate(() => window.location.hash)).slice(1)
      await reloadOn(page, route, 'loans-compare-sentence')
      await expect(page.getByTestId('loans-compare-sentence')).toHaveText(sentence)
      await expect(page.getByTestId('loans-mode-both')).toHaveAttribute('aria-checked', 'true')
    })

    test('16.3 Use as A: the next what-if is measured against it @release', async ({ m }) => {
      const { page } = m
      const { start } = await arrangeLoan(m, `zz-pin${m.suffix}`)
      await loanCard(page, `zz-pin${m.suffix}`).getByTestId('loans-item-what-if').click()
      await pickOneOff(page)
      await page.getByTestId('loans-mode-shorten').click()

      await page.getByTestId('loans-use-as-a').click()
      await expect.poll(() => pick(page, 'a')).toBe(`${ONE_OFF}.shorten`)
      expect(await pick(page, 'b')).toBeNull()
      await expect(page.getByTestId('loans-compare-a-title')).toHaveText('€10,000 in a year')
      await expect(page.getByTestId('loans-compare-a-payoff')).toHaveText(
        paymentMonth(start, 106, 'short')
      )

      await page.getByTestId('loans-template-more-each-month').click()
      await expect(page.getByTestId('loans-compare-b-payoff')).toHaveText(
        `${paymentMonth(start, 114, 'short')}8 months later`
      )

      await page.getByTestId('loans-reset-a').click()
      await expect(page.getByTestId('loans-compare-a-title')).toHaveText('As planned')
      await expect(page.getByTestId('loans-compare-b-payoff')).toHaveText(
        `${paymentMonth(start, 114, 'short')}6 months sooner`
      )
    })

    test('16.4 an extra payment saved on Extra payments moves A @release', async ({ m }) => {
      const { page } = m
      const name = `zz-extra${m.suffix}`
      const { id, start } = await arrangeLoan(m, name)
      await loanCard(page, name).getByTestId('loans-item-what-if').click()
      await expect(page.getByTestId('loans-compare-a-payoff')).toHaveText(
        paymentMonth(start, 120, 'short')
      )

      await page.getByTestId('loans-tab-extras').click()
      await page.getByTestId('loans-extra-month').selectOption('12')
      await page.getByTestId('loans-extra-amount').fill('10000')
      await page.getByTestId('loans-extra-add').click()
      await expect(page.getByTestId('loans-extra-item')).toHaveCount(1, { timeout: 15_000 })
      await expect(page.getByTestId('loans-extra-item')).toContainText('Payment 12')
      await expect(page.getByTestId('loans-extra-item')).toContainText(money(10000))

      // Stored on the loan, not only shown.
      const stored = await m.api<{ prepayments?: { month: number; amount: number }[] }>(
        `/api/loans/${id}`
      )
      expect(stored.prepayments?.map((p) => [p.month, p.amount])).toEqual([[12, 10000]])

      await page.getByTestId('loans-tab-compare').click()
      await expect(page.getByTestId('loans-compare-a-payoff')).toHaveText(
        paymentMonth(start, 106, 'short')
      )
      await expect(page.getByTestId('loans-compare-side-a')).toContainText(
        'With your saved extra payment'
      )
    })
  })
}
