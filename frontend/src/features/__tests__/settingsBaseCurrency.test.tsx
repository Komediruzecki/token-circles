/**
 * Settings > General: the base currency, against the real local-first router on fake-indexeddb.
 *
 * The select had no label, and any failure was a toast saying the currency was locked. Now the
 * select is labelled, a save says so, and the lock (a profile with accounts keeps its currency) is
 * marked under the select in the runtime's words, with the select back on the currency that stays
 * (features/baseCurrencyForm.ts).
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
      // The settings writes after the page has opened (it settles its base currency on open).
      const method = init.method ?? 'GET'
      if (method === 'PUT' && url.startsWith('/api/settings')) {
        const body = typeof init.body === 'string' ? init.body : ''
        net.sent.push(`${method} ${url} ${body}`)
      }
      return real.apiFetch(url, init)
    },
  }
})

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
  localStorage.setItem('localCurrency', 'EUR')
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Household', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
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

const select = () =>
  host.querySelector<HTMLSelectElement>('[data-test-id="settings-currency-select"]')

async function openGeneral(): Promise<void> {
  setSettingsTab('general')
  const { default: Settings } = await import('../Settings')
  dispose = render(() => <Settings />, host)
  await vi.waitFor(() => {
    expect(select()).not.toBeNull()
  })
  // The page settles its base currency once it opens; what follows is the person's.
  await new Promise((resolve) => setTimeout(resolve, 50))
  net.sent.length = 0
}

function choose(code: string): void {
  select()!.value = code
  select()!.dispatchEvent(new Event('change', { bubbles: true }))
}

const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

async function storedCurrency(): Promise<unknown> {
  return ((await (await getDB()).get('settings', 'currency')) as { value: unknown }).value
}

const failureToasts = () =>
  toasts()
    .filter((t) => t.type === 'error' || t.type === 'warning')
    .map((t) => t.message)
const successToasts = () =>
  toasts()
    .filter((t) => t.type === 'success')
    .map((t) => t.message)

describe('the base currency in Settings', () => {
  it('labels the select, and starts from the stored currency', async () => {
    await openGeneral()
    const label = host.querySelector<HTMLLabelElement>(`label[for="${select()!.id}"]`)
    expect(label?.textContent).toBe('Base currency')
    expect(select()!.value).toBe('EUR')
  })

  it('saves a new one the moment it is chosen, and says so', async () => {
    await openGeneral()
    choose('USD')

    await vi.waitFor(async () => {
      expect(await storedCurrency()).toBe('USD')
    })
    expect(net.sent).toEqual(['PUT /api/settings {"currency":"USD"}'])
    await vi.waitFor(() => {
      expect(successToasts()).toEqual(['Base currency set to USD.'])
    })
    expect(localStorage.getItem('localCurrency')).toBe('USD')
    expect(select()!.getAttribute('aria-invalid')).toBeNull()
    expect(failureToasts()).toEqual([])
  })

  it("marks a locked currency at the select, in the runtime's words, and goes back to it", async () => {
    await (
      await getDB()
    ).add('accounts', {
      id: 1,
      profile_id: 1,
      name: 'Everyday',
      type: 'giro',
      currency: 'EUR',
    } as never)
    await openGeneral()
    choose('USD')

    await vi.waitFor(() => {
      expect(describedBy(select()!)).toBe(
        'The base currency stays EUR once you have accounts or transactions.'
      )
    })
    expect(select()!.getAttribute('aria-invalid')).toBe('true')
    // Focus goes to the select, which was disabled while the currency was being saved.
    expect(document.activeElement).toBe(select())
    expect(select()!.value).toBe('EUR')
    expect(await storedCurrency()).toBe('EUR')
    expect(localStorage.getItem('localCurrency')).toBe('EUR')
    expect(failureToasts()).toEqual([])
    expect(successToasts()).toEqual([])
  })

  it('sends nothing for the currency already stored', async () => {
    await openGeneral()
    choose('EUR')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(net.sent).toEqual([])
  })
})
