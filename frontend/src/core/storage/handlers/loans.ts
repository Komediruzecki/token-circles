/**
 * Loans handlers — IndexedDB-backed implementations
 *
 * A loan, its rate periods and its extra payments are checked by shared/loanSchema.ts, as the
 * Worker's routes check them: a refused body answers 400 with what is wrong at each field, and an
 * edit checks and writes only what it changes.
 */
import { calculateLoan, loanStatus } from '../../../../../shared/loanSchedule'
import {
  checkExtraPaymentCreate,
  checkExtraPaymentEdit,
  checkLoanCreate,
  checkLoanEdit,
  checkRatePeriodCreate,
  checkRatePeriodEdit,
} from '../../../../../shared/loanSchema'
import { localToday } from '../../../utils/period'
import { getDB } from '../idb'
import { adapter, currentProfileRecord, idParam, json, notFound, ok, refuse } from './helpers'
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

/** A new loan as checked, with its rate periods; keys the app never reads are not stored. */
export async function loansCreate(body: unknown): Promise<Response> {
  const checked = checkLoanCreate(body)
  if (!checked.ok) return refuse(checked.fields)
  const loan: Record<string, unknown> = {
    ...checked.value,
    profile_id: await adapter.getCurrentProfileId(),
    prepayments: [],
  }
  giveIds(loan)
  const id = await adapter.createLoan(loan as unknown as Parameters<typeof adapter.createLoan>[0])
  return json({ id, ...loan }, 201)
}

/**
 * Gives each of a loan's extra payments and rate periods without a usable id one past the largest
 * of its list, so each keeps one id for good, as the Worker's rows do. The page changes and removes
 * an extra payment by that id, and the rate period routes address a period by it. A place in the
 * list would not do: removing an earlier row moves every later one up, and a change sent to a
 * place lands on whichever row has moved into it. A loan restored from a cloud backup keeps the
 * Worker's ids. Answers whether any row got one, so the caller can store the loan.
 */
function giveIds(loan: object): boolean {
  const usable = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0
  let changed = false
  for (const key of ['prepayments', 'rate_periods'] as const) {
    const list = (loan as Record<string, unknown>)[key]
    const rows = Array.isArray(list) ? (list as Record<string, unknown>[]) : []
    let next = rows.reduce((max, r) => (usable(r.id) ? Math.max(max, r.id) : max), 0)
    const seen = new Set<number>()
    for (const row of rows) {
      if (!usable(row.id) || seen.has(row.id)) {
        row.id = ++next
        changed = true
      }
      seen.add(row.id as number)
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

/**
 * An edit of a loan: only what it changes is checked and written, so a loan an older version
 * stored under other rules can still be renamed. Rate periods sent replace the stored ones when
 * they differ from them; sent back unchanged, they are left as they are, ids and all.
 */
export async function loansUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const id = idParam(params)
  const loan = await currentProfileRecord('loans', id)
  if (!loan) return notFound('Loan')
  const checked = checkLoanEdit(body, loan)
  if (!checked.ok) return refuse(checked.fields)
  if (Object.keys(checked.value).length === 0) return ok()
  const edit: Record<string, unknown> = { ...checked.value }
  if (edit.rate_periods !== undefined) giveIds(edit)
  await adapter.updateLoan(id, edit)
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
  const checked = checkRatePeriodCreate(body, loan.term_months)
  if (!checked.ok) return refuse(checked.fields)
  giveIds(loan)
  const rates = loan.rate_periods || []
  const id = rates.reduce((max: number, r: any) => Math.max(max, Number(r.id) || 0), 0) + 1
  rates.push({ ...checked.value, id })
  loan.rate_periods = rates
  await db.put('loans', loan)
  return json({ id }, 201)
}

/** Change the rate period whose id is `p2`: only what the body changes is checked and written. */
export async function loanRateUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const db = await getDB()
  const loan = await currentProfileRecord('loans', idParam(params))
  if (!loan) return notFound('Loan')
  const rateId = idParam(params, 'p2') // p2 is the rateId
  giveIds(loan)
  const rates = loan.rate_periods || []
  const index = rates.findIndex((r: any) => Number(r.id) === rateId)
  if (index < 0) return notFound('Rate period')
  const checked = checkRatePeriodEdit(body, rates[index], loan.term_months)
  if (!checked.ok) return refuse(checked.fields)
  rates[index] = { ...rates[index], ...checked.value, id: rateId }
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
  const extra = checkExtraPaymentCreate(body, loan.term_months)
  if (!extra.ok) return refuse(extra.fields)
  giveIds(loan)
  const prepayments = loan.prepayments || []
  const id = prepayments.reduce((max: number, p: { id: number }) => Math.max(max, p.id), 0) + 1
  prepayments.push({ ...extra.value, id })
  loan.prepayments = prepayments
  await db.put('loans', loan)
  return json({ id }, 201)
}

/**
 * Change the extra payment whose id is `p2`: only what the body changes is checked and written, so
 * one that goes with a payment a since-shortened term has passed keeps its month.
 */
export async function loanPrepaymentUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const db = await getDB()
  const loan = await currentProfileRecord('loans', idParam(params))
  if (!loan) return notFound('Loan')
  giveIds(loan)
  const prepayId = idParam(params, 'p2')
  const prepayments = loan.prepayments || []
  const index = prepayments.findIndex((p: { id: number }) => p.id === prepayId)
  if (index < 0) return notFound('Extra payment')
  const extra = checkExtraPaymentEdit(body, prepayments[index], loan.term_months)
  if (!extra.ok) return refuse(extra.fields)
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
