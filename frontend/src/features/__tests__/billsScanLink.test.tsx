/**
 * Getting started's subscription step links to `#bills?scan=1`: Bills opens the subscription scan,
 * on the Subscriptions tab it belongs to. Run against the real local-first router on
 * fake-indexeddb.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import scanStyles from '../../components/SubscriptionScan.module.css'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { getDB } from '../../core/storage/idb'
import styles from '../BillsPage.module.css'

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../Bills'), import('../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('localCurrency', 'EUR')
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
  setProfiles([{ id: 1, name: 'Me' }] as never)
  setCurrentProfile({ id: 1, name: 'Me' } as never)
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
  setPage('bills')
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  history.replaceState(null, '', '#')
  vi.unstubAllGlobals()
})

async function mountPage(): Promise<void> {
  const { default: Bills } = await import('../Bills')
  dispose = render(() => <Bills />, host)
  await vi.waitFor(() => {
    expect(host.querySelector('[data-test-id="bills-tab-subscriptions"]')).not.toBeNull()
  })
}

const scanOpen = () =>
  host
    .querySelector('[data-test-id="sub-scan-modal"]')
    ?.parentElement?.classList.contains(scanStyles.open) ?? false

const subscriptionsTabActive = () =>
  host
    .querySelector('[data-test-id="bills-tab-subscriptions"]')!
    .classList.contains(styles.tabActive)

describe('arriving from Getting started', () => {
  it('opens the scan on the Subscriptions tab, once', async () => {
    history.replaceState(null, '', '#bills?scan=1')
    await mountPage()

    await vi.waitFor(() => {
      expect(scanOpen()).toBe(true)
    })
    expect(subscriptionsTabActive()).toBe(true)
    expect(window.location.hash).toBe('#bills')
  })

  it('opens it for a link that arrives once the page is open', async () => {
    history.replaceState(null, '', '#bills')
    await mountPage()
    expect(scanOpen()).toBe(false)
    expect(subscriptionsTabActive()).toBe(false)

    history.replaceState(null, '', '#bills?scan=1')
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    await vi.waitFor(() => {
      expect(scanOpen()).toBe(true)
    })
    expect(subscriptionsTabActive()).toBe(true)
  })
})
