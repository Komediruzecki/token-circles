/**
 * Fixtures for the release suite: the manual dev test scope for a release, automated.
 *
 * The scope is run twice, once per storage mode, and so is this:
 *
 * - `cloud` is the signed-in fixture account, working in two profiles of the test's own,
 *   "Personal <tag>" and "Family <tag>", created through the API and deleted afterwards. A spec
 *   can switch, tick and write in them without touching the shared "E2E Fixture" profile or a
 *   profile another worker is using. Badges, settings and import rules are all per profile on the
 *   Worker, so two profiles of our own are real isolation, not a convention.
 * - `local` is a browser with nothing in it that takes the sign-in screen's "Continue with no
 *   account": the demo seed's three Example profiles in IndexedDB, and nothing on the network.
 *
 * Profile selection lives in localStorage (`currentProfileId` for writes, `selectedProfileIds`
 * for household reads), so it belongs to the browser context, never to the account. Two cloud
 * tests on the same account therefore cannot steer each other's selection.
 */
import { devices, expect, test as base } from '@playwright/test'
import { E2E_BASE } from '../e2e-constants'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'

const DAY = 24 * 60 * 60 * 1000

/** A context with no cookie and no localStorage: what a private window brings to the sign-in screen. */
export const EMPTY_STATE = { cookies: [], origins: [] }

export interface Profile {
  id: number
  name: string
}

/** `days` ago as YYYY-MM-DD. Negative is the future. */
export function isoDaysAgo(days: number, now = Date.now()): string {
  return new Date(now - days * DAY).toISOString().slice(0, 10)
}

/** Unique per test and per run, short enough to read in a profile menu. */
function tagFor(testInfo: TestInfo): string {
  return `${testInfo.workerIndex}${Date.now().toString(36).slice(-5)}`
}

// ---------------------------------------------------------------------------------------------
// Cloud: the Worker, through the API the app itself uses
// ---------------------------------------------------------------------------------------------

/** Requests scoped to one profile, the way the app sends them (`X-Profile-Id`). */
export class ProfileApi {
  constructor(
    private readonly request: APIRequestContext,
    readonly profile: Profile
  ) {}

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', 'X-Profile-Id': String(this.profile.id) }
  }

  private async body<T>(res: Awaited<ReturnType<APIRequestContext['get']>>, what: string) {
    const text = await res.text()
    expect(res.ok(), `${what} -> ${res.status()} ${text}`).toBeTruthy()
    return (text ? JSON.parse(text) : null) as T
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.body<T>(
      await this.request.get(`${E2E_BASE}${path}`, { headers: this.headers() }),
      `GET ${path}`
    )
  }

  async post<T = Record<string, unknown>>(path: string, data: unknown = {}): Promise<T> {
    return this.body<T>(
      await this.request.post(`${E2E_BASE}${path}`, { headers: this.headers(), data }),
      `POST ${path}`
    )
  }

  async put<T = Record<string, unknown>>(path: string, data: unknown = {}): Promise<T> {
    return this.body<T>(
      await this.request.put(`${E2E_BASE}${path}`, { headers: this.headers(), data }),
      `PUT ${path}`
    )
  }

  async del(path: string): Promise<void> {
    const res = await this.request.delete(`${E2E_BASE}${path}`, { headers: this.headers() })
    expect(res.ok(), `DELETE ${path} -> ${res.status()} ${await res.text()}`).toBeTruthy()
  }
}

export interface SeededProfile {
  api: ProfileApi
  profile: Profile
  /** Category ids by name. */
  categories: Record<string, number>
  accountId: number
}

/**
 * A small, believable profile: categories, one account, three months of income and spending,
 * and one unpaid bill. Enough for every page to render its populated state, so onboarding does
 * not open over the page (a profile with an account is not pristine). Specs add what they test.
 */
export async function seedSmallProfile(api: ProfileApi, now = Date.now()): Promise<SeededProfile> {
  const categories: Record<string, number> = {}
  for (const c of [
    { name: 'Salary', type: 'income', icon: 'wallet', color: '#22c55e' },
    { name: 'Housing', type: 'expense', icon: 'home', color: '#6366f1' },
    { name: 'Groceries', type: 'expense', icon: 'cart', color: '#f59e0b' },
    { name: 'Eating out', type: 'expense', icon: 'coffee', color: '#14b8a6' },
    { name: 'Utilities', type: 'expense', icon: 'bolt', color: '#0ea5e9' },
    { name: 'Subscriptions', type: 'expense', icon: 'repeat', color: '#ec4899' },
  ]) {
    const created = await api.post<{ id: number }>('/api/categories', c)
    categories[c.name] = created.id
  }

  const account = await api.post<{ id: number }>('/api/accounts', {
    name: 'Everyday Checking',
    type: 'giro',
    bank_name: 'Example Bank',
    starting_balance: 2500,
    starting_date: isoDaysAgo(400, now),
  })
  const accountId = account.id

  for (let month = 0; month < 3; month += 1) {
    const base = month * 30
    for (const t of [
      { description: 'Salary', amount: 3000, type: 'income', days: base + 2, category: 'Salary' },
      { description: 'Rent', amount: 1000, type: 'expense', days: base + 3, category: 'Housing' },
      {
        description: 'Weekly groceries',
        amount: 82.4,
        type: 'expense',
        days: base + 5,
        category: 'Groceries',
      },
    ]) {
      await api.post('/api/transactions', {
        description: t.description,
        amount: t.amount,
        type: t.type,
        date: isoDaysAgo(t.days, now),
        account_id: accountId,
        category_id: categories[t.category],
      })
    }
  }

  await api.post('/api/bills', {
    name: 'Internet',
    amount: 39.99,
    frequency: 'monthly',
    dueDate: isoDaysAgo(-9, now),
    account_id: accountId,
    category_id: categories['Utilities'],
  })

  return { api, profile: api.profile, categories, accountId }
}

async function listProfiles(request: APIRequestContext): Promise<Profile[]> {
  const res = await request.get(`${E2E_BASE}/api/profiles`)
  expect(res.ok(), `GET /api/profiles -> ${res.status()}`).toBeTruthy()
  const body = (await res.json()) as Profile[] | { profiles: Profile[] }
  return Array.isArray(body) ? body : body.profiles
}

/**
 * Wait until the local Worker answers. `wrangler dev` crashes now and then under a full run and its
 * supervisor brings it back within seconds, but Playwright starts the retry at once: without this,
 * the retry's first request lands in the restart window, gets a 502, and the retry is spent.
 */
async function waitForApi(request: APIRequestContext): Promise<void> {
  await expect
    .poll(
      () =>
        request
          .get(`${E2E_BASE}/api/health`, { timeout: 5_000 })
          .then((r) => r.ok())
          .catch(() => false),
      { message: 'the local Worker answers /api/health', timeout: 60_000 }
    )
    .toBe(true)
}

async function createProfile(request: APIRequestContext, name: string): Promise<Profile> {
  const res = await request.post(`${E2E_BASE}/api/profiles`, { data: { name } })
  expect(res.ok(), `POST /api/profiles ${name} -> ${res.status()} ${await res.text()}`).toBeTruthy()
  const body = (await res.json()) as { id: number; name: string }
  return { id: body.id, name: body.name }
}

/**
 * Point the browser at a profile before the app boots. Done from a static file on the same
 * origin, so the app never starts in some other profile and then switches, which would be a
 * profile switch the spec did not ask for.
 */
export async function primeSelection(page: Page, current: number, selected: number[] = [current]) {
  await page.goto(`${E2E_BASE}/robots.txt`)
  await page.evaluate(
    ([c, s]) => {
      localStorage.setItem('currentProfileId', String(c))
      localStorage.setItem('selectedProfileIds', JSON.stringify(s))
    },
    [current, selected] as const
  )
}

export interface CloudWorld {
  page: Page
  context: BrowserContext
  /** Appended to every profile name this test creates, so teardown can find them all. */
  tag: string
  personal: SeededProfile
  family: SeededProfile
  /** A request client for any profile, including ones a spec creates through the UI. */
  apiFor(profile: Profile): ProfileApi
  /** Every profile of the account whose name ends with this test's tag. */
  ownProfiles(): Promise<Profile[]>
}

// ---------------------------------------------------------------------------------------------
// Local-first: IndexedDB, through the app's own router
// ---------------------------------------------------------------------------------------------

export interface LocalWorld {
  page: Page
  context: BrowserContext
  /**
   * Console problems seen so far: `Validation failed` (a write the local router's schemas
   * refused), `VersionError` (an IndexedDB upgrade gone wrong), and uncaught page errors.
   * The fixture fails the test on any of them unless the spec calls `allowConsole` first.
   */
  problems: string[]
  allowConsole(pattern: RegExp): void
  /**
   * Call the app's own API router from inside the page, exactly as the app does: same module
   * instance (vite serves `/src`), same IndexedDB, same invalidation after a write. For arranging
   * data a case needs before it starts; the case itself goes through the UI.
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the JSON it expects
  localApi<T = unknown>(
    path: string,
    init?: { method?: string; body?: unknown }
  ): Promise<{ status: number; body: T }>
  /** Profiles in the local database. */
  profiles(): Promise<Profile[]>
}

const LOCAL_PROBLEM = /Validation failed|VersionError/

/**
 * Known local-first bugs that log a `Validation failed`, each pinned by an expected-failure case
 * of its own. Allowed here so they do not fail every unrelated case; when a fix lands, its own
 * case starts passing unexpectedly, and the entry comes out of this list.
 */
export const KNOWN_LOCAL_CONSOLE: { pattern: RegExp; pinnedBy: string }[] = [
  {
    // A category made on the Categories page has no `tax_deductible`; normalizeCategory does not
    // default it and CategorySchema requires it, so every typed `api.getCategories()` throws.
    pattern: /\[ApiClient\] Validation failed for \/categories/,
    pinnedBy: 's01-profiles.spec.ts 1.2c',
  },
]

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the JSON it expects
export async function callLocalApi<T>(
  page: Page,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ([p, i]) => {
      // A variable specifier: vite serves the source module, and the browser hands back the
      // instance the app already loaded, because the URL is the same.
      const spec = '/src/core/apiFetch.ts'
      const mod = (await import(/* @vite-ignore */ spec)) as {
        apiFetch: (url: string, init?: RequestInit) => Promise<Response>
      }
      const res = await mod.apiFetch(
        p,
        i
          ? {
              method: i.method ?? 'GET',
              headers: { 'Content-Type': 'application/json' },
              body: i.body === undefined ? undefined : JSON.stringify(i.body),
            }
          : undefined
      )
      const text = await res.text()
      let body: unknown = text
      try {
        body = JSON.parse(text)
      } catch {
        // not JSON; keep the text
      }
      return { status: res.status, body }
    },
    [path, init ?? null] as const
  ) as Promise<{ status: number; body: T }>
}

/**
 * The sign-in screen, then "Continue with no account": the path a new visitor takes. The app
 * reloads into local-first mode and seeds the demo. Ready when the header names a demo profile
 * and the dashboard is up.
 *
 * A deployed build defaults a new browser to the sign-in screen (VITE_DEFAULT_STORAGE=sqlite).
 * The vite dev server has no such default and would drop a new browser straight into local-first,
 * skipping the button this case is about, so the deployed default is set first.
 */
export async function enterLocalFirst(page: Page): Promise<void> {
  await page.goto(`${E2E_BASE}/robots.txt`)
  await page.evaluate(() => {
    localStorage.setItem('finance_storage_mode', 'self-hosted')
  })
  await page.goto(`${E2E_BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('try-no-account').click({ timeout: 60_000 })
  await expect(page.getByTestId('profile-dropdown-btn')).toContainText('Example', {
    timeout: 90_000,
  })
  await expect(page.getByTestId('dashboard-container')).toBeVisible({ timeout: 60_000 })
}

// ---------------------------------------------------------------------------------------------
// The fixtures
// ---------------------------------------------------------------------------------------------

export const test = base.extend<{ cloud: CloudWorld; local: LocalWorld }>({
  cloud: async ({ page, context }, use, testInfo) => {
    const tag = tagFor(testInfo)
    const request = page.request
    await waitForApi(request)
    const personalProfile = await createProfile(request, `Personal ${tag}`)
    const familyProfile = await createProfile(request, `Family ${tag}`)
    const personal = await seedSmallProfile(new ProfileApi(request, personalProfile))
    const family = await seedSmallProfile(new ProfileApi(request, familyProfile))

    await primeSelection(page, personalProfile.id)

    const ownProfiles = async () =>
      (await listProfiles(request)).filter((p) => p.name.endsWith(tag))

    await use({
      page,
      context,
      tag,
      personal,
      family,
      apiFor: (profile) => new ProfileApi(request, profile),
      ownProfiles,
    })

    // Every profile this test made, including the ones it created through the UI.
    for (const p of await ownProfiles().catch(() => [] as Profile[])) {
      await request.delete(`${E2E_BASE}/api/profiles/${p.id}`).catch(() => undefined)
    }
  },

  local: async ({ browser }, use, testInfo) => {
    // The demo seed writes thousands of rows into IndexedDB before the app is usable: give the
    // case its own minute on top of whatever the seed took.
    testInfo.setTimeout(testInfo.timeout + 120_000)
    const context = await browser.newContext({
      ...devices['Desktop Chrome'],
      baseURL: E2E_BASE,
      storageState: EMPTY_STATE,
    })
    const page = await context.newPage()
    const problems: string[] = []
    const allowed: RegExp[] = KNOWN_LOCAL_CONSOLE.map((k) => k.pattern)
    const watch = (p: Page) => {
      p.on('console', (msg) => {
        const text = msg.text()
        if (LOCAL_PROBLEM.test(text) && !allowed.some((a) => a.test(text))) problems.push(text)
      })
      p.on('pageerror', (err) => {
        if (!allowed.some((a) => a.test(err.message))) problems.push(`pageerror: ${err.message}`)
      })
    }
    watch(page)
    context.on('page', watch)

    await enterLocalFirst(page)

    await use({
      page,
      context,
      problems,
      allowConsole: (pattern) => allowed.push(pattern),
      localApi: (path, init) => callLocalApi(page, path, init),
      profiles: async () => {
        const res = await callLocalApi<Profile[] | { profiles: Profile[] }>(page, '/api/profiles')
        return Array.isArray(res.body) ? res.body : res.body.profiles
      },
    })

    await context.close()
    // Scope case 5.7: no `Validation failed` or `VersionError` anywhere in the local-first pass.
    expect(problems, 'console problems during the local-first case').toEqual([])
  },
})

// ---------------------------------------------------------------------------------------------
// One case, both passes
// ---------------------------------------------------------------------------------------------

/** Where a kind of row lives in each mode: the Worker route and the IndexedDB store. */
export const ENTITIES = {
  categories: { api: '/api/categories', store: 'categories' },
  tags: { api: '/api/tags', store: 'tags' },
  accounts: { api: '/api/accounts', store: 'accounts' },
  budgets: { api: '/api/budgets', store: 'budgets' },
  goals: { api: '/api/savings-goals', store: 'goals' },
  bills: { api: '/api/bills', store: 'bills' },
  loans: { api: '/api/loans', store: 'loans' },
  transactions: { api: '/api/transactions?limit=1000', store: 'transactions' },
} as const
export type Entity = keyof typeof ENTITIES

/**
 * The same case in either pass. `a` is the profile the case starts in (active, the only one
 * selected), `b` a second profile with data of its own. Cloud: Personal and Family. Local-first:
 * the demo's Example Mid Income (active on a fresh demo) and Example Low Income.
 */
export interface Mode {
  kind: 'cloud' | 'local'
  page: Page
  context: BrowserContext
  a: Profile
  b: Profile
  /** Append to every name a case creates. In cloud it carries the cleanup tag. */
  suffix: string
  profiles(): Promise<Profile[]>
  profileNamed(name: string): Promise<Profile>
  /** Rows of one profile, read from storage (Worker or IndexedDB), never from the screen. */
  rows<T = Record<string, unknown>>(entity: Entity, profileId: number): Promise<T[]>
  /**
   * Arrange data a case needs, through the API the app uses: the Worker in cloud, the app's own
   * local router in local-first. Writes land in the ACTIVE profile (`currentProfileId`), as the
   * app's do; switch first to write elsewhere. Fails the case on a non-2xx answer.
   */

  api<T = Record<string, unknown>>(path: string, init?: ApiInit): Promise<T>
}

export interface ApiInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
}

/** Every row of an IndexedDB store, read on a short-lived connection of its own. */
export async function localRows<T = Record<string, unknown>>(
  page: Page,
  store: string
): Promise<T[]> {
  return page.evaluate((name) => {
    return new Promise<T[]>((resolve, reject) => {
      // No version: open whatever is there, never trigger an upgrade from a test.
      // eslint-disable-next-line no-restricted-globals -- reading the store itself is the point
      const req = indexedDB.open('finance-manager')
      req.onerror = () => {
        reject(new Error(String(req.error)))
      }
      req.onsuccess = () => {
        const db = req.result
        const all = db.transaction(name, 'readonly').objectStore(name).getAll()
        all.onsuccess = () => {
          db.close()
          resolve(all.result as T[])
        }
        all.onerror = () => {
          db.close()
          reject(new Error(String(all.error)))
        }
      }
    })
  }, store)
}

async function cloudMode(world: CloudWorld): Promise<Mode> {
  const { page } = world
  await page.goto('/#dashboard', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('profile-dropdown-btn')).toContainText(
    world.personal.profile.name,
    {
      timeout: 30_000,
    }
  )
  await expect(page.getByTestId('dashboard-container')).toBeVisible({ timeout: 30_000 })
  const profiles = async () => world.ownProfiles()
  return {
    kind: 'cloud',
    page,
    context: world.context,
    a: world.personal.profile,
    b: world.family.profile,
    suffix: ` ${world.tag}`,
    profiles,
    profileNamed: async (name) => {
      const found = (await profiles()).find((p) => p.name === name)
      expect(found, `no profile named "${name}"`).toBeTruthy()
      return found as Profile
    },
    api: async <T>(path: string, init?: ApiInit) => {
      const current = await page.evaluate(() => Number(localStorage.getItem('currentProfileId')))
      const client = world.apiFor({ id: current, name: '' })
      const method = init?.method ?? 'GET'
      if (method === 'GET') return client.get<T>(path)
      if (method === 'POST') return client.post<T>(path, init?.body ?? {})
      if (method === 'PUT' || method === 'PATCH') return client.put<T>(path, init?.body ?? {})
      await client.del(path)
      return null as T
    },
    rows: async <T>(entity: Entity, profileId: number) => {
      const body = await world
        .apiFor({ id: profileId, name: '' })
        .get<T[] | Record<string, T[]>>(ENTITIES[entity].api)
      if (Array.isArray(body)) return body
      const list = Object.values(body ?? {}).find(Array.isArray)
      return (list ?? []) as T[]
    },
  }
}

async function localMode(world: LocalWorld): Promise<Mode> {
  const { page } = world
  const all = await world.profiles()
  const activeId = await page.evaluate(() => Number(localStorage.getItem('currentProfileId')))
  const a = all.find((p) => p.id === activeId)
  const b = all.find((p) => p.id !== activeId && /Low Income/.test(p.name))
  expect(a, 'the demo has an active profile').toBeTruthy()
  expect(b, 'the demo has Example Low Income').toBeTruthy()
  const profiles = async () => world.profiles()
  return {
    kind: 'local',
    page,
    context: world.context,
    a: a as Profile,
    b: b as Profile,
    suffix: '',
    profiles,
    profileNamed: async (name) => {
      const found = (await profiles()).find((p) => p.name === name)
      expect(found, `no profile named "${name}"`).toBeTruthy()
      return found as Profile
    },
    api: async <T>(path: string, init?: ApiInit) => {
      const res = await callLocalApi<T>(page, path, init)
      expect(
        res.status < 300,
        `${init?.method ?? 'GET'} ${path} -> ${res.status} ${JSON.stringify(res.body)}`
      ).toBe(true)
      return res.body
    },
    rows: async <T>(entity: Entity, profileId: number) =>
      (await localRows<T & { profile_id?: number }>(page, ENTITIES[entity].store)).filter(
        (r) => Number(r.profile_id) === profileId
      ) as T[],
  }
}

/** `both` runs a case in each pass; `cloudOnly` and `localOnly` are for the C and L rows. */
export const cloudTest = test.extend<{ m: Mode }>({
  m: async ({ cloud }, use) => use(await cloudMode(cloud)),
})
export const localTest = test.extend<{ m: Mode; lw: LocalWorld }>({
  lw: async ({ local }, use) => use(local),
  m: async ({ local }, use) => use(await localMode(local)),
})
export const both = [
  ['cloud', cloudTest],
  ['local', localTest],
] as const

export { expect }
