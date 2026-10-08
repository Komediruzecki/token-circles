/**
 * The Transactions form, in both storage modes: a refused entry is said in the form, under the
 * field it is about, and a good one is added, edited and deleted as before.
 *
 * It used to be one of seven warning toasts ("Please enter a positive amount"), or an error toast
 * in the server's words, with nothing in the form marked. Now the form checks the entry with the
 * rules both runtimes run and its own, marks each field (`aria-invalid`, the message as its
 * accessible description), moves focus to the first, and sends nothing. A refusal only the server
 * can make lands under its field the same way. A Cash account that could not be created says why
 * under the account field.
 *
 * Every case runs signed in (the Worker) and local-first (the IndexedDB router): the two answered
 * differently before, and the point is that they now answer the same. Pull requests run the
 * `@smoke` ones; main runs them all.
 */
import { expect, test } from '@playwright/test'
import { E2E_BASE } from './e2e-constants'
import { gotoServerless, isNetworkNoise, login, navigateToRoute } from './test-helpers'
import type { Locator, Page } from '@playwright/test'

interface Mode {
  name: 'cloud' | 'local-first'
  goto: (page: Page) => Promise<void>
}

/**
 * The setup wizard opens over a profile with nothing in it (a new one, or local-first's demo) a
 * moment after the page looks ready, and takes every click until it is left: leave it each time
 * it shows up.
 */
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
      await navigateToRoute(page, 'transactions')
      await expect(page.getByTestId('transactions-header')).toBeVisible({ timeout: 20_000 })
    },
  },
  {
    name: 'local-first',
    goto: async (page) => {
      await leaveOnboarding(page)
      await gotoServerless(page, 'transactions', 'transactions-header')
    },
  },
]

const modal = (page: Page): Locator => page.getByTestId('tx-modal')
const control = (page: Page, testId: string): Locator => modal(page).getByTestId(testId)
const save = (page: Page) => control(page, 'tx-save-btn').click()
const formIsOpen = (page: Page) => modal(page).evaluate((el) => el.className.includes('show'))
const toasts = (page: Page): Locator => page.getByRole('region', { name: 'Notifications' })
const errorToasts = (page: Page): Locator => toasts(page).getByRole('alert')

/** The values a select offers, its placeholder left out. */
async function options(select: Locator): Promise<string[]> {
  return select.evaluate((el: HTMLSelectElement) =>
    Array.from(el.options)
      .map((o) => o.value)
      .filter((v) => v !== '')
  )
}

/** Opens the add form, once its lists are in. */
async function openAddForm(page: Page): Promise<void> {
  await page.getByTestId('add-transaction-btn').click()
  await expect.poll(() => formIsOpen(page)).toBe(true)
  await expect
    .poll(async () => (await options(control(page, 'tx-category'))).length)
    .toBeGreaterThan(0)
  await expect
    .poll(async () => (await options(control(page, 'tx-account'))).length)
    .toBeGreaterThan(1)
}

/** Picks the first option a select offers, and answers its value. */
async function pickFirst(select: Locator): Promise<string> {
  const [first] = await options(select)
  await select.selectOption(first)
  return first
}

/** List rows whose description cell carries this text. */
function rowsOf(page: Page, description: string): Locator {
  return page.getByTestId('transactions-row').filter({
    has: page.getByTestId('transactions-cell-description').filter({ hasText: description }),
  })
}

/** Narrows the list to rows matching `text`, so a new row is on its first page. */
async function search(page: Page, text: string): Promise<void> {
  await page.getByTestId('transactions-search').fill(text)
}

/** Deletes a row from the list, as a person does. */
async function deleteRow(page: Page, description: string): Promise<void> {
  await rowsOf(page, description).getByRole('button', { name: 'Delete transaction' }).click()
  await page.getByTestId('confirm-accept').click()
  await expect(rowsOf(page, description)).toHaveCount(0)
}

/** Every transaction POST or PUT the page sends over the network (local-first sends none). */
function watchTransactionWrites(page: Page): string[] {
  const writes: string[] = []
  page.on('request', (request) => {
    if (['POST', 'PUT'].includes(request.method()) && /\/api\/transactions\b/.test(request.url())) {
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

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

/**
 * A request through the app's own API client, so it goes where the page's storage mode sends it:
 * the Worker signed in, the IndexedDB router local-first. It is addressed to the active profile.
 */
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
        apiPut: (url: string, body: unknown) => Promise<unknown>
        apiDelete: (url: string) => Promise<unknown>
      }
      if (req.method === 'GET') return mod.apiGet(req.url)
      if (req.method === 'POST') return mod.apiPost(req.url, req.body)
      if (req.method === 'PUT') return mod.apiPut(req.url, req.body)
      return mod.apiDelete(req.url)
    },
    { method, url, body }
  )
  return answer as T
}

/**
 * Takes out of the Worker's database what a case made, whether or not the case got as far as
 * removing it: the fixture account is shared by every spec and outlives a local run. Local-first
 * keeps everything in the test's own browser, which goes with it.
 */
async function sweep(page: Page, mode: Mode, stamp: string): Promise<void> {
  if (mode.name !== 'cloud' || !stamp) return
  const listed = await viaApp<{ id: number }[] | { rows?: { id: number }[] }>(
    page,
    'GET',
    `/api/transactions?search=${stamp}`
  )
  const rows = Array.isArray(listed) ? listed : (listed.rows ?? [])
  for (const row of rows) await viaApp(page, 'DELETE', `/api/transactions/${row.id}`)
  for (const kind of ['tags', 'categories']) {
    const named = await viaApp<{ id: number; name: string }[]>(page, 'GET', `/api/${kind}`)
    for (const item of named.filter((n) => n.name.includes(stamp))) {
      await viaApp(page, 'DELETE', `/api/${kind}/${item.id}`)
    }
  }
}

for (const mode of MODES) {
  test.describe(`the transaction form, ${mode.name} @smoke`, () => {
    /** In the name of everything a case makes, so `sweep` can find it. */
    let stamp = ''

    test.beforeEach(async ({ page }) => {
      test.setTimeout(120_000)
      stamp = Date.now().toString(36)
      await mode.goto(page)
      await openAddForm(page)
    })

    test.afterEach(async ({ page }) => {
      await sweep(page, mode, stamp)
    })

    test('an empty entry is marked under each field, focused, and nothing is sent', async ({
      page,
    }) => {
      const writes = watchTransactionWrites(page)
      await control(page, 'tx-account').selectOption('')

      await save(page)

      const description = control(page, 'tx-description')
      await expect(description).toHaveAttribute('aria-invalid', 'true')
      await expect(description).toHaveAccessibleDescription(
        'Describe it in a few words, like Weekly groceries.'
      )
      await expect(control(page, 'tx-amount')).toHaveAccessibleDescription('Enter the amount.')
      await expect(control(page, 'tx-category')).toHaveAccessibleDescription(
        'Choose a category from the list.'
      )
      await expect(control(page, 'tx-account')).toHaveAccessibleDescription(
        'Choose the account the money came out of.'
      )
      await expect(description).toBeFocused()
      expect(writes).toEqual([])
      await expect(errorToasts(page)).toHaveCount(0)
      expect(await formIsOpen(page)).toBe(true)

      // The message goes as soon as the field is fixed, without another save.
      await description.fill('M')
      await expect(description).not.toHaveAttribute('aria-invalid', 'true')
      // And the label names the field alone, without its InfoTip's explanation.
      await expect(modal(page).getByLabel('Description', { exact: true })).toHaveValue('M')
    })

    test('a category deleted after the form opened is refused by the server, under the category', async ({
      page,
    }) => {
      const category = await viaApp<{ id: number }>(page, 'POST', '/api/categories', {
        name: `zz-gone-${stamp}`,
        type: 'expense',
      })
      // Reopen, so the form offers the new category.
      await control(page, 'tx-cancel-btn').click()
      await openAddForm(page)
      await expect.poll(() => options(control(page, 'tx-category'))).toContain(String(category.id))
      await control(page, 'tx-description').fill(`zz-refused-${stamp}`)
      await control(page, 'tx-amount').fill('4')
      await control(page, 'tx-category').selectOption(String(category.id))
      await pickFirst(control(page, 'tx-account'))
      // Deleted elsewhere, after this form was filled in.
      await viaApp(page, 'DELETE', `/api/categories/${category.id}`)

      await save(page)

      const field = control(page, 'tx-category')
      await expect(field).toHaveAttribute('aria-invalid', 'true')
      await expect(field).toHaveAccessibleDescription(
        'Choose a category from the list, or leave it uncategorized.'
      )
      await expect(field).toBeFocused()
      expect(await formIsOpen(page)).toBe(true)
      await expect(errorToasts(page)).toHaveCount(0)
    })

    test('an expense with a new tag is added, edited and deleted', async ({ page }) => {
      const errors = watchErrors(page)
      const name = `zz-tx-${stamp}`
      const tag = `zz-tag-${stamp}`
      await control(page, 'tx-description').fill(name)
      await control(page, 'tx-amount').fill('12.34')
      await pickFirst(control(page, 'tx-category'))
      await pickFirst(control(page, 'tx-account'))
      const tagInput = control(page, 'tx-tag-new-input')
      if (!(await tagInput.isVisible())) await control(page, 'tx-advanced-toggle').click()
      await tagInput.fill(tag)
      await tagInput.press('Enter')
      await expect(control(page, 'tx-tag-chip')).toContainText(tag)

      await save(page)

      await expect.poll(() => formIsOpen(page), { timeout: 15_000 }).toBe(false)
      await expect(toasts(page).getByText(`Added "${name}" to your transactions.`)).toBeVisible()
      await search(page, name)
      await expect(rowsOf(page, name)).toHaveCount(1)
      await expect(rowsOf(page, name)).toContainText(tag)

      await rowsOf(page, name).getByRole('button', { name: 'Edit transaction' }).click()
      await expect(control(page, 'tx-description')).toHaveValue(name)
      await expect(control(page, 'tx-tag-chip')).toContainText(tag)
      await control(page, 'tx-description').fill(`${name}-edited`)
      await save(page)

      await expect.poll(() => formIsOpen(page), { timeout: 15_000 }).toBe(false)
      await expect(toasts(page).getByText(`Saved your changes to "${name}-edited".`)).toBeVisible()
      await expect(rowsOf(page, `${name}-edited`)).toHaveCount(1)
      await expect(rowsOf(page, `${name}-edited`)).toContainText(tag)

      await deleteRow(page, `${name}-edited`)
      await expect(errorToasts(page)).toHaveCount(0)
      expect(errors).toEqual([])
    })
  })

  test.describe(`the transaction form's other refusals and entries, ${mode.name}`, () => {
    /** In the name of everything a case makes, so `sweep` can find it. */
    let stamp = ''

    test.beforeEach(async ({ page }) => {
      test.setTimeout(120_000)
      stamp = Date.now().toString(36)
      await mode.goto(page)
      await openAddForm(page)
    })

    test.afterEach(async ({ page }) => {
      await sweep(page, mode, stamp)
    })

    test('an amount it cannot take is marked under the amount', async ({ page }) => {
      const writes = watchTransactionWrites(page)
      await control(page, 'tx-description').fill('zz-amount')
      await pickFirst(control(page, 'tx-category'))
      await pickFirst(control(page, 'tx-account'))

      for (const [amount, message] of [
        ['0', 'Enter an amount more than zero.'],
        ['12.345', 'Use at most two decimal places, like 12.50.'],
      ]) {
        await control(page, 'tx-amount').fill(amount)
        await save(page)
        await expect(control(page, 'tx-amount')).toHaveAccessibleDescription(message)
        await expect(control(page, 'tx-amount')).toBeFocused()
      }
      expect(writes).toEqual([])
      await expect(errorToasts(page)).toHaveCount(0)
    })

    test('a transfer is asked for both accounts, then for two different ones', async ({ page }) => {
      const writes = watchTransactionWrites(page)
      await control(page, 'tx-type-transfer').click()
      await control(page, 'tx-description').fill('zz-transfer')
      await control(page, 'tx-amount').fill('5')
      await control(page, 'tx-account').selectOption('')

      await save(page)

      await expect(control(page, 'tx-transfer-account')).toHaveAccessibleDescription(
        'Choose the account the money goes to.'
      )
      await expect(control(page, 'tx-account')).toHaveAccessibleDescription(
        'Choose the account the money comes from.'
      )
      await expect(control(page, 'tx-transfer-account')).toBeFocused()

      const from = await pickFirst(control(page, 'tx-account'))
      await control(page, 'tx-transfer-account').selectOption(from)
      await save(page)

      await expect(control(page, 'tx-transfer-account')).toHaveAccessibleDescription(
        'Choose a different account from the one the money comes from.'
      )
      await expect(control(page, 'tx-account')).not.toHaveAttribute('aria-invalid', 'true')
      expect(writes).toEqual([])
      await expect(errorToasts(page)).toHaveCount(0)
    })

    test('an income and a transfer are added', async ({ page }) => {
      const [from, to] = await options(control(page, 'tx-account'))

      await control(page, 'tx-type-income').click()
      await control(page, 'tx-description').fill(`zz-income-${stamp}`)
      await control(page, 'tx-amount').fill('250')
      await expect
        .poll(async () => (await options(control(page, 'tx-category'))).length)
        .toBeGreaterThan(0)
      await pickFirst(control(page, 'tx-category'))
      await control(page, 'tx-account').selectOption(from)
      await save(page)
      await expect.poll(() => formIsOpen(page), { timeout: 15_000 }).toBe(false)
      await expect(
        toasts(page).getByText(`Added "zz-income-${stamp}" to your transactions.`)
      ).toBeVisible()

      await openAddForm(page)
      await control(page, 'tx-type-transfer').click()
      await control(page, 'tx-description').fill(`zz-transfer-${stamp}`)
      await control(page, 'tx-amount').fill('20')
      await control(page, 'tx-account').selectOption(from)
      await control(page, 'tx-transfer-account').selectOption(to)
      await save(page)
      await expect.poll(() => formIsOpen(page), { timeout: 15_000 }).toBe(false)
      await expect(
        toasts(page).getByText(`Added "zz-transfer-${stamp}" to your transactions.`)
      ).toBeVisible()
      await expect(errorToasts(page)).toHaveCount(0)

      await search(page, stamp)
      await expect(rowsOf(page, `zz-income-${stamp}`)).toHaveCount(1)
      await expect(rowsOf(page, `zz-transfer-${stamp}`)).toHaveCount(1)
    })

    test('Enter in a field saves the entry, as Save does', async ({ page }) => {
      const name = `zz-enter-${stamp}`
      await control(page, 'tx-description').fill(name)
      await pickFirst(control(page, 'tx-category'))
      await pickFirst(control(page, 'tx-account'))
      await control(page, 'tx-amount').fill('7')

      await control(page, 'tx-amount').press('Enter')

      await expect.poll(() => formIsOpen(page), { timeout: 15_000 }).toBe(false)
      await expect(toasts(page).getByText(`Added "${name}" to your transactions.`)).toBeVisible()
      await search(page, name)
      await expect(rowsOf(page, name)).toHaveCount(1)
    })
  })

  /**
   * The Cash account the form offers when the profile has none, in a profile of its own: the
   * shared fixture profile has accounts.
   */
  test.describe(`the inline Cash account, ${mode.name} @smoke`, () => {
    let fixture: number | undefined
    let profile: number | undefined

    test.beforeEach(async ({ page }) => {
      test.setTimeout(120_000)
      await mode.goto(page)
      fixture = Number(await page.evaluate(() => localStorage.getItem('currentProfileId')))
      profile = (
        await viaApp<{ id: number }>(page, 'POST', '/api/profiles', {
          name: `zz-cash-${Date.now().toString(36)}`,
        })
      ).id
      await page.evaluate((id) => {
        localStorage.setItem('currentProfileId', String(id))
        localStorage.setItem('selectedProfileIds', JSON.stringify([id]))
      }, profile)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('transactions-header')).toBeVisible({ timeout: 30_000 })
      await page.getByTestId('add-transaction-btn').click()
      await expect(control(page, 'tx-create-cash-account')).toBeVisible({ timeout: 20_000 })
    })

    test.afterEach(async ({ page }) => {
      // Local-first lives in this test's own browser; the Worker's database outlives the run.
      if (mode.name !== 'cloud' || profile === undefined || fixture === undefined) return
      await page.request.delete(`${E2E_BASE}/api/profiles/${profile}`, {
        headers: { 'X-Profile-Id': String(fixture) },
      })
    })

    test('is created from the account field and chosen for the entry', async ({ page }) => {
      await control(page, 'tx-create-cash-account').click()

      await expect(control(page, 'tx-account').locator('option:checked')).toContainText('Cash')
      await expect(errorToasts(page)).toHaveCount(0)
    })

    test('says why it could not be created, under the account field', async ({ page }) => {
      // The profile's base currency is set, and this browser asks for another one: a 409.
      const base = (await viaApp<{ currency?: string }>(page, 'GET', '/api/settings')).currency
      const configured = base || 'EUR'
      await viaApp(page, 'PUT', '/api/settings', { currency: configured })
      const asked = configured === 'USD' ? 'EUR' : 'USD'
      await page.evaluate((code) => localStorage.setItem('localCurrency', code), asked)

      await control(page, 'tx-create-cash-account').click()

      const field = modal(page).getByRole('group', { name: /^Account/ })
      await expect(field).toHaveAttribute('aria-invalid', 'true')
      await expect(field).toHaveAccessibleDescription(
        `Account balances use ${configured}. Change the base currency in Settings before adding financial data.`
      )
      await expect(control(page, 'tx-create-cash-account')).toBeVisible()
      await expect(errorToasts(page)).toHaveCount(0)
    })
  })
}
