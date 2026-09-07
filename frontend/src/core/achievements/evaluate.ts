/**
 * The one place a badge is decided. Pure and deterministic: everything, including "today", is
 * an input, so a fixture profile always evaluates the same way. Runs over arrays the app already
 * holds; cost is one pass per array.
 */
import { ACHIEVEMENTS, TRACKED_MONTH_MIN_TRANSACTIONS } from './definitions'
import { currentStreak, monthOf, monthReaching } from './months'
import type { Budget, SavingsGoal, Transaction } from '../../types/models'
import type {AchievementId} from './definitions';

export interface EvaluateInput {
  transactions: Array<Pick<Transaction, 'date' | 'type' | 'amount' | 'category_id'>>
  budgets: Array<
    Pick<Budget, 'category_id' | 'amount' | 'period' | 'start_date' | 'end_date' | 'created_at'>
  >
  goals: Array<Pick<SavingsGoal, 'target_amount' | 'current_amount' | 'created_at'>>
  importLogs: Array<{ created_at: string }>
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

type Tx = EvaluateInput['transactions'][number]

const MONTH_RE = /^\d{4}-\d{2}/
const firstDay = (month: string): string => `${month}-01`
const earliestMonth = (dates: string[]): string | null => {
  const months = dates
    .filter((d) => MONTH_RE.test(d))
    .map(monthOf)
    .sort()
  return months[0] ?? null
}
const sum = (list: Tx[], types: string[]): number =>
  list.filter((t) => types.includes(t.type)).reduce((acc, t) => acc + Math.abs(t.amount), 0)

export function evaluateAchievements(input: EvaluateInput): Evaluation {
  const nowMonth = monthOf(input.today)
  const byMonth = new Map<string, Tx[]>()
  for (const t of input.transactions) {
    if (!MONTH_RE.test(t.date)) continue
    const m = monthOf(t.date)
    const list = byMonth.get(m)
    if (list) list.push(t)
    else byMonth.set(m, [t])
  }
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
