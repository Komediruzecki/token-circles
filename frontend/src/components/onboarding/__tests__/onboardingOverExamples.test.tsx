/**
 * Setup in a local workspace whose profile is one of the demo's examples: after "Keep my data in
 * this browser only" over a browser that ran the demo, or "Run setup again" in the demo itself.
 *
 * The space step used to rename the profile it was on, so the person's space became Example Low
 * Income under a new name, with every example account, transaction and bill in it. Now it makes a
 * new profile and selects it, never renames an example, and asks whether the example profiles
 * stay: removed by default, through the path the Danger Zone deletes a profile with, once the
 * space is made. A removal that fails keeps the space and says where the examples can go.
 *
 * Run against the real local-first router on fake-indexeddb. `selectProfiles` does what App's
 * does with the stored selection and the current profile.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../../core/api'
import { getProfiles, setCurrentProfile, setProfiles, useAppState } from '../../../core/appStore'
import { confirmRequests, resolveConfirm } from '../../../core/confirmStore'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import { EXAMPLE_PROFILE_NAMES } from '../../../core/demoMode'
import {
  LOCAL_SETUP_PENDING_KEY,
  markLocalSetupPending,
  onboardingOpen,
  onboardingStep,
  setOnboardingOwner,
  skipOnboarding,
  startOnboarding,
} from '../../../core/onboardingStore'
import { getDB } from '../../../core/storage/idb'
import { setStorageMode } from '../../../core/storage/storageFactory'
import { removeToast, toasts } from '../../../core/toastStore'
import { EXAMPLES_NOT_REMOVED } from '../localOnly'
import type { Profile } from '../../../types/models'

let host: HTMLDivElement
let dispose: (() => void) | undefined
const selected: number[][] = []

/** App's selectProfiles, as far as setup needs it. */
function selectProfiles(ids: number[]): void {
  selected.push(ids)
  localStorage.setItem('selectedProfileIds', JSON.stringify(ids))
  localStorage.setItem('currentProfileId', String(ids[0]))
  const active = getProfiles().find((p) => p.id === ids[0])
  setCurrentProfile(active ? { ...active } : null)
}

const asProfile = (p: { id: number; name: string }) =>
  ({ ...p, created_at: '2026-01-01T00:00:00.000Z' }) as Profile

/** The demo's three profiles, each with an account, a category, a transaction and a bill. */
async function examplesWorkspace(): Promise<void> {
  const db = await getDB()
  for (const [i, name] of EXAMPLE_PROFILE_NAMES.entries()) {
    const id = i + 1
    await db.add('profiles', { id, name, created_at: '2026-01-01T00:00:00.000Z' })
    await db.add('accounts', { id, profile_id: id, name: 'Checking Account', balance: 100 })
    await db.add('categories', { id, profile_id: id, name: 'Groceries', type: 'expense' })
    await db.add('transactions', {
      id,
      profile_id: id,
      account_id: id,
      category_id: id,
      type: 'expense',
      amount: 12,
      date: '2026-10-01',
      description: 'Groceries',
    })
    await db.add('bills', { id, profile_id: id, name: 'Rent', amount: 600 })
    await db.put('settings', { key: `emergency_fund_config_${String(id)}`, value: '{}' })
  }
  const profiles = EXAMPLE_PROFILE_NAMES.map((name, i) => asProfile({ id: i + 1, name }))
  setProfiles(profiles)
  setCurrentProfile({ ...profiles[0] })
  localStorage.setItem('currentProfileId', '1')
}

/** Every row still filed on profiles 1 to 3, the examples. */
async function exampleRows(): Promise<string[]> {
  const db = await getDB()
  const left: string[] = []
  for (const store of Array.from(db.objectStoreNames)) {
    for (const row of (await db.getAll(store)) as Array<Record<string, unknown>>) {
      const pid = store === 'profiles' ? row.id : row.profile_id
      if (pid === 1 || pid === 2 || pid === 3) left.push(`${store} ${String(pid)}`)
      if (store === 'settings' && /_[123]$/.test(String(row.key))) left.push(String(row.key))
    }
  }
  return left
}

async function openSpaceStep() {
  startOnboarding('space')
  const { OnboardingWizard } = await import('../OnboardingWizard')
  dispose = render(() => <OnboardingWizard selectProfiles={selectProfiles} />, host)
  return vi.waitFor(() => {
    const input = host.querySelector<HTMLInputElement>('[data-test-id="onboarding-profile-name"]')
    expect(input).not.toBeNull()
    return input!
  })
}

function nameAndContinue(input: HTMLInputElement, name: string) {
  input.value = name
  input.dispatchEvent(new Event('input', { bubbles: true }))
  host
    .querySelector<HTMLFormElement>('[data-test-id="onboarding-space-form"]')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

const radio = (choice: 'remove' | 'keep') =>
  host.querySelector<HTMLInputElement>(`[data-test-id="onboarding-examples-${choice}"] input`)

beforeAll(async () => {
  await Promise.all([import('../OnboardingWizard'), import('../../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  setStorageMode('serverless')
  localStorage.setItem('finance_had_profiles', '1')
  localStorage.setItem('localCurrency', 'EUR')
  // The About this space screen is held back in production: the name screen goes straight on.
  vi.stubEnv('MODE', 'production')
  __resetDataVersionsForTest()
  setOnboardingOwner('local')
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await examplesWorkspace()
  for (const toast of toasts()) removeToast(toast.id)
  selected.length = 0
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  dispose?.()
  dispose = undefined
  host.remove()
  if (onboardingOpen()) skipOnboarding()
  setOnboardingOwner(null)
  setCurrentProfile(null)
  setProfiles([])
})

it('makes a new space over an example, selects it, and removes the examples by default', async () => {
  markLocalSetupPending()
  const name = await openSpaceStep()
  // An example's name is not offered for the person's space.
  expect(name.value).toBe('Personal Profile')
  const choice = host.querySelector('[data-test-id="onboarding-examples-choice"]')
  expect(choice?.textContent).toContain('The example profiles')
  expect(radio('remove')?.checked).toBe(true)
  expect(radio('keep')?.checked).toBe(false)
  expect(host.querySelector('[data-test-id="onboarding-examples-note"]')?.textContent).toBe(
    'Deletes Example Low Income, Example Mid Income and Example High Income and everything in them: accounts, transactions, bills and budgets.'
  )

  nameAndContinue(name, 'Our flat')
  await vi.waitFor(() => {
    expect(onboardingStep()).toBe('account')
  })

  const db = await getDB()
  const stored = (await db.getAll('profiles')) as Array<{ id: number; name: string }>
  expect(stored.map((p) => p.name)).toEqual(['Our flat'])
  const ours = stored[0].id
  expect(ours).toBeGreaterThan(3)
  expect(selected).toEqual([[ours]])
  expect(useAppState().currentProfile).toMatchObject({ id: ours, name: 'Our flat' })
  expect(getProfiles().map((p) => p.name)).toEqual(['Our flat'])
  expect(localStorage.getItem('currentProfileId')).toBe(String(ours))
  expect(JSON.parse(localStorage.getItem('selectedProfileIds') ?? '[]')).toEqual([ours])
  expect(await exampleRows()).toEqual([])
  expect(localStorage.getItem(LOCAL_SETUP_PENDING_KEY)).toBeNull()
  expect(toasts()).toEqual([])
})

it('keeps the examples when asked, beside the new space, and renames none of them', async () => {
  const name = await openSpaceStep()
  radio('keep')!.click()
  expect(host.querySelector('[data-test-id="onboarding-examples-note"]')?.textContent).toBe(
    'They stay in the profile switcher, beside your new space.'
  )
  nameAndContinue(name, 'Our flat')
  await vi.waitFor(() => {
    expect(onboardingStep()).toBe('account')
  })

  const db = await getDB()
  const stored = (await db.getAll('profiles')) as Array<{ id: number; name: string }>
  expect(stored.map((p) => p.name)).toEqual([...EXAMPLE_PROFILE_NAMES, 'Our flat'])
  const ours = stored[3].id
  expect(selected).toEqual([[ours]])
  expect(useAppState().currentProfile).toMatchObject({ id: ours, name: 'Our flat' })
  // Still in the switcher.
  expect(getProfiles().map((p) => p.name)).toEqual([...EXAMPLE_PROFILE_NAMES, 'Our flat'])
  expect(await db.getAllFromIndex('transactions', 'by_profile', 1)).toHaveLength(1)
})

it('keeps the new space and says where the examples can go when one will not go', async () => {
  const realDelete = api.deleteProfile.bind(api)
  vi.spyOn(api, 'deleteProfile').mockImplementation((id: number) =>
    id === 2 ? Promise.reject(new Error('blocked')) : realDelete(id)
  )
  const name = await openSpaceStep()
  nameAndContinue(name, 'Our flat')
  await vi.waitFor(() => {
    expect(onboardingStep()).toBe('account')
  })

  const db = await getDB()
  const stored = (await db.getAll('profiles')) as Array<{ id: number; name: string }>
  expect(stored.map((p) => p.name)).toEqual(['Example Mid Income', 'Our flat'])
  const ours = stored[1].id
  expect(useAppState().currentProfile).toMatchObject({ id: ours, name: 'Our flat' })
  expect(getProfiles().map((p) => p.name)).toEqual(['Example Mid Income', 'Our flat'])
  expect(toasts().map((t) => [t.message, t.type])).toEqual([[EXAMPLES_NOT_REMOVED, 'warning']])
  expect(EXAMPLES_NOT_REMOVED).toContain('Settings, under Exports, in the Danger Zone')
})

it("renames a profile of the person's own as before, and asks nothing about the examples", async () => {
  const db = await getDB()
  await db.add('profiles', { id: 4, name: 'Household', created_at: '2026-01-01T00:00:00.000Z' })
  setProfiles([...getProfiles(), asProfile({ id: 4, name: 'Household' })])
  setCurrentProfile(asProfile({ id: 4, name: 'Household' }))
  localStorage.setItem('currentProfileId', '4')

  const name = await openSpaceStep()
  expect(name.value).toBe('Household')
  expect(host.querySelector('[data-test-id="onboarding-examples-choice"]')).toBeNull()
  nameAndContinue(name, 'Our flat')
  await vi.waitFor(() => {
    expect(onboardingStep()).toBe('account')
  })
  expect(((await db.getAll('profiles')) as Array<{ name: string }>).map((p) => p.name)).toEqual([
    ...EXAMPLE_PROFILE_NAMES,
    'Our flat',
  ])
  expect(selected).toEqual([])
})

it('asks nothing about examples on an account, which has none', async () => {
  setStorageMode('self-hosted')
  const created = vi.spyOn(api, 'createProfile')
  const renamed = vi.spyOn(api, 'updateProfile').mockResolvedValue(undefined)
  const name = await openSpaceStep()
  expect(host.querySelector('[data-test-id="onboarding-examples-choice"]')).toBeNull()
  nameAndContinue(name, 'Our flat')
  await vi.waitFor(() => {
    expect(onboardingStep()).toBe('account')
  })
  expect(renamed).toHaveBeenCalledWith(1, 'Our flat')
  expect(created).not.toHaveBeenCalled()
})

it('says on the switch that the examples are here, before anything changes', async () => {
  setStorageMode('self-hosted')
  setCurrentProfile(null)
  setProfiles([])
  await openSpaceStep()
  host.querySelector<HTMLButtonElement>('[data-test-id="onboarding-local-only"]')!.click()
  await vi.waitFor(() => {
    expect(confirmRequests()).toHaveLength(1)
  })
  expect(confirmRequests()[0].message).toContain(
    'This browser has the example profiles from the demo.'
  )
  resolveConfirm(confirmRequests()[0].id, false)
  // Cancelled: still on the account, nothing marked.
  expect(localStorage.getItem('finance_storage_mode')).toBe('self-hosted')
  expect(localStorage.getItem(LOCAL_SETUP_PENDING_KEY)).toBeNull()
  expect(((await (await getDB()).getAll('profiles')) as unknown[]).length).toBe(3)
})

/** "Keep my data in this browser only" on an account's space step, confirmed, up to its reload. */
async function switchToLocalOnly(): Promise<{ question: string; reloads: () => number }> {
  let reloads = 0
  vi.stubGlobal('location', {
    reload: () => {
      reloads += 1
    },
    href: 'https://app.example.com/',
    pathname: '/',
    search: '',
    hash: '',
  } as unknown as Location)
  setStorageMode('self-hosted')
  setCurrentProfile(null)
  setProfiles([])
  // What the account's session left: its own profile selected.
  localStorage.setItem('currentProfileId', '77')
  localStorage.setItem('selectedProfileIds', '[77]')
  await openSpaceStep()
  host.querySelector<HTMLButtonElement>('[data-test-id="onboarding-local-only"]')!.click()
  await vi.waitFor(() => {
    expect(confirmRequests()).toHaveLength(1)
  })
  const question = confirmRequests()[0].message
  resolveConfirm(confirmRequests()[0].id, true)
  await vi.waitFor(() => {
    expect(reloads).toBe(1)
  })
  return { question, reloads: () => reloads }
}

it("opens the app on the person's own profile, not an example, when both are here", async () => {
  const db = await getDB()
  await db.add('profiles', { id: 4, name: 'Household', created_at: '2026-02-01T00:00:00.000Z' })
  await db.add('profiles', { id: 5, name: 'Side business', created_at: '2026-03-01T00:00:00.000Z' })

  const { question } = await switchToLocalOnly()

  expect(question).toContain('your profiles "Household" and "Side business". You carry on with it')
  expect(localStorage.getItem('finance_storage_mode')).toBe('serverless')
  // App opens on the stored profile when the workspace has it (loadProfiles): the oldest own one.
  expect(localStorage.getItem('currentProfileId')).toBe('4')
  expect(JSON.parse(localStorage.getItem('selectedProfileIds') ?? '[]')).toEqual([4])
})

it('leaves the selection for the app to pick over the examples alone, as before', async () => {
  const { question } = await switchToLocalOnly()

  expect(question).toContain('This browser has the example profiles from the demo.')
  expect(localStorage.getItem('finance_storage_mode')).toBe('serverless')
  expect(localStorage.getItem('currentProfileId')).toBeNull()
  expect(localStorage.getItem('selectedProfileIds')).toBeNull()
  expect(localStorage.getItem(LOCAL_SETUP_PENDING_KEY)).toBe('1')
})

/** The region chip checked on About this space, or null for none. */
const checkedRegion = () =>
  host
    .querySelector<HTMLInputElement>('[data-test-id="onboarding-space-region"] input:checked')
    ?.closest('[data-test-id]')
    ?.getAttribute('data-test-id') ?? null

/** A profile's stored guidance answers, as local-first files them (guidanceAnswers.ts). */
async function answersOf(profileId: number): Promise<Record<string, unknown> | null> {
  const row = (await (await getDB()).get('settings', `guidance:${String(profileId)}`)) as
    { value: string } | undefined
  return row ? (JSON.parse(row.value) as Record<string, unknown>) : null
}

it('asks About this space afresh over an example, and saves the answer on the new space', async () => {
  // About this space shows where the benchmarks do.
  vi.stubEnv('MODE', 'development')
  // The example the demo left on, with an answer of its own.
  await (
    await getDB()
  ).put('settings', { key: 'guidance:1', value: JSON.stringify({ region: 'DE' }) })
  const name = await openSpaceStep()
  radio('keep')!.click()
  nameAndContinue(name, 'Our flat')
  await vi.waitFor(() => {
    expect(host.querySelector('[data-test-id="onboarding-step-about"]')).not.toBeNull()
  })
  const ours = useAppState().currentProfile!.id
  expect(ours).toBeGreaterThan(3)

  // Nothing of the example's: the space is new.
  expect(checkedRegion()).toBeNull()

  host.querySelector<HTMLInputElement>('[data-test-id="onboarding-space-region-HR"] input')!.click()
  expect(checkedRegion()).toBe('onboarding-space-region-HR')
  host.querySelector<HTMLButtonElement>('[data-test-id="onboarding-next"]')!.click()
  await vi.waitFor(() => {
    expect(onboardingStep()).toBe('account')
  })

  expect(await answersOf(ours)).toMatchObject({ region: 'HR' })
  // The example kept, with its own answer untouched.
  expect(await answersOf(1)).toEqual({ region: 'DE' })
})
