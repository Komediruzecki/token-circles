/**
 * Creating a profile from the sidebar makes it the active profile everywhere, not just in the header.
 *
 * WHY THIS TEST EXISTS. Three values say which profile the user is in: `currentProfileId` is where a
 * write lands (X-Profile-Id), `selectedProfileIds` is what a household read returns
 * (X-Profile-Ids), and `profileVersion` is what makes the open pages read again. The sidebar's
 * "Create profile" modal moved only some of them. In local-first mode the IndexedDB adapter points
 * `currentProfileId` at the new profile and App showed it as active, but the selection stayed on
 * the old profile and nothing bumped `profileVersion`. The pages kept the old profile's data, and
 * new rows went to a profile those reads did not ask for. That is the split-brain behind "I created
 * it, it said success, and it is nowhere" (#575, #577). In cloud mode the create goes straight to
 * the Worker, so nothing moved `currentProfileId` and the new profile was not selected at all.
 *
 * Both storage modes run against the real App. Local-first goes through the real local router and
 * IndexedDB adapter; cloud mode goes to a stand-in Worker, because that is the network.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  setCurrentProfile,
  setIsProfileModalOpen,
  setProfiles,
  setShowDropdown,
  useAppState,
} from '../core/appStore'
import type { apiFetch as ApiFetch } from '../core/apiFetch'
import type { StorageMode } from '../core/storage/storageFactory'

interface SentRequest {
  method: string
  path: string
  headers: Record<string, string>
}

const net = vi.hoisted(() => ({
  sent: [] as SentRequest[],
  /** The create's response waits on this, so the test controls when the create finishes. */
  createHeld: Promise.resolve(),
}))

// Record every request the app makes, with the profile headers it carried, then send it on as
// normal. Holding the create back separates what the create caused from what the click on the
// modal's own button caused: that click also closes the sidebar dropdown, which re-reads.
vi.mock('../core/apiFetch', async (importOriginal) => {
  const real = await importOriginal<{ apiFetch: typeof ApiFetch }>()
  return {
    ...real,
    apiFetch: async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const path = url.split('?')[0]
      net.sent.push({ method, path, headers: { ...(init.headers as Record<string, string>) } })
      if (method === 'POST' && path === '/api/profiles') await net.createHeld
      return real.apiFetch(url, init)
    },
  }
})

// The pages are not under test, and the real Dashboard would cost more to load than all of this.
vi.mock('../router', () => ({ pages: { dashboard: () => null } }))

const CREATED_AT = '2026-01-01T00:00:00.000Z'
const SEED = [
  { id: 1, name: 'Personal', created_at: CREATED_AT },
  { id: 2, name: 'Family', created_at: CREATED_AT },
]

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Cloud mode's Worker: two profiles, a create that adds one, and nothing else stored. */
function workerStandIn() {
  const profiles = SEED.map((p) => ({ ...p }))
  return async (url: string, init: RequestInit = {}) => {
    const path = url.split('?')[0]
    if (path === '/api/auth/me') return json({ id: 1, username: 'owner', role: 'admin' })
    if (path === '/api/profiles' && init.method === 'POST') {
      const { name } = JSON.parse(init.body as string) as { name: string }
      const created = { id: profiles.length + 1, name, created_at: CREATED_AT }
      profiles.push(created)
      return json(created, 201)
    }
    if (path === '/api/profiles') return json(profiles)
    return json([])
  }
}

/** Local-first mode: the same two profiles, in IndexedDB. */
async function seedLocalProfiles() {
  const { getDB } = await import('../core/storage/idb')
  const db = await getDB()
  await db.clear('profiles')
  for (const profile of SEED) await db.put('profiles', { ...profile })
}

const state = useAppState()
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-test-id="${id}"]`)
const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  for (let i = 0; i < 6; i++) await flush()
}
const waitLong = { timeout: 10_000 }

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  // Pay for the App import once, outside any one test's time budget.
  await import('../App')
}, 120_000)

beforeEach(() => {
  localStorage.clear()
  net.sent.length = 0
  net.createHeld = Promise.resolve()
  // The store outlives each mount; start every test from a closed sidebar and an empty list.
  setShowDropdown(false)
  setIsProfileModalOpen(false)
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

/** Mount the app signed in, in profile 1 with only profile 1 selected. */
async function mountApp(mode: StorageMode) {
  localStorage.setItem('finance_storage_mode', mode)
  localStorage.setItem('finance_onboarding', 'skipped')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', JSON.stringify([1]))
  if (mode === 'serverless') await seedLocalProfiles()
  else vi.stubGlobal('fetch', workerStandIn())

  const { App } = await import('../App')
  dispose = render(() => <App />, host)
  await vi.waitFor(() => {
    expect(state.currentProfile?.id).toBe(1)
  }, waitLong)
}

/** Open the sidebar dropdown, choose "Create profile" and type a name, without submitting. */
async function openCreateModal(name: string): Promise<HTMLInputElement> {
  byTestId('profile-dropdown-btn')!.click()
  byTestId('profile-create-item')!.click()
  const input = await vi.waitFor(() => {
    const el = byTestId('profile-name-input') as HTMLInputElement | null
    expect(el).not.toBeNull()
    return el!
  }, waitLong)
  input.value = name
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return input
}

/** Wait until the create has finished and App has handled its result. */
async function createFinished(name: string) {
  await vi.waitFor(() => {
    expect(byTestId('profile-modal')).toBeNull()
    expect(state.profiles.map((p) => p.name)).toContain(name)
  }, waitLong)
  await settle()
  return state.profiles.find((p) => p.name === name)!
}

describe.each(['serverless', 'self-hosted'] as const)('creating a profile in %s mode', (mode) => {
  it('makes it where writes land, what reads return and what the header shows', async () => {
    await mountApp(mode)
    await openCreateModal('Travel')

    let releaseCreate!: () => void
    net.createHeld = new Promise((resolve) => (releaseCreate = resolve))
    byTestId('profile-create-submit')!.click()
    await settle()
    const versionBeforeCreateFinished = state.profileVersion
    releaseCreate()
    const travel = await createFinished('Travel')

    expect(localStorage.getItem('currentProfileId')).toBe(String(travel.id))
    expect(JSON.parse(localStorage.getItem('selectedProfileIds')!)).toEqual([travel.id])
    expect(state.currentProfile?.id).toBe(travel.id)
    expect(state.profileVersion).toBeGreaterThan(versionBeforeCreateFinished)

    // What the bump is for: the open pages read again, for the new profile only. App's quick-add
    // category list is one of those reads.
    const lastCategoryRead = net.sent.filter((r) => r.path === '/api/categories').at(-1)
    expect(lastCategoryRead?.headers).toMatchObject({
      'X-Profile-Id': String(travel.id),
      'X-Profile-Ids': JSON.stringify([travel.id]),
    })
  })

  it('stays selected after the next click outside the sidebar dropdown', async () => {
    await mountApp(mode)
    const input = await openCreateModal('Travel')

    // Enter submits without a click, so nothing closes the dropdown on the way.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    const travel = await createFinished('Travel')

    // A dropdown left open re-applies the selection it holds when a click lands outside it.
    document.body.click()
    await settle()

    expect(localStorage.getItem('currentProfileId')).toBe(String(travel.id))
    expect(JSON.parse(localStorage.getItem('selectedProfileIds')!)).toEqual([travel.id])
    expect(state.currentProfile?.id).toBe(travel.id)
  })
})
