/**
 * The quick entries offer what an entry can be filed under: the active profile's categories and
 * accounts, as they stand when the entry is made.
 *
 * WHY THIS TEST EXISTS. Reported on dev (main 229e324b, local-first demo, on a phone), 2026-10-07:
 *
 * 1. A new profile, a category made on Budgets, then the floating + on Transactions: 50, expense,
 *    Next, and the Guided Orbit said there were no categories.
 * 2. After a reload, a switch to that profile showed its one category on the Categories page, but
 *    the orb offered the predefined categories of the profile it had last been opened on.
 *
 * App kept one copy of the categories for both quick entries. It read the household
 * (`selectedProfileIds`) while an entry is written to the active profile (`currentProfileId`), it
 * kept the previous list whenever a read failed (and in local-first every read failed once a
 * category had been made on a page), it showed the old list while the new one loaded, and an older
 * answer could land after a newer one. A pick from the wrong profile was refused by the save:
 * "Failed to save entry". The accounts both quick entries offer had the same household scope.
 *
 * Both storage modes run against the real App, the real Guided Orbit and command bar. Local-first
 * goes through the real local router and IndexedDB; cloud mode goes to a stand-in Worker that
 * scopes reads and refuses foreign ids the way the real one does.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  setCurrentProfile,
  setIsProfileModalOpen,
  setIsQuickAddOpen,
  setProfiles,
  setShowDropdown,
  useAppState,
} from '../core/appStore'
import type { apiFetch as ApiFetch } from '../core/apiFetch'
import type { StorageMode } from '../core/storage/storageFactory'

interface SentRequest {
  method: string
  path: string
  /** Lower-cased names: the typed client sends a plain object, the raw helpers a Headers. */
  headers: Record<string, string>
  body?: Record<string, unknown>
}

const net = vi.hoisted(() => ({
  sent: [] as SentRequest[],
  /** A category read made for one of these active profiles waits until its promise settles. */
  heldCategoryReads: new Map<number, Promise<void>>(),
  /** A category read made for one of these active profiles fails, as a dropped connection does. */
  failingCategoryReads: new Set<number>(),
}))

// Record every request with the profile headers it carried, and hold or fail category reads on
// cue. Everything else goes on to the real apiFetch: the local router, or the stand-in Worker.
vi.mock('../core/apiFetch', async (importOriginal) => {
  const real = await importOriginal<{ apiFetch: typeof ApiFetch }>()
  return {
    ...real,
    apiFetch: async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const path = url.split('?')[0]
      const headers = Object.fromEntries(new Headers(init.headers).entries())
      const body =
        typeof init.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined
      net.sent.push({ method, path, headers, body })
      if (method === 'GET' && path === '/api/categories') {
        const forProfile = Number(headers['x-profile-id'])
        const held = net.heldCategoryReads.get(forProfile)
        if (held) await held
        if (net.failingCategoryReads.has(forProfile)) return json({ error: 'Unavailable' }, 503)
      }
      return real.apiFetch(url, init)
    },
  }
})

// The pages are not under test.
vi.mock('../router', () => ({ pages: { dashboard: () => null } }))

const CREATED_AT = '2026-01-01T00:00:00.000Z'
const PROFILES = [
  { id: 1, name: 'Personal', created_at: CREATED_AT },
  { id: 2, name: 'Family', created_at: CREATED_AT },
  { id: 3, name: 'Test', created_at: CREATED_AT },
]
const category = (id: number, name: string, type: 'income' | 'expense', profileId: number) => ({
  id,
  name,
  type,
  color: '#6e9bff',
  icon: 'tag',
  parent_id: null,
  tax_deductible: false,
  created_at: CREATED_AT,
  profile_id: profileId,
})
const CATEGORIES = [
  category(11, 'Groceries', 'expense', 1),
  category(12, 'Salary', 'income', 1),
  category(21, 'Eating out', 'expense', 2),
  category(22, 'Fuel', 'expense', 2),
]
const account = (id: number, name: string, profileId: number) => ({
  id,
  name,
  type: 'giro',
  currency: 'EUR',
  balance: 0,
  starting_balance: 0,
  notes: '',
  profile_id: profileId,
})
const ACCOUNTS = [account(31, 'Main', 1), account(41, 'Joint', 2)]

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/**
 * Cloud mode's Worker: categories scoped the way getProfileIds scopes them (the household when
 * X-Profile-Ids is sent), accounts to the active profile only, foreign ids refused on a save.
 */
function workerStandIn() {
  const categories = CATEGORIES.map((c) => ({ ...c }))
  const accounts = ACCOUNTS.map((a) => ({ ...a }))
  let nextId = 100
  return async (url: string, init: RequestInit = {}) => {
    const path = url.split('?')[0]
    const method = init.method ?? 'GET'
    const headers = new Headers(init.headers)
    const active = Number(headers.get('X-Profile-Id') ?? 1)
    const household = headers.get('X-Profile-Ids')
    const scope = household ? (JSON.parse(household) as number[]) : [active]
    const body =
      typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    if (path === '/api/auth/me') return json({ id: 1, username: 'owner', role: 'admin' })
    if (path === '/api/profiles') return json(PROFILES)
    if (path === '/api/categories' && method === 'GET')
      return json(categories.filter((c) => scope.includes(c.profile_id)))
    if (path === '/api/categories' && method === 'POST') {
      const row = {
        ...category(nextId++, String(body.name), body.type as 'expense', active),
        icon: (body.icon as string | null) || 'tag',
      }
      categories.push(row)
      return json(row, 201)
    }
    // The Worker lists only the active profile's accounts, whatever X-Profile-Ids says.
    if (path === '/api/accounts' && method === 'GET')
      return json(accounts.filter((a) => a.profile_id === active))
    if (path === '/api/transactions' && method === 'POST') {
      const own = (rows: { id: number; profile_id: number }[], id: unknown) =>
        id === null || id === undefined || rows.some((r) => r.id === id && r.profile_id === active)
      if (!own(categories, body.category_id))
        return json({ error: 'Category does not belong to this profile' }, 403)
      if (!own(accounts, body.account_id))
        return json({ error: 'Account does not belong to this profile' }, 403)
      return json(
        {
          id: nextId++,
          ...body,
          created_at: CREATED_AT,
          updated_at: CREATED_AT,
          profile_id: active,
        },
        201
      )
    }
    return json([])
  }
}

/** Local-first mode: the same profiles, categories and accounts, in IndexedDB. */
async function seedLocal() {
  const { getDB } = await import('../core/storage/idb')
  const db = await getDB()
  for (const store of ['profiles', 'categories', 'accounts', 'transactions'] as const) {
    await db.clear(store)
  }
  for (const p of PROFILES) await db.put('profiles', { ...p })
  for (const c of CATEGORIES) await db.put('categories', { ...c } as never)
  for (const a of ACCOUNTS) await db.put('accounts', { ...a } as never)
}

const state = useAppState()
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-test-id="${id}"]`)
const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  for (let i = 0; i < 8; i++) await flush()
}
const waitLong = { timeout: 10_000 }

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await import('../App')
}, 120_000)

beforeEach(() => {
  localStorage.clear()
  net.sent.length = 0
  net.heldCategoryReads.clear()
  net.failingCategoryReads.clear()
  setShowDropdown(false)
  setIsProfileModalOpen(false)
  setIsQuickAddOpen(false)
  setProfiles([])
  setCurrentProfile(null)
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
  localStorage.clear()
})

async function mountApp(mode: StorageMode, current: number, selected: number[] = [current]) {
  localStorage.setItem('finance_storage_mode', mode)
  localStorage.setItem('finance_onboarding', 'skipped')
  localStorage.setItem('finance_had_profiles', '1')
  localStorage.setItem('currentProfileId', String(current))
  localStorage.setItem('selectedProfileIds', JSON.stringify(selected))
  if (mode === 'serverless') await seedLocal()
  else vi.stubGlobal('fetch', workerStandIn())

  const { App } = await import('../App')
  dispose = render(() => <App />, host)
  await vi.waitFor(() => {
    expect(state.currentProfile?.id).toBe(current)
  }, waitLong)
  await settle()
}

// ---- The Guided Orbit (the floating + button) -----------------------------------------------

const orb = () =>
  document.querySelector<HTMLElement>('[role="dialog"][aria-label="Add transaction"]')!
const orbButton = (name: string) =>
  Array.from(orb().querySelectorAll('button')).find(
    (b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name
  )

/** Tap the floating +, key in an amount and go on to the category step. */
async function openOrbAtCategories(amount = '50') {
  document.querySelector<HTMLButtonElement>('button[aria-label="Quick add entry"]')!.click()
  await settle()
  for (const digit of amount) orbButton(digit)!.click()
  orbButton('Next')!.click()
  await settle()
}

/** The category chips the orb is offering right now. */
const offered = () =>
  Array.from(orb().querySelectorAll<HTMLElement>('[class*="catChip"]')).map((b) =>
    b.textContent!.trim()
  )

async function closeOrb() {
  orbButton('Close')!.click()
  await settle()
}

/** Pick a chip and land on the confirm step. */
async function pickCategory(name: string) {
  Array.from(orb().querySelectorAll<HTMLElement>('[class*="catChip"]'))
    .find((b) => b.textContent!.trim() === name)!
    .click()
  await settle()
}

/** The confirm step's button, "Add" and the amount in the local currency. */
const addButton = () =>
  Array.from(orb().querySelectorAll('button')).find((b) =>
    /^Add /.test(b.textContent?.trim() ?? '')
  )

const transactionPosts = () =>
  net.sent.filter((r) => r.method === 'POST' && r.path === '/api/transactions')

// ---- The sidebar ------------------------------------------------------------------------------

async function switchProfile(id: number) {
  byTestId('profile-dropdown-btn')!.click()
  await settle()
  document.querySelector<HTMLElement>(`[data-profile-id="${id}"] span`)!.click()
  await settle()
  expect(localStorage.getItem('currentProfileId')).toBe(String(id))
}

// ---- The command bar (Ctrl/Cmd+K) -------------------------------------------------------------

/** Ctrl+K and an entry typed in. */
async function openCommandBar(text: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
  await settle()
  const bar = document.querySelector<HTMLElement>('[aria-label="Quick entry command bar"]')!
  const input = bar.querySelector<HTMLInputElement>('input[aria-label="Quick entry"]')!
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
  const select = bar.querySelector<HTMLSelectElement>('select[aria-label="Category"]')!
  return { input, select }
}

/** The category chip's options, and the one it has picked. */
const optionNames = (select: HTMLSelectElement) =>
  Array.from(select.options).map((o) => o.textContent)
const picked = (select: HTMLSelectElement) => select.options[select.selectedIndex]?.textContent

describe.each(['serverless', 'self-hosted'] as const)('quick entry in %s mode', (mode) => {
  it('offers the active profile’s categories, not the rest of the household’s', async () => {
    // Settings > Household with Family ticked as well: reads cover both, entries go to Personal.
    await mountApp(mode, 1, [1, 2])

    await openOrbAtCategories()

    expect(offered()).toEqual(['Groceries'])
  })

  it('offers the active profile’s accounts, not the rest of the household’s', async () => {
    await mountApp(mode, 1, [1, 2])
    await openOrbAtCategories()
    await pickCategory('Groceries')

    // One account to offer, so nothing to cycle through.
    expect(orb().textContent).toContain('Main')
    expect(orb().textContent).not.toContain('tap to change')
  })

  it('offers a category made elsewhere the next time it opens', async () => {
    await mountApp(mode, 3)
    await openOrbAtCategories()
    expect(orb().textContent).toContain('No expense categories yet')
    await closeOrb()

    // What Budgets sends: an icon typed in, no tax_deductible.
    const { apiPost } = await import('../core/api')
    await apiPost('/api/categories', {
      name: 'Food',
      type: 'expense',
      color: '#6e9bff',
      icon: 'food',
    })
    await settle()

    await openOrbAtCategories()
    expect(offered()).toEqual(['Food'])
  })

  it('never shows the previous profile’s categories after a switch, and says it is loading', async () => {
    await mountApp(mode, 1)
    await openOrbAtCategories()
    expect(offered()).toEqual(['Groceries'])
    await closeOrb()

    let release!: () => void
    net.heldCategoryReads.set(2, new Promise((r) => (release = r)))
    await switchProfile(2)
    await openOrbAtCategories()

    expect(offered()).toEqual([])
    expect(orb().textContent).toContain('Loading your categories')
    expect(orb().textContent).not.toContain('No expense categories yet')

    release()
    await vi.waitFor(() => {
      expect(offered()).toEqual(['Eating out', 'Fuel'])
    }, waitLong)
  })

  it('says it is loading the first time, instead of claiming there are no categories', async () => {
    let release!: () => void
    net.heldCategoryReads.set(1, new Promise((r) => (release = r)))
    await mountApp(mode, 1)

    await openOrbAtCategories()

    expect(orb().textContent).toContain('Loading your categories')
    expect(orb().textContent).not.toContain('No expense categories yet')
    release()
    await vi.waitFor(() => {
      expect(offered()).toEqual(['Groceries'])
    }, waitLong)
  })

  it('keeps the newest answer when an older one arrives after it', async () => {
    await mountApp(mode, 1)
    let releaseFamily!: () => void
    net.heldCategoryReads.set(2, new Promise((r) => (releaseFamily = r)))

    // Family's read is still out when the person switches back to Personal and opens again.
    await switchProfile(2)
    await openOrbAtCategories()
    await closeOrb()
    await switchProfile(1)
    await openOrbAtCategories()
    expect(offered()).toEqual(['Groceries'])

    releaseFamily()
    await settle()
    await settle()

    expect(offered()).toEqual(['Groceries'])
  })

  it('says a failed read failed, rather than offering another profile’s categories', async () => {
    await mountApp(mode, 1)
    await openOrbAtCategories()
    expect(offered()).toEqual(['Groceries'])
    await closeOrb()

    net.failingCategoryReads.add(2)
    await switchProfile(2)
    await openOrbAtCategories()

    expect(offered()).toEqual([])
    expect(orb().textContent).not.toContain('No expense categories yet')
    expect(orbButton('Try again')).toBeDefined()

    net.failingCategoryReads.delete(2)
    orbButton('Try again')!.click()
    await vi.waitFor(() => {
      expect(offered()).toEqual(['Eating out', 'Fuel'])
    }, waitLong)
  })

  it('never sends a category from another profile to the save', async () => {
    await mountApp(mode, 1)
    await openOrbAtCategories()
    await pickCategory('Groceries')

    // Another tab switches to Family while this one sits on the confirm step: the save would be
    // filed under Family, with Personal's category.
    localStorage.setItem('currentProfileId', '2')
    localStorage.setItem('selectedProfileIds', JSON.stringify([2]))
    addButton()!.click()
    await settle()

    expect(transactionPosts()).toEqual([])
    await vi.waitFor(() => {
      expect(offered()).toEqual(['Eating out', 'Fuel'])
    }, waitLong)
  })

  it('files an entry under the active profile with its own category and account', async () => {
    await mountApp(mode, 1, [1, 2])
    await openOrbAtCategories()
    await pickCategory('Groceries')

    addButton()!.click()
    await vi.waitFor(() => {
      expect(transactionPosts()).toHaveLength(1)
    }, waitLong)

    const [save] = transactionPosts()
    expect(save.headers['x-profile-id']).toBe('1')
    expect(save.body).toMatchObject({ category_id: 11, account_id: 31, amount: 50 })
  })

  it('the command bar matches only the active profile’s categories', async () => {
    await mountApp(mode, 1, [1, 2])

    const { select } = await openCommandBar('dinner 12 eating')

    expect(optionNames(select)).not.toContain('Eating out')
    expect(optionNames(select)).toContain('Groceries')
    expect(picked(select)).not.toBe('Eating out')
  })

  it('the command bar never sends a category from another profile to the save', async () => {
    await mountApp(mode, 1)
    const { input, select } = await openCommandBar('coffee 5 groceries')
    expect(picked(select)).toBe('Groceries')

    // Another tab switches to Family before Enter: the save would be filed under Family, with
    // Personal's category.
    localStorage.setItem('currentProfileId', '2')
    localStorage.setItem('selectedProfileIds', JSON.stringify([2]))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()

    expect(transactionPosts()).toEqual([])
    await vi.waitFor(() => {
      expect(optionNames(select)).toContain('Eating out')
    }, waitLong)
    expect(picked(select)).not.toBe('Groceries')
  })
})
