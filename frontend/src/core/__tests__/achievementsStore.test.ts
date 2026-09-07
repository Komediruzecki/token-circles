import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: Record<string, unknown[]> = {}
vi.mock('../api', () => ({
  api: {
    getSettings: vi.fn(async () => ({ achievements: calls.stored?.[0] })),
    updateSettings: vi.fn(async (data: unknown) => {
      calls.updated = [data]
    }),
    getTransactions: vi.fn(async () => calls.transactions ?? []),
    getBudgets: vi.fn(async () => []),
    getGoals: vi.fn(async () => []),
    getImportLogs: vi.fn(async () => []),
  },
}))
const toasts: string[] = []
vi.mock('../toastStore', () => ({ addToast: vi.fn((m: string) => toasts.push(m)) }))
vi.mock('../storage/storageFactory', () => ({ getStorageMode: () => 'serverless' }))

import { refreshAchievements, streak, unlocks } from '../achievementsStore'

const month = (m: string) =>
  [3, 4, 5].map((d) => ({ date: `${m}-0${d}`, type: 'expense', amount: 10, category_id: 1 }))
const thisMonth = new Date().toISOString().slice(0, 7)
const monthsAgo = (n: number): string => {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - n)
  return d.toISOString().slice(0, 7)
}

describe('achievementsStore.refreshAchievements', () => {
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k]
    toasts.length = 0
  })

  it('first run on a history persists the backfill and toasts once as a summary', async () => {
    calls.transactions = [...month(monthsAgo(2)), ...month(monthsAgo(1)), ...month(thisMonth)]
    const newly = await refreshAchievements()
    expect(newly.map((n) => n.id)).toEqual([
      'first-entry',
      'named-everything',
      'one-month',
      'a-quarter',
    ])
    expect(unlocks().length).toBe(4)
    expect(streak()).toBe(3)
    const saved = JSON.parse((calls.updated![0] as { achievements: string }).achievements) as {
      unlocks: unknown[]
    }
    expect(saved.unlocks).toHaveLength(4)
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatch(/4 badges/)
  })

  it('a later single unlock toasts by name and keeps what is stored', async () => {
    calls.stored = [
      JSON.stringify({
        v: 1,
        unlocks: [
          { id: 'first-entry', earnedOn: '2026-07-01', unlockedAt: '2026-08-01T00:00:00.000Z' },
          {
            id: 'named-everything',
            earnedOn: '2026-07-01',
            unlockedAt: '2026-08-01T00:00:00.000Z',
          },
        ],
      }),
    ]
    calls.transactions = month(thisMonth)
    const newly = await refreshAchievements()
    expect(newly.map((n) => n.id)).toEqual(['one-month'])
    expect(unlocks().map((u) => u.id)).toEqual(['first-entry', 'named-everything', 'one-month'])
    expect(toasts).toEqual(['Badge unlocked: One month.'])
  })

  it('nothing new means no write and no toast', async () => {
    calls.stored = [
      JSON.stringify({
        v: 1,
        unlocks: [
          { id: 'first-entry', earnedOn: '2026-09-01', unlockedAt: '2026-09-01T00:00:00.000Z' },
        ],
      }),
    ]
    calls.transactions = [{ date: `${thisMonth}-03`, type: 'expense', amount: 10, category_id: 1 }]
    expect(await refreshAchievements()).toEqual([])
    expect(calls.updated).toBeUndefined()
    expect(toasts).toHaveLength(0)
  })
})
