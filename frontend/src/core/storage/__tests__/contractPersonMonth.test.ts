/**
 * The contract's housing scenario reads "this month" as the person's calendar has it, as both
 * runtimes do: a housing expense sent without a due month falls due in the person's month.
 *
 * The scenario built the month from UTC. The two contract runners only agreed with it because both
 * run on UTC (contract.test.ts, and the Worker without an X-Time-Zone). Here local-first runs
 * fourteen hours ahead of UTC on the last day of a month, where the person's month is the next one.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { housing } from '../../../../../shared/contract/scenarios/housing'
import { getDB } from '../idb'
import type { ContractApi, Expect, Reply } from '../../../../../shared/contract/types'

const hostZone = process.env.TZ
process.env.TZ = 'Pacific/Kiritimati'
afterAll(() => {
  if (hostZone === undefined) delete process.env.TZ
  else process.env.TZ = hostZone
})

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  const db = await getDB()
  await db.clear('housings')
  await db.clear('profiles')
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  // 31 October at noon in UTC is already 1 November, 02:00, on Kiritimati.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-31T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

async function send(method: string, path: string, body?: unknown): Promise<Reply> {
  const res = await routeApiRequest(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Profile-Id': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as unknown) : null,
    type: res.headers.get('Content-Type') ?? '',
  }
}

const unused = (): never => {
  throw new Error('not used by this scenario')
}

const api: ContractApi = {
  runtime: 'local',
  profile: 1,
  get: (path) => send('GET', path),
  post: (path, body) => send('POST', path, body),
  put: (path, body) => send('PUT', path, body),
  patch: (path, body) => send('PATCH', path, body),
  delete: (path) => send('DELETE', path),
  get other(): ContractApi {
    return unused()
  },
  get unscoped(): ContractApi {
    return unused()
  },
  get household(): ContractApi {
    return unused()
  },
  as: unused,
  stored: unused,
}

describe("the housing scenario's month, off UTC", () => {
  it("expects the person's month, as local-first stores it", async () => {
    const [falls] = housing.filter((s) => s.name.includes('without a due month'))
    expect(falls).toBeDefined()
    await falls!.run(api, expect as unknown as Expect)

    const [row] = (await (await getDB()).getAll('housings')) as { due_date: string }[]
    expect(row?.due_date).toBe('11-15')
  })
})
