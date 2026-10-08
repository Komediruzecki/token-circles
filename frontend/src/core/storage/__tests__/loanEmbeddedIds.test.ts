/**
 * A local-first loan's extra payments and rate periods carry ids, so they can be addressed.
 *
 * Local-first keeps both inside the loan record, and stored them as posted, without an id. The
 * Loans page deletes an extra payment by the id the loan's detail gives it, so it asked for
 * `/prepayments/undefined` and nothing was deleted; the rate period routes took a position in
 * the list for the Worker's row id. New rows now get an id; a loan stored before that gets them
 * the first time it is read. The contract scenarios "extra payments are added, listed and
 * removed" and "rate periods are added, changed and removed by their own routes" cover new rows;
 * this file covers the stored ones.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb'
import { routeApiRequest } from '../localApiRouter'

async function call(method: string, path: string, body?: unknown) {
  const res = await routeApiRequest(`http://localhost/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

let loanId: number

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  const db = await getDB()
  for (const store of ['profiles', 'loans']) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01' })
  // A loan as local-first stored one before its extra payments and rate periods had ids.
  loanId = (await db.add('loans', {
    profile_id: 1,
    name: 'Car',
    principal: 15000,
    interest_rate: 4.5,
    start_date: '2026-01-15',
    term_months: 60,
    rate_periods: [
      { rate: 6, start_month: 13, end_month: 24 },
      { rate: 5, start_month: 25, end_month: null },
    ],
    prepayments: [
      { month: 12, amount: 2000, note: 'Bonus' },
      { month: 24, amount: 500, note: '' },
    ],
    created_at: '2026-01-01T00:00:00.000Z',
  })) as number
})

describe('the extra payments of a loan stored without ids', () => {
  it('get ids when the loan is read, and keep them', async () => {
    const first = await call('GET', `/loans/${loanId}`)
    expect(first.body.prepayments.map((p: { id: number }) => p.id)).toEqual([1, 2])
    const again = await call('GET', `/loans/${loanId}`)
    expect(again.body.prepayments.map((p: { id: number }) => p.id)).toEqual([1, 2])
  })

  it('can be deleted by the id the detail gives them', async () => {
    const detail = await call('GET', `/loans/${loanId}`)
    const bonus = detail.body.prepayments[0]
    expect((await call('DELETE', `/loans/${loanId}/prepayments/${bonus.id}`)).status).toBe(200)
    const after = await call('GET', `/loans/${loanId}`)
    expect(after.body.prepayments).toEqual([{ month: 24, amount: 500, note: '', id: 2 }])
  })

  it('give a new one the next id', async () => {
    const added = await call('POST', `/loans/${loanId}/prepayments`, { month: 36, amount: 100 })
    expect(added).toEqual({ status: 201, body: { id: 3 } })
  })
})

describe('the rate periods of a loan stored without ids', () => {
  it('get ids when the loan is read, and are changed and removed by them', async () => {
    const detail = await call('GET', `/loans/${loanId}`)
    expect(detail.body.rate_periods.map((r: { id: number }) => r.id)).toEqual([1, 2])
    const put = await call('PUT', `/loans/${loanId}/rates/2`, {
      rate: 4.5,
      start_month: 25,
      end_month: 48,
    })
    expect(put.status).toBe(200)
    expect((await call('DELETE', `/loans/${loanId}/rates/1`)).status).toBe(200)
    const after = await call('GET', `/loans/${loanId}`)
    expect(after.body.rate_periods).toEqual([{ rate: 4.5, start_month: 25, end_month: 48, id: 2 }])
  })
})
