import { describe, expect, it } from 'vitest'
import { samplePaths, unsent } from '../../../../../shared/contract/guard'
import { CONTRACT_ROUTES, LOCAL_ONLY, UNCOVERED } from '../../../../../shared/contract/routes'
import { SCENARIOS } from '../../../../../shared/contract/scenarios'
import { getDB } from '../idb.js'
import { localRoutes, routeApiRequest } from '../localApiRouter.js'
import type { Hit, RouteKey } from '../../../../../shared/contract/guard'
import type { ContractApi, Expect, Method, Reply } from '../../../../../shared/contract/types'

// The CRUD contract (shared/contract) against local-first: the real router and handlers on
// IndexedDB (fake-indexeddb, src/test-setup.ts). The Worker runs the same scenarios in
// worker/test/contract.test.ts. The last block checks that the scenarios sent every contract
// route, and that every route local-first serves is on a list.

const hits: Hit[] = []
let ran = 0
const total = Object.values(SCENARIOS).reduce((n, list) => n + list.length, 0)

function apiFor(profile: number, partner: () => ContractApi): ContractApi {
  const send = async (method: Method, path: string, body?: unknown): Promise<Reply> => {
    // What the app has in place while this profile is the active one.
    localStorage.setItem('currentProfileId', String(profile))
    localStorage.setItem('selectedProfileIds', JSON.stringify([profile]))
    const res = await routeApiRequest(`http://localhost${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Profile-Id': String(profile) },
      body: body === undefined ? undefined : JSON.stringify(body),
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
  return {
    runtime: 'local',
    get: (path) => send('GET', path),
    post: (path, body) => send('POST', path, body),
    put: (path, body) => send('PUT', path, body),
    patch: (path, body) => send('PATCH', path, body),
    delete: (path) => send('DELETE', path),
    get other() {
      return partner()
    },
  }
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
})
