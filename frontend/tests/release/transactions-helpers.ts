/**
 * Transactions page helpers for the release suite: arranging rows and tags through the app's own
 * API, driving the add/edit form and its tag picker, and telling the list's own reloads apart from
 * the identical request the badge evaluation sends.
 */
import { expect, isoDaysAgo } from './release-fixtures'
import { goPage } from './release-helpers'
import type { Locator, Page } from '@playwright/test'
import type { Mode } from './release-fixtures'

export interface TagRow {
  id: number
  name: string
  color?: string
  profile_id?: number
}

export interface CategoryRow {
  id: number
  name: string
  type: string
  profile_id?: number
}

export interface TxRow {
  id: number
  description: string
  amount: number
  type: string
  date: string
  currency?: string
  category_id?: number | null
  account_id?: number | null
  profile_id?: number
}

// ---------------------------------------------------------------------------------------------
// Arranging data through the API the app uses (Mode.api writes to the ACTIVE profile)
// ---------------------------------------------------------------------------------------------

/** The base currency the app stamps on a new row (`getLocalCurrency()`). */
export async function baseCurrency(page: Page): Promise<string> {
  return page.evaluate(() => (localStorage.getItem('localCurrency') || 'EUR').toUpperCase())
}

/** A category of the profile by name, read from storage. */
export async function categoryNamed(
  m: Mode,
  profileId: number,
  name: string
): Promise<CategoryRow> {
  const found = (await m.rows<CategoryRow>('categories', profileId)).find((c) => c.name === name)
  expect(found, `profile ${profileId} has a category "${name}"`).toBeTruthy()
  return found as CategoryRow
}

/** The profile's first account (cloud: Everyday Checking; the demo: Checking Account). */
export async function firstAccountId(m: Mode, profileId: number): Promise<number> {
  const accounts = await m.rows<{ id: number }>('accounts', profileId)
  expect(accounts.length, `profile ${profileId} has an account`).toBeGreaterThan(0)
  return Math.min(...accounts.map((a) => a.id))
}

/**
 * A transaction in the active profile, as the add form would send it. Every key the client's
 * TransactionSchema requires is sent: the local router stores the body as it is, and a row
 * without `currency` would fail the typed list read.
 */
export async function addTransaction(
  m: Mode,
  t: {
    description: string
    amount: number
    categoryId: number
    accountId: number
    type?: 'expense' | 'income'
    date?: string
  }
): Promise<number> {
  const currency = await baseCurrency(m.page)
  const created = await m.api<{ id?: number; transaction_id?: number }>('/api/transactions', {
    method: 'POST',
    body: {
      description: t.description,
      amount: t.amount,
      type: t.type ?? 'expense',
      date: t.date ?? isoDaysAgo(0),
      category_id: t.categoryId,
      account_id: t.accountId,
      currency,
      amount_local: t.amount,
      exchange_rate: 1,
      beneficiary: '',
      payor: '',
      notes: '',
    },
  })
  const id = created.id ?? created.transaction_id
  expect(id, `created "${t.description}"`).toBeTruthy()
  return id as number
}

/** A tag in the active profile. */
export async function addTag(m: Mode, name: string, color = '#6e9bff'): Promise<TagRow> {
  const created = await m.api<TagRow>('/api/tags', { method: 'POST', body: { name, color } })
  expect(created.id, `created tag "${name}"`).toBeTruthy()
  return created
}

/** The tags a transaction carries as stored (active profile), by name. */
export async function storedTagNames(m: Mode, transactionId: number): Promise<string[]> {
  const tags = await m.api<TagRow[]>(`/api/transactions/${transactionId}/tags`)
  return tags.map((t) => t.name).sort()
}

/** The tags a transaction carries as stored (active profile), by id. */
export async function storedTagIds(m: Mode, transactionId: number): Promise<number[]> {
  const tags = await m.api<TagRow[]>(`/api/transactions/${transactionId}/tags`)
  return tags.map((t) => t.id).sort((x, y) => x - y)
}

/** The stored row of a profile with this description. Fails unless there is exactly one. */
export async function txNamed(m: Mode, profileId: number, description: string): Promise<TxRow> {
  const rows = (await m.rows<TxRow>('transactions', profileId)).filter(
    (r) => r.description === description
  )
  expect(rows, `one stored "${description}" in profile ${profileId}`).toHaveLength(1)
  return rows[0]
}

/** Tags of a profile whose name matches, case and edge spaces ignored. */
export async function tagsNamed(m: Mode, profileId: number, name: string): Promise<TagRow[]> {
  const wanted = name.trim().toLowerCase()
  return (await m.rows<TagRow>('tags', profileId)).filter(
    (t) => t.name.trim().toLowerCase() === wanted
  )
}

// ---------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------

/** Transactions, by the sidebar's hash route, with the table (not the skeleton) on screen. */
export async function openTransactions(page: Page): Promise<void> {
  await goPage(page, 'transactions', 'transactions-header')
  await expect(page.getByTestId('transactions-table')).toBeVisible({ timeout: 30_000 })
}

/** List rows whose description cell carries this text. Descriptions in these specs are unique. */
export function txRows(page: Page, description: string): Locator {
  return page.getByTestId('transactions-row').filter({
    has: page.getByTestId('transactions-cell-description').filter({ hasText: description }),
  })
}

/** Narrow the list with its search box, so the rows a case made are on the first page. */
export async function searchList(page: Page, text: string): Promise<void> {
  await page.getByTestId('transactions-search').fill(text)
}

/**
 * The filter bar's tag dropdown button while no tag filter is set. Its label is the filter's
 * state ("All Tags", or "N Selected" once a tag is picked), so this is the content under test.
 */
export function unfilteredTagButton(page: Page): Locator {
  return page.getByTestId('filter-bar').getByRole('button', { name: 'All Tags' })
}

/** Open the filter bar's tag dropdown and read the tag names it offers. */
export async function tagFilterOffers(page: Page): Promise<string[]> {
  await unfilteredTagButton(page).click()
  const list = page
    .getByTestId('filter-bar')
    .locator('label', { hasText: 'All Tags' })
    .locator('xpath=..')
  await expect(list).toBeVisible()
  const names = (await list.locator('label').allInnerTexts()).map((t) => t.trim())
  // Close it again, as a click outside does. The open dropdown lays a transparent backdrop over
  // the whole page (FilterBar's `dropdownBackdrop`), and that is what such a click lands on.
  await page.locator('[class*="dropdownBackdrop"]').dispatchEvent('click')
  await expect(list).toBeHidden()
  return names.filter((n) => n !== 'All Tags')
}

/**
 * The names on the Tags page's cards, in page order. Read from the card's header (dot, then name)
 * because the card carries no hook for the name alone.
 */
export async function tagCardNames(page: Page): Promise<string[]> {
  return page
    .locator('[data-test-id^="tag-card-"]')
    .evaluateAll((cards) =>
      cards.map(
        (card) => card.querySelector('button span span:nth-child(2)')?.textContent?.trim() ?? ''
      )
    )
}

/** How many Tags page cards carry this name, case and edge spaces ignored. */
export async function tagCardsNamed(page: Page, name: string): Promise<number> {
  const wanted = name.trim().toLowerCase()
  return (await tagCardNames(page)).filter((n) => n.toLowerCase() === wanted).length
}

// ---------------------------------------------------------------------------------------------
// The add / edit form
// ---------------------------------------------------------------------------------------------

export async function openAddForm(page: Page): Promise<void> {
  await page.getByTestId('add-transaction-btn').click()
  await expect(page.getByTestId('tx-modal')).toBeVisible()
}

/** The row's Edit button opens the form on it. */
export async function openEditForm(page: Page, description: string): Promise<void> {
  await txRows(page, description).getByRole('button', { name: 'Edit transaction' }).click()
  await expect(page.getByTestId('tx-modal')).toBeVisible()
  await expect(page.getByTestId('tx-description')).toHaveValue(description)
}

/** Description, amount, an expense category and (when given) the account. */
export async function fillForm(
  page: Page,
  f: { description: string; amount: number; categoryId: number; accountId?: number }
): Promise<void> {
  await page.getByTestId('tx-description').fill(f.description)
  await page.getByTestId('tx-amount').fill(String(f.amount))
  await page.getByTestId('tx-category').selectOption(String(f.categoryId))
  if (f.accountId !== undefined) {
    await page.getByTestId('tx-account').selectOption(String(f.accountId))
  }
}

/** Show the advanced section, where the tag picker lives. */
export async function showTagPicker(page: Page): Promise<void> {
  const input = page.getByTestId('tx-tag-new-input')
  if (!(await input.isVisible())) await page.getByTestId('tx-advanced-toggle').click()
  await expect(input).toBeVisible()
}

/** Type a name in the form's tag box and press Enter. */
export async function enterFormTag(page: Page, name: string): Promise<void> {
  await showTagPicker(page)
  const input = page.getByTestId('tx-tag-new-input')
  await input.fill(name)
  await input.press('Enter')
}

/** The chips of the tags the form's transaction will carry. */
export async function formChips(page: Page): Promise<string[]> {
  return (await page.getByTestId('tx-tag-chip').allInnerTexts()).map((t) => t.trim()).sort()
}

/** The one-click chips of the profile's other tags. */
export async function formOffers(page: Page): Promise<string[]> {
  const options = page.getByTestId('tx-tag-options')
  if ((await options.count()) === 0) return []
  return (await options.getByRole('button').allInnerTexts()).map((t) => t.trim()).sort()
}

export async function pickFormTag(page: Page, name: string): Promise<void> {
  await showTagPicker(page)
  await page
    .getByTestId('tx-tag-options')
    .getByRole('button', { name: `Add tag ${name}`, exact: true })
    .click()
}

export async function removeFormTag(page: Page, name: string): Promise<void> {
  await page
    .getByTestId('tx-tag-chips')
    .getByRole('button', { name: `Remove tag ${name}`, exact: true })
    .click()
}

/** Save, and wait for the form to close: it stays open on a refused save. */
export async function saveForm(page: Page): Promise<void> {
  await page.getByTestId('tx-save-btn').click()
  await expect(page.getByTestId('tx-modal')).toBeHidden({ timeout: 20_000 })
}

// ---------------------------------------------------------------------------------------------
// The command bar (Ctrl+K): the app's quick add
// ---------------------------------------------------------------------------------------------

/**
 * Quick add an expense: Ctrl+K, the entry text, the category picked on its chip, Enter. Waits for
 * App's "Entry added" toast, which only a saved entry raises.
 */
export async function quickAdd(page: Page, text: string, categoryId: number): Promise<void> {
  await page.keyboard.press('Control+k')
  const bar = page.getByRole('dialog', { name: 'Quick entry command bar' })
  const input = bar.getByRole('textbox', { name: 'Quick entry' })
  await expect(input).toBeFocused()
  await input.fill(text)
  await bar.getByRole('combobox', { name: 'Category' }).selectOption(String(categoryId))
  await input.press('Enter')
  await expect(
    page.getByRole('region', { name: 'Notifications' }).getByText('Entry added')
  ).toBeVisible({ timeout: 15_000 })
}

// ---------------------------------------------------------------------------------------------
// Who asked for a request (cloud only: local-first reads never reach the network)
// ---------------------------------------------------------------------------------------------

interface FetchEntry {
  method: string
  path: string
  stack: string
}

/**
 * Record every `/api/*` fetch the page makes together with the script that made it: DevTools'
 * Network panel shows the same thing in its Initiator column. Needed because two callers send the
 * identical `GET /api/transactions`: the Transactions list, and the badge evaluation that runs
 * 1.2 s after every write (core/achievementsStore.ts). A count by URL alone would charge the
 * badge run to the list. apiFetch reads the global `fetch` on each call, so wrapping it here takes
 * effect without a reload.
 */
export async function watchFetchCallers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __tcFetchLog?: FetchEntry[] }
    if (w.__tcFetchLog) return
    const log: FetchEntry[] = []
    w.__tcFetchLog = log
    const real = window.fetch.bind(window)
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = input instanceof Request ? input.url : String(input)
      const url = new URL(raw, window.location.href)
      if (url.pathname.startsWith('/api/')) {
        const limit = Error.stackTraceLimit
        Error.stackTraceLimit = 60
        const stack = new Error('fetch').stack ?? ''
        Error.stackTraceLimit = limit
        const method = (
          init?.method ?? (input instanceof Request ? input.method : 'GET')
        ).toUpperCase()
        log.push({ method, path: url.pathname + url.search, stack })
      }
      return real(input, init)
    }
  })
}

async function fetchLog(page: Page): Promise<FetchEntry[]> {
  return page.evaluate(
    () => (window as unknown as { __tcFetchLog?: FetchEntry[] }).__tcFetchLog ?? []
  )
}

/** Where the fetch log is now; pass it to `listReloadsSince`. */
export async function fetchMark(page: Page): Promise<number> {
  return (await fetchLog(page)).length
}

/** `GET /api/transactions` requests the Transactions page itself made since `mark`. */
export async function listReloadsSince(page: Page, mark: number): Promise<number> {
  return (await fetchLog(page))
    .slice(mark)
    .filter(
      (e) =>
        e.method === 'GET' &&
        e.path === '/api/transactions' &&
        e.stack.includes('/src/features/Transactions.tsx')
    ).length
}

/** Every `GET /api/transactions` since `mark`, whoever sent it (for the failure message). */
export async function allListGetsSince(page: Page, mark: number): Promise<string[]> {
  return (await fetchLog(page))
    .slice(mark)
    .filter((e) => e.method === 'GET' && e.path === '/api/transactions')
    .map((e) =>
      e.stack.includes('/src/features/Transactions.tsx')
        ? 'Transactions.tsx'
        : e.stack.includes('/src/core/achievementsStore.ts')
          ? 'achievementsStore.ts'
          : 'other'
    )
}
