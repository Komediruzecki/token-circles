/**
 * Loan Calculator with variable rate periods and prepayments
 * Ported from backend/models/loanCalculator.js for client-only/serverless mode.
 */

interface RatePeriod {
  rate: number
  start_month: number
  end_month?: number | null
}

interface Prepayment {
  month: number
  amount: number
  note?: string
}

interface ScheduleRow {
  month: number
  date: string
  payment: number
  principal: number
  interest: number
  balance: number
  prepayment: number
  rate: number
  note: string
}

interface Summary {
  totalPaid: number
  totalInterest: number
  interestSaved: number
  monthsSaved: number
  payoffDate: string | null
  totalPayments: number
  avgMonthlyPayment: number
  maxBalance: number
  originalTotalInterest: number
  originalTotalPayments: number
}

export function calcMonthlyPayment(principal: number, annualRate: number, months: number): number {
  if (annualRate === 0) return principal / months
  const r = annualRate / 100 / 12
  return (principal * (r * Math.pow(1 + r, months))) / (Math.pow(1 + r, months) - 1)
}

export function calculateSchedule(
  principal: number,
  startDate: string,
  termMonths: number,
  ratePeriods: RatePeriod[],
  prepayments: Prepayment[] = []
): ScheduleRow[] {
  const sortedRates = [...ratePeriods].sort((a, b) => a.start_month - b.start_month)
  const sortedPrepayments = [...prepayments].sort((a, b) => a.month - b.month)

  const schedule: ScheduleRow[] = []
  let balance = principal
  let monthIndex = 0
  let lockedPayment: number | null = null

  while (balance > 0.01 && monthIndex < termMonths * 2) {
    monthIndex++

    let currentRate = 0
    for (const rp of sortedRates) {
      if (rp.start_month <= monthIndex) {
        if (!rp.end_month || monthIndex <= rp.end_month) {
          currentRate = rp.rate
        }
      }
    }

    const prepayment = sortedPrepayments.find((p) => p.month === monthIndex)
    const prepayAmount = prepayment ? prepayment.amount : 0

    const remainingMonths = termMonths - monthIndex + 1
    if (remainingMonths <= 0) break

    if (prepayment || lockedPayment === null) {
      lockedPayment = calcMonthlyPayment(balance, currentRate, remainingMonths)
    }

    const interestPortion = balance * (currentRate / 100 / 12)
    let principalPortion = lockedPayment - interestPortion

    if (prepayment) {
      principalPortion += prepayAmount
    }

    if (principalPortion > balance) {
      principalPortion = balance
    }

    balance = Math.max(0, balance - principalPortion)

    const d = new Date(startDate)
    d.setMonth(d.getMonth() + monthIndex - 1)
    const monthDate = d.toISOString().split('T')[0]

    schedule.push({
      month: monthIndex,
      date: monthDate,
      payment: lockedPayment,
      principal: principalPortion - (prepayment ? prepayAmount : 0),
      interest: interestPortion,
      balance,
      prepayment: prepayAmount || 0,
      rate: currentRate,
      note: prepayment ? prepayment.note || '' : '',
    })
  }

  return schedule
}

export function calculateScheduleNoPrepayments(
  principal: number,
  startDate: string,
  termMonths: number,
  ratePeriods: RatePeriod[]
): ScheduleRow[] {
  return calculateSchedule(principal, startDate, termMonths, ratePeriods, [])
}

export function totalInterest(schedule: ScheduleRow[]): number {
  return schedule.reduce((sum, row) => sum + row.interest, 0)
}

export function totalPaid(schedule: ScheduleRow[]): number {
  return schedule.reduce((sum, row) => sum + row.payment + row.prepayment, 0)
}

export function payoffDate(schedule: ScheduleRow[]): string | null {
  if (schedule.length === 0) return null
  return schedule[schedule.length - 1].date
}

export function interestSaved(
  originalSchedule: ScheduleRow[],
  prepaySchedule: ScheduleRow[]
): number {
  return totalInterest(originalSchedule) - totalInterest(prepaySchedule)
}

export function monthsSaved(
  originalSchedule: ScheduleRow[],
  prepaySchedule: ScheduleRow[]
): number {
  const saved = interestSaved(originalSchedule, prepaySchedule)
  const monthlyPayment = originalSchedule.length > 0 ? originalSchedule[0].payment : 1
  const equivMonths = Math.round(saved / monthlyPayment)
  const eliminatedMonths = originalSchedule.length - prepaySchedule.length
  return Math.max(equivMonths, eliminatedMonths)
}

export function getSummary(schedule: ScheduleRow[], originalSchedule: ScheduleRow[]): Summary {
  const originalInterest = totalInterest(originalSchedule)
  const newInterest = totalInterest(schedule)
  const originalMonths = originalSchedule.length

  return {
    totalPaid: totalPaid(schedule),
    totalInterest: newInterest,
    interestSaved: originalInterest - newInterest,
    monthsSaved: monthsSaved(originalSchedule, schedule),
    payoffDate: payoffDate(schedule),
    totalPayments: schedule.length,
    avgMonthlyPayment:
      schedule.length > 0 ? schedule.reduce((s, r) => s + r.payment, 0) / schedule.length : 0,
    maxBalance: schedule.length > 0 ? schedule[0].balance : 0,
    originalTotalInterest: originalInterest,
    originalTotalPayments: originalMonths,
  }
}
