/**
 * The circles' store (core/guidance.ts): it works the circles out only while Progress or Dashboard
 * is on screen, after the page has painted, and again when what it reads changes (an evaluation,
 * a settings write, a portfolio write); it never answers one profile's circles for another; and a
 * failed accounts read reads as not known, not as nothing.
 */
import { createRoot } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bumpProfileVersion, setPage } from '../appStore'
import { invalidateEntity, invalidateForRequest } from '../dataVersions'
import { __resetGuidanceForTest, holdingsOf, useGuidance, withdrawalRateIn } from '../guidance'
import type { guidanceFacts as GuidanceFacts } from '../../../../shared/guidance/facts'
import type { AchievementsSnapshot } from '../achievementsStore'
import type { GuidanceView } from '../guidance'

const store = vi.hoisted(() => ({ set: null as ((s: unknown) => void) | null }))
const counted = vi.hoisted(() => ({ facts: 0 }))
const net = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  holdings: [] as unknown[],
  settingsReads: 0,
  holdingsReads: 0,
  failSettings: false,
}))

vi.mock('../achievementsStore', async () => {
  const { createRoot, createSignal } = await import('solid-js')
  return createRoot(() => {
    const [snapshot, setSnapshot] = createSignal<unknown>(null)
    store.set = (s) => setSnapshot(() => s)
    return { snapshot }
  })
})

vi.mock('../../../../shared/guidance/facts', async (importOriginal) => {
  const real = await importOriginal<{ guidanceFacts: typeof GuidanceFacts }>()
  return {
    ...real,
    guidanceFacts: (...args: Parameters<typeof GuidanceFacts>) => {
      counted.facts++
      return real.guidanceFacts(...args)
    },
  }
})

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: {
    getSettings: async () => {
      net.settingsReads++
      if (net.failSettings) throw new Error('offline')
      return { ...net.settings }
    },
  },
  apiGet: async (url: string) => {
    if (url === '/api/portfolio/holdings') {
      net.holdingsReads++
      return net.holdings
    }
    throw new Error(`unexpected GET ${url}`)
  },
  getLocalCurrency: () => 'EUR',
}))

const TODAY = '2026-10-15'

/** 'YYYY-MM' `n` months before October 2026. */
const ago = (n: number) => {
  const d = new Date(Date.UTC(2026, 9 - n, 1))
  return d.toISOString().slice(0, 7)
}

/**
 * Fourteen months of a salary of 3,000 and rent and food of 1,800, on a current account, for
 * profile `profileId`; accounts as given (null for a failed read).
 */
function snap(
  profileId: number,
  accounts: AchievementsSnapshot['accounts'] = [
    { id: 1, name: 'Everyday', type: 'giro', balance: 2000 } as never,
    { id: 2, name: 'Savings', type: 'savings', balance: 4000 } as never,
  ]
): AchievementsSnapshot {
  const transactions = Array.from({ length: 14 }, (_, i) => ago(i + 1)).flatMap((month) => [
    { id: 0, date: `${month}-01`, type: 'income', amount: 3000, category_id: 1, account_id: 1 },
    { id: 0, date: `${month}-03`, type: 'expense', amount: -1000, category_id: 2, account_id: 1 },
    { id: 0, date: `${month}-08`, type: 'expense', amount: -800, category_id: 3, account_id: 1 },
  ])
  return {
    profileId,
    transactions: transactions as never,
    budgets: [],
    goals: [],
    importLogs: [],
    loans: [],
    categories: [
      { id: 1, name: 'Salary', type: 'income' },
      { id: 2, name: 'Rent', type: 'expense', kind: 'housing' },
      { id: 3, name: 'Groceries', type: 'expense', kind: 'groceries' },
    ] as never,
    bills: [],
    accounts,
    evaluation: { trackedMonths: [] } as never,
    today: TODAY,
  }
}

const disposers: (() => void)[] = []
let view: () => GuidanceView | null

/** A page's use of the store, as its component makes it. */
function use(page: 'progress' | 'dashboard'): () => GuidanceView | null {
  return createRoot((dispose) => {
    disposers.push(dispose)
    return useGuidance(page)
  })
}

function mount(page: 'progress' | 'dashboard' = 'progress'): void {
  view = use(page)
}

/** A frame and a task: what the store waits for before it works the circles out. */
const painted = () => new Promise((resolve) => setTimeout(resolve, 40))

/** Long enough for a read that lands and a frame after it. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 200))

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('finance_storage_mode', 'self-hosted')
  net.settings = {}
  net.holdings = []
  net.settingsReads = 0
  net.holdingsReads = 0
  net.failSettings = false
  counted.facts = 0
  store.set!(null)
  __resetGuidanceForTest()
  bumpProfileVersion()
})

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

describe('when it works the circles out', () => {
  it('works nothing out while neither Progress nor Dashboard is on screen', async () => {
    setPage('transactions')
    mount('progress')
    store.set!(snap(1))
    await settled()
    expect(counted.facts).toBe(0)
    expect(view()).toBeNull()

    setPage('progress')
    await vi.waitFor(() => {
      expect(view()).not.toBeNull()
    })
    expect(counted.facts).toBe(1)
    // A year on file, own income covering spending, 3.3 months of essentials in reach.
    expect(view()!.placement.current).toBe(5)

    // Back on another page, a new evaluation waits for Progress.
    setPage('budgets')
    store.set!(snap(1))
    await settled()
    expect(counted.facts).toBe(1)
    // ...and is worked out once Progress is on screen again.
    setPage('progress')
    await vi.waitFor(() => {
      expect(counted.facts).toBe(2)
    })
  })

  it('works nothing out for a page left before it painted', async () => {
    setPage('progress')
    mount('progress')
    store.set!(snap(1))
    await vi.waitFor(() => {
      expect(view()).not.toBeNull()
    })
    store.set!(snap(1))
    setPage('budgets')
    await settled()
    expect(counted.facts).toBe(1)
  })

  it('works them out once for both pages', async () => {
    setPage('dashboard')
    mount('dashboard')
    const progress = use('progress')
    store.set!(snap(1))
    await vi.waitFor(() => {
      expect(view()).not.toBeNull()
    })
    setPage('progress')
    await painted()
    expect(progress()).toBe(view())
    expect(counted.facts).toBe(1)
  })
})

describe('what it follows', () => {
  it('follows a new evaluation, a settings write and a portfolio write', async () => {
    setPage('progress')
    mount('progress')
    store.set!(snap(1))
    await vi.waitFor(() => {
      expect(view()).not.toBeNull()
    })
    const first = view()!
    expect(first.facts.invested).toBe(0)

    // An answer saved: the settings are read again, and the circles take it.
    net.settings = { guidance: JSON.stringify({ carriesCardBalance: true, setsAsideYearly: true }) }
    invalidateEntity('settings')
    await vi.waitFor(() => {
      expect(view()!.inputs.answers.carriesCardBalance).toBe(true)
    })
    expect(view()!.facts.setsAsideYearly).toBe(true)

    // A holding bought: invested money counts it, at what was paid.
    net.holdings = [
      { profile_id: 1, marketValue: 1200 },
      { profile_id: 2, marketValue: 99999 },
    ]
    invalidateEntity('portfolio')
    await vi.waitFor(() => {
      expect(view()!.facts.invested).toBe(1200)
    })

    // A new evaluation, as after an import.
    const before = counted.facts
    store.set!(snap(1))
    await vi.waitFor(() => {
      expect(counted.facts).toBe(before + 1)
    })
  })

  it('works nothing out again for a settings write that changes none of its inputs', async () => {
    setPage('progress')
    mount('progress')
    store.set!(snap(1))
    await vi.waitFor(() => {
      expect(view()).not.toBeNull()
    })
    const first = view()
    const reads = net.settingsReads
    invalidateEntity('settings')
    await vi.waitFor(() => {
      expect(net.settingsReads).toBe(reads + 1)
    })
    await settled()
    expect(counted.facts).toBe(1)
    expect(view()).toBe(first)
  })

  // An evaluation that earns a badge saves the badge record in the settings. The circles never
  // read it: Dashboard asked for its settings and holdings again after every badge earned.
  it('reads nothing again when a badge record is saved', async () => {
    setPage('dashboard')
    mount('dashboard')
    store.set!(snap(1))
    await vi.waitFor(() => {
      expect(view()).not.toBeNull()
    })
    const reads = { settings: net.settingsReads, holdings: net.holdingsReads }

    invalidateForRequest('/api/settings', 'PUT', true, JSON.stringify({ achievements: '{"v":1}' }))
    await settled()
    expect({ settings: net.settingsReads, holdings: net.holdingsReads }).toEqual(reads)

    // Any other settings write is still read again: the base currency, an answer.
    invalidateForRequest('/api/settings', 'PUT', true, JSON.stringify({ currency: 'USD' }))
    await vi.waitFor(() => {
      expect(net.settingsReads).toBe(reads.settings + 1)
    })
  })

  // The retirement plan is saved with PUT /api/retirement/settings, which bumps `retirement`, not
  // `settings`: the circles kept the withdrawal rate they first read until some other write.
  it('follows a retirement plan save, and not a retirement goal write', async () => {
    setPage('dashboard')
    mount('dashboard')
    store.set!(snap(1))
    await vi.waitFor(() => {
      expect(view()).not.toBeNull()
    })
    expect(view()!.inputs.withdrawalRatePct).toBe(4)
    const reads = net.settingsReads

    // A goal holds no part of the plan: nothing to read again.
    invalidateForRequest('/api/retirement-goals', 'POST', true, '{}')
    await settled()
    expect(net.settingsReads).toBe(reads)

    net.settings = { retirement_settings: JSON.stringify({ safeWithdrawalRatePct: 3 }) }
    invalidateForRequest('/api/retirement/settings', 'PUT', true, '{}')
    await vi.waitFor(() => {
      expect(view()!.inputs.withdrawalRatePct).toBe(3)
    })
    expect(net.settingsReads).toBe(reads + 1)
  })

  it('keeps the answers it read when a later settings read fails', async () => {
    net.settings = { guidance: JSON.stringify({ carriesCardBalance: false }) }
    setPage('progress')
    mount('progress')
    store.set!(snap(1))
    await vi.waitFor(() => {
      expect(view()?.inputs.answers.carriesCardBalance).toBe(false)
    })
    net.failSettings = true
    invalidateEntity('settings')
    await painted()
    expect(view()!.inputs.answers.carriesCardBalance).toBe(false)
  })
})

describe('one profile at a time', () => {
  it("never answers the old profile's circles after a switch", async () => {
    setPage('progress')
    mount('progress')
    store.set!(snap(1))
    await vi.waitFor(() => {
      expect(view()?.profileId).toBe(1)
    })

    localStorage.setItem('currentProfileId', '2')
    bumpProfileVersion()
    expect(view()).toBeNull()
    // The old profile's evaluation is still the one on hand: nothing is shown for it.
    await painted()
    expect(view()).toBeNull()

    store.set!(snap(2))
    await vi.waitFor(() => {
      expect(view()?.profileId).toBe(2)
    })
  })
})

describe('the benchmarks gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  /** Germany, where free money is asked about, with an answer to it on file. */
  const freeMoneyAnswered = () => {
    net.settings = {
      guidance: JSON.stringify({ region: 'DE', freeMoney: { region: 'DE', answer: 'taken' } }),
    }
  }
  const freeMoneyCheck = (shown: GuidanceView) =>
    shown.placement.circles[3].checks.find((check) => check.id === 'free-money')

  it('holds free money back in the production build, answer or not', async () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_ENABLE_BENCHMARKS', '')
    freeMoneyAnswered()
    setPage('progress')
    mount('progress')
    store.set!(snap(1))
    await vi.waitFor(() => {
      expect(view()).not.toBeNull()
    })
    expect(view()!.region.region).toBe('DE')
    expect(view()!.inputs.answers.freeMoney).toEqual({ region: 'DE', answer: 'taken' })
    expect(view()!.gate).toBe(false)
    expect(freeMoneyCheck(view()!)).toBeUndefined()
  })

  it('shows it on dev, where the same answer meets the check', async () => {
    vi.stubEnv('MODE', 'development')
    freeMoneyAnswered()
    setPage('progress')
    mount('progress')
    store.set!(snap(1))
    await vi.waitFor(() => {
      expect(view()).not.toBeNull()
    })
    expect(view()!.gate).toBe(true)
    expect(freeMoneyCheck(view()!)).toMatchObject({ met: true, required: false })
  })
})

describe('what is not known', () => {
  it('reads accounts that did not load as not known, not as none', async () => {
    setPage('progress')
    mount('progress')
    store.set!(snap(1, null))
    await vi.waitFor(() => {
      expect(view()).not.toBeNull()
    })
    expect(view()!.facts.accountsKnown).toBe(false)
    const cushion = view()!.placement.circles[2].checks.find((c) => c.id === 'first-cushion')!
    expect(cushion).toMatchObject({ met: null, unknown: 'unread' })
  })
})

describe('the ledger and the next step', () => {
  it('words the rows, the status and the step in whole units of the base currency', async () => {
    setPage('progress')
    mount('progress')
    store.set!(snap(1))
    await vi.waitFor(() => {
      expect(view()).not.toBeNull()
    })
    const { rows, status, next } = view()!
    expect(rows.map((row) => row.state)).toEqual([
      'reached',
      'reached',
      'reached',
      'reached',
      'current',
      'later',
      'later',
    ])
    expect(rows[2].detail).toBe('€6,000 you can reach, against €1,800 needed a month.')
    expect(status.meta).toBe('Circle 5 of 7')
    // A year on file: the step is the circles', not Getting started's.
    expect(next).toMatchObject({ id: 'two-years', circle: 5 })
  })

  it("takes Getting started's first step while less than a year is on file", async () => {
    setPage('progress')
    mount('progress')
    const full = snap(1)
    const recent = full.transactions.filter((t) => t.date >= `${ago(5)}-01`)
    store.set!({ ...full, transactions: recent })
    await vi.waitFor(() => {
      expect(view()).not.toBeNull()
    })
    expect(view()!.facts.firm).toBe(false)
    expect(view()!.next).toMatchObject({ id: 'import-year', circle: 1 })
    expect(view()!.status.meta).toBe('For now: 5 of 12 months')
  })
})

describe('the retirement plan and the holdings', () => {
  it('reads the withdrawal rate where each runtime keeps the plan', () => {
    const plan = JSON.stringify({ safeWithdrawalRatePct: 3.5 })
    localStorage.setItem('finance_storage_mode', 'self-hosted')
    expect(withdrawalRateIn({ retirement_settings: plan }, 1)).toBe(3.5)
    expect(withdrawalRateIn({}, 1)).toBe(4)
    expect(withdrawalRateIn({ retirement_settings: '{broken' }, 1)).toBe(4)
    localStorage.setItem('finance_storage_mode', 'serverless')
    expect(
      withdrawalRateIn(
        { 'retirement_settings:2': { safeWithdrawalRatePct: 3 }, retirement_settings: plan },
        2
      )
    ).toBe(3)
    // A plan saved before the key named the profile, not yet opened by one.
    expect(withdrawalRateIn({ retirement_settings: { safeWithdrawalRatePct: 5 } }, 2)).toBe(5)
  })

  it("adds up the profile's holdings at what was paid, and none that could not be read", () => {
    const rows = [
      { profile_id: 1, marketValue: 1000 },
      { profile_id: 1, marketValue: 250.5 },
      { profile_id: 3, marketValue: 7000 },
      { marketValue: 10 },
    ]
    expect(holdingsOf(rows, 1)).toBe(1260.5)
    expect(holdingsOf([], 1)).toBe(0)
    expect(holdingsOf({ error: 'x' }, 1)).toBeNull()
  })
})
