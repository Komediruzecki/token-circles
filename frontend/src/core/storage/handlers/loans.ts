/**
 * Loans handlers — IndexedDB-backed implementations
 */
import { readExtraPayment } from '../../../../../shared/loanExtraPayment'
import { calculateLoan, loanStatus } from '../../../../../shared/loanSchedule'
import { localToday } from '../../../utils/period'
import { getDB } from '../idb'
import { adapter, currentProfileRecord, idParam, json, notFound, ok } from './helpers'
import { normalizeLoan } from './normalize'
import type { LoanInput } from '../../../../../shared/loanSchedule'

/**
 * Every loan of the selected profiles, with its prepayment rollups and where it stands today:
 * remaining_balance, monthly_payment and payoff_date, from the shared engine, as the Worker's list
 * returns them. "Today" is the person's date in both runtimes: the browser's local one here, the
 * zone the app sends in the Worker (worker/src/local-date.ts).
 */
export async function loansList(): Promise<Response> {
  const loans = await adapter.listLoans()
  const today = localToday()
  const enriched = loans.map((l) => {
    // A loan stored without ids is answered with the ones loansGet stores on its first read.
    giveIds(l)
    const prepayments = (l as any).prepayments as Array<{ amount: number }> | undefined
    const total_prepaid = prepayments?.reduce((s, p) => s + (p.amount || 0), 0) || 0
    const prepayment_count = prepayments?.length || 0
    return {
      ...normalizeLoan(l),
      total_prepaid,
      prepayment_count,
      ...loanStatus(loanInput(l as Record<string, any>), today),
    }
  })
  return json(enriched)
}

export async function loansCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid loan data' }, 400)
  const loan = body as Record<string, unknown>
  loan.profile_id = await adapter.getCurrentProfileId()
  loan.rate_periods = loan.rate_periods || []
  loan.prepayments = loan.prepayments || []
  const id = await adapter.createLoan(loan as unknown as Parameters<typeof adapter.createLoan>[0])
  return json({ id, ...loan }, 201)
}

export async function loansGet(params: Record<string, string>): Promise<Response> {
  const loan = await currentProfileRecord('loans', idParam(params))
  if (!loan) return notFound('Loan')
  // A loan stored before its extra payments had ids gets them the first time it is read.
  if (giveIds(loan)) await (await getDB()).put('loans', loan)
  return json(normalizeLoan(loan))
}

/**
 * Gives each of a loan's extra payments without a usable id one past the largest it has, so each
 * keeps one id for good, as the Worker's rows do. The page changes and removes an extra payment by
 * that id. Its place in the list would not do: removing an earlier payment moves every later one
 * up, and a change sent to a place lands on whichever payment has moved into it. A loan restored
 * from a cloud backup keeps the Worker's ids. Answers whether any payment got one, so the caller
 * can store the loan.
 */
function giveIds(loan: object): boolean {
  const list = (loan as { prepayments?: unknown }).prepayments
  const rows = Array.isArray(list) ? (list as Record<string, unknown>[]) : []
  const usable = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0
  let next = rows.reduce((max, r) => (usable(r.id) ? Math.max(max, r.id) : max), 0)
  const seen = new Set<number>()
  let changed = false
  for (const row of rows) {
    if (!usable(row.id) || seen.has(row.id)) {
      row.id = ++next
      changed = true
    }
    seen.add(row.id as number)
  }
  return changed
}

export async function loansUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const id = idParam(params)
  if (!(await currentProfileRecord('loans', id))) return notFound('Loan')
  await adapter.updateLoan(id, body as Record<string, unknown>)
  return ok()
}

export async function loansDelete(params: Record<string, string>): Promise<Response> {
  const id = idParam(params)
  if (!(await currentProfileRecord('loans', id))) return notFound('Loan')
  await adapter.deleteLoan(id)
  return ok()
}

// Loan rate periods
export async function loanRates(params: Record<string, string>): Promise<Response> {
  const loan = await currentProfileRecord('loans', idParam(params))
  if (!loan) return notFound('Loan')
  return json(loan.rate_periods || [])
}

export async function loanRatesAdd(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const db = await getDB()
  const loan = await currentProfileRecord('loans', idParam(params))
  if (!loan) return notFound('Loan')
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const rates = loan.rate_periods || []
  rates.push(body as Record<string, unknown>)
  loan.rate_periods = rates
  await db.put('loans', loan)
  return json({ ok: true }, 201)
}

export async function loanRateUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const db = await getDB()
  const loan = await currentProfileRecord('loans', idParam(params))
  if (!loan) return notFound('Loan')
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const rateId = idParam(params, 'p2') // p2 is the rateId
  const rates = loan.rate_periods || []
  if (rateId >= 0 && rateId < rates.length) {
    rates[rateId] = { ...rates[rateId], ...(body as Record<string, unknown>) }
    loan.rate_periods = rates
    await db.put('loans', loan)
    return ok()
  }
  return notFound('Rate period')
}

export async function loanRateDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const loan = await currentProfileRecord('loans', idParam(params))
  if (!loan) return notFound('Loan')
  const rateId = idParam(params, 'p2')
  const rates = loan.rate_periods || []
  if (rateId >= 0 && rateId < rates.length) {
    rates.splice(rateId, 1)
    loan.rate_periods = rates
    await db.put('loans', loan)
    return ok()
  }
  return notFound('Rate period')
}

// Loan prepayments
export async function loanPrepayments(params: Record<string, string>): Promise<Response> {
  const loan = await currentProfileRecord('loans', idParam(params))
  if (!loan) return notFound('Loan')
  if (giveIds(loan)) await (await getDB()).put('loans', loan)
  return json(loan.prepayments || [])
}

export async function loanPrepaymentAdd(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const db = await getDB()
  const loan = await currentProfileRecord('loans', idParam(params))
  if (!loan) return notFound('Loan')
  const extra = readExtraPayment(body, loan.term_months)
  if (!extra.ok) return json({ error: extra.error }, 400)
  giveIds(loan)
  const prepayments = loan.prepayments || []
  const id = prepayments.reduce((max: number, p: { id: number }) => Math.max(max, p.id), 0) + 1
  prepayments.push({ ...extra.value, id })
  loan.prepayments = prepayments
  await db.put('loans', loan)
  return json({ id }, 201)
}

/** Change the extra payment whose id is `p2`, checked as an added one is. */
export async function loanPrepaymentUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const db = await getDB()
  const loan = await currentProfileRecord('loans', idParam(params))
  if (!loan) return notFound('Loan')
  const extra = readExtraPayment(body, loan.term_months)
  if (!extra.ok) return json({ error: extra.error }, 400)
  giveIds(loan)
  const prepayId = idParam(params, 'p2')
  const prepayments = loan.prepayments || []
  const index = prepayments.findIndex((p: { id: number }) => p.id === prepayId)
  if (index < 0) return notFound('Extra payment')
  prepayments[index] = { ...prepayments[index], ...extra.value }
  loan.prepayments = prepayments
  await db.put('loans', loan)
  return ok()
}

export async function loanPrepaymentsDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const loan = await currentProfileRecord('loans', idParam(params))
  if (!loan) return notFound('Loan')
  giveIds(loan)
  const prepayId = idParam(params, 'p2')
  const prepayments = loan.prepayments || []
  const index = prepayments.findIndex((p: { id: number }) => p.id === prepayId)
  if (index < 0) return notFound('Extra payment')
  prepayments.splice(index, 1)
  loan.prepayments = prepayments
  await db.put('loans', loan)
  return ok()
}

/**
 * A stored loan as the shared engine reads it. The record carries its own rate periods and extra
 * payments, and its interest_rate is the base rate the engine charges where no period applies.
 */
function loanInput(loan: Record<string, any>): LoanInput {
  return {
    principal: loan.principal,
    interest_rate: loan.interest_rate,
    start_date: loan.start_date,
    term_months: loan.term_months,
    rate_periods: loan.rate_periods ?? [],
    prepayments: loan.prepayments ?? [],
  }
}

// Loan amortization: shared/loanSchedule.ts, the same engine the Worker's route calls, so both
// modes return the same schedule and summary for the same loan.
export async function loansCalculate(params: Record<string, string>): Promise<Response> {
  try {
    const loan = await currentProfileRecord('loans', idParam(params))
    if (!loan) return notFound('Loan')
    return json(calculateLoan(loanInput(loan)))
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}
