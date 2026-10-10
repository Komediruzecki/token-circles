/**
 * What the local-first router refuses for a portfolio holding, and how it says it: the twin of
 * worker/test/holding-refusals.test.ts, by the same rules (shared/holdingSchema.ts), through
 * `routeApiRequest`, the router `apiFetch` calls.
 *
 * Where local-first used to differ from the Worker:
 *
 * - Its zod schema refused a ticker over 10 characters and said what was wrong in zod's terms.
 * - The same schema ran on an edit as if it were a new holding, so an edit that sent one field
 *   was refused for the ones it left out, and one that sent the form's whole body was refused for
 *   any value an older version had stored.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { HOLDING_MESSAGES as M } from '../../../../../shared/holdingSchema'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const OTHER_PROFILE = 2
const PLAN = 51
const OLD = 52 // a ticker over 20 characters, a price below zero and a date that is none
const ELSEWHERE = 53
const LONG_TICKER = 'EXAMPLE-FUND-CLASS-A.XX'

const PLAN_ROW = {
  ticker: 'EXMPL',
  shares: 12,
  purchase_price: 48.5,
  purchase_date: '2026-02-10',
  notes: 'Monthly plan',
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of ['profiles', 'portfolioHoldings'] as const) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('profiles', { id: OTHER_PROFILE, name: 'Else', created_at: '2026-01-01' })
  const holding = (id: number, profile: number, values: Record<string, unknown>) =>
    db.add('portfolioHoldings', {
      id,
      profile_id: profile,
      ...PLAN_ROW,
      created_at: '2026-01-01T00:00:00.000Z',
      ...values,
    } as never)
  await holding(PLAN, 1, {})
  await holding(OLD, 1, {
    ticker: LONG_TICKER,
    purchase_price: -5,
    purchase_date: 'soon',
    notes: '',
  })
  await holding(ELSEWHERE, OTHER_PROFILE, { ticker: 'THEIRS' })
})

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  return routeApiRequest(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function refusal(res: Response): Promise<{ status: number; body: unknown }> {
  return { status: res.status, body: await res.json() }
}

/** The holding's stored fields, as the Worker test reads its columns. */
async function stored(id: number): Promise<Record<string, unknown> | undefined> {
  const row = (await (await getDB()).get('portfolioHoldings', id)) as
    Record<string, unknown> | undefined
  if (!row) return undefined
  const { ticker, shares, purchase_price, purchase_date, notes } = row
  return { ticker, shares, purchase_price, purchase_date, notes }
}

async function count(): Promise<number> {
  return (await (await getDB()).getAllFromIndex('portfolioHoldings', 'by_profile', 1)).length
}

/** What the Portfolio form posts. */
const FORM = {
  ticker: 'SAMPL',
  shares: 2.5,
  purchase_price: 101.25,
  purchase_date: '2026-03-02',
  notes: 'First buy',
}

describe('POST /api/portfolio/holdings', () => {
  it('refuses a body without a ticker, shares, a price or a date, at each field', async () => {
    expect(await refusal(await call('POST', '/api/portfolio/holdings', {}))).toEqual({
      status: 400,
      body: {
        error: `${M.ticker} ${M.shares} ${M.price} ${M.date}`,
        fields: {
          ticker: M.ticker,
          shares: M.shares,
          purchase_price: M.price,
          purchase_date: M.date,
        },
      },
    })
    expect(await count()).toBe(2)
  })

  it('refuses a ticker, shares, a price and a date it cannot store', async () => {
    const res = await call('POST', '/api/portfolio/holdings', {
      ...FORM,
      ticker: LONG_TICKER,
      shares: 'lots',
      purchase_price: -5,
      purchase_date: 'soon',
    })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.tickerLength} ${M.sharesNumber} ${M.pricePositive} ${M.dateReal}`,
        fields: {
          ticker: M.tickerLength,
          shares: M.sharesNumber,
          purchase_price: M.pricePositive,
          purchase_date: M.dateReal,
        },
      },
    })
    expect(await count()).toBe(2)
  })

  it('takes a ticker of up to 20 characters, where it refused one over 10', async () => {
    const res = await call('POST', '/api/portfolio/holdings', { ...FORM, ticker: 'SAMPLE-FUND.XX' })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: number }
    expect((await stored(id))?.ticker).toBe('SAMPLE-FUND.XX')
  })

  it('stores what the Portfolio form sends, the ticker trimmed and in capitals, and answers 201', async () => {
    const res = await call('POST', '/api/portfolio/holdings', { ...FORM, ticker: ' sampl ' })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: number }
    expect(await stored(id)).toEqual(FORM)
  })
})

describe('PUT /api/portfolio/holdings/:id', () => {
  it('changes only what it sends', async () => {
    expect((await call('PUT', `/api/portfolio/holdings/${PLAN}`, { notes: 'Paused' })).status).toBe(
      200
    )
    expect((await call('PUT', `/api/portfolio/holdings/${PLAN}`, { shares: 15 })).status).toBe(200)
    expect(await stored(PLAN)).toEqual({ ...PLAN_ROW, shares: 15, notes: 'Paused' })
  })

  it('refuses a blank ticker, shares it cannot read and a blank date at their fields, and stores nothing', async () => {
    const res = await call('PUT', `/api/portfolio/holdings/${PLAN}`, {
      ...PLAN_ROW,
      ticker: ' ',
      shares: 'lots',
      purchase_date: '',
    })
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.ticker} ${M.sharesNumber} ${M.date}`,
        fields: { ticker: M.ticker, shares: M.sharesNumber, purchase_date: M.date },
      },
    })
    expect(await stored(PLAN)).toEqual(PLAN_ROW)
  })

  it('takes back what an older version stored, and changes what the edit changes', async () => {
    const res = await call('PUT', `/api/portfolio/holdings/${OLD}`, {
      ticker: LONG_TICKER,
      shares: 12,
      purchase_price: -5,
      purchase_date: 'soon',
      notes: 'Still here',
    })
    expect(res.status).toBe(200)
    expect(await stored(OLD)).toEqual({
      ticker: LONG_TICKER,
      shares: 12,
      purchase_price: -5,
      purchase_date: 'soon',
      notes: 'Still here',
    })
  })

  it("answers 404 for another profile's holding, and changes nothing", async () => {
    const res = await call('PUT', `/api/portfolio/holdings/${ELSEWHERE}`, { notes: 'Mine now' })
    expect(await refusal(res)).toEqual({ status: 404, body: { error: M.notFound } })
    expect((await stored(ELSEWHERE))?.notes).toBe('Monthly plan')
    expect(await refusal(await call('DELETE', `/api/portfolio/holdings/${ELSEWHERE}`))).toEqual({
      status: 404,
      body: { error: M.notFound },
    })
  })
})
