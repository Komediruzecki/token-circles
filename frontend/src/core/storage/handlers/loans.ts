/**
 * Loans handlers — IndexedDB-backed implementations
 */
import { calculateSchedule, getSummary } from '../../loanCalculator'
import { getDB } from '../idb'
import { adapter, currentProfileRecord, idParam, json, notFound, ok } from './helpers'

export async function loansList(): Promise<Response> {
  const loans = await adapter.listLoans()
  const enriched = loans.map((l) => {
    const prepayments = (l as any).prepayments as Array<{ amount: number }> | undefined
    const total_prepaid = prepayments?.reduce((s, p) => s + (p.amount || 0), 0) || 0
    const prepayment_count = prepayments?.length || 0
    return { ...l, total_prepaid, prepayment_count }
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
  return json(loan)
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
  const prepayments = loan.prepayments || []
  prepayments.push(body as Record<string, unknown>)
  loan.prepayments = prepayments
  await db.put('loans', loan)
  return json({ ok: true }, 201)
}

export async function loanPrepaymentsDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const loan = await currentProfileRecord('loans', idParam(params))
  if (!loan) return notFound('Loan')
  const prepayId = idParam(params, 'p2')
  const prepayments = loan.prepayments || []
  if (prepayId >= 0 && prepayId < prepayments.length) {
    prepayments.splice(prepayId, 1)
    loan.prepayments = prepayments
    await db.put('loans', loan)
    return ok()
  }
  return notFound('Prepayment')
}

// Loan amortization calculate (ported from backend/models/loanCalculator.js)
export async function loansCalculate(params: Record<string, string>): Promise<Response> {
  try {
    const loan = await currentProfileRecord('loans', idParam(params))
    if (!loan) return notFound('Loan')

    const ratePeriods = (loan.rate_periods || []) as Array<{
      rate: number
      start_month: number
      end_month?: number | null
    }>
    const prepayments = (loan.prepayments || []) as Array<{
      month: number
      amount: number
      note?: string
    }>

    // Prepend the loan's initial rate as the first rate period
    const initialRatePeriod = {
      rate: (loan.interest_rate as number) || 0,
      start_month: 1,
      end_month: null as number | null,
    }
    const allRatePeriods = [initialRatePeriod, ...ratePeriods]

    const scheduleWithPrepayments = calculateSchedule(
      loan.principal as number,
      loan.start_date as string,
      loan.term_months as number,
      allRatePeriods,
      prepayments
    )

    const scheduleNoPrepayments = calculateSchedule(
      loan.principal as number,
      loan.start_date as string,
      loan.term_months as number,
      allRatePeriods,
      []
    )

    const summary = getSummary(scheduleWithPrepayments, scheduleNoPrepayments)

    return json({
      schedule: scheduleWithPrepayments,
      summary,
      comparison: {
        withPrepayments: summary,
        withoutPrepayments: getSummary(scheduleNoPrepayments, scheduleNoPrepayments),
      },
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}
