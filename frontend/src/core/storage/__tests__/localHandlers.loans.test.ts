import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PARITY_LOAN } from '../../../../../shared/fixtures/loanParity'
import { calculateLoan, loanStatus } from '../../../../../shared/loanSchedule'
import { getDB } from '../idb.js'
import {
  loanPrepaymentAdd,
  loansCalculate,
  loansCreate,
  loansDelete,
  loansGet,
  loansList,
  loansUpdate,
} from '../localHandlers.js'

/** Store a loan the way the app does: the loan with its rate periods, then each extra payment. */
async function storeLoan(loan: typeof PARITY_LOAN): Promise<number> {
  const { prepayments, ...rest } = loan
  const created = await (await loansCreate({ name: 'Fixture loan', ...rest })).json()
  for (const p of prepayments) {
    expect((await loanPrepaymentAdd({ p1: String(created.id) }, { ...p })).status).toBe(201)
  }
  return created.id
}

describe('localHandlers - loans', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    // Reset data
    await db.clear('profiles')
    await db.clear('loans')

    // Seed initial data
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  })

  it('creates, lists, and gets a loan', async () => {
    const createRes = await loansCreate({
      name: 'Mortgage',
      principal: 200000,
      interest_rate: 3.5,
      term_months: 360,
      start_date: '2026-01-01',
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.id).toBeDefined()
    expect(created.name).toBe('Mortgage')

    // List
    const listRes = await loansList()
    expect(listRes.status).toBe(200)
    const list = await listRes.json()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(created.id)
    expect(list[0].principal).toBe(200000)

    // Get
    const getRes = await loansGet({ p1: created.id.toString() })
    expect(getRes.status).toBe(200)
    const fetched = await getRes.json()
    expect(fetched.id).toBe(created.id)
  })

  it('updates a loan', async () => {
    const createRes = await loansCreate({
      name: 'Car Loan',
      principal: 15000,
      interest_rate: 5,
      term_months: 60,
    })
    const created = await createRes.json()

    const updateRes = await loansUpdate(
      { p1: created.id.toString() },
      {
        ...created,
        interest_rate: 4.5,
      }
    )
    expect(updateRes.status).toBe(200)

    const getRes = await loansGet({ p1: created.id.toString() })
    const fetched = await getRes.json()
    expect(fetched.interest_rate).toBe(4.5)
  })

  it('deletes a loan', async () => {
    const createRes = await loansCreate({
      name: 'To Delete',
      principal: 1000,
      interest_rate: 10,
      term_months: 12,
    })
    const created = await createRes.json()

    const deleteRes = await loansDelete({ p1: created.id.toString() })
    expect(deleteRes.status).toBe(200)

    const listRes = await loansList()
    const list = await listRes.json()
    expect(list).toHaveLength(0)
  })

  it('calculates a loan schedule', async () => {
    const createRes = await loansCreate({
      name: 'Personal Loan',
      principal: 10000,
      interest_rate: 5,
      term_months: 12,
      start_date: '2026-01-01',
    })
    const created = await createRes.json()

    const calcRes = await loansCalculate({ p1: created.id.toString() })
    expect(calcRes.status).toBe(200)
    const schedule = await calcRes.json()

    // Assuming the calculate returns { summary: {...}, schedule: [...] }
    expect(schedule.summary).toBeDefined()
    expect(schedule.schedule).toBeDefined()
    expect(Array.isArray(schedule.schedule)).toBe(true)
  })

  it('calculates exactly what the shared engine computes from the stored loan', async () => {
    // worker/test/loans-calculate.test.ts stores the same fixture through the Worker and requires
    // the same answer, so both modes return the same schedule and summary for it.
    const id = await storeLoan(PARITY_LOAN)
    const res = await loansCalculate({ p1: String(id) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(calculateLoan(PARITY_LOAN))
    // The shape the Worker answers in, key for key.
    expect(Object.keys(body)).toEqual(['schedule', 'summary', 'comparison'])
    expect(Object.keys(body.schedule[0])).toEqual([
      'month',
      'date',
      'payment',
      'principal',
      'interest',
      'balance',
      'prepayment',
      'rate',
      'note',
    ])
    expect(Object.keys(body.summary)).toEqual([
      'totalPaid',
      'totalInterest',
      'interestSaved',
      'monthsSaved',
      'payoffDate',
      'totalPayments',
      'avgMonthlyPayment',
      'maxBalance',
      'originalTotalInterest',
      'originalTotalPayments',
    ])
  })

  it('charges the base rate outside the rate period and adds up same-month extras', async () => {
    const id = await storeLoan(PARITY_LOAN)
    const { schedule } = await (await loansCalculate({ p1: String(id) })).json()
    expect(schedule[11].rate).toBe(4.5)
    expect(schedule[12].rate).toBe(6.25)
    expect(schedule[30].rate).toBe(4.5)
    expect(schedule[5].prepayment).toBe(2000)
    expect(schedule[5].note).toBe('bonus; gift')
  })

  it('calculates a loan saved without a start date instead of failing', async () => {
    const created = await (
      await loansCreate({ name: 'Undated', principal: 1200, interest_rate: 0, term_months: 12 })
    ).json()
    const res = await loansCalculate({ p1: String(created.id) })
    expect(res.status).toBe(200)
    const { schedule, summary } = await res.json()
    expect(schedule).toHaveLength(12)
    expect(schedule[0].payment).toBe(100)
    expect(summary.payoffDate).toBeNull()
  })
})

describe('localHandlers - where each listed loan stands today', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    await db.clear('profiles')
    await db.clear('loans')
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
    await db.add('profiles', { id: 2, name: 'Partner', created_at: '2026-01-01' })
    // Only Date is faked: fake-indexeddb needs real timers to settle its requests.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2025-12-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // 100,000 at 5 % over 120 months from 2021-01-01. By 2025-12-15 sixty payments are due, so what
  // is owed is B_60 = P (1+r)^60 - A ((1+r)^60 - 1) / r = 56,204.87, with A = 1,060.66. The Loans
  // page used to subtract 60 whole installments from the principal and showed 36,360.69.
  const r = 0.05 / 12
  const A = (100000 * r * (1 + r) ** 120) / ((1 + r) ** 120 - 1)
  const B60 = 100000 * (1 + r) ** 60 - (A * ((1 + r) ** 60 - 1)) / r
  const example = {
    name: 'Example',
    principal: 100000,
    interest_rate: 5,
    start_date: '2021-01-01',
    term_months: 120,
  }

  it('adds remaining_balance, monthly_payment, next_payment_date and payoff_date from the shared engine', async () => {
    const plain = (await (await loansCreate({ ...example })).json()).id
    const busy = await storeLoan(PARITY_LOAN)

    const list = await (await loansList()).json()
    const row = list.find((l: { id: number }) => l.id === plain)
    expect(row.remaining_balance).toBeCloseTo(B60, 6)
    expect(row.remaining_balance).toBeCloseTo(56204.87, 2)
    expect(row.monthly_payment).toBeCloseTo(A, 6)
    expect(row.next_payment_date).toBe('2026-01-01')
    expect(row.payoff_date).toBe('2030-12-01')
    // Fields the list already had are still there.
    expect(row.principal).toBe(100000)
    expect(row.total_prepaid).toBe(0)
    expect(row.prepayment_count).toBe(0)

    // The loan with a rate period and extra payments gets its own figures, as the Worker's list
    // gives them for the same loan on the same day.
    const other = list.find((l: { id: number }) => l.id === busy)
    expect({
      remaining_balance: other.remaining_balance,
      monthly_payment: other.monthly_payment,
      next_payment_date: other.next_payment_date,
      payoff_date: other.payoff_date,
    }).toEqual(loanStatus(PARITY_LOAN, '2025-12-15'))
    expect(other.total_prepaid).toBe(5000)
    expect(other.prepayment_count).toBe(3)
  })

  it('lists the loans of every selected profile, each with its own figures', async () => {
    const mine = (await (await loansCreate({ ...example })).json()).id
    localStorage.setItem('currentProfileId', '2')
    const theirs = (
      await (await loansCreate({ ...example, principal: 50000, start_date: '2024-06-30' })).json()
    ).id
    localStorage.setItem('currentProfileId', '1')
    localStorage.setItem('selectedProfileIds', JSON.stringify([1, 2]))

    const list = await (await loansList()).json()
    expect(list.map((l: { id: number }) => l.id).sort()).toEqual([mine, theirs].sort())
    const partner = list.find((l: { id: number }) => l.id === theirs)
    expect(partner.profile_id).toBe(2)
    expect({
      remaining_balance: partner.remaining_balance,
      monthly_payment: partner.monthly_payment,
      next_payment_date: partner.next_payment_date,
      payoff_date: partner.payoff_date,
    }).toEqual(loanStatus({ ...example, principal: 50000, start_date: '2024-06-30' }, '2025-12-15'))
  })

  it('owes the whole principal on a loan saved without a start date', async () => {
    await loansCreate({ name: 'Undated', principal: 1200, interest_rate: 0, term_months: 12 })
    const [row] = await (await loansList()).json()
    expect(row.remaining_balance).toBe(1200)
    expect(row.monthly_payment).toBe(100)
    expect(row.next_payment_date).toBeNull()
    expect(row.payoff_date).toBeNull()
  })
})
