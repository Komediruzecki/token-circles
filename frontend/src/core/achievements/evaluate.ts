/**
 * The one place a badge is decided. Pure and deterministic: everything, including "today", is
 * an input, so a fixture profile always evaluates the same way. Runs over arrays the app already
 * holds; cost is one pass per array.
 */
import { calculateSchedule, payoffDate } from '../loanCalculator'
import { ACHIEVEMENTS, TRACKED_MONTH_MIN_TRANSACTIONS, VOLUME_STEPS } from './definitions'
import { addMonths, currentStreak, monthOf, monthReaching, runs } from './months'
import type { Budget, SavingsGoal, Transaction } from '../../types/models'
import type { AchievementId } from './definitions'

export interface EvaluateInput {
  transactions: Array<Pick<Transaction, 'date' | 'type' | 'amount' | 'category_id' | 'reconciled'>>
  budgets: Array<
    Pick<Budget, 'category_id' | 'amount' | 'period' | 'start_date' | 'end_date' | 'created_at'>
  >
  goals: Array<
    Pick<SavingsGoal, 'target_amount' | 'current_amount' | 'created_at' | 'deadline' | 'name'>
  >
  importLogs: Array<{ created_at: string }>
  /**
   * Enough of each loan to run the amortisation: the schedule, not a stored balance, is what
   * says when a loan reached zero, and prepayments are what make that earlier than the term.
   */
  loans: Array<{
    principal: number
    start_date: string
    term_months: number
    rate_periods: Array<{ rate: number; start_month: number; end_month: number | null }>
    prepayments: Array<{ month: number; amount: number }>
  }>
  /** Server mode against an origin that is not ours. */
  selfHosted: boolean
  /** YYYY-MM-DD. Injected so evaluation is reproducible. */
  today: string
}

export interface Earned {
  id: AchievementId
  /** First day of the month the rule was met, YYYY-MM-01. */
  earnedOn: string
}

export interface Evaluation {
  earned: Earned[]
  /** Live figure: consecutive tracked months ending this month or last. */
  streak: number
  trackedMonths: string[]
}

export type Tx = EvaluateInput['transactions'][number]

const MONTH_RE = /^\d{4}-\d{2}/
const firstDay = (month: string): string => `${month}-01`
const earliestMonth = (dates: string[]): string | null => {
  const months = dates
    .filter((d) => MONTH_RE.test(d))
    .map(monthOf)
    .sort()
  return months[0] ?? null
}
const sum = sumTypes

/**
 * The month in which the nth transaction was entered, by transaction date. Volume badges are
 * dated to when the count was actually reached, not to today, so importing ten years of
 * statements dates the hundredth entry to the month it happened.
 */
function monthOfNth(transactions: EvaluateInput['transactions'], n: number): string | null {
  const dates = transactions
    .map((t) => t.date)
    .filter((d) => MONTH_RE.test(d))
    .sort()
  const at = dates[n - 1]
  return at === undefined ? null : monthOf(at)
}

/** Transactions grouped by 'YYYY-MM', skipping anything without a parseable date. */
export function bucketByMonth(transactions: EvaluateInput['transactions']): Map<string, Tx[]> {
  const byMonth = new Map<string, Tx[]>()
  for (const t of transactions) {
    if (!MONTH_RE.test(t.date)) continue
    const m = monthOf(t.date)
    const list = byMonth.get(m)
    if (list) list.push(t)
    else byMonth.set(m, [t])
  }
  return byMonth
}

/** Total of the given transaction types, absolute amounts. */
export function sumTypes(list: Tx[], types: string[]): number {
  return list.filter((t) => types.includes(t.type)).reduce((acc, t) => acc + Math.abs(t.amount), 0)
}

export function evaluateAchievements(input: EvaluateInput): Evaluation {
  const nowMonth = monthOf(input.today)
  const byMonth = bucketByMonth(input.transactions)
  const tracked = [...byMonth.entries()]
    .filter(([, list]) => list.length >= TRACKED_MONTH_MIN_TRANSACTIONS)
    .map(([m]) => m)
    .sort()
  const trackedSet = new Set(tracked)
  const inMonth = (m: string): Tx[] => byMonth.get(m) ?? []

  // Deductions count as outflow: what leaves the profile in the month.
  const savingMonths = tracked.filter(
    (m) => sum(inMonth(m), ['income']) > sum(inMonth(m), ['expense', 'deduction'])
  )
  const namedMonths = tracked.filter((m) =>
    inMonth(m).every((t) => t.type === 'transfer' || t.category_id !== null)
  )
  const reconciledMonths = tracked.filter((m) => inMonth(m).every((t) => t.reconciled === true))
  // Income, spending and a transfer, all named: the month someone used the app for everything.
  const fullPictureMonths = tracked.filter((m) => {
    const list = inMonth(m)
    if (!list.every((t) => t.category_id !== null || t.type === 'transfer')) return false
    return ['income', 'expense', 'transfer'].every((kind) => list.some((t) => t.type === kind))
  })
  const heldMonths = tracked.filter((m) => {
    if (m >= nowMonth) return false // only finished months
    const start = firstDay(m)
    const end = `${m}-31`
    const active = input.budgets.filter(
      (b) =>
        b.period === 'monthly' &&
        b.start_date <= end &&
        (b.end_date === null || b.end_date >= start)
    )
    if (active.length === 0) return false
    const list = inMonth(m)
    return active.every(
      (b) =>
        sum(
          list.filter((t) => t.category_id === b.category_id),
          ['expense']
        ) <= b.amount
    )
  })

  const heldSet = new Set(heldMonths)
  const cleanSweeps = namedMonths.filter((m) => heldSet.has(m))

  /**
   * The first tracked month that follows a break of two or more, where the run before the break
   * was at least three. The point is the return, so it is dated to the month tracking resumed.
   */
  const comeback = ((): string | null => {
    const spans = runs(tracked)
    for (let i = 1; i < spans.length; i++) {
      const before = spans[i - 1]
      const gap = spans[i].start
      const resumedAfter = addMonths(before.start, before.length)
      if (before.length >= 3 && gap >= addMonths(resumedAfter, 2)) return spans[i].start
    }
    return null
  })()

  /** The last month of the first calendar year with all twelve months tracked. */
  const everyMonth = ((): string | null => {
    const perYear = new Map<string, number>()
    for (const m of tracked) perYear.set(m.slice(0, 4), (perYear.get(m.slice(0, 4)) ?? 0) + 1)
    const year = [...perYear.entries()]
      .filter(([, n]) => n === 12)
      .map(([y]) => y)
      .sort()[0]
    return year === undefined ? null : `${year}-12`
  })()

  /** Average monthly spend across tracked months: what "three months of spending" means here. */
  const avgMonthlySpend =
    tracked.length === 0
      ? 0
      : tracked.reduce((acc, m) => acc + sum(inMonth(m), ['expense', 'deduction']), 0) /
        tracked.length

  const reachedGoals = input.goals.filter(
    (g) => g.target_amount > 0 && g.current_amount >= g.target_amount
  )

  /**
   * A loan is paid off when its own amortisation, prepayments included, runs out before today.
   * There is no stored balance to read: the schedule is the only thing that knows.
   */
  const debtFreeOn = ((): string | null => {
    const months: string[] = []
    for (const loan of input.loans) {
      if (loan.principal <= 0 || loan.term_months <= 0) continue
      const end = payoffDate(
        calculateSchedule(
          loan.principal,
          loan.start_date,
          loan.term_months,
          loan.rate_periods,
          loan.prepayments
        )
      )
      if (end !== null && monthOf(end) <= nowMonth) months.push(monthOf(end))
    }
    return months.sort()[0] ?? null
  })()

  const when: Record<AchievementId, string | null> = {
    'first-entry': earliestMonth(input.transactions.map((t) => t.date)),
    'first-import': earliestMonth(input.importLogs.map((l) => l.created_at)),
    'first-budget': earliestMonth(input.budgets.map((b) => b.created_at)),
    'named-everything': namedMonths[0] ?? null,
    'goal-in-sight': earliestMonth(input.goals.map((g) => g.created_at)),
    'one-month': monthReaching(tracked, 1),
    'a-quarter': monthReaching(tracked, 3),
    'saver-x3': monthReaching(savingMonths, 3),
    'held-the-line': heldMonths[0] ?? null,
    'goal-reached': input.goals.some(
      (g) => g.target_amount > 0 && g.current_amount >= g.target_amount
    )
      ? nowMonth
      : null,
    'half-a-year': monthReaching(tracked, 6),
    'a-year': monthReaching(tracked, 12),
    'saver-x6': monthReaching(savingMonths, 6),
    'two-years': monthReaching(tracked, 24),
    'own-the-stack': input.selfHosted ? nowMonth : null,
    'three-years': monthReaching(tracked, 36),
    'five-years': monthReaching(tracked, 60),
    'ten-years': monthReaching(tracked, 120),
    'twenty-years': monthReaching(tracked, 240),
    'hundred-entries': monthOfNth(input.transactions, VOLUME_STEPS[0]),
    'thousand-entries': monthOfNth(input.transactions, VOLUME_STEPS[1]),
    'five-thousand-entries': monthOfNth(input.transactions, VOLUME_STEPS[2]),
    'ten-thousand-entries': monthOfNth(input.transactions, VOLUME_STEPS[3]),
    'twenty-thousand-entries': monthOfNth(input.transactions, VOLUME_STEPS[4]),
    'the-comeback': comeback,
    'clean-sweep': cleanSweeps[0] ?? null,
    reconciled: reconciledMonths[0] ?? null,
    'ahead-of-plan': input.goals.some(
      (g) =>
        g.target_amount > 0 &&
        g.current_amount >= g.target_amount &&
        g.deadline !== null &&
        input.today <= g.deadline
    )
      ? nowMonth
      : null,
    'the-full-picture': fullPictureMonths[0] ?? null,
    'perfect-year': monthReaching(savingMonths, 12),
    'under-budget-six': monthReaching(heldMonths, 6),
    'rainy-day':
      avgMonthlySpend > 0 && reachedGoals.some((g) => g.target_amount >= avgMonthlySpend * 3)
        ? nowMonth
        : null,
    'debt-free': debtFreeOn,
    'every-month': everyMonth,
  }

  const earned: Earned[] = []
  for (const def of ACHIEVEMENTS) {
    const month = when[def.id]
    if (month) earned.push({ id: def.id, earnedOn: firstDay(month) })
  }
  return { earned, streak: currentStreak(trackedSet, nowMonth), trackedMonths: tracked }
}

/** For the panel's "next up" copy: how far the live streak is from a target. */
export const monthsTo = (streak: number, target: number): number => Math.max(0, target - streak)
