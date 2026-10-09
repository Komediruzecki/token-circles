/**
 * Settings > Household view: renaming a profile, against the real local-first router on
 * fake-indexeddb.
 *
 * The rename was an input with no label, inside the row's checkbox label, and its refusals were
 * the runtime's sentence in a toast: local-first stored any name at all, and a name taken in cloud
 * mode was "A profile with this name already exists". A save reloaded the whole page.
 *
 * Now the field has a label, the name is checked with the rules both runtimes run
 * (shared/profileSchema.ts) and marked under the field in their words, a name the runtime refuses
 * is marked the same way, and a save renames the profile in the list and the sidebar in place.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROFILE_MESSAGES as M } from '../../../../shared/profileSchema'
import { setCurrentProfile, setProfiles, useAppState } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setSettingsTab } from '../../core/settingsStore'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'
import type { apiFetch as ApiFetch } from '../../core/apiFetch'

const net = vi.hoisted(() => ({ sent: [] as string[] }))

vi.mock('../../core/apiFetch', async (importOriginal) => {
  const real = await importOriginal<{ apiFetch: typeof ApiFetch }>()
  return {
    ...real,
    apiFetch: async (url: string, init: RequestInit = {}) => {
      // The writes to profiles: the page also settles its base currency when it opens.
      const method = init.method ?? 'GET'
      const path = url.split('?')[0]!
      if (method !== 'GET' && path.startsWith('/api/profiles')) net.sent.push(`${method} ${path}`)
      return real.apiFetch(url, init)
    },
  }
})

const LONG = 'Weekend house by the lake '.repeat(5).trim()
const state = useAppState()

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../Settings'), import('../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  const profiles = [
    { id: 1, name: 'Household', created_at: '2026-01-01T00:00:00.000Z' },
    { id: 2, name: 'Side business', created_at: '2026-01-02T00:00:00.000Z' },
    { id: 3, name: LONG, created_at: '2026-01-03T00:00:00.000Z' },
  ]
  for (const profile of profiles) await db.add('profiles', profile)
  setProfiles(profiles)
  setCurrentProfile(profiles[1]!)
  for (const toast of toasts()) removeToast(toast.id)
  net.sent.length = 0
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
})

async function openHousehold(lastId = 3): Promise<void> {
  setSettingsTab('exports')
  const { default: Settings } = await import('../Settings')
  dispose = render(() => <Settings />, host)
  await vi.waitFor(() => {
    expect(row(lastId)).not.toBeNull()
  })
}

const row = (id: number) =>
  host.querySelector<HTMLElement>(`[data-test-id="household-profile-${id}"]`)
const input = () => host.querySelector<HTMLInputElement>('[data-test-id="household-rename-input"]')
const save = () => input()!.form!.querySelector<HTMLButtonElement>('button[type="submit"]')!
const cancel = () =>
  Array.from(input()!.form!.querySelectorAll('button')).find((b) => b.textContent === 'Cancel')!

const editButton = (id: number) =>
  row(id)!.querySelector<HTMLButtonElement>('button[title="Rename profile"]')!

async function startRename(id: number): Promise<void> {
  editButton(id).click()
  await vi.waitFor(() => {
    expect(input()).not.toBeNull()
  })
}

async function rename(id: number, name: string): Promise<void> {
  await startRename(id)
  type(name)
  save().click()
  await vi.waitFor(() => {
    expect(input()).toBeNull()
  })
}

const dangerSelect = () => host.querySelector<HTMLSelectElement>('#danger-profile-select')!
const dangerOptions = () =>
  Array.from(dangerSelect().options).map((option) => [Number(option.value), option.textContent])
const buttonNamed = (name: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === name)

/** Picks a profile in the Danger Zone the way a person does: by the name it shows. */
function chooseInDangerZone(name: string): void {
  const option = Array.from(dangerSelect().options).find((o) => o.textContent === name)!
  dangerSelect().value = option.value
  dangerSelect().dispatchEvent(new Event('change', { bubbles: true }))
}

function type(value: string): void {
  input()!.focus()
  input()!.value = value
  input()!.dispatchEvent(new Event('input', { bubbles: true }))
}

const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

async function names(): Promise<string[]> {
  return ((await (await getDB()).getAll('profiles')) as { name: string }[]).map((p) => p.name)
}

const failureToasts = () =>
  toasts()
    .filter((t) => t.type === 'error' || t.type === 'warning')
    .map((t) => t.message)
const successToasts = () =>
  toasts()
    .filter((t) => t.type === 'success')
    .map((t) => t.message)

describe('renaming a profile in the household view', () => {
  it('labels the field with the profile it renames, and starts from its name', async () => {
    await openHousehold()
    await startRename(2)
    const label = host.querySelector<HTMLLabelElement>(`label[for="${input()!.id}"]`)
    expect(label?.textContent).toBe('New name for Side business')
    expect(input()!.value).toBe('Side business')
    expect(input()!.required).toBe(true)
  })

  it('marks a blank name in its own words, focuses it, and sends nothing', async () => {
    await openHousehold()
    await startRename(2)
    type('  ')
    save().click()
    await settle()

    expect(input()!.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(input()!)).toBe(M.name)
    expect(document.activeElement).toBe(input())
    expect(net.sent).toEqual([])
    expect(await names()).toEqual(['Household', 'Side business', LONG])
    expect(failureToasts()).toEqual([])
  })

  it('marks a name the runtime says is taken, and keeps the field open', async () => {
    await openHousehold()
    await startRename(2)
    type('HOUSEHOLD')
    save().click()

    await vi.waitFor(() => {
      expect(describedBy(input()!)).toBe(
        'You already have a profile called "Household". Choose another name.'
      )
    })
    expect(net.sent).toEqual(['PUT /api/profiles/2'])
    expect(await names()).toEqual(['Household', 'Side business', LONG])
    expect(failureToasts()).toEqual([])
  })

  it('sends nothing for the stored name, and re-cases an older long one', async () => {
    await openHousehold()
    await startRename(3)
    expect(save().getAttribute('aria-disabled')).toBe('true')
    save().click()
    await settle()
    expect(net.sent).toEqual([])

    type(LONG.toUpperCase())
    save().click()
    await vi.waitFor(async () => {
      expect(await names()).toEqual(['Household', 'Side business', LONG.toUpperCase()])
    })
    expect(failureToasts()).toEqual([])
  })

  it('renames the profile in the list and the sidebar, and says so', async () => {
    await openHousehold()
    await startRename(2)
    type(' Freelance ')
    save().click()

    await vi.waitFor(() => {
      expect(input()).toBeNull()
    })
    expect(await names()).toEqual(['Household', 'Freelance', LONG])
    expect(row(2)!.textContent).toContain('Freelance')
    expect(state.profiles.map((p) => p.name)).toEqual(['Household', 'Freelance', LONG])
    expect(state.currentProfile?.name).toBe('Freelance')
    expect(successToasts()).toEqual(['Renamed "Side business" to "Freelance".'])
    expect(failureToasts()).toEqual([])
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(editButton(2))
    })
  })

  it('closes on Cancel and on Escape, sending nothing', async () => {
    await openHousehold()
    await startRename(2)
    type('Freelance')
    cancel().click()
    await vi.waitFor(() => {
      expect(input()).toBeNull()
    })
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(editButton(2))
    })

    await startRename(2)
    expect(input()!.value).toBe('Side business')
    input()!.focus()
    input()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await vi.waitFor(() => {
      expect(input()).toBeNull()
    })
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(editButton(2))
    })
    expect(net.sent).toEqual([])
  })
})

describe('the Danger Zone', () => {
  it('names a renamed profile by its new name, and deletes the one it names', async () => {
    await openHousehold()
    await rename(2, 'Freelance')
    await rename(3, 'Side business')

    await vi.waitFor(() => {
      expect(dangerOptions()).toEqual([
        [1, 'Household'],
        [2, 'Freelance'],
        [3, 'Side business'],
      ])
    })
    chooseInDangerZone('Side business')
    buttonNamed('Delete Profile')!.click()
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Delete profile "Side business"?')
    })
    buttonNamed('Yes, Delete Profile')!.click()

    await vi.waitFor(async () => {
      expect(await names()).toEqual(['Household', 'Freelance'])
    })
    expect(net.sent).toContain('DELETE /api/profiles/3')
  })

  it('deletes the first profile, as both runtimes allow any profile but the last', async () => {
    await openHousehold()
    chooseInDangerZone('Household')
    const remove = buttonNamed('Delete Profile')!
    expect(remove.disabled).toBe(false)
    remove.click()
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Delete profile "Household"?')
    })
    buttonNamed('Yes, Delete Profile')!.click()

    await vi.waitFor(async () => {
      expect(await names()).toEqual(['Side business', LONG])
    })
    expect(net.sent).toContain('DELETE /api/profiles/1')
  })

  it('keeps the last profile', async () => {
    const db = await getDB()
    await db.delete('profiles', 2)
    await db.delete('profiles', 3)
    setProfiles([{ id: 1, name: 'Household', created_at: '2026-01-01T00:00:00.000Z' }])
    setCurrentProfile({ id: 1, name: 'Household', created_at: '2026-01-01T00:00:00.000Z' })
    await openHousehold(1)

    expect(dangerOptions()).toEqual([[1, 'Household']])
    expect(buttonNamed('Delete Profile')!.disabled).toBe(true)
    expect(host.textContent).toContain('(Cannot delete the last remaining profile)')
  })
})
