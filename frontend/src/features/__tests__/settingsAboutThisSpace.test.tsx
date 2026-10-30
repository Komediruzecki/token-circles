/**
 * Settings > General, About this space, against the real local-first router on fake-indexeddb:
 * the production build holds back setup's region and household questions with the benchmarks they
 * choose figures for (core/guidanceGate.ts), so the card is not there; every other build shows it.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setSettingsTab } from '../../core/settingsStore'
import { getDB } from '../../core/storage/idb'

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
  vi.unstubAllEnvs()
})

const card = () => host.querySelector('[data-test-id="settings-about-space"]')

async function openGeneral(): Promise<void> {
  setSettingsTab('general')
  const { default: Settings } = await import('../Settings')
  dispose = render(() => <Settings />, host)
  await vi.waitFor(() => {
    expect(host.querySelector('[data-test-id="settings-currency-select"]')).not.toBeNull()
  })
}

it('is not in the production build', async () => {
  vi.stubEnv('MODE', 'production')
  await openGeneral()
  expect(card()).toBeNull()
  expect(host.textContent).not.toContain('Where do you live?')
})

it('asks where you live and who the space covers in every other build', async () => {
  vi.stubEnv('MODE', 'dev')
  await openGeneral()
  expect(card()).not.toBeNull()
  await vi.waitFor(() => {
    expect(host.querySelector('[data-test-id="settings-space-region"]')).not.toBeNull()
  })
  expect(host.querySelector('[data-test-id="settings-space-household"]')).not.toBeNull()
})
