/**
 * When a bill falls due next, and whether it is paid, in local-first: the twin of
 * worker/test/bill-schedule.test.ts, by the same rule (shared/billSchedule.ts), through
 * `routeApiRequest`, the router `apiFetch` calls.
 *
 * Where local-first used to differ from the Worker:
 *
 * - GET /api/dashboard answered no upcoming bills at all, so the Dashboard's card showed in cloud
 *   mode only (the contract's `dashboard-upcoming-bills`).
 * - GET /api/bills/upcoming answered the stored rows whose due day of the month was today or
 *   later, with no date (`bills-upcoming`).
 * - The list answered the stored next_due_date, which is always null.
 * - A weekly bill paid a week ago could not be paid on the day it fell due again.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const GIRO = 21
const UTILITIES = 11

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of ['profiles', 'categories', 'accounts', 'bills', 'transactions'] as const) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('categories', {
    id: UTILITIES,
    profile_id: 1,
    name: 'Utilities',
    type: 'expense',
    color: '#F97316',
  } as never)
  await db.add('accounts', {
    id: GIRO,
    profile_id: 1,
    name: 'Giro',
    balance: 1000,
    starting_balance: 1000,
  } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

/** Stop the clock at noon on `date`, on this machine's calendar. */
function on(date: string): void {
  const [year, month, day] = date.split('-').map(Number)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(year!, month! - 1, day!, 12))
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return routeApiRequest(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function get<T>(path: string): Promise<T> {
  const res = await send('GET', path)
  expect(res.status, `GET ${path}`).toBe(200)
  return (await res.json()) as T
}

/** A bill as the Bills form saves it: no day of the month, its due date the first one. */
async function bill(name: string, fields: Record<string, unknown>): Promise<number> {
  const res = await send('POST', '/api/bills', {
    name,
    amount: 60,
    frequency: 'monthly',
    account_id: GIRO,
    category_id: UTILITIES,
    ...fields,
  })
  expect(res.status, `POST ${name}`).toBe(201)
  return ((await res.json()) as { id: number }).id
}

type Due = {
  id: number
  name: string
  next_due_date: string
  days_until: number
  is_overdue: boolean
  paid: boolean
  last_paid: string | null
  category_name: string | null
}

const upcoming = () => get<Due[]>('/api/bills/upcoming')
const dashboard = async () =>
  (await get<{ upcomingBills: Due[] }>('/api/dashboard')).upcomingBills.map((b) => ({
    name: b.name,
    next_due_date: b.next_due_date,
    days_until: b.days_until,
  }))

describe("the Dashboard's Upcoming Bills", () => {
  it('lists a monthly bill every month, by the day of its first due date', async () => {
    on('2026-10-08')
    await bill('Power', { dueDate: '2026-08-20' })
    expect(await dashboard()).toEqual([
      { name: 'Power', next_due_date: '2026-10-20', days_until: 12 },
    ])
  })

  it('moves a bill on once it is paid', async () => {
    on('2026-10-25')
    const id = await bill('Water', { dueDate: '2026-09-28' })
    expect(await dashboard()).toEqual([
      { name: 'Water', next_due_date: '2026-10-28', days_until: 3 },
    ])
    expect((await send('POST', `/api/bills/${id}/mark-paid`)).status).toBe(200)
    // November's is 34 days away: past the card's 30.
    expect(await dashboard()).toEqual([])
    expect((await upcoming())[0]).toMatchObject({ next_due_date: '2026-11-28', paid: true })
  })

  it('lists no paused bill, and none that is overdue', async () => {
    on('2026-10-08')
    const paused = await bill('Gym', { dueDate: '2026-10-10' })
    expect((await send('PUT', `/api/bills/${paused}`, { is_active: false })).status).toBe(200)
    await bill('Phone', { dueDate: '2026-09-05' })
    await bill('Rent', { dueDate: '2026-10-08' })
    expect((await dashboard()).map((b) => b.name)).toEqual(['Rent'])
  })

  it('lists the soonest five', async () => {
    on('2026-10-01')
    for (const [name, day] of [
      ['F', '06'],
      ['B', '02'],
      ['E', '05'],
      ['A', '01'],
      ['D', '04'],
      ['C', '03'],
    ] as const) {
      await bill(name, { dueDate: `2026-10-${day}` })
    }
    expect((await dashboard()).map((b) => b.name)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })
})

describe('GET /api/bills/upcoming', () => {
  it('answers when each bill falls due next, with its category', async () => {
    on('2026-10-08')
    await bill('Power', { dueDate: '2026-09-15' })
    expect((await upcoming())[0]).toMatchObject({
      name: 'Power',
      category_name: 'Utilities',
      next_due_date: '2026-10-15',
      days_until: 7,
      is_overdue: false,
      paid: false,
      last_paid: null,
    })
  })

  it('reads a payment an older version recorded only as last_paid', async () => {
    on('2026-10-08')
    const id = await bill('Power', { dueDate: '2026-09-15' })
    const db = await getDB()
    await db.put('bills', {
      ...(await db.get('bills', id)),
      last_paid_date: null,
      last_paid: '2026-10-02',
    })
    expect((await upcoming())[0]).toMatchObject({
      next_due_date: '2026-11-15',
      paid: true,
      last_paid: '2026-10-02',
    })
  })

  it('calls a bill whose day has passed unpaid overdue, the most overdue first', async () => {
    on('2026-10-20')
    await bill('Power', { dueDate: '2026-09-15' })
    await bill('Phone', { dueDate: '2026-09-05' })
    await bill('Rent', { dueDate: '2026-09-25' })
    expect(
      (await upcoming()).map((b) => [b.name, b.next_due_date, b.days_until, b.is_overdue])
    ).toEqual([
      ['Phone', '2026-10-05', -15, true],
      ['Power', '2026-10-15', -5, true],
      ['Rent', '2026-10-25', 5, false],
    ])
  })

  it('gives a biweekly bill its date, two weeks after it was paid', async () => {
    on('2026-09-29')
    const id = await bill('Cleaner', { dueDate: '2026-09-29', frequency: 'biweekly' })
    expect((await send('POST', `/api/bills/${id}/mark-paid`)).status).toBe(200)
    on('2026-10-08')
    expect((await upcoming())[0]).toMatchObject({
      next_due_date: '2026-10-13',
      days_until: 5,
      paid: true,
    })
  })
})

describe('GET /api/bills', () => {
  it('answers when each bill falls due next', async () => {
    on('2026-10-08')
    await bill('Power', { dueDate: '2026-08-20' })
    const [power] = await get<{ next_due_date: string | null; due_date: string }[]>('/api/bills')
    expect(power).toMatchObject({ due_date: '2026-08-20', next_due_date: '2026-10-20' })
  })

  it("names each bill's category, as the Worker's list does", async () => {
    on('2026-10-08')
    await bill('Power', { dueDate: '2026-08-20' })
    await bill('Rent', { dueDate: '2026-08-01', category_id: null })
    const list =
      await get<{ name: string; category_name: unknown; category_color: unknown }[]>('/api/bills')
    expect(list.map((b) => [b.name, b.category_name, b.category_color])).toEqual([
      ['Power', 'Utilities', '#F97316'],
      ['Rent', null, null],
    ])
  })
})

describe('a weekly bill', () => {
  it('can be paid on the day it falls due again, a week after the last payment', async () => {
    on('2026-10-01')
    const id = await bill('Cleaner', { dueDate: '2026-10-01', frequency: 'weekly', amount: 25 })
    expect((await send('POST', `/api/bills/${id}/mark-paid`)).status).toBe(200)
    on('2026-10-07')
    expect((await send('POST', `/api/bills/${id}/mark-paid`)).status).toBe(409)
    on('2026-10-08')
    expect((await upcoming())[0]).toMatchObject({ next_due_date: '2026-10-08', days_until: 0 })
    expect((await send('POST', `/api/bills/${id}/mark-paid`)).status).toBe(200)
    expect((await (await getDB()).get('accounts', GIRO))?.balance).toBe(950)
  })

  // Its dates are Mondays from its first due date, whenever it is paid: a payment two days late
  // pays that Monday, and the next Monday is due, and payable, on the day. It was due a week after
  // the payment, a Wednesday, and next Monday's payment answered 409.
  it('falls due on its own weekday after a late payment, and can be paid that day', async () => {
    on('2026-10-05')
    const id = await bill('Cleaner', { dueDate: '2026-10-05', frequency: 'weekly', amount: 25 })
    on('2026-10-07')
    expect((await send('POST', `/api/bills/${id}/mark-paid`)).status).toBe(200)
    on('2026-10-08')
    expect((await upcoming())[0]).toMatchObject({
      next_due_date: '2026-10-12',
      days_until: 4,
      paid: true,
    })
    on('2026-10-12')
    expect((await upcoming())[0]).toMatchObject({
      next_due_date: '2026-10-12',
      days_until: 0,
      paid: false,
    })
    expect((await send('POST', `/api/bills/${id}/mark-paid`)).status).toBe(200)
  })

  // Paid two days before its first due date, the payment pays that date. The bill showed as paid
  // with that date as its next, then overdue for it once it had passed, and took a second payment.
  it('counts a payment made before its first due date for that date', async () => {
    on('2026-10-08')
    const id = await bill('Cleaner', { dueDate: '2026-10-10', frequency: 'weekly', amount: 25 })
    expect((await send('POST', `/api/bills/${id}/mark-paid`)).status).toBe(200)
    on('2026-10-11')
    expect((await upcoming())[0]).toMatchObject({
      next_due_date: '2026-10-17',
      days_until: 6,
      paid: true,
    })
    expect((await send('POST', `/api/bills/${id}/mark-paid`)).status).toBe(409)
    on('2026-10-17')
    expect((await upcoming())[0]).toMatchObject({
      next_due_date: '2026-10-17',
      days_until: 0,
      paid: false,
    })
    expect((await send('POST', `/api/bills/${id}/mark-paid`)).status).toBe(200)
  })
})
