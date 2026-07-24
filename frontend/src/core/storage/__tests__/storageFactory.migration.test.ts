import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDB } from '../idb'
import { getStorageMode, migrateData, resetAdapter, setStorageMode } from '../storageFactory'
import type { ExportData } from '../../../types/storage'

const originalFetch = globalThis.fetch

function emptyBackup(profiles: ExportData['profiles']): ExportData {
  return {
    version: '3.0.0',
    export_date: '2026-07-23T00:00:00.000Z',
    storage_mode: 'self-hosted',
    profiles,
    categories: [],
    transactions: [],
    accounts: [],
    budgets: [],
    goals: [],
    loans: [],
    settings: { currency: 'EUR', primary_currency: 'EUR', theme: 'dark', language: 'en' },
  }
}

async function wipe(): Promise<void> {
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
}

beforeEach(async () => {
  localStorage.clear()
  resetAdapter()
  await wipe()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  resetAdapter()
})

describe('storage-mode migration uses the complete backup contract', () => {
  it('exports every server profile before restoring into IndexedDB', async () => {
    setStorageMode('self-hosted')
    const profiles = [
      { id: 11, name: 'Home', created_at: '2026-01-01', updated_at: '2026-01-01' },
      { id: 22, name: 'Joint', created_at: '2026-01-02', updated_at: '2026-01-02' },
    ]
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (path === '/api/profiles') return Response.json(profiles)
      if (path === '/api/export') {
        const headers = new Headers(init?.headers)
        expect(headers.get('X-Profile-Id')).toBe('11')
        expect(headers.get('X-Profile-Ids')).toBe('[11,22]')
        return Response.json(emptyBackup(profiles))
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    globalThis.fetch = fetchMock as typeof fetch

    await expect(migrateData('serverless')).resolves.toEqual({ success: true })
    expect(getStorageMode()).toBe('serverless')
    expect(await (await getDB()).getAll('profiles')).toHaveLength(2)
  })

  it('sends a v3 all-profile browser backup to the Worker restore endpoint', async () => {
    setStorageMode('serverless')
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    await db.add('profiles', { id: 1, name: 'Home', created_at: '2026-01-01' })
    await db.add('profiles', { id: 2, name: 'Joint', created_at: '2026-01-02' })

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      expect(path).toBe('/api/import')
      expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
      if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body')
      const backup = JSON.parse(init.body) as ExportData
      expect(backup.version).toBe('3.0.0')
      expect(backup.profiles.map((profile) => profile.name)).toEqual(['Home', 'Joint'])
      return Response.json({ profiles_restored: 2, first_profile_id: 77 })
    })
    globalThis.fetch = fetchMock as typeof fetch

    await expect(migrateData('self-hosted')).resolves.toEqual({ success: true })
    expect(getStorageMode()).toBe('self-hosted')
    expect(localStorage.getItem('currentProfileId')).toBe('77')
    expect(localStorage.getItem('selectedProfileIds')).toBe('[77]')
  })

  it('reverts the mode and preserves browser data when server restore rejects the backup', async () => {
    setStorageMode('serverless')
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    await db.add('profiles', { id: 1, name: 'Home', created_at: '2026-01-01' })
    globalThis.fetch = vi.fn(async () =>
      Response.json({ error: 'Backup graph is invalid' }, { status: 422 })
    ) as typeof fetch

    const result = await migrateData('self-hosted')
    expect(result).toEqual({
      success: false,
      error: 'Import failed: Backup graph is invalid',
    })
    expect(getStorageMode()).toBe('serverless')
    expect(await db.getAll('profiles')).toHaveLength(1)
  })
})
