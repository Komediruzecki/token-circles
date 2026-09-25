import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: Record<string, unknown[]> = {}
/** The settings the page reads back: one object, merged by every write, like the real store. */
let settingsStore: Record<string, unknown> = {}
const env = { mode: 'serverless' as 'serverless' | 'self-hosted' }
vi.mock('../api', () => ({
  api: {
    getSettings: vi.fn(async () => ({ ...settingsStore })),
    updateSettings: vi.fn(async (data: Record<string, unknown>) => {
      calls.updated = [...(calls.updated ?? []), data]
      settingsStore = { ...settingsStore, ...data }
    }),
    getTransactions: vi.fn(async () => calls.transactions ?? []),
    getBudgets: vi.fn(async () => calls.budgets ?? []),
    getGoals: vi.fn(async () => calls.goals ?? []),
    getImportLogs: vi.fn(async () => []),
    getCategories: vi.fn(async () => [{ id: 1, name: 'Food' }]),
    getBills: vi.fn(async () => []),
    getLoans: vi.fn(async () => calls.loans ?? []),
    getLoan: vi.fn(async (id: number) =>
      (calls.loans as Array<{ id: number }>)?.find((l) => l.id === id)
    ),
  },
}))
const toasts: string[] = []
vi.mock('../toastStore', () => ({ addToast: vi.fn((m: string) => toasts.push(m)) }))
vi.mock('../storage/storageFactory', () => ({ getStorageMode: () => env.mode }))
vi.mock('../appStore', () => ({ setPage: vi.fn() }))

import { parseRecords } from '../achievements/records'
import {
  dismissAdvice,
  dismissedAdvice,
  refreshAchievements,
  snapshot,
  streak,
  unlocks,
} from '../achievementsStore'

const month = (m: string) =>
  [3, 4, 5].map((d) => ({ date: `${m}-0${d}`, type: 'expense', amount: 10, category_id: 1 }))
const thisMonth = new Date().toISOString().slice(0, 7)
const monthsAgo = (n: number): string => {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - n)
  return d.toISOString().slice(0, 7)
}

/** The key the active profile's record lives under, in the mode under test. */
const key = () =>
  env.mode === 'serverless'
    ? `achievements:${localStorage.getItem('currentProfileId') ?? '1'}`
    : 'achievements'
/** Seed the active profile's stored record. */
const seed = (record: string) => {
  settingsStore[key()] = record
}
/** The active profile's record as the nth write saved it. */
const saved = (n: number) =>
  JSON.parse((calls.updated![n] as Record<string, string>)[key()]) as {
    unlocks: unknown[]
    dismissedAdvice: string[]
  }

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k]
  toasts.length = 0
  settingsStore = {}
  env.mode = 'serverless'
  localStorage.clear()
})

describe('achievementsStore.refreshAchievements', () => {
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
    expect(saved(0).unlocks).toHaveLength(4)
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatch(/4 badges/)
  })

  it('a later single unlock toasts by name and keeps what is stored', async () => {
    seed(
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
      })
    )
    calls.transactions = month(thisMonth)
    const newly = await refreshAchievements()
    expect(newly.map((n) => n.id)).toEqual(['one-month'])
    expect(unlocks().map((u) => u.id)).toEqual(['first-entry', 'named-everything', 'one-month'])
    expect(toasts).toEqual(['Badge unlocked: One month.'])
  })

  it('keeps the loaded arrays in a snapshot, so the page needs no second fetch', async () => {
    calls.transactions = month(thisMonth)
    await refreshAchievements()
    expect(snapshot()!.transactions).toHaveLength(3)
    expect(snapshot()!.categories).toEqual([{ id: 1, name: 'Food' }])
    expect(snapshot()!.evaluation.streak).toBe(1)
    expect(snapshot()!.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('persists a dismissed advice id beside the unlocks, not in a key of its own', async () => {
    calls.transactions = month(thisMonth)
    await refreshAchievements()
    await dismissAdvice(`uncategorised:${thisMonth}`)
    const last = saved(calls.updated!.length - 1)
    expect(last.dismissedAdvice).toEqual([`uncategorised:${thisMonth}`])
    expect(last.unlocks.length).toBeGreaterThan(0)
    expect(dismissedAdvice()).toEqual([`uncategorised:${thisMonth}`])
  })

  it('nothing new means no write and no toast', async () => {
    seed(
      JSON.stringify({
        v: 1,
        unlocks: [
          { id: 'first-entry', earnedOn: '2026-09-01', unlockedAt: '2026-09-01T00:00:00.000Z' },
        ],
      })
    )
    calls.transactions = [{ date: `${thisMonth}-03`, type: 'expense', amount: 10, category_id: 1 }]
    expect(await refreshAchievements()).toEqual([])
    expect(calls.updated).toBeUndefined()
    expect(toasts).toHaveLength(0)
  })
})

describe('badges are per profile', () => {
  // The view that caused it: profile 2 is active, and profile 3 is ticked into the household in
  // Settings. Every list read below returns both profiles' rows, as the household reads do.
  const householdOfTwoAndThree = () => {
    localStorage.setItem('currentProfileId', '2')
    localStorage.setItem('selectedProfileIds', JSON.stringify([2, 3]))
  }
  const budget = (profile_id: number) => ({
    profile_id,
    category_id: 1,
    amount: 100,
    period: 'monthly',
    start_date: `${thisMonth}-01`,
    end_date: null,
    created_at: `${thisMonth}-02`,
  })
  const goal = (profile_id: number) => ({
    profile_id,
    name: 'Trip',
    target_amount: 1000,
    current_amount: 10,
    deadline: null,
    created_at: `${thisMonth}-02`,
  })
  const transactionsOf = (profile_id: number) => month(thisMonth).map((t) => ({ ...t, profile_id }))

  it("does not earn the active profile another profile's badges", async () => {
    householdOfTwoAndThree()
    calls.transactions = transactionsOf(3)
    calls.budgets = [budget(3)]
    calls.goals = [goal(3)]

    expect(await refreshAchievements()).toEqual([])
    expect(unlocks()).toEqual([])
    expect(toasts).toEqual([])
    expect(calls.updated).toBeUndefined()
  })

  it("still earns from the active profile's own rows in the same view", async () => {
    householdOfTwoAndThree()
    calls.budgets = [budget(3), budget(2)]
    calls.goals = [goal(3)]

    const newly = (await refreshAchievements()).map((n) => n.id)

    expect(newly).toContain('first-budget')
    expect(newly).not.toContain('goal-in-sight')
  })

  it('counts only the active profile in the progress snapshot too', async () => {
    householdOfTwoAndThree()
    calls.transactions = [...transactionsOf(2), ...transactionsOf(3)]

    await refreshAchievements()

    expect(snapshot()!.transactions).toHaveLength(3)
  })

  it('in local-first mode, each profile keeps a record of its own', async () => {
    // The browser settings store has one row per key for the whole device, so a shared key would
    // show profile 2's badges on profile 3.
    householdOfTwoAndThree()
    calls.budgets = [budget(2)]
    await refreshAchievements()
    expect(parseRecords(settingsStore['achievements:2']).map((r) => r.id)).toContain('first-budget')

    localStorage.setItem('currentProfileId', '3')
    await refreshAchievements()

    expect(unlocks()).toEqual([])
    expect(settingsStore['achievements:3']).toBeUndefined()
  })

  it('adopts a record saved before badges were per profile, once', async () => {
    settingsStore.achievements = JSON.stringify({
      v: 1,
      unlocks: [
        { id: 'first-entry', earnedOn: '2026-07-01', unlockedAt: '2026-08-01T00:00:00.000Z' },
      ],
    })
    localStorage.setItem('currentProfileId', '2')

    expect(await refreshAchievements()).toEqual([])
    expect(unlocks().map((u) => u.id)).toEqual(['first-entry'])
    expect(parseRecords(settingsStore['achievements:2']).map((r) => r.id)).toEqual(['first-entry'])
    // Emptied, so the next profile to open does not inherit it as well.
    expect(settingsStore.achievements).toBe('')
    expect(toasts).toEqual([])

    localStorage.setItem('currentProfileId', '3')
    await refreshAchievements()

    expect(unlocks()).toEqual([])
  })

  it('in cloud mode keeps the plain key, because the server stores settings per profile', async () => {
    env.mode = 'self-hosted'
    householdOfTwoAndThree()
    calls.budgets = [budget(2)]

    await refreshAchievements()

    expect(Object.keys(calls.updated![0] as object)).toEqual(['achievements'])
  })
})
