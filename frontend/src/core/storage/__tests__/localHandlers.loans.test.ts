import { beforeEach, describe, expect, it } from 'vitest'
import { PARITY_LOAN } from '../../../../../shared/fixtures/loanParity'
import { calculateLoan } from '../../../../../shared/loanSchedule'
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
