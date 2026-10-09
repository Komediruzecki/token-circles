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
import { clashingProfileName, profileNameTaken } from '../../../shared/profileSchema'
import { refusalOf } from '../../../shared/refusal'
import {
  bumpProfileVersion,
  setCurrentProfile,
  setIsProfileModalOpen,
  setIsQuickAddOpen,
  setProfiles,
  setShowDropdown,
  useAppState,
} from '../core/appStore'
import { onboardingMirrorSettled, skipOnboarding, startOnboarding } from '../core/onboardingStore'
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
  /** The id the create answered with, whatever the storage mode numbered it. */
  createdId: null as number | null,
  /** When set, every read of the profile list after the create fails, as a dropped connection would. */
  failListAfterCreate: false,
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
      if (method === 'POST' && path === '/api/profiles') {
        await net.createHeld
        const res = await real.apiFetch(url, init)
        if (res.ok) net.createdId = ((await res.clone().json()) as { id: number }).id
        return res
      }
      if (method === 'GET' && path === '/api/profiles' && net.failListAfterCreate && net.createdId)
        return json({ error: 'Service unavailable' }, 503)
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
function workerStandIn(seed = SEED) {
  const profiles = seed.map((p) => ({ ...p }))
  return async (url: string, init: RequestInit = {}) => {
    const path = url.split('?')[0]
    if (path === '/api/auth/me') return json({ id: 1, username: 'owner', role: 'admin' })
    if (path === '/api/profiles' && init.method === 'POST') {
      const { name } = JSON.parse(init.body as string) as { name: string }
      const taken = clashingProfileName(profiles, name)
      if (taken !== null) return json(refusalOf(profileNameTaken(taken)), 400)
      const created = { id: profiles.length + 1, name, created_at: CREATED_AT }
      profiles.push(created)
      return json(created, 201)
    }
    if (path === '/api/profiles') return json(profiles)
    return json([])
  }
}

/** Local-first mode: the same two profiles, in IndexedDB. */
async function seedLocalProfiles(seed = SEED) {
  const { getDB } = await import('../core/storage/idb')
  const db = await getDB()
  await db.clear('profiles')
  for (const profile of seed) await db.put('profiles', { ...profile })
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
  net.createdId = null
  net.failListAfterCreate = false
  // The store outlives each mount; start every test from a closed sidebar and an empty list.
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

/** Mount the app signed in, to a workspace with no profile at all: a new account's first run. */
async function mountEmptyApp(mode: StorageMode) {
  localStorage.setItem('finance_storage_mode', mode)
  localStorage.setItem('finance_onboarding', 'skipped')
  // Local-first seeds demo profiles into an empty store only on a device's first run.
  localStorage.setItem('finance_had_profiles', '1')
  if (mode === 'serverless') await seedLocalProfiles([])
  else vi.stubGlobal('fetch', workerStandIn([]))

  const { App } = await import('../App')
  dispose = render(() => <App />, host)
  await vi.waitFor(() => {
    expect(net.sent.some((r) => r.method === 'GET' && r.path === '/api/profiles')).toBe(true)
  }, waitLong)
  await settle()
}

/** The sidebar's profile button, which names the active profile, or every selected one. */
const header = () => byTestId('profile-dropdown-btn')!.textContent ?? ''

/** The profiles the sidebar dropdown has ticked. */
const tickedProfiles = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-profile-id]'))
    .filter((row) => row.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked)
    .map((row) => Number(row.dataset.profileId))

/** Open the sidebar dropdown, then click outside it, which applies what it holds. */
async function openAndClickAway() {
  byTestId('profile-dropdown-btn')!.click()
  await settle()
  expect(state.showDropdown).toBe(true)
  document.body.click()
  await settle()
  expect(state.showDropdown).toBe(false)
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

    // What the bump is for: what reads next reads for the new profile only. App's quick-entry
    // category list is one of those reads; it reads when a quick entry opens.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    await settle()
    const lastCategoryRead = net.sent.filter((r) => r.path === '/api/categories').at(-1)
    expect(lastCategoryRead?.headers['X-Profile-Id']).toBe(String(travel.id))
    // Asked for the active profile alone, or for a household of just that profile.
    expect([undefined, JSON.stringify([travel.id])]).toContain(
      lastCategoryRead?.headers['X-Profile-Ids']
    )
  })

  it('stays selected after the next click outside the sidebar dropdown', async () => {
    await mountApp(mode)
    const input = await openCreateModal('Travel')

    // Enter submits without a click, so nothing closes the dropdown on the way. Enter in a form's
    // field is the browser submitting the form, which jsdom leaves to requestSubmit.
    input.form!.requestSubmit()
    const travel = await createFinished('Travel')
    // Choosing the new profile closes the dropdown, the same as choosing any other profile does.
    expect(state.showDropdown).toBe(false)

    // A dropdown left open re-applies the selection it holds when a click lands outside it.
    document.body.click()
    await settle()

    expect(localStorage.getItem('currentProfileId')).toBe(String(travel.id))
    expect(JSON.parse(localStorage.getItem('selectedProfileIds')!)).toEqual([travel.id])
    expect(state.currentProfile?.id).toBe(travel.id)
  })

  it('moves nothing when the create is refused', async () => {
    await mountApp(mode)
    const input = await openCreateModal('Family')
    const versionBefore = state.profileVersion

    // Enter, so that no click outside the dropdown re-applies the selection on the way.
    input.form!.requestSubmit()
    await vi.waitFor(() => {
      expect(byTestId('profile-modal')?.textContent).toContain(
        'You already have a profile called "Family". Choose another name.'
      )
    }, waitLong)
    await settle()

    expect(localStorage.getItem('currentProfileId')).toBe('1')
    expect(JSON.parse(localStorage.getItem('selectedProfileIds')!)).toEqual([1])
    expect(state.currentProfile?.id).toBe(1)
    expect(state.profileVersion).toBe(versionBefore)
  })

  it('stays consistent when the profile list cannot be read after the create', async () => {
    await mountApp(mode)
    await openCreateModal('Travel')
    net.failListAfterCreate = true
    const versionBefore = state.profileVersion

    byTestId('profile-create-submit')!.click()
    await vi.waitFor(() => {
      expect(net.createdId).not.toBeNull()
      expect(byTestId('profile-modal')).toBeNull()
    }, waitLong)
    await settle()
    const created = net.createdId!

    // The profile exists, so writes and household reads both go to it...
    expect(localStorage.getItem('currentProfileId')).toBe(String(created))
    expect(JSON.parse(localStorage.getItem('selectedProfileIds')!)).toEqual([created])
    expect(state.profileVersion).toBeGreaterThan(versionBefore)
    // ...the header names it, from the row the create answered with, and the profiles already
    // listed stay listed. A failed read used to empty the list: "Not Logged In", no profiles.
    expect(state.currentProfile?.id).toBe(created)
    expect(header()).toContain('Travel')
    expect(state.profiles.map((p) => p.name)).toEqual(['Personal', 'Family', 'Travel'])
    expect(tickedProfiles()).toEqual([created])
  })
})

describe.each(['serverless', 'self-hosted'] as const)(
  'a household changed in Settings, in %s mode',
  (mode) => {
    it('shows in the sidebar, and a click outside the dropdown does not undo it', async () => {
      await mountApp(mode)

      // What Settings > Household does when a profile is ticked: store the household, then bump.
      localStorage.setItem('selectedProfileIds', JSON.stringify([1, 2]))
      bumpProfileVersion()
      await settle()

      expect(header()).toContain('Personal & Family')
      expect(tickedProfiles()).toEqual([1, 2])

      // The sidebar used to keep [1], and closing its dropdown wrote that back.
      await openAndClickAway()
      expect(JSON.parse(localStorage.getItem('selectedProfileIds')!)).toEqual([1, 2])
      expect(localStorage.getItem('currentProfileId')).toBe('1')
      expect(state.currentProfile?.id).toBe(1)
    })

    it('waits while the dropdown is open, whose ticks are applied when it closes', async () => {
      await mountApp(mode)
      byTestId('profile-dropdown-btn')!.click()
      await settle()
      // Tick Family in the dropdown; nothing is applied until it closes.
      const family = document.querySelector<HTMLInputElement>(
        '[data-profile-id="2"] input[type="checkbox"]'
      )!
      family.click()
      await settle()
      expect(tickedProfiles()).toEqual([1, 2])

      // Anything that bumps meanwhile must not reset the ticks to the stored [1].
      bumpProfileVersion()
      await settle()
      expect(tickedProfiles()).toEqual([1, 2])

      document.body.click()
      await settle()
      expect(JSON.parse(localStorage.getItem('selectedProfileIds')!)).toEqual([1, 2])
    })
  }
)

describe.each(['serverless', 'self-hosted'] as const)(
  'the setup wizard creating the first profile, in %s mode',
  (mode) => {
    it('selects it the way the sidebar does, and a click outside the dropdown keeps it', async () => {
      await mountEmptyApp(mode)
      startOnboarding('space')
      const name = await vi.waitFor(() => {
        const el = byTestId('onboarding-profile-name') as HTMLInputElement | null
        expect(el).not.toBeNull()
        return el!
      }, waitLong)
      name.value = 'Home'
      name.dispatchEvent(new Event('input', { bubbles: true }))
      byTestId('onboarding-next')!.click()
      await vi.waitFor(() => {
        expect(byTestId('onboarding-step-account')).not.toBeNull()
      }, waitLong)
      await settle()
      const home = state.profiles.find((p) => p.name === 'Home')!

      expect(localStorage.getItem('currentProfileId')).toBe(String(home.id))
      expect(JSON.parse(localStorage.getItem('selectedProfileIds')!)).toEqual([home.id])
      expect(state.currentProfile?.id).toBe(home.id)
      // The sidebar's own copy of the selection moved too. It used to stay empty...
      expect(tickedProfiles()).toEqual([home.id])

      skipOnboarding()
      await onboardingMirrorSettled()
      await settle()
      // ...and closing the dropdown wrote the empty selection back over the stored one.
      await openAndClickAway()
      expect(JSON.parse(localStorage.getItem('selectedProfileIds')!)).toEqual([home.id])
      expect(state.currentProfile?.id).toBe(home.id)
    })
  }
)

describe('signing out of cloud mode', () => {
  it('drops the signed-out account’s profile list', async () => {
    // A failed read of the list no longer empties it, so nothing else would before another
    // account signs in on this tab.
    await mountApp('self-hosted')
    expect(state.profiles.map((p) => p.name)).toEqual(['Personal', 'Family'])

    document.querySelector<HTMLButtonElement>('button[title="Logout"]')!.click()

    await vi.waitFor(() => {
      expect(state.profiles).toEqual([])
    }, waitLong)
  })
})
