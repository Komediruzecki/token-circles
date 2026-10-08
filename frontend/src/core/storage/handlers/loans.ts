/**
 * Loans handlers — IndexedDB-backed implementations
 */
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
  // Newest first, as the Worker lists them and the Loans page shows them.
  const createdAt = (loan: object) => (loan as { created_at?: string }).created_at ?? ''
  const loans = (await adapter.listLoans()).sort(
    (a, b) => createdAt(b).localeCompare(createdAt(a)) || (b.id ?? 0) - (a.id ?? 0)
  )
  const today = localToday()
  const enriched = loans.map((l) => {
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

/**
 * Gives each of a loan's extra payments and rate periods that has none an id, one past the largest
 * of its list, as the Worker's rows have. The Loans page deletes an extra payment by the id the
 * loan's detail gives it, and the rate period routes address a period by its id; local-first
 * stored both without one. Answers whether any row got an id, so the caller can store the loan.
 */
function giveIds(loan: Record<string, any>): boolean {
  let changed = false
  for (const key of ['prepayments', 'rate_periods']) {
    const rows = (loan[key] ?? []) as Array<Record<string, unknown>>
    let next = rows.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0)
    for (const row of rows) {
      if (row.id === undefined || row.id === null) {
        row.id = ++next
        changed = true
      }
    }
  }
  return changed
}

export async function loansGet(params: Record<string, string>): Promise<Response> {
  const loan = await currentProfileRecord('loans', idParam(params))
  if (!loan) return notFound('Loan')
  // A loan stored before its rows had ids gets them the first time it is read.
  if (giveIds(loan)) await (await getDB()).put('loans', loan)
  return json(normalizeLoan(loan))
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
  giveIds(loan)
  const rates = loan.rate_periods || []
  const id = rates.reduce((max: number, r: any) => Math.max(max, Number(r.id) || 0), 0) + 1
  rates.push({ ...(body as Record<string, unknown>), id })
  loan.rate_periods = rates
  await db.put('loans', loan)
  return json({ id }, 201)
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
  giveIds(loan)
  const rates = loan.rate_periods || []
  const index = rates.findIndex((r: any) => Number(r.id) === rateId)
  if (index < 0) return notFound('Rate period')
  rates[index] = { ...rates[index], ...(body as Record<string, unknown>), id: rateId }
  loan.rate_periods = rates
  await db.put('loans', loan)
  return ok()
}

export async function loanRateDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const loan = await currentProfileRecord('loans', idParam(params))
  if (!loan) return notFound('Loan')
  const rateId = idParam(params, 'p2')
  giveIds(loan)
  const rates = loan.rate_periods || []
  const index = rates.findIndex((r: any) => Number(r.id) === rateId)
  if (index < 0) return notFound('Rate period')
  rates.splice(index, 1)
  loan.rate_periods = rates
  await db.put('loans', loan)
  return ok()
}

// Loan prepayments
export async function loanPrepayments(params: Record<string, string>): Promise<Response> {
  const loan = await currentProfileRecord('loans', idParam(params))
  if (!loan) return notFound('Loan')
  return json(loan.prepayments || [])
}

export async function loanPrepaymentAdd(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const db = await getDB()
  const loan = await currentProfileRecord('loans', idParam(params))
  if (!loan) return notFound('Loan')
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  giveIds(loan)
  const prepayments = loan.prepayments || []
  const id = prepayments.reduce((max: number, p: any) => Math.max(max, Number(p.id) || 0), 0) + 1
  prepayments.push({ ...(body as Record<string, unknown>), id })
  loan.prepayments = prepayments
  await db.put('loans', loan)
  return json({ id }, 201)
}

export async function loanPrepaymentsDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const loan = await currentProfileRecord('loans', idParam(params))
  if (!loan) return notFound('Loan')
  const prepayId = idParam(params, 'p2')
  giveIds(loan)
  const prepayments = loan.prepayments || []
  const index = prepayments.findIndex((p: any) => Number(p.id) === prepayId)
  if (index < 0) return notFound('Prepayment')
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
