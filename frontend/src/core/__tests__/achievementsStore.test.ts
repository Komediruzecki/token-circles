import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

const calls: Record<string, unknown[]> = {}
/** The settings the page reads back: one object, merged by every write, like the real store. */
let settingsStore: Record<string, unknown> = {}
const env = { mode: 'serverless' as 'serverless' | 'self-hosted' }
vi.mock('../api', () => ({
  api: {
    getSettings: vi.fn(async () => ({ ...settingsStore })),
    updateSettings: vi.fn(async (data: Record<string, unknown>) => {
      calls.updated = [...(calls.updated ?? []), data]
      // The profile the write lands on in cloud mode: X-Profile-Id is read when the request is made.
      calls.writtenAs = [
        ...(calls.writtenAs ?? []),
        localStorage.getItem('currentProfileId') ?? '1',
      ]
      settingsStore = { ...settingsStore, ...data }
    }),
    getTransactions: vi.fn(async () => calls.transactions ?? []),
    getBudgets: vi.fn(async () => calls.budgets ?? []),
    getGoals: vi.fn(async () => calls.goals ?? []),
    getImportLogs: vi.fn(async () => calls.importLogs ?? []),
    getCategories: vi.fn(async () => calls.categories ?? [{ id: 1, name: 'Food' }]),
    getBills: vi.fn(async () => calls.bills ?? []),
    getLoans: vi.fn(async () => calls.loans ?? []),
    getAccounts: vi.fn(async () => calls.accounts ?? []),
    getLoan: vi.fn(async (id: number) =>
      (calls.loans as Array<{ id: number }>)?.find((l) => l.id === id)
    ),
  },
  // The setup wizard's store keeps its decision through these (onboardingStore.ts).
  apiGet: vi.fn(async () => ({})),
  apiPut: vi.fn(async () => ({})),
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
  restoreAdvice,
  snapshot,
  streak,
  unlocks,
} from '../achievementsStore'
import { api } from '../api'
import {
  completeOnboarding,
  onboardingOpen,
  skipOnboarding,
  startOnboarding,
} from '../onboardingStore'

/** The mocked client's members as plain mocks, to hold, count and re-stub. */
const apiMock = api as unknown as Record<
  'getSettings' | 'updateSettings' | 'getLoan' | 'getAccounts',
  Mock
>

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
  vi.clearAllMocks()
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

  it('dates the snapshot with the person’s today, not the UTC one', async () => {
    // 00:30 on 8 October in Zagreb; UTC is still on the 7th.
    const hostZone = process.env.TZ
    process.env.TZ = 'Europe/Zagreb'
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T22:30:00Z'))
    try {
      await refreshAchievements()
      expect(snapshot()!.today).toBe('2026-10-08')
    } finally {
      vi.useRealTimers()
      if (hostZone === undefined) delete process.env.TZ
      else process.env.TZ = hostZone
    }
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

  it("counts the active profile's loan, and does not fetch or count another profile's", async () => {
    householdOfTwoAndThree()
    // Paid off long ago, so it earns "debt free" for whoever it is counted for.
    const paidOff = (id: number, profile_id: number) => ({
      id,
      profile_id,
      principal: 12000,
      interest_rate: 5,
      start_date: '2020-01-01',
      term_months: 24,
      rate_periods: [{ rate: 5, start_month: 1, end_month: null }],
      prepayments: [],
    })
    calls.loans = [paidOff(7, 3)]

    await refreshAchievements()

    expect(apiMock.getLoan).not.toHaveBeenCalled()
    expect(unlocks().map((u) => u.id)).not.toContain('debt-free')

    calls.loans = [paidOff(7, 3), paidOff(8, 2)]
    await refreshAchievements()

    expect(apiMock.getLoan).toHaveBeenCalledTimes(1)
    expect(apiMock.getLoan).toHaveBeenCalledWith(8, { expectedStatuses: [404] })
    expect(unlocks().map((u) => u.id)).toContain('debt-free')
  })

  it("hands each loan's own rate to the badge, for the months no rate period covers", async () => {
    householdOfTwoAndThree()
    // 12,000 at 24 % over 60 months, no rate periods, 6,000 extra in month 6: paid off 24 months
    // after the first payment at its own rate. Charged 0 %, which is what leaving the rate out
    // did, it runs 29. Started 25 months ago, it was paid off last month, or 4 months from now.
    calls.loans = [
      {
        id: 9,
        profile_id: 2,
        principal: 12000,
        interest_rate: 24,
        start_date: `${monthsAgo(25)}-01`,
        term_months: 60,
        rate_periods: [],
        prepayments: [{ month: 6, amount: 6000 }],
      },
    ]

    await refreshAchievements()

    expect(unlocks().find((u) => u.id === 'debt-free')?.earnedOn).toBe(`${monthsAgo(1)}-01`)
  })

  it("does not count another profile's imports", async () => {
    householdOfTwoAndThree()
    calls.importLogs = [{ id: 1, profile_id: 3, created_at: `${thisMonth}-02T10:00:00Z` }]

    await refreshAchievements()

    expect(unlocks().map((u) => u.id)).not.toContain('first-import')
  })

  it('keeps only the active profile in the categories and bills the progress page reads', async () => {
    householdOfTwoAndThree()
    calls.categories = [
      { id: 1, name: 'Food', profile_id: 2 },
      { id: 2, name: 'Rent', profile_id: 3 },
    ]
    calls.bills = [
      { name: 'Power', amount: 40, profile_id: 2 },
      { name: 'Water', amount: 20, profile_id: 3 },
    ]

    await refreshAchievements()

    expect(snapshot()!.categories.map((c) => c.name)).toEqual(['Food'])
    expect(snapshot()!.bills.map((b) => b.name)).toEqual(['Power'])
  })

  it("keeps only the active profile's accounts, for Getting started's cushion", async () => {
    householdOfTwoAndThree()
    calls.accounts = [
      { id: 1, name: 'Savings', type: 'savings', balance: 900, profile_id: 2 },
      { id: 2, name: 'Theirs', type: 'savings', balance: 5000, profile_id: 3 },
    ]

    await refreshAchievements()

    expect(snapshot()!.accounts!.map((a) => a.name)).toEqual(['Savings'])
  })

  it('works the badges out when the accounts cannot be read, and holds them as unknown', async () => {
    apiMock.getAccounts.mockRejectedValueOnce(new Error('offline'))
    calls.transactions = month(thisMonth)

    await refreshAchievements()

    expect(snapshot()!.accounts).toBeNull()
    expect(unlocks().map((u) => u.id)).toContain('first-entry')
  })

  it('restores dismissed advice under the per-profile key', async () => {
    householdOfTwoAndThree()
    calls.budgets = [budget(2)]
    await refreshAchievements()
    await dismissAdvice('some-card')
    await restoreAdvice()

    const last = calls.updated![calls.updated!.length - 1] as Record<string, string>
    expect(Object.keys(last)).toEqual(['achievements:2'])
    expect(JSON.parse(last['achievements:2']).dismissedAdvice).toEqual([])
  })

  it('does not adopt the old record for a profile that already has its own', async () => {
    settingsStore.achievements = JSON.stringify({
      v: 1,
      unlocks: [
        { id: 'first-entry', earnedOn: '2026-07-01', unlockedAt: '2026-08-01T00:00:00.000Z' },
      ],
    })
    settingsStore['achievements:2'] = JSON.stringify({ v: 1, unlocks: [] })
    localStorage.setItem('currentProfileId', '2')

    await refreshAchievements()

    expect(unlocks()).toEqual([])
    expect(calls.updated).toBeUndefined()
  })
})

/**
 * Hold the next settings read until `release` is called: the evaluation's lists are read
 * meanwhile, and a switch or a write can land mid-run.
 */
const holdSettings = () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  apiMock.getSettings.mockImplementationOnce(async () => {
    await gate
    return { ...settingsStore }
  })
  return release
}

describe('a profile switch while an evaluation is running', () => {
  const ownBudget = {
    profile_id: 2,
    category_id: 1,
    amount: 100,
    period: 'monthly',
    start_date: `${thisMonth}-01`,
    end_date: null,
    created_at: `${thisMonth}-02`,
  }

  it("does not save the old profile's badges on the new one, or announce them there", async () => {
    // Cloud mode: the plain key, and the write goes to whichever profile is active when it is sent.
    env.mode = 'self-hosted'
    localStorage.setItem('currentProfileId', '2')
    calls.budgets = [ownBudget]
    const release = holdSettings()

    const running = refreshAchievements()
    localStorage.setItem('currentProfileId', '3')
    release()
    await running

    expect(calls.writtenAs ?? []).not.toContain('3')
    expect(toasts).toEqual([])
    expect(unlocks().map((u) => u.id)).not.toContain('first-budget')
  })

  it('evaluates the new profile instead of handing it the old run', async () => {
    localStorage.setItem('currentProfileId', '2')
    calls.budgets = [ownBudget]
    const release = holdSettings()

    const old = refreshAchievements()
    localStorage.setItem('currentProfileId', '3')
    const fresh = refreshAchievements()
    release()
    await Promise.all([old, fresh])

    expect(fresh).not.toBe(old)
    expect(apiMock.getSettings).toHaveBeenCalledTimes(2)
    expect(snapshot()!.budgets).toEqual([])
  })

  it("does not file the old profile's badges under the new one when advice is dismissed", async () => {
    env.mode = 'self-hosted'
    localStorage.setItem('currentProfileId', '2')
    calls.budgets = [ownBudget]
    await refreshAchievements()
    expect(unlocks().length).toBeGreaterThan(0)
    const writes = calls.updated!.length

    // Switched, and the new profile's evaluation has not finished yet.
    localStorage.setItem('currentProfileId', '3')
    await dismissAdvice('some-card')
    await restoreAdvice()

    expect(calls.updated!.length).toBe(writes)
  })

  it('keeps what the old profile earned, but does not announce it once the switch has happened', async () => {
    localStorage.setItem('currentProfileId', '2')
    calls.budgets = [ownBudget]
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    apiMock.updateSettings.mockImplementationOnce(async (data) => {
      await gate
      settingsStore = { ...settingsStore, ...data }
    })

    const running = refreshAchievements()
    // The switch lands while the record is being saved.
    await vi.waitFor(() => {
      expect(apiMock.updateSettings).toHaveBeenCalled()
    })
    localStorage.setItem('currentProfileId', '3')
    release()
    await running

    expect(parseRecords(settingsStore['achievements:2']).map((r) => r.id)).toContain('first-budget')
    expect(toasts).toEqual([])
  })
})

/**
 * A write that lands while an evaluation runs, after the evaluation has read its lists. The ask
 * it sets off (AchievementsHost, 1.2 s after the write) used to be handed the running evaluation,
 * whose lists predate the write, and nothing evaluated again: Getting started kept the account
 * list from before a second account was added.
 */
describe('a refresh asked for while an evaluation is running', () => {
  const account = (id: number, name: string) => ({
    id,
    name,
    type: 'savings',
    balance: 1000,
    profile_id: 1,
  })

  it('evaluates once more when the running one ends, so the snapshot holds the new account', async () => {
    localStorage.setItem('currentProfileId', '1')
    calls.accounts = [account(1, 'Rainy day')]
    const release = holdSettings()
    const running = refreshAchievements()
    expect(apiMock.getAccounts).toHaveBeenCalledTimes(1)

    // POST /api/accounts lands after the running evaluation read the accounts.
    calls.accounts = [account(1, 'Rainy day'), account(2, 'Holiday')]
    const asked = refreshAchievements()
    release()
    await Promise.all([running, asked])

    expect(snapshot()!.accounts!.map((a) => a.name)).toEqual(['Rainy day', 'Holiday'])
    expect(apiMock.getAccounts).toHaveBeenCalledTimes(2)
  })

  it('folds several asks into one more evaluation, and stops there', async () => {
    localStorage.setItem('currentProfileId', '1')
    const release = holdSettings()
    const running = refreshAchievements()
    const asks = [refreshAchievements(), refreshAchievements(), refreshAchievements()]
    expect(asks[1]).toBe(asks[0])
    expect(asks[2]).toBe(asks[0])
    release()
    await Promise.all([running, ...asks])
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(apiMock.getSettings).toHaveBeenCalledTimes(2)
  })

  it('does not evaluate the old profile again after a switch', async () => {
    localStorage.setItem('currentProfileId', '2')
    const release = holdSettings()
    const running = refreshAchievements()
    const asked = refreshAchievements()
    localStorage.setItem('currentProfileId', '3')
    release()
    await Promise.all([running, asked])
    await new Promise((resolve) => setTimeout(resolve, 20))

    // Profile 2's run only: the switch's own refresh evaluates profile 3.
    expect(apiMock.getSettings).toHaveBeenCalledTimes(1)
    expect(await asked).toEqual([])
  })

  it('starts no further evaluation when nothing asked during the run', async () => {
    localStorage.setItem('currentProfileId', '1')
    await refreshAchievements()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(apiMock.getSettings).toHaveBeenCalledTimes(1)
  })
})

describe('badges earned while the setup wizard is open', () => {
  afterEach(() => {
    if (onboardingOpen()) skipOnboarding()
  })

  it('are saved at once and announced when setup closes, not over it', async () => {
    startOnboarding('import')
    calls.transactions = [...month(thisMonth)]

    const newly = await refreshAchievements()

    expect(newly.length).toBeGreaterThan(1)
    expect(saved(0).unlocks).toHaveLength(newly.length)
    expect(toasts).toEqual([])

    completeOnboarding()

    expect(toasts).toEqual([`${newly.length} badges earned from your history so far.`])
  })

  it('from two evaluations are each announced by name when setup closes, as outside it', async () => {
    seed(
      JSON.stringify({
        v: 1,
        unlocks: [
          { id: 'first-entry', earnedOn: '2026-07-01', unlockedAt: '2026-08-01T00:00:00.000Z' },
        ],
      })
    )
    startOnboarding('account')
    calls.transactions = [...month(thisMonth)]
    const first = await refreshAchievements()
    calls.transactions = [...month(monthsAgo(2)), ...month(monthsAgo(1)), ...month(thisMonth)]
    const second = await refreshAchievements()
    expect(first.length).toBeGreaterThan(0)
    expect(second.length).toBeGreaterThan(0)
    expect(toasts).toEqual([])

    skipOnboarding()

    expect(toasts).toHaveLength(first.length + second.length)
    for (const toast of toasts) expect(toast).toMatch(/^Badge unlocked: .+\.$/)
  })

  it('are not announced on another profile, when setup closes after a switch', async () => {
    localStorage.setItem('currentProfileId', '1')
    startOnboarding('import')
    calls.transactions = [...month(thisMonth)]
    await refreshAchievements()

    localStorage.setItem('currentProfileId', '2')
    completeOnboarding()

    expect(toasts).toEqual([])
  })
})
