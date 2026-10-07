/**
 * Helpers for the "pages follow writes" cases (5.16.0 sections 2, 4 and 8, and 5.16.1 section 11).
 *
 * The cases share one shape: mount a set of pages (keep-alive keeps them), make a write on one of
 * them or somewhere else entirely, then look at every page again without a reload. These helpers
 * are the pieces of that shape the release fixtures do not already have.
 */
import { E2E_BASE } from '../e2e-constants'
import { expect } from './release-fixtures'
import { dismissOnboardingIfOpen, goPage } from './release-helpers'
import type { Locator, Page } from '@playwright/test'
import type { Mode } from './release-fixtures'

// ---------------------------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------------------------

/** A page route and the test id that says it has rendered. */
export type PageStop = readonly [route: string, readyTestId: string]

/** Visit each page once, in order, so it is mounted and stays mounted. Ends on the last one. */
export async function mountPages(page: Page, stops: readonly PageStop[]): Promise<void> {
  for (const [route, ready] of stops) await goPage(page, route, ready)
}

/**
 * The page on screen. Every visited page stays mounted, hidden with `display: none` (App.tsx
 * keep-alive), so a locator for a page without a root test id must be scoped to the shown one.
 */
export function shownPage(page: Page): Locator {
  return page.locator('main > div[style*="display: block"]')
}

/** Go to a page that has no ready test id of its own: wait for a heading on it instead. */
export async function goPageByHeading(page: Page, route: string, heading: string): Promise<void> {
  await goPage(page, route)
  await expect(shownPage(page).getByRole('heading', { name: heading }).first()).toBeVisible({
    timeout: 20_000,
  })
}

/**
 * A real reload, landing on `route`: every page unmounted, every store read again. `openApp`'s
 * `page.goto('/#route')` from a URL that differs only in its hash is a same-document hash change,
 * not a load, so it is no way to make the app read data or settings arranged behind its back.
 */
export async function reloadOn(page: Page, route: string, readyTestId: string): Promise<void> {
  await page.evaluate((h) => {
    window.location.hash = h
  }, route)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('profile-dropdown-btn')).toBeVisible({ timeout: 30_000 })
  await dismissOnboardingIfOpen(page)
  await expect(page.getByTestId(readyTestId)).toBeVisible({ timeout: 20_000 })
}

/**
 * The Dashboard's classic widgets (Budget Alerts, Recurring Insights, ...) sit below its "Show
 * more" toggle, folded away by default; Recurring Insights is also off by default. Both choices
 * live in localStorage (Dashboard.tsx, dashboardWidgets.ts): set them, then `reloadOn`.
 */
export async function unfoldDashboardWidgets(page: Page, extra: readonly string[]): Promise<void> {
  await page.evaluate((ids) => {
    const visible = [
      'badges',
      'metrics',
      'deck-sankey',
      'deck-heatmap',
      'deck-radar',
      'deck-trends',
      'deck-portfolio',
      'deck-transactions',
      'category-chart',
      'upcoming-bills',
      'budget-alerts',
      ...ids,
    ]
    localStorage.setItem(
      'dashboard_widgets',
      JSON.stringify({ visibleWidgets: visible, widgetOrder: [] })
    )
    localStorage.setItem('dashboard_showMore', '1')
  }, extra)
}

// ---------------------------------------------------------------------------------------------
// Money and dates
// ---------------------------------------------------------------------------------------------

/**
 * A money string as a number: "€1,234.56" is 1234.56, "-£12.00" and "−£12.00" are -12. Returns
 * NaN when there is no number in it.
 */
export function parseMoney(text: string): number {
  const negative = /^[\s(]*[-−]/.test(text)
  const digits = text.replace(/[^\d.]/g, '')
  if (!digits) return Number.NaN
  const value = Number(digits)
  return negative ? -value : value
}

/** What the app's formatCurrency prints: en-US, in the given currency. */
export function money(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

/** A date in the browser's local calendar, `days` from today (negative is the past). */
export function localIso(days = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ---------------------------------------------------------------------------------------------
// Counting the requests a page makes (cloud only: local-first reads never touch the network)
// ---------------------------------------------------------------------------------------------

export interface FetchEntry {
  url: string
  method: string
  /** Who called fetch. Lets a count leave out the badge evaluator, which is not the page. */
  stack: string
}

declare global {
  interface Window {
    __tcFetchLog?: FetchEntry[]
    __tcFetchWrapped?: boolean
  }
}

/**
 * Log every fetch the page makes, with the caller's stack.
 *
 * Every write also schedules a badge evaluation 1.2 s later (AchievementsHost), which reads
 * transactions, budgets, goals, loans, bills, categories and settings. Those reads are the badge
 * evaluator's, not the page's, and DevTools tells them apart by initiator. A count of "one GET
 * per write" on Goals or Loans would otherwise count the evaluator's read of the same list too.
 * `apiFetch` calls the global `fetch` at call time, so wrapping it here sees every app request.
 */
export async function ensureFetchLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (window.__tcFetchWrapped) return
    window.__tcFetchWrapped = true
    window.__tcFetchLog = []
    const original = window.fetch.bind(window)
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (
        init?.method ?? (input instanceof Request ? input.method : 'GET')
      ).toUpperCase()
      window.__tcFetchLog?.push({ url, method, stack: new Error('fetch').stack ?? '' })
      return original(input, init)
    }
  })
}

async function fetchLog(page: Page): Promise<FetchEntry[]> {
  return page.evaluate(() => window.__tcFetchLog ?? [])
}

/** Wait until the page has started no request for `quietMs`. */
export async function settleFetches(page: Page, quietMs = 1500, timeoutMs = 20_000): Promise<void> {
  const end = Date.now() + timeoutMs
  let last = -1
  let since = Date.now()
  while (Date.now() < end) {
    const n = (await fetchLog(page)).length
    if (n !== last) {
      last = n
      since = Date.now()
    } else if (Date.now() - since >= quietMs) {
      return
    }
    await page.waitForTimeout(200)
  }
}

function apiPath(url: string): string {
  const u = new URL(url, E2E_BASE)
  return u.pathname + u.search
}

/**
 * A request as the "one request per endpoint" check sees it: the path with its query parameters
 * sorted, so the same question asked with its parameters in another order counts as a repeat.
 */
function requestKey(path: string): string {
  const u = new URL(path, E2E_BASE)
  const params = [...u.searchParams].sort(([a, x], [b, y]) =>
    a === b ? x.localeCompare(y) : a.localeCompare(b)
  )
  const query = new URLSearchParams(params).toString()
  return query ? `${u.pathname}?${query}` : u.pathname
}

/** The requests asked more often than `allowed` says, as "path xN" (ordered parameters). */
function repeats(gets: readonly string[], allowed: readonly RegExp[] = []): string[] {
  const seen = new Map<string, number>()
  for (const p of gets) seen.set(requestKey(p), (seen.get(requestKey(p)) ?? 0) + 1)
  return [...seen]
    .filter(([p, n]) => n > (allowed.some((a) => a.test(p)) ? 2 : 1))
    .map(([p, n]) => `${p} x${String(n)}`)
}

function isBadgeEvaluation(entry: FetchEntry): boolean {
  return /achievements/i.test(entry.stack)
}

/** The page's own GETs (not the badge evaluator's) since `mark`, as API paths. */
async function pageGetsSince(page: Page, mark: number): Promise<string[]> {
  return (await fetchLog(page))
    .slice(mark)
    .filter((e) => e.method === 'GET' && !isBadgeEvaluation(e))
    .map((e) => apiPath(e.url))
    .filter((p) => p.startsWith('/api/'))
}

/** What `getsDuring` saw. */
export interface GetCount {
  /** The page's own GETs that matched the path. */
  n: number
  /** The page's own GETs, every endpoint. */
  gets: string[]
  /** Every request in the window, the badge evaluator's included: the failure message. */
  seen: string[]
}

/**
 * Count the page's own GETs matching `path` that `work` causes, in cloud, with the network let
 * settle before and after so the count is final. In local-first `work` just runs and the answer
 * is null: the case asserts the visible outcome alone.
 */
export async function getsDuring(
  m: Mode,
  path: RegExp,
  work: () => Promise<void>
): Promise<GetCount | null> {
  if (m.kind !== 'cloud') {
    await work()
    return null
  }
  await ensureFetchLog(m.page)
  await settleFetches(m.page)
  const mark = (await fetchLog(m.page)).length
  await work()
  await settleFetches(m.page)
  const gets = await pageGetsSince(m.page, mark)
  const seen = (await fetchLog(m.page)).slice(mark).map(describeFetch)
  return { n: gets.filter((p) => path.test(p)).length, gets, seen }
}

/**
 * In cloud: the path was fetched exactly `n` times, and no endpoint twice ("one request per
 * endpoint, not two"). In local-first there is nothing to count.
 */
export function expectGets(m: Mode, count: GetCount | null, n: number, what: string): void {
  if (m.kind !== 'cloud') return
  const log = `\n  requests in the window:\n    ${(count?.seen ?? []).join('\n    ')}`
  expect(count?.n, `${what}${log}`).toBe(n)
  expect(repeats(count?.gets ?? []), `${what}: no endpoint fetched twice${log}`).toEqual([])
}

/**
 * Show a page that was mounted before a write, and check it followed: in cloud, showing it
 * fetched each of `keys` exactly once (it was stale: one refetch, not none and not two) and no
 * endpoint twice. Local-first just shows it; the case then checks what is on it.
 *
 * `knownTwice` lists requests a page is known to repeat, each pinned by a case of its own that
 * expects to fail until the page is fixed: they may come twice here, and no more.
 */
export async function showFollower(
  m: Mode,
  route: string,
  ready: string | null,
  keys: readonly RegExp[],
  knownTwice: readonly RegExp[] = []
): Promise<void> {
  const show = async () => {
    if (ready) await goPage(m.page, route, ready)
    else await goPage(m.page, route)
  }
  if (m.kind !== 'cloud') {
    await show()
    return
  }
  await ensureFetchLog(m.page)
  await settleFetches(m.page)
  const mark = (await fetchLog(m.page)).length
  await show()
  await settleFetches(m.page)
  const gets = await pageGetsSince(m.page, mark)
  const log = `\n  requests in the window:\n    ${(await fetchLog(m.page))
    .slice(mark)
    .map(describeFetch)
    .join('\n    ')}`
  for (const key of keys) {
    const asked = gets.filter((p) => key.test(p))
    const what = `showing ${route} after the write refetches ${String(key)} once${log}`
    if (knownTwice.some((k) => asked.some((p) => k.test(requestKey(p))))) {
      expect(asked.length, what).toBeGreaterThanOrEqual(1)
      expect(asked.length, what).toBeLessThanOrEqual(2)
    } else {
      expect(asked, what).toHaveLength(1)
    }
  }
  expect(repeats(gets, knownTwice), `showing ${route}: no endpoint fetched twice${log}`).toEqual([])
}

/** In cloud: the page's own GETs in `gets` asked nothing twice. */
export function expectNoRepeats(m: Mode, gets: readonly string[], what: string): void {
  if (m.kind !== 'cloud') return
  expect(repeats(gets), `${what}:\n    ${gets.join('\n    ')}`).toEqual([])
}

/** Start counting now: returns a function that lists the page's own GETs since. Cloud only. */
export async function countFrom(page: Page): Promise<() => Promise<string[]>> {
  await ensureFetchLog(page)
  await settleFetches(page)
  const mark = (await fetchLog(page)).length
  return async () => {
    await settleFetches(page)
    return pageGetsSince(page, mark)
  }
}

/** Every request the page started since a mark, any method, badge evaluation included. */
export async function allFetchesFrom(page: Page): Promise<() => Promise<FetchEntry[]>> {
  await ensureFetchLog(page)
  await settleFetches(page)
  const mark = (await fetchLog(page)).length
  return async () => {
    await settleFetches(page, 3000)
    return (await fetchLog(page)).slice(mark)
  }
}

export function describeFetch(e: FetchEntry): string {
  return `${e.method} ${apiPath(e.url)}${isBadgeEvaluation(e) ? ' (badge evaluation)' : ''}`
}

// ---------------------------------------------------------------------------------------------
// Writes made somewhere this tab cannot see
// ---------------------------------------------------------------------------------------------

/**
 * A write made in another tab or on another device. It lands in storage, and this tab's data
 * counters are not told, exactly as a write from elsewhere would leave them.
 *
 * Cloud: straight to the Worker with the page's own cookie, for the profile the page writes to.
 * Local-first: the app's local router called directly, which writes the same IndexedDB the app
 * reads but skips `apiFetch`, the one place a write announces itself.
 */
export async function writeElsewhere<T = Record<string, unknown>>(
  m: Mode,
  path: string,
  init: { method: 'POST' | 'PUT' | 'DELETE'; body?: unknown }
): Promise<T> {
  const { page } = m
  if (m.kind === 'cloud') {
    const profileId = await page.evaluate(() => localStorage.getItem('currentProfileId') ?? '')
    const res = await page.request.fetch(`${E2E_BASE}${path}`, {
      method: init.method,
      headers: { 'Content-Type': 'application/json', 'X-Profile-Id': profileId },
      data: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const text = await res.text()
    expect(res.ok(), `${init.method} ${path} -> ${String(res.status())} ${text}`).toBe(true)
    return (text ? JSON.parse(text) : null) as T
  }
  const res = await page.evaluate(
    async ([p, i]) => {
      const spec = '/src/core/storage/localApiRouter.ts'
      const mod = (await import(/* @vite-ignore */ spec)) as {
        routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>
      }
      const response = await mod.routeApiRequest(p, {
        method: i.method,
        headers: { 'Content-Type': 'application/json' },
        body: i.body === undefined ? undefined : JSON.stringify(i.body),
      })
      return { status: response.status, text: await response.text() }
    },
    [path, init] as const
  )
  expect(res.status < 300, `${init.method} ${path} -> ${String(res.status)} ${res.text}`).toBe(true)
  return (res.text ? JSON.parse(res.text) : null) as T
}

/**
 * A write made by the app running in another tab: that tab's own raw helpers (core/api.ts
 * apiPost/apiPut/apiDelete), so it carries that tab's profile headers and announces itself there,
 * exactly as a save on one of its pages would. The tab must have the app loaded.
 */
export async function writeInTab<T = Record<string, unknown>>(
  tab: Page,
  path: string,
  init: { method: 'POST' | 'PUT' | 'DELETE'; body?: unknown }
): Promise<T> {
  return tab.evaluate(
    async ([p, i]) => {
      const spec = '/src/core/api.ts'
      const mod = (await import(/* @vite-ignore */ spec)) as {
        apiPost: (url: string, body: unknown) => Promise<unknown>
        apiPut: (url: string, body: unknown) => Promise<unknown>
        apiDelete: (url: string) => Promise<unknown>
      }
      if (i.method === 'POST') return (await mod.apiPost(p, i.body)) as T
      if (i.method === 'PUT') return (await mod.apiPut(p, i.body)) as T
      return (await mod.apiDelete(p)) as T
    },
    [path, init] as const
  )
}

// ---------------------------------------------------------------------------------------------
// Colours on screen
// ---------------------------------------------------------------------------------------------

/** "#e0708a" as the browser reports a computed colour: "rgb(224, 112, 138)". */
export function rgb(hex: string): string {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return `rgb(${String((n >> 16) & 255)}, ${String((n >> 8) & 255)}, ${String(n & 255)})`
}

/** The computed background colour of an element (a category dot, a swatch). */
export async function backgroundOf(locator: Locator): Promise<string> {
  return locator.evaluate((el) => window.getComputedStyle(el).backgroundColor)
}

// ---------------------------------------------------------------------------------------------
// Arranging data through the app's API
// ---------------------------------------------------------------------------------------------

export interface Row {
  id: number
  name?: string
}

function listOf<T>(body: unknown, key: string): T[] {
  if (Array.isArray(body)) return body as T[]
  const inner = (body as Record<string, unknown> | null)?.[key]
  return Array.isArray(inner) ? (inner as T[]) : []
}

/** The active profile's accounts. */
export async function accountsOf(m: Mode): Promise<(Row & { balance: number; type: string })[]> {
  return listOf(await m.api('/api/accounts'), 'accounts')
}

/** An account in the active profile, its starting and current balance the same figure. */
export async function arrangeAccountOf(
  m: Mode,
  fields: { name: string; type: 'giro' | 'savings' | 'ib' | 'cash'; balance: number }
): Promise<number> {
  const created = await m.api<{ id: number }>('/api/accounts', {
    method: 'POST',
    body: {
      name: fields.name,
      type: fields.type,
      currency: 'EUR',
      bank_name: '',
      balance: fields.balance,
      starting_balance: fields.balance,
    },
  })
  return created.id
}

/** A complete category (a string icon and a boolean tax flag, so every reader accepts it). */
export async function arrangeCategory(
  m: Mode,
  name: string,
  color = '#0ea5e9',
  type: 'expense' | 'income' = 'expense'
): Promise<number> {
  const created = await m.api<{ id: number }>('/api/categories', {
    method: 'POST',
    body: { name, type, color, icon: 'cart', tax_deductible: false },
  })
  return created.id
}

/**
 * An expense in the active profile, today unless a date is given. The body is the one the app's
 * own quick entry sends (CommandBar.tsx), every field included: the local-first store keeps a
 * row as it was posted, and a row without `currency` fails the client's TransactionSchema on
 * every later read of the list.
 */
export async function arrangeExpense(
  m: Mode,
  fields: {
    description: string
    amount: number
    categoryId: number | null
    date?: string
    beneficiary?: string
    currency?: string
  }
): Promise<number> {
  const accounts = await accountsOf(m)
  expect(accounts.length, 'the profile has an account to spend from').toBeGreaterThan(0)
  const created = await m.api<{ id: number }>('/api/transactions', {
    method: 'POST',
    body: {
      description: fields.description,
      amount: fields.amount,
      date: fields.date ?? localIso(),
      beneficiary: fields.beneficiary ?? '',
      payor: '',
      category_id: fields.categoryId,
      currency: fields.currency ?? 'EUR',
      amount_local: fields.amount,
      exchange_rate: 1,
      type: 'expense',
      notes: '',
      account_id: accounts[0]?.id ?? null,
    },
  })
  return created.id
}

// ---------------------------------------------------------------------------------------------
// The confirm dialog every delete goes through
// ---------------------------------------------------------------------------------------------

export async function acceptConfirm(page: Page): Promise<void> {
  const accept = page.getByTestId('confirm-accept')
  await expect(accept).toBeVisible()
  await accept.click()
  await expect(accept).toBeHidden({ timeout: 15_000 })
}

// ---------------------------------------------------------------------------------------------
// Page readers shared by several cases
// ---------------------------------------------------------------------------------------------

/** Dashboard > Net Worth, as a number. */
export async function dashboardNetWorth(page: Page): Promise<number> {
  return parseMoney(await page.getByTestId('dashboard-metric-networth-value').innerText())
}

/**
 * A figure read once it has stopped moving: two reads 700 ms apart that agree, after the network
 * has gone quiet. For the cards that paint a zero before their data arrives (the Emergency fund
 * summary, the Dashboard's budget radar), where a single read can catch the placeholder.
 */
export async function settledValue<T>(
  page: Page,
  /** The figure, or undefined while the card says it is still loading. */
  read: () => Promise<T | undefined>
): Promise<T> {
  await ensureFetchLog(page)
  await settleFetches(page)
  let last: string | undefined
  let value: T | undefined
  await expect
    .poll(
      async () => {
        value = await read()
        const key = value === undefined ? undefined : JSON.stringify(value)
        const same = key !== undefined && key === last
        last = key
        return same
      },
      { intervals: [700], timeout: 20_000 }
    )
    .toBe(true)
  return value as T
}

/** The Emergency fund calculator, mounted, with its total once loaded. */
export async function goEmergency(page: Page): Promise<number> {
  await goPage(page, 'emergency')
  await expect(page.locator('[data-tour="calc-emergency"]')).toBeVisible({ timeout: 20_000 })
  return settledValue(page, async () => {
    const loading = await shownPage(page).getByText('Loading...', { exact: true }).isVisible()
    return loading ? undefined : emergencyTotal(page)
  })
}

/**
 * Emergency fund > Total Emergency Fund: the savings accounts' balances. The card has no test id;
 * its label is the only handle, read from the page on screen.
 */
export async function emergencyTotal(page: Page): Promise<number> {
  const value = shownPage(page)
    .getByText('Total Emergency Fund', { exact: true })
    .locator('xpath=following-sibling::*[1]')
  return parseMoney(await value.innerText({ timeout: 20_000 }))
}

export function accountCard(page: Page, name: string): Locator {
  return page
    .getByTestId('account-card')
    .filter({ has: page.getByTestId('account-name').getByText(name, { exact: true }) })
}

/** Accounts > Add Account: name, type and a balance, saved with the form's own button. */
export async function addAccountUI(
  page: Page,
  name: string,
  type: 'giro' | 'savings' | 'ib' | 'cash',
  balance: number
): Promise<void> {
  await goPage(page, 'accounts', 'accounts-header')
  await page.getByTestId('add-account-btn').click()
  const modal = page.getByTestId('add-account-modal')
  await expect(modal).toBeVisible()
  await modal.getByPlaceholder('e.g., Checking, Savings').fill(name)
  await modal.locator('select').first().selectOption(type)
  // Starting Balance and Current Balance: the same figure for a new account.
  const amounts = modal.getByPlaceholder('0.00')
  await expect(amounts).toHaveCount(2)
  await amounts.nth(0).fill(String(balance))
  await amounts.nth(1).fill(String(balance))
  await modal.locator('button[type="submit"]').click()
  await expect(modal).toBeHidden({ timeout: 15_000 })
}
