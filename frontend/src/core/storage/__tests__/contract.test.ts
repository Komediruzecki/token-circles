import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { DIFFERENCES } from '../../../../../shared/contract/differences'
import { namedDifferences, samplePaths, unsent } from '../../../../../shared/contract/guard'
import { outbound } from '../../../../../shared/contract/outbound'
import { CONTRACT_ROUTES, LOCAL_ONLY, UNCOVERED } from '../../../../../shared/contract/routes'
import { SCENARIOS } from '../../../../../shared/contract/scenarios'
import { getDB } from '../idb.js'
import { localRoutes, routeApiRequest } from '../localApiRouter.js'
import type { Hit, RouteKey } from '../../../../../shared/contract/guard'
import type {
  ContractApi,
  Expect,
  Method,
  Owned,
  Reply,
  StoredKind,
} from '../../../../../shared/contract/types'

// The CRUD contract (shared/contract) against local-first: the real router and handlers on
// IndexedDB (fake-indexeddb, src/test-setup.ts). The Worker runs the same scenarios in
// worker/test/contract.test.ts. The last block checks that the scenarios sent every contract
// route, and that every route local-first serves is on a list.

// The browser's calendar is local-first's "today" and "this month" (#603). The Worker runner sends
// no X-Time-Zone, so the Worker's calendar is UTC's; local-first runs on UTC too, so both runtimes
// read one calendar whatever the machine's zone. A date bug that only shows in some zone is pinned
// by a test of its own in that zone (endOfNextMonth.test.ts, forecastHistoryLabels.test.ts).
const hostZone = process.env.TZ
process.env.TZ = 'UTC'
afterAll(() => {
  if (hostZone === undefined) delete process.env.TZ
  else process.env.TZ = hostZone
})

// Local-first's own requests to other services (a spreadsheet) are answered from
// shared/contract/outbound.ts, so no scenario reaches the network; anything else fails it.
beforeAll(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) =>
    outbound(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  )
})
afterAll(() => {
  vi.restoreAllMocks()
})

const hits: Hit[] = []
let ran = 0
const total = Object.values(SCENARIOS).reduce((n, list) => n + list.length, 0)

function apiFor(profile: number, partner: () => ContractApi, scoped = true): ContractApi {
  const send = async (method: Method, path: string, body?: unknown): Promise<Reply> => {
    // What the app has in place while this profile is the active one.
    localStorage.setItem('currentProfileId', String(profile))
    localStorage.setItem('selectedProfileIds', JSON.stringify([profile]))
    const form = body instanceof FormData
    const res = await routeApiRequest(`http://localhost${path}`, {
      method,
      headers: {
        ...(form ? {} : { 'Content-Type': 'application/json' }),
        ...(scoped ? { 'X-Profile-Id': String(profile) } : {}),
      },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    })
    const text = await res.text()
    let parsed: unknown = text
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      // Not JSON: the scenario gets the text.
    }
    hits.push({ method, path, status: res.status })
    return { status: res.status, body: parsed }
  }
  const api: ContractApi = {
    runtime: 'local',
    profile,
    get: (path) => send('GET', path),
    post: (path, body) => send('POST', path, body),
    put: (path, body) => send('PUT', path, body),
    patch: (path, body) => send('PATCH', path, body),
    delete: (path) => send('DELETE', path),
    get other() {
      return partner()
    },
    as: (id) => apiFor(id, () => api),
    get unscoped() {
      return apiFor(profile, partner, false)
    },
    stored,
  }
  return api
}

/** Each profile-scoped kind `stored` counts, by its object store. */
const PROFILE_STORES: Partial<Record<StoredKind, string>> = {
  accounts: 'accounts',
  bills: 'bills',
  budgets: 'budgets',
  categories: 'categories',
  'category mappings': 'categoryMappings',
  goals: 'goals',
  holdings: 'portfolioHoldings',
  housing: 'housings',
  'import logs': 'import_logs',
  'import sources': 'import_sources',
  loans: 'loans',
  recurring: 'recurring',
  'retirement goals': 'retirement_goals',
  'tag rules': 'tagRules',
  tags: 'tags',
  transactions: 'transactions',
}

type Row = Record<string, unknown>

/**
 * What IndexedDB holds for a profile (ContractApi.stored). A loan carries its rate periods and
 * extra payments, and a transaction its tag ids, so those are counted inside the rows still there.
 */
async function stored(profile: number, owned: Owned = {}): Promise<Record<StoredKind, number>> {
  const db = await getDB()
  const all = async (store: string) => (await db.getAll(store as never)) as Row[]
  const counts: Partial<Record<StoredKind, number>> = {}
  for (const [kind, store] of Object.entries(PROFILE_STORES)) {
    counts[kind as StoredKind] = (await all(store)).filter((r) => r.profile_id === profile).length
  }
  counts['retirement settings'] = (await db.get('settings', `retirement_settings:${profile}`))
    ? 1
    : 0
  const within = (rows: Row[], ids: readonly number[] = []) =>
    rows.filter((r) => ids.includes(Number(r.id)))
  const lengthOf = (value: unknown) => (Array.isArray(value) ? value.length : 0)
  const loans = within(await all('loans'), owned.loans)
  counts['loan rate periods'] = loans.reduce((n, l) => n + lengthOf(l.rate_periods), 0)
  counts['loan extra payments'] = loans.reduce((n, l) => n + lengthOf(l.prepayments), 0)
  counts['balance history'] = (await all('balanceHistory')).filter((r) =>
    (owned.accounts ?? []).includes(Number(r.account_id))
  ).length
  counts['transaction tags'] = within(await all('transactions'), owned.transactions).reduce(
    (n, t) => n + lengthOf(t.tag_ids),
    0
  )
  return counts as Record<StoredKind, number>
}

/** An empty browser with two profiles. Every scenario starts from one. */
async function person(): Promise<ContractApi> {
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01' })
  await db.add('profiles', { id: 2, name: 'Partner', created_at: '2026-01-01' })
  const mine: ContractApi = apiFor(1, () => theirs)
  const theirs: ContractApi = apiFor(2, () => mine)
  return mine
}

for (const [entity, list] of Object.entries(SCENARIOS)) {
  describe(`contract: ${entity}`, () => {
    for (const s of list) {
      it(s.name, async () => {
        expect.hasAssertions()
        await s.run(await person(), expect as unknown as Expect)
        ran += 1
      })
    }
  })
}

describe('contract: every route', () => {
  it('sends every contract route, and each answers 2xx', (ctx) => {
    // A filtered or failed run sent fewer routes than a full one: it proves nothing here.
    if (ran < total) ctx.skip()
    const missing = unsent(CONTRACT_ROUTES, hits)
    expect(
      missing.filter((k) => !UNCOVERED.includes(k)),
      'no scenario sends these'
    ).toEqual([])
    expect(
      UNCOVERED.filter((k) => !missing.includes(k)),
      'a scenario sends these now: take them off UNCOVERED'
    ).toEqual([])
  })

  it('serves every contract route, and lists every route it serves', () => {
    const serves = (key: RouteKey, route: (typeof localRoutes)[number]) =>
      route.methods.includes(key.slice(0, key.indexOf(' '))) &&
      samplePaths(key).some((p) => route.pattern.test(p.replace(/^\/api/, '')))
    expect(
      CONTRACT_ROUTES.filter((k) => !localRoutes.some((r) => serves(k, r))),
      'contract routes local-first does not serve'
    ).toEqual([])
    const unlisted = localRoutes.flatMap((r) =>
      r.methods
        .filter(
          (m) =>
            !CONTRACT_ROUTES.some((k) => k.startsWith(`${m} `) && serves(k, r)) &&
            !(`${m} ${r.pattern.source}` in LOCAL_ONLY)
        )
        .map((m) => `${m} ${r.pattern.source}`)
    )
    expect(unlisted, 'routes on no list in shared/contract/routes.ts').toEqual([])
  })

  it('pins every difference it lists, and lists every difference it pins', () => {
    const sources = import.meta.glob('../../../../../shared/contract/**/*.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    const named = new Set(
      Object.entries(sources)
        .filter(([path]) => !path.endsWith('/differences.ts'))
        .flatMap(([, source]) => namedDifferences(source))
    )
    expect(named.size, 'the scenario sources were read').toBeGreaterThan(0)
    expect(
      [...named].filter((id) => !(id in DIFFERENCES)),
      'DIFFERENCE comments with no entry in shared/contract/differences.ts'
    ).toEqual([])
    expect(
      Object.keys(DIFFERENCES).filter((id) => !named.has(id)),
      'entries in shared/contract/differences.ts that no scenario names'
    ).toEqual([])
  })
})
