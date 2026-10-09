/**
 * The Loans dialog and a loan's extra payments, in both storage modes: a refused loan, rate period
 * or extra payment is said under the field it is about, and a good one is added, changed and
 * removed with a toast that says which.
 *
 * The dialog said "The loan was not saved. Check your connection and try again." in a toast for
 * every refusal, with nothing marked, and an extra payment's refusal was a toast too. Now both
 * check with the rules both runtimes run (shared/loanSchema.ts), mark the field in its own words,
 * a rate period's under the field of its row, focus it, and send nothing. What only the runtime can
 * tell, like a payment past the end of a loan another tab shortened, is marked the same way.
 *
 * Every case runs signed in (the Worker) and local-first (the IndexedDB router). Pull requests run
 * the `@smoke` ones; main runs them all.
 */
import { expect, test } from '@playwright/test'
import { E2E_BASE, gotoServerless, isNetworkNoise, login, navigateToRoute } from './test-helpers'
import type { Locator, Page } from '@playwright/test'

interface Mode {
  name: 'cloud' | 'local-first'
  goto: (page: Page) => Promise<void>
}

/** The setup wizard can open over local-first's demo: leave it each time it shows up. */
async function leaveOnboarding(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByTestId('onboarding-wizard'), async () => {
    await page.getByTestId('onboarding-skip').click()
    const confirm = page.getByRole('button', { name: 'Confirm' })
    if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) await confirm.click()
  })
}

const MODES: Mode[] = [
  {
    name: 'cloud',
    goto: async (page) => {
      await leaveOnboarding(page)
      await login(page)
      await navigateToRoute(page, 'loans')
      await expect(page.getByTestId('loans-header')).toBeVisible({ timeout: 20_000 })
    },
  },
  {
    name: 'local-first',
    goto: async (page) => {
      await leaveOnboarding(page)
      await gotoServerless(page, 'loans', 'loans-header')
    },
  },
]

const dialog = (page: Page): Locator => page.getByTestId('loans-modal')
const field = (page: Page, label: string): Locator =>
  dialog(page).getByLabel(label, { exact: true })
const periodRows = (page: Page): Locator => dialog(page).getByTestId('loans-form-rate-period')
const submit = (page: Page) => dialog(page).locator('button[type="submit"]').click()
const toasts = (page: Page): Locator => page.getByRole('region', { name: 'Notifications' })
const errorToasts = (page: Page): Locator => toasts(page).getByRole('alert')

/** The card of the loan called `name`. */
function card(page: Page, name: string): Locator {
  return page.getByTestId('loans-item').filter({
    has: page.getByTestId('loans-item-name').getByText(name, { exact: true }),
  })
}

/** Every loan write the page sends over the network (local-first sends none). */
function watchLoanWrites(page: Page): string[] {
  const writes: string[] = []
  page.on('request', (request) => {
    if (['POST', 'PUT'].includes(request.method()) && /\/api\/loans\b/.test(request.url())) {
      writes.push(`${request.method()} ${request.url()}`)
    }
  })
  return writes
}

/** Uncaught exceptions, and console errors that are not the network's own noise. */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    const text = msg.text()
    if (msg.type() === 'error' && text.includes('Error') && !isNetworkNoise(text)) {
      errors.push(text)
    }
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

type Method = 'GET' | 'POST' | 'DELETE'

/** A request through the app's own API client, in whichever storage mode the page runs. */
async function viaApp<T = unknown>(
  page: Page,
  method: Method,
  url: string,
  body?: unknown
): Promise<T> {
  const answer = await page.evaluate(
    async (req) => {
      const spec = '/src/core/api.ts'
      const mod = (await import(/* @vite-ignore */ spec)) as {
        apiGet: (url: string) => Promise<unknown>
        apiPost: (url: string, body: unknown) => Promise<unknown>
        apiDelete: (url: string) => Promise<unknown>
      }
      if (req.method === 'GET') return mod.apiGet(req.url)
      if (req.method === 'POST') return mod.apiPost(req.url, req.body)
      return mod.apiDelete(req.url)
    },
    { method, url, body }
  )
  return answer as T
}

/** An amount as the app writes it, in the profile's currency. */
async function money(page: Page, amount: number): Promise<string> {
  return page.evaluate(async (value) => {
    const spec = '/src/core/api.ts'
    const mod = (await import(/* @vite-ignore */ spec)) as {
      formatCurrency: (amount: number) => string
    }
    return mod.formatCurrency(value)
  }, amount)
}

interface StoredLoan {
  id: number
  name: string
  rate_periods?: { rate: number; start_month: number; end_month: number | null }[]
}

/** The loan called `name` as stored, its rate periods with it, or undefined when there is none. */
async function loanNamed(page: Page, name: string): Promise<StoredLoan | undefined> {
  const loans = await viaApp<StoredLoan[]>(page, 'GET', '/api/loans')
  const listed = loans.find((loan) => loan.name === name)
  // The list carries a loan's rate periods in local-first only; the loan itself, in both.
  return listed ? viaApp<StoredLoan>(page, 'GET', `/api/loans/${listed.id}`) : undefined
}

/**
 * Changes a loan behind the page's back, as another tab would: the page's own client is not used,
 * so the page is not told.
 */
async function changeElsewhere(page: Page, mode: Mode, url: string, body: unknown): Promise<void> {
  if (mode.name === 'cloud') {
    const profileId = await page.evaluate(() => localStorage.getItem('currentProfileId'))
    const res = await page.request.put(`${E2E_BASE}${url}`, {
      headers: { 'X-Profile-Id': String(profileId) },
      data: body,
    })
    expect(res.ok(), `PUT ${url}: ${res.status()}`).toBeTruthy()
    return
  }
  await page.evaluate(
    async (req) => {
      const spec = '/src/core/storage/localApiRouter.ts'
      const mod = (await import(/* @vite-ignore */ spec)) as {
        routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>
      }
      const res = await mod.routeApiRequest(req.url, {
        method: 'PUT',
        body: JSON.stringify(req.body),
      })
      if (!res.ok) throw new Error(`PUT ${req.url}: ${res.status}`)
    },
    { url, body }
  )
}

/**
 * Takes out of the Worker's database the loans a case made, whether or not the case got that far:
 * the fixture profile is shared by every spec and outlives a local run. Local-first keeps
 * everything in the test's own browser, which goes with it.
 */
async function sweep(page: Page, mode: Mode, stamp: string): Promise<void> {
  if (mode.name !== 'cloud' || !stamp) return
  const loans = await viaApp<StoredLoan[]>(page, 'GET', '/api/loans')
  for (const loan of loans.filter((l) => l.name.includes(stamp))) {
    await viaApp(page, 'DELETE', `/api/loans/${loan.id}`)
  }
}

for (const mode of MODES) {
  // Pull requests run the cases tagged `@smoke`, and the ones tagged `cloudSmoke` signed in only:
  // a case that sends nothing runs the same code in both modes. Main runs every case in both.
  const cloudSmoke = mode.name === 'cloud' ? ' @smoke' : ''
  test.describe(`the Loans dialog and extra payments, ${mode.name}`, () => {
    /** In the name of every loan a case makes, so `sweep` can find it. */
    let stamp = ''

    test.beforeEach(async ({ page }) => {
      test.setTimeout(120_000)
      // Unique to this case: two cases that start in the same millisecond on two workers must not
      // sweep each other's rows.
      stamp = `${Date.now().toString(36)}${test.info().parallelIndex}`
      await mode.goto(page)
    })

    test.afterEach(async ({ page }) => {
      await sweep(page, mode, stamp)
    })

    test(`a loan without its figures is marked at each field, a rate period at its row, and nothing is sent${cloudSmoke}`, async ({
      page,
    }) => {
      const writes = watchLoanWrites(page)
      const name = `zz-loan-${stamp}`
      await page.getByTestId('add-loan-btn').click()
      await expect(dialog(page)).toBeVisible()

      await submit(page)

      for (const [label, said] of [
        ['Name', 'Give the loan a name.'],
        ['Amount borrowed', 'Enter the amount you borrowed.'],
        ['Interest rate (%)', 'Enter the interest rate, or 0 for an interest-free loan.'],
        ['Term (months)', 'Enter the term in months, like 60.'],
        ['First payment due', 'Choose the date the first payment is due.'],
      ] as const) {
        await expect(field(page, label)).toHaveAttribute('aria-invalid', 'true')
        await expect(field(page, label)).toHaveAccessibleDescription(said)
      }
      await expect(field(page, 'Name')).toBeFocused()

      await field(page, 'Name').fill(name)
      await field(page, 'Amount borrowed').fill('20000')
      await field(page, 'Interest rate (%)').fill('6,25')
      await field(page, 'Term (months)').fill('60')
      await field(page, 'First payment due').fill('2026-03-01')
      // A rate period with no rate, starting after the last payment.
      await dialog(page).getByRole('button', { name: 'Add a rate period' }).click()
      const row = periodRows(page).first()
      await row.getByLabel('Rate (%)', { exact: true }).fill('')
      await row.getByLabel('From payment', { exact: true }).fill('61')

      await submit(page)

      await expect(field(page, 'Name')).not.toHaveAttribute('aria-invalid', 'true')
      await expect(row.getByLabel('Rate (%)', { exact: true })).toHaveAccessibleDescription(
        'Enter the rate for these payments.'
      )
      await expect(row.getByLabel('From payment', { exact: true })).toHaveAccessibleDescription(
        'Enter a payment from 1 to 60.'
      )
      await expect(row.getByLabel('Rate (%)', { exact: true })).toBeFocused()
      // The message sits under its own field: the row's two marked fields start level.
      const rate = await row.getByLabel('Rate (%)', { exact: true }).boundingBox()
      const from = await row.getByLabel('From payment', { exact: true }).boundingBox()
      expect(Math.abs((rate?.y ?? 0) - (from?.y ?? 1))).toBeLessThanOrEqual(1)

      expect(writes).toEqual([])
      expect(await loanNamed(page, name)).toBeUndefined()
      await expect(errorToasts(page)).toHaveCount(0)
    })

    test('a loan is added with a rate period, changed, and deleted, and each step names it', async ({
      page,
    }) => {
      const errors = watchErrors(page)
      const name = `zz-loan-${stamp}`

      await page.getByTestId('add-loan-btn').click()
      await field(page, 'Name').fill(name)
      await field(page, 'Amount borrowed').fill('20000')
      await field(page, 'Interest rate (%)').fill('6,25')
      await field(page, 'Term (months)').fill('60')
      await field(page, 'First payment due').fill('2026-03-01')
      await dialog(page).getByRole('button', { name: 'Add a rate period' }).click()
      await periodRows(page).first().getByLabel('Rate (%)', { exact: true }).fill('3,9')
      await periodRows(page).first().getByLabel('From payment', { exact: true }).fill('13')
      await periodRows(page).first().getByLabel('To payment', { exact: true }).fill('24')
      await submit(page)

      await expect(dialog(page)).toHaveCount(0)
      await expect(toasts(page).getByText(`Added "${name}" to your loans.`)).toBeVisible()
      await expect(card(page, name).getByTestId('loans-item-rate')).toHaveText('6.25%')
      expect((await loanNamed(page, name))?.rate_periods).toEqual([
        expect.objectContaining({ rate: 3.9, start_month: 13, end_month: 24 }),
      ])

      // Changed: renamed, its rate period moved, and a second one added.
      await card(page, name).getByTestId('loans-item-edit').click()
      await expect(dialog(page)).toBeVisible()
      await expect(field(page, 'Name')).toHaveValue(name)
      await expect(periodRows(page)).toHaveCount(1)
      await field(page, 'Name').fill(`${name}-renamed`)
      await periodRows(page).first().getByLabel('Rate (%)', { exact: true }).fill('4,1')
      await dialog(page).getByRole('button', { name: 'Add a rate period' }).click()
      await periodRows(page).nth(1).getByLabel('Rate (%)', { exact: true }).fill('5')
      await periodRows(page).nth(1).getByLabel('From payment', { exact: true }).fill('37')
      await submit(page)

      await expect(dialog(page)).toHaveCount(0)
      await expect(toasts(page).getByText(`Saved your changes to "${name}-renamed".`)).toBeVisible()
      expect((await loanNamed(page, `${name}-renamed`))?.rate_periods).toEqual([
        expect.objectContaining({ rate: 4.1, start_month: 13, end_month: 24 }),
        expect.objectContaining({ rate: 5, start_month: 37, end_month: null }),
      ])

      // A rate period removed: the other one stays.
      await card(page, `${name}-renamed`).getByTestId('loans-item-edit').click()
      await expect(periodRows(page)).toHaveCount(2)
      await periodRows(page)
        .first()
        .getByRole('button', { name: 'Remove this rate period' })
        .click()
      await expect(periodRows(page)).toHaveCount(1)
      await submit(page)

      await expect(dialog(page)).toHaveCount(0)
      expect((await loanNamed(page, `${name}-renamed`))?.rate_periods).toEqual([
        expect.objectContaining({ rate: 5, start_month: 37, end_month: null }),
      ])

      // A new loan opened after that edit starts empty.
      await page.getByTestId('add-loan-btn').click()
      await expect(field(page, 'Name')).toHaveValue('')
      await expect(periodRows(page)).toHaveCount(0)
      await dialog(page).getByRole('button', { name: 'Cancel' }).click()

      // Deleted, once it is confirmed.
      await card(page, `${name}-renamed`)
        .getByRole('button', { name: `Delete ${name}-renamed` })
        .click()
      await page.getByTestId('confirm-accept').click()

      await expect(toasts(page).getByText('Loan deleted')).toBeVisible()
      await expect(card(page, `${name}-renamed`)).toHaveCount(0)
      await expect(errorToasts(page)).toHaveCount(0)
      expect(errors).toEqual([])
    })

    test('an extra payment is marked at its amount, then added, changed and removed, each step said', async ({
      page,
    }) => {
      const errors = watchErrors(page)
      const name = `zz-extra-${stamp}`
      const loan = await viaApp<{ id: number }>(page, 'POST', '/api/loans', {
        name,
        principal: 20000,
        interest_rate: 5,
        term_months: 60,
        start_date: '2026-03-01',
      })
      await page.evaluate((hash) => {
        location.hash = hash
      }, `#loans/${loan.id}/extras`)
      await expect(page.getByTestId('loans-detail-name')).toHaveText(name, { timeout: 20_000 })

      const writes = watchLoanWrites(page)
      const form = page.getByTestId('loans-extra-form')
      const amount = form.getByTestId('loans-extra-amount')
      await form.getByTestId('loans-extra-month').selectOption('3')
      for (const [typed, said] of [
        ['', 'Enter the amount of the extra payment.'],
        ['lots', 'Enter the amount as a number, like 1000.'],
        ['10.555', 'Use at most two decimal places, like 1000.50.'],
      ] as const) {
        await amount.fill(typed)
        await form.getByTestId('loans-extra-add').click()

        await expect(amount).toHaveAttribute('aria-invalid', 'true')
        await expect(amount).toHaveAccessibleDescription(said)
        await expect(amount).toBeFocused()
      }
      expect(writes).toEqual([])
      await expect(form.getByLabel('Amount', { exact: true })).toBeFocused()

      await amount.fill('1000,50')
      await form.getByTestId('loans-extra-add').click()

      await expect(
        toasts(page).getByText(`Added ${await money(page, 1000.5)} with payment 3 to "${name}".`)
      ).toBeVisible()
      const item = page.getByTestId('loans-extra-item')
      await expect(item).toHaveCount(1)
      await expect(amount).not.toHaveAttribute('aria-invalid', 'true')

      // Changed in place.
      await item.getByTestId('loans-extra-edit').click()
      const edit = page.getByTestId('loans-extra-edit-form')
      await expect(edit.getByTestId('loans-extra-edit-amount')).toBeFocused()
      await edit.getByTestId('loans-extra-edit-amount').fill('0')
      await edit.getByTestId('loans-extra-save').click()
      await expect(edit.getByTestId('loans-extra-edit-amount')).toHaveAccessibleDescription(
        'Enter an amount more than zero.'
      )
      await edit.getByTestId('loans-extra-edit-amount').fill('1500')
      await edit.getByTestId('loans-extra-save').click()

      await expect(
        toasts(page).getByText('Saved your changes to the extra payment with payment 3.')
      ).toBeVisible()
      await expect(item).toContainText(await money(page, 1500))

      // Removed, once it is confirmed.
      await item.getByRole('button', { name: 'Remove the extra payment with payment 3' }).click()
      await page.getByTestId('confirm-accept').click()

      await expect(toasts(page).getByText('Extra payment removed')).toBeVisible()
      await expect(page.getByTestId('loans-extras-empty')).toBeVisible()
      await expect(errorToasts(page)).toHaveCount(0)
      expect(errors).toEqual([])
    })

    test('an extra payment past the end of a loan another tab shortened is marked at When, and nothing is added @smoke', async ({
      page,
    }) => {
      const errors = watchErrors(page)
      const name = `zz-short-${stamp}`
      const loan = await viaApp<{ id: number }>(page, 'POST', '/api/loans', {
        name,
        principal: 20000,
        interest_rate: 5,
        term_months: 60,
        start_date: '2026-03-01',
      })
      await page.evaluate((hash) => {
        location.hash = hash
      }, `#loans/${loan.id}/extras`)
      await expect(page.getByTestId('loans-detail-name')).toHaveText(name, { timeout: 20_000 })

      const form = page.getByTestId('loans-extra-form')
      const when = form.getByTestId('loans-extra-month')
      await when.selectOption('48')
      await form.getByTestId('loans-extra-amount').fill('100')
      // Another tab cut the loan to 24 payments. The page still offers the 60 it opened with, so
      // only the runtime can tell that payment 48 is gone: its refusal is marked at the field.
      await changeElsewhere(page, mode, `/api/loans/${loan.id}`, { term_months: 24 })
      await form.getByTestId('loans-extra-add').click()

      await expect(when).toHaveAttribute('aria-invalid', 'true')
      await expect(when).toHaveAccessibleDescription(
        'Choose which payment the extra payment goes with.'
      )
      await expect(when).toBeFocused()
      await expect(page.getByTestId('loans-extra-notice')).toHaveText('')
      await expect(page.getByTestId('loans-extra-item')).toHaveCount(0)
      await expect(errorToasts(page)).toHaveCount(0)
      const stored = await viaApp<{ prepayments: unknown[] }>(page, 'GET', `/api/loans/${loan.id}`)
      expect(stored.prepayments).toEqual([])
      expect(errors).toEqual([])
    })
  })
}
