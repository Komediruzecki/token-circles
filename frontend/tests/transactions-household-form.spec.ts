/**
 * The add-transaction form in household view (two profiles ticked) offers the active profile's
 * categories and accounts, the ones a new entry can be saved with.
 *
 * Reproduced 2026-10-07 in both modes: the form offered every ticked profile's categories (and,
 * in local-first, accounts), and the save refused another profile's with "Category does not belong
 * to this profile" or "Account does not belong to this profile". The filter bar is meant to cover
 * the household; the form is not. See src/features/__tests__/transactionFormOffersItsProfile.test.tsx.
 */
import { expect, test } from '@playwright/test'
import { E2E_BASE } from './e2e-constants'
import type { Page } from '@playwright/test'

/** A request as the signed-in app makes it, addressed to the profile named. */
async function asProfile<T>(
  page: Page,
  method: string,
  path: string,
  profile: number,
  data?: unknown
): Promise<T> {
  const res = await page.request.fetch(`${E2E_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Profile-Id': String(profile) },
    data,
  })
  expect(res.ok(), `${method} ${path} -> ${res.status()} ${await res.text()}`).toBeTruthy()
  return (await res.json()) as T
}

/** The ids a select in the form offers, its placeholder left out. */
async function offered(page: Page, testId: string): Promise<number[]> {
  return page
    .getByTestId('tx-modal')
    .getByTestId(testId)
    .evaluate((el: HTMLSelectElement) =>
      Array.from(el.options)
        .map((o) => o.value)
        .filter((v) => v !== '')
        .map(Number)
    )
}

const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b)

/** Tick both profiles, the first one active, and load the Transactions page. */
async function householdView(page: Page, active: number, other: number): Promise<void> {
  await page.evaluate(
    ([a, o]) => {
      localStorage.setItem('currentProfileId', String(a))
      localStorage.setItem('selectedProfileIds', JSON.stringify([a, o]))
    },
    [active, other]
  )
  await page.goto(`${E2E_BASE}/#transactions`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('page-transactions')).toBeVisible({ timeout: 60_000 })
}

const formIsOpen = (page: Page) =>
  page.getByTestId('tx-modal').evaluate((el) => el.className.includes('show'))

/**
 * Open the add form once the page's lists are in. The form picks its account as it opens, so it is
 * opened, closed once the options have loaded, and opened again.
 */
async function openAddFormLoaded(page: Page): Promise<void> {
  await page.getByTestId('add-transaction-btn').click()
  await expect.poll(async () => (await offered(page, 'tx-category')).length).toBeGreaterThan(0)
  await expect.poll(async () => (await offered(page, 'tx-account')).length).toBeGreaterThan(0)
  await page.getByTestId('tx-cancel-btn').click()
  await expect.poll(() => formIsOpen(page)).toBe(false)
  await page.getByTestId('add-transaction-btn').click()
}

/** Description, amount and the category picked; then Save, which closes the form when it lands. */
async function saveEntry(page: Page, description: string, category: number): Promise<void> {
  const modal = page.getByTestId('tx-modal')
  await modal.getByTestId('tx-description').fill(description)
  await modal.getByTestId('tx-amount').fill('3')
  await modal.getByTestId('tx-category').selectOption(String(category))
  await modal.getByTestId('tx-save-btn').click()
  await expect.poll(() => formIsOpen(page), { timeout: 15_000 }).toBe(false)
}

test('cloud: a new entry in household view is offered the active profile’s categories @smoke', async ({
  page,
}) => {
  await page.goto(`${E2E_BASE}/#transactions`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('page-transactions')).toBeVisible({ timeout: 60_000 })
  const active = Number(await page.evaluate(() => localStorage.getItem('currentProfileId')))

  // Another profile of the same account, with a category and an account of its own.
  const stamp = Date.now().toString(36)
  const other = (
    await asProfile<{ id: number }>(page, 'POST', '/api/profiles', active, {
      name: `zz-household-${stamp}`,
    })
  ).id
  try {
    const theirs = await asProfile<{ id: number }>(page, 'POST', '/api/categories', other, {
      name: `zz-theirs-${stamp}`,
      type: 'expense',
      color: '#14b8a6',
      icon: 'tag',
    })
    await asProfile(page, 'POST', '/api/accounts', other, {
      name: `zz-their-account-${stamp}`,
      type: 'giro',
      starting_balance: 0,
    })
    const own = await asProfile<{ id: number; type: string }[]>(
      page,
      'GET',
      '/api/categories',
      active
    )
    const ownExpense = own.filter((c) => c.type === 'expense').map((c) => c.id)
    const ownAccounts = (
      await asProfile<{ id: number }[]>(page, 'GET', '/api/accounts', active)
    ).map((a) => a.id)

    await householdView(page, active, other)
    await openAddFormLoaded(page)

    const categories = await offered(page, 'tx-category')
    expect(categories).not.toContain(theirs.id)
    expect(sorted(categories)).toEqual(sorted(ownExpense))
    expect(sorted(await offered(page, 'tx-account'))).toEqual(sorted(ownAccounts))

    // And the one it offers lands.
    await saveEntry(page, `zz-household-entry-${stamp}`, ownExpense[0])
  } finally {
    await page.request.delete(`${E2E_BASE}/api/profiles/${other}`, {
      headers: { 'X-Profile-Id': String(active) },
    })
  }
})

test.describe('local-first', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('a new entry in household view is offered the active profile’s categories and accounts', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    // The setup wizard can open over the demo a moment after the page looks ready, and takes every
    // click until it is left: leave it each time it shows up.
    await page.addLocatorHandler(page.getByTestId('onboarding-wizard'), async () => {
      await page.getByTestId('onboarding-skip').click()
      const confirm = page.getByRole('button', { name: 'Confirm' })
      if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) await confirm.click()
    })
    await page.goto(`${E2E_BASE}/robots.txt`)
    await page.evaluate(() => {
      localStorage.setItem('finance_storage_mode', 'self-hosted')
    })
    await page.goto(`${E2E_BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('try-no-account').click({ timeout: 60_000 })
    await expect(page.getByTestId('profile-dropdown-btn')).toContainText('Example', {
      timeout: 90_000,
    })

    // The demo's profiles each have their own categories and accounts, with the same names.
    const owners = await page.evaluate(async () => {
      const spec = '/src/core/storage/idb.ts'
      const { getDB } = (await import(/* @vite-ignore */ spec)) as {
        getDB(): Promise<{ getAll(store: string): Promise<{ id: number; profile_id: number }[]> }>
      }
      const db = await getDB()
      const pairs = (rows: { id: number; profile_id: number }[]) =>
        rows.map((r) => [r.id, r.profile_id] as [number, number])
      return {
        active: Number(localStorage.getItem('currentProfileId')),
        categories: pairs(await db.getAll('categories')),
        accounts: pairs(await db.getAll('accounts')),
      }
    })
    const categoryOwner = new Map(owners.categories)
    const accountOwner = new Map(owners.accounts)
    const active = owners.active
    const other = owners.categories.map(([, p]) => p).find((p) => p !== active)
    expect(other, 'a second demo profile').toBeDefined()

    await householdView(page, active, other!)
    await openAddFormLoaded(page)

    const categories = await offered(page, 'tx-category')
    const accounts = await offered(page, 'tx-account')
    expect(categories.filter((id) => categoryOwner.get(id) !== active)).toEqual([])
    expect(accounts.filter((id) => accountOwner.get(id) !== active)).toEqual([])
    const preselected = Number(
      await page.getByTestId('tx-modal').getByTestId('tx-account').inputValue()
    )
    expect(accountOwner.get(preselected)).toBe(active)

    await saveEntry(page, 'zz-household-entry', categories[0])
  })
})
