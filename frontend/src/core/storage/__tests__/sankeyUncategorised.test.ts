/**
 * The month's budget flow (GET /api/analytics/sankey) in local-first: the twin of
 * worker/test/sankey-uncategorised.test.ts, through `routeApiRequest`, the router `apiFetch`
 * calls. Both show spending without a category as one Uncategorized category, budgeted at what was
 * spent. Here a row stored without the key and one stored with null made two Uncategorized nodes
 * of one name.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const FOOD = 1

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of ['profiles', 'categories', 'budgets', 'transactions'] as const) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('categories', {
    id: FOOD,
    profile_id: 1,
    name: 'Food',
    type: 'expense',
    color: '#F97316',
  } as never)
  await db.add('budgets', {
    profile_id: 1,
    category_id: FOOD,
    amount: 300,
    period: 'monthly',
    start_date: '2026-10-01',
    end_date: null,
    rollover_enabled: false,
    rollover_amount: 0,
    created_at: '2026-01-01T00:00:00.000Z',
  } as never)
  let id = 1
  const expense = (category: number | null | undefined, date: string, amount: number) => {
    const row: Record<string, unknown> = {
      id: id++,
      profile_id: 1,
      description: 'spent',
      amount,
      amount_local: amount,
      currency: 'EUR',
      exchange_rate: 1,
      type: 'expense',
      date,
      account_id: null,
      transfer_account_id: null,
      notes: '',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }
    if (category !== undefined) row.category_id = category
    return db.add('transactions', row as never)
  }
  await expense(FOOD, '2026-10-04', 200)
  await expense(null, '2026-10-09', 30)
  await expense(undefined, '2026-10-21', 20.5)
  // Another month's: in no October flow.
  await expense(null, '2026-09-30', 99)
})

type Flow = {
  nodes: { name: string; category: string }[]
  links: { source: string; target: string; value: number }[]
}

async function flow(query: string): Promise<Flow> {
  const res = await routeApiRequest(`/api/analytics/sankey?${query}`)
  expect(res.status).toBe(200)
  return (await res.json()) as Flow
}

describe('GET /api/analytics/sankey', () => {
  it("counts the month's uncategorised spending in Total Actual, as one Uncategorized", async () => {
    const { nodes, links } = await flow('year=2026&month=10')
    expect(nodes.map((n) => n.name)).toEqual([
      'Total Budget',
      'Food',
      'Uncategorized',
      'Total Actual',
      'Unused Budget',
    ])
    expect(links.map((l) => [l.source, l.target, l.value])).toEqual([
      ['Total Budget', 'Food', 300],
      ['Food', 'Total Actual', 200],
      ['Total Budget', 'Uncategorized', 50.5],
      ['Uncategorized', 'Total Actual', 50.5],
      ['Total Budget', 'Unused Budget', 100],
    ])
  })

  it('draws a month spent entirely without categories', async () => {
    await (await getDB()).clear('budgets')
    const { nodes } = await flow('year=2026&month=9')
    expect(nodes.map((n) => n.name)).toEqual(['Total Budget', 'Uncategorized', 'Total Actual'])
  })
})
