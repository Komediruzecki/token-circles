/**
 * What the form-errors specs for Housing, Portfolio, Tags, the Recurring section, the
 * subscription catalog and scan, and the setup wizard share: the two storage modes, requests
 * through the app's own client or behind its back, and what each case watches.
 *
 * Signed in, each case runs on a profile of its own, named with the case's stamp and deleted
 * after it: the fixture profile is every spec's, and a holding, a tag or a category left in it
 * would show on another spec's page. Local-first runs on the demo, in the test's own browser,
 * which goes with it.
 *
 * The form-errors specs before these carry their own copies of the same helpers
 * (bill-form-errors.spec.ts and the rest).
 */
import { expect, test } from '@playwright/test'
import {
  E2E_BASE,
  firstProfileId,
  gotoServerless,
  isNetworkNoise,
  login,
  navigateToRoute,
} from './test-helpers'
import type { Locator, Page } from '@playwright/test'

export interface Mode {
  name: 'cloud' | 'local-first'
  /**
   * Opens the app at `route` once `ready` shows: signed in, on a new profile called `profile`, or
   * local-first on the demo. Resolves with the id of the profile the page is on.
   */
  open: (
    page: Page,
    route: string,
    ready: (page: Page) => Locator,
    profile: string
  ) => Promise<number>
}

interface StoredProfile {
  id: number
  name: string
}

/** The setup wizard can open over a new profile: leave it each time it shows up. */
export async function leaveOnboarding(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByTestId('onboarding-wizard'), async () => {
    await page.getByTestId('onboarding-skip').click()
    const confirm = page.getByRole('button', { name: 'Confirm' })
    if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) await confirm.click()
  })
}

/** Creates a profile for the account every spec signs in as, and answers its id. */
export async function newCloudProfile(page: Page, name: string): Promise<number> {
  const fixture = await firstProfileId(page)
  const res = await page.request.post(`${E2E_BASE}/api/profiles`, {
    headers: { 'X-Profile-Id': String(fixture) },
    data: { name },
  })
  expect(res.ok(), `POST /api/profiles: ${String(res.status())}`).toBeTruthy()
  return ((await res.json()) as StoredProfile).id
}

export const MODES: Mode[] = [
  {
    name: 'cloud',
    open: async (page, route, ready, profile) => {
      const id = await newCloudProfile(page, profile)
      await page.addInitScript((pid) => {
        localStorage.setItem('currentProfileId', String(pid))
        localStorage.setItem('selectedProfileIds', JSON.stringify([pid]))
        // A recorded decision keeps the setup wizard from covering a new profile's page.
        localStorage.setItem('finance_onboarding', 'skipped')
      }, id)
      await leaveOnboarding(page)
      await login(page)
      await navigateToRoute(page, route)
      await expect(ready(page)).toBeVisible({ timeout: 30_000 })
      return id
    },
  },
  {
    name: 'local-first',
    open: async (page, route, ready) => {
      await leaveOnboarding(page)
      await gotoServerless(page, route, 'profile-dropdown-btn')
      await expect(ready(page)).toBeVisible({ timeout: 30_000 })
      return Number(await page.evaluate(() => localStorage.getItem('currentProfileId')))
    },
  },
]

/** Unique to the case: two cases that start in the same millisecond on two workers differ. */
export function caseStamp(): string {
  return `${Date.now().toString(36)}${String(test.info().parallelIndex)}`
}

/**
 * Takes the profiles a case made out of the Worker's database, whether or not the case got that
 * far, and everything in them with them. Local-first keeps everything in the test's own browser.
 */
export async function sweepProfiles(page: Page, mode: Mode, stamp: string): Promise<void> {
  if (mode.name !== 'cloud' || !stamp) return
  const fixture = await firstProfileId(page)
  const headers = { 'X-Profile-Id': String(fixture) }
  const res = await page.request.get(`${E2E_BASE}/api/profiles`, { headers })
  const profiles = (await res.json()) as StoredProfile[]
  for (const profile of profiles.filter((p) => p.name.toLowerCase().includes(stamp))) {
    await page.request.delete(`${E2E_BASE}/api/profiles/${String(profile.id)}`, { headers })
  }
}

/**
 * The line the typed client (core/api.ts) logs for an answer it was not told to expect, a refusal
 * the form then marks at its field included: what a case that makes the runtime refuse expects.
 */
export const REFUSAL_LOGGED = /\[ERROR\] API Error \{status: 400,/

export const toasts = (page: Page): Locator => page.getByRole('region', { name: 'Notifications' })
export const errorToasts = (page: Page): Locator => toasts(page).getByRole('alert')

/**
 * Uncaught exceptions, and console errors that are not the network's own noise, nor what `expected`
 * matches: a line the page logs on purpose when the case makes it fail.
 */
export function watchErrors(page: Page, expected?: RegExp): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    const text = msg.text()
    if (msg.type() !== 'error' || !text.includes('Error') || isNetworkNoise(text)) return
    if (!expected?.test(text)) errors.push(text)
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

/** Every write to a path `path` matches that the page sends over the network (local-first sends none). */
export function watchWrites(page: Page, path: RegExp): string[] {
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET' && path.test(new URL(request.url()).pathname)) {
      writes.push(`${request.method()} ${request.url()}`)
    }
  })
  return writes
}

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

/** A request through the app's own API client, in whichever storage mode the page runs. */
export async function viaApp<T = unknown>(
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
 * A request as another tab would send it: the page's own client is not used, so the page is not
 * told. On the Worker it is the API, as the profile `profileId`; in local-first, the router the
 * page's IndexedDB sits behind.
 */
export async function elsewhere<T = unknown>(
  page: Page,
  mode: Mode,
  method: Method,
  url: string,
  profileId: number,
  body?: unknown
): Promise<T> {
  if (mode.name === 'cloud') {
    const res = await page.request.fetch(`${E2E_BASE}${url}`, {
      method,
      headers: { 'X-Profile-Id': String(profileId) },
      data: body,
    })
    expect(res.ok(), `${method} ${url}: ${String(res.status())}`).toBeTruthy()
    return (await res.json()) as T
  }
  return page.evaluate(
    async (req) => {
      const spec = '/src/core/storage/localApiRouter.ts'
      const mod = (await import(/* @vite-ignore */ spec)) as {
        routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>
      }
      const res = await mod.routeApiRequest(req.url, {
        method: req.method,
        headers: { 'X-Profile-Id': String(req.profileId) },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
      })
      if (!res.ok) throw new Error(`${req.method} ${req.url}: ${String(res.status)}`)
      return (await res.json()) as T
    },
    { method, url, profileId, body }
  )
}

/** An amount as the app writes it, in the profile's currency. */
export async function money(page: Page, amount: number): Promise<string> {
  return page.evaluate(async (value) => {
    const spec = '/src/core/api.ts'
    const mod = (await import(/* @vite-ignore */ spec)) as {
      formatCurrency: (amount: number) => string
    }
    return mod.formatCurrency(value)
  }, amount)
}

/** YYYY-MM-DD, `days` from today on this calendar (negative for days ago). */
export function daysFromToday(days: number): string {
  const day = new Date()
  day.setDate(day.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${String(day.getFullYear())}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

/**
 * Leaves the page for `route` by its hash, as a link in the sidebar would, so the page mounts and
 * loads what it shows afresh.
 */
export async function goTo(page: Page, route: string, ready: Locator): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = hash
  }, `#${route}`)
  await expect(ready).toBeVisible({ timeout: 30_000 })
}
