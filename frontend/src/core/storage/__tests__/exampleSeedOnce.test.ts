/**
 * A browser that never had a profile gets the three example profiles, and nothing beside them.
 *
 * WHY THIS TEST EXISTS. The seed marked the browser (`finance_had_profiles`) first and then added
 * the example profiles one transaction at a time. A request that came in between, from the same
 * boot or from a second tab, found the mark and an empty store, took the workspace for one with no
 * profile, and made "Personal Profile" beside the examples. Two tabs seeding at once each added a
 * set. Now the seed adds all three profiles in one transaction that only runs on an empty store
 * and marks the browser after it: a request that comes in before then seeds too, and whichever
 * seed comes second finds the first one's profiles and stops.
 *
 * Each module graph below is one tab: its own connection and its own seed. Everything goes
 * through the real `apiFetch` and local router.
 */
import { openDB } from 'idb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const EXAMPLES = ['Example Low Income', 'Example Mid Income', 'Example High Income']

/** One tab: the app's modules, fresh. */
async function tab() {
  vi.resetModules()
  const idb = await import('../idb')
  const api = await import('../../api')
  return { ...api, idb }
}

async function profileNames(): Promise<string[]> {
  const db = await openDB('finance-manager')
  const names = ((await db.getAll('profiles')) as Array<{ name: string }>).map((p) => p.name)
  db.close()
  return names
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  const { idb } = await tab()
  const db = await idb.getDB()
  for (const name of Array.from(db.objectStoreNames)) await db.clear(name)
  db.close()
})

describe('a fresh browser opening the app', () => {
  it('gets the three example profiles, however many requests ask at once', async () => {
    const { apiGet } = await tab()

    await Promise.all([
      apiGet('/api/profiles'),
      apiGet('/api/profiles'),
      apiGet('/api/profiles'),
      apiGet('/api/transactions'),
    ])

    expect(await profileNames()).toEqual(EXAMPLES)
  }, 60_000)

  it('gets them once when two tabs open at the same moment', async () => {
    const a = await tab()
    const b = await tab()

    await Promise.all([
      a.apiGet('/api/profiles'),
      b.apiGet('/api/profiles'),
      a.apiGet('/api/profiles'),
      b.apiGet('/api/profiles'),
    ])

    expect(await profileNames()).toEqual(EXAMPLES)
  }, 60_000)
})

describe("the Danger Zone's reseed", () => {
  it('ends with the three example profiles while the app keeps reading', async () => {
    const { apiGet, apiPost } = await tab()
    await apiGet('/api/profiles')

    await Promise.all([
      apiPost('/api/profiles/reseed-demo', {}),
      apiGet('/api/profiles'),
      apiGet('/api/profiles'),
    ])

    expect(await profileNames()).toEqual(EXAMPLES)
  }, 90_000)
})
