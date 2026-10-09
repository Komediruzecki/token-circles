/**
 * The sidebar's Create Profile dialog, run against the real local-first router on fake-indexeddb.
 *
 * It refused nothing itself: a blank name kept the button disabled with no word why, and every
 * refusal (a name taken, one too long) was the runtime's sentence in a red box above the buttons,
 * with nothing marked. Now it checks the name with the rules both runtimes run
 * (shared/profileSchema.ts), marks the field in their words, and marks a name the runtime refuses
 * the same way. The plan's profile cap is no field's fault: it stays a notice, with the Upgrade
 * button beside it.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROFILE_MESSAGES as M } from '../../../../shared/profileSchema'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'
import type { apiFetch as ApiFetch } from '../../core/apiFetch'
import type { Profile } from '../../types/models'

const net = vi.hoisted(() => ({ sent: [] as string[] }))

// Every request the dialog makes, then on to the real router (or, in cloud mode, the stub below).
vi.mock('../../core/apiFetch', async (importOriginal) => {
  const real = await importOriginal<{ apiFetch: typeof ApiFetch }>()
  return {
    ...real,
    apiFetch: async (url: string, init: RequestInit = {}) => {
      net.sent.push(`${init.method ?? 'GET'} ${url.split('?')[0]}`)
      return real.apiFetch(url, init)
    },
  }
})

let host: HTMLDivElement
let dispose: (() => void) | undefined
let created: Profile[]
let closed: number

beforeAll(async () => {
  await Promise.all([import('../ProfileModal'), import('../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  __resetDataVersionsForTest()
  const db = await getDB()
  await db.clear('profiles')
  await db.add('profiles', { id: 1, name: 'Household', created_at: '2026-01-01T00:00:00.000Z' })
  for (const toast of toasts()) removeToast(toast.id)
  created = []
  closed = 0
  net.sent.length = 0
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
})

async function mount(): Promise<void> {
  const { default: ProfileModal } = await import('../ProfileModal')
  dispose = render(
    () => (
      <ProfileModal
        onClose={() => {
          closed++
        }}
        onSuccess={(profile) => {
          created.push(profile)
        }}
      />
    ),
    host
  )
}

const input = () => host.querySelector<HTMLInputElement>('[data-test-id="profile-name-input"]')!
const submitButton = () =>
  host.querySelector<HTMLButtonElement>('[data-test-id="profile-create-submit"]')!
const notice = () => host.querySelector('[role="alert"]')?.textContent ?? ''
const upgrade = () =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Upgrade')

function type(value: string): void {
  input().focus()
  input().value = value
  input().dispatchEvent(new Event('input', { bubbles: true }))
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

describe('creating a profile', () => {
  it('labels the name field', async () => {
    await mount()
    const label = host.querySelector<HTMLLabelElement>(`label[for="${input().id}"]`)
    expect(label?.textContent).toBe('Profile Name')
  })

  it('marks a blank name in its own words, focuses it, and sends nothing', async () => {
    await mount()
    submitButton().focus()
    submitButton().click()
    await settle()

    expect(input().getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(input())).toBe(M.name)
    expect(document.activeElement).toBe(input())
    expect(net.sent).toEqual([])
    expect(await names()).toEqual(['Household'])
    expect(created).toEqual([])
    expect(failureToasts()).toEqual([])
  })

  it('marks a name over 100 characters, and takes the mark away once it is fixed', async () => {
    await mount()
    type('x'.repeat(101))
    submitButton().click()
    await settle()
    expect(describedBy(input())).toBe(M.nameLength)

    type('x'.repeat(100))
    expect(input().getAttribute('aria-invalid')).toBeNull()
    expect(net.sent).toEqual([])
    expect(await names()).toEqual(['Household'])
  })

  it('marks a name the runtime says is taken, and stays open', async () => {
    await mount()
    type(' household ')
    submitButton().click()

    await vi.waitFor(() => {
      expect(describedBy(input())).toBe(
        'You already have a profile called "Household". Choose another name.'
      )
    })
    expect(input().getAttribute('aria-invalid')).toBe('true')
    expect(notice()).toBe('')
    expect(net.sent).toEqual(['POST /api/profiles'])
    expect(await names()).toEqual(['Household'])
    expect(created).toEqual([])
    expect(closed).toBe(0)
    expect(failureToasts()).toEqual([])
  })

  it('creates the profile, says so, and hands it to the sidebar to switch to', async () => {
    await mount()
    type('  Holiday house ')
    submitButton().click()

    await vi.waitFor(() => {
      expect(created).toHaveLength(1)
    })
    expect(created[0]).toMatchObject({ name: 'Holiday house', id: expect.any(Number) })
    expect(await names()).toEqual(['Household', 'Holiday house'])
    expect(successToasts()).toEqual(['Added "Holiday house" to your profiles and switched to it.'])
    expect(failureToasts()).toEqual([])
  })

  it('creates on Enter, as a form does', async () => {
    await mount()
    type('Side business')
    input().form!.requestSubmit()

    await vi.waitFor(() => {
      expect(created.map((p) => p.name)).toEqual(['Side business'])
    })
  })
})

describe("past the plan's profile cap, in cloud mode", () => {
  it('says so in the notice, offers the upgrade, and marks no field', async () => {
    localStorage.setItem('finance_storage_mode', 'self-hosted')
    const sent: string[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      sent.push(`${init.method ?? 'GET'} ${url}`)
      return new Response(
        JSON.stringify({ error: 'Your plan allows up to 2 profiles. Upgrade for more.' }),
        { status: 403, headers: { 'content-type': 'application/json' } }
      )
    })
    await mount()
    type('Holiday house')
    submitButton().click()

    await vi.waitFor(() => {
      expect(notice()).toBe('Your plan allows up to 2 profiles. Upgrade for more.')
    })
    expect(upgrade()).toBeDefined()
    expect(input().getAttribute('aria-invalid')).toBeNull()
    expect(sent).toEqual(['POST /api/profiles'])
    expect(created).toEqual([])
    expect(failureToasts()).toEqual([])
  })
})
