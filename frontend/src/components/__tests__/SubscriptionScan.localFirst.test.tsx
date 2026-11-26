/**
 * The subscription scan in local-first, in a household: it reads the charges of the profile it
 * adds to, as the Worker answers them. With the data kept in this browser, `GET /api/transactions`
 * answers every chosen profile's rows, and the scan proposed another profile's subscriptions as
 * bills for this one. Nothing is mocked between the scan and IndexedDB: the real `apiFetch`, the
 * real router, fake-indexeddb.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDB } from '../../core/storage/idb'
import type * as ScanModule from '../SubscriptionScan'

const OURS = 1
const THEIRS = 2

let scanModule: typeof ScanModule
let host: HTMLDivElement | undefined
let dispose: (() => void) | undefined

beforeAll(async () => {
  scanModule = await import('../SubscriptionScan')
  await import('../../core/storage/localApiRouter')
}, 120_000)

let nextId = 1

/** A charge `days` ago, written by `profile`. */
function charge(profile: number, description: string, amount: number, days: number) {
  const date = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  return {
    id: nextId++,
    profile_id: profile,
    account_id: 1,
    type: 'expense',
    amount,
    date,
    description,
    currency: 'EUR',
  }
}

async function seed(rows: ReturnType<typeof charge>[]): Promise<void> {
  const db = await getDB()
  for (const row of rows) await db.add('transactions', row)
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', String(OURS))
  localStorage.setItem('selectedProfileIds', JSON.stringify([OURS, THEIRS]))
  localStorage.setItem('localCurrency', 'EUR')
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: OURS, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('profiles', { id: THEIRS, name: 'Partner', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
})

/** The scan, once it has read the charges: what it found, or that there was nothing to read. */
async function scan(): Promise<{ found: string[]; nothing: boolean }> {
  const mount = document.createElement('div')
  host = mount
  document.body.appendChild(mount)
  dispose = render(() => <scanModule.SubscriptionScanPanel active={() => true} />, mount)
  await vi.waitFor(() => {
    expect(
      mount.querySelector(
        '[data-test-id="sub-scan-row"], [data-test-id="sub-scan-nothing"], [data-test-id="sub-scan-empty"]'
      )
    ).not.toBeNull()
  })
  return {
    found: [...mount.querySelectorAll<HTMLElement>('[data-test-id="sub-scan-row"]')].map(
      (row) => row.dataset.name ?? ''
    ),
    nothing: mount.querySelector('[data-test-id="sub-scan-nothing"]') !== null,
  }
}

describe('the scan in a household, with the data kept in this browser', () => {
  it('reads the charges of the profile it adds to, not those of every chosen profile', async () => {
    await seed([
      ...[95, 65, 35, 5].map((days) => charge(OURS, 'Spotify P0FF8B1C34', 10.99, days)),
      ...[95, 65, 35, 5].map((days) => charge(THEIRS, 'NETFLIX.COM AMSTERDAM', 13.99, days)),
    ])

    expect(await scan()).toEqual({ found: ['Spotify'], nothing: false })
  })

  it('says there is nothing to scan when only another profile has charges', async () => {
    await seed([95, 65, 35, 5].map((days) => charge(THEIRS, 'NETFLIX.COM AMSTERDAM', 13.99, days)))

    expect(await scan()).toEqual({ found: [], nothing: true })
  })
})
