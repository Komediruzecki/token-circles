/**
 * Advice: what the profile's own numbers say is worth a look this month. Pure and ranked, so
 * the page renders it and the tests pin it. Every card names the figure it was built from and
 * points at the page that shows it; none of it is computed anywhere but on this device.
 */
import { bucketByMonth,  sumTypes  } from './evaluate'
import { addMonths, monthOf } from './months'
import type {EvaluateInput, Tx} from './evaluate';

export type AdviceKind =
  | 'budget-drift'
  | 'goal-pace'
  | 'in-the-red'
  | 'uncategorised'
  | 'unbudgeted-subscription'
  | 'streak-at-risk'

export interface AdviceCard {
  /** Stable across runs of the same data, so a dismissal sticks. */
  id: string
  kind: AdviceKind
  tone: 'warn' | 'info'
  title: string
  detail: string
  /** The number the card is built from, already formatted. */
  figure: string
  link?: { page: string; label: string }
  /** Ranking weight within a tone; bigger is more urgent. */
  weight: number
}

export interface AdviceInput extends EvaluateInput {
  categories: Array<{ id: number; name: string }>
  /** Recurring charges already known, so a detected one is not advised twice. */
  bills: Array<{ category_id?: number | null; amount?: number; name?: string }>
  dismissed: string[]
}

const MONTH_NAME = (month: string): string =>
  new Date(`${month}-15T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

const round = (n: number): string => n.toFixed(n % 1 === 0 ? 0 : 2)
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** Fraction of the current month already elapsed, never 0 so it can divide. */
function monthElapsed(today: string): number {
  const day = Number(today.slice(8, 10))
  const [y, m] = today.split('-').map(Number)
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Math.max(day / days, 1 / days)
}

function categoryName(input: AdviceInput, id: number | null): string {
  return input.categories.find((c) => c.id === id)?.name ?? 'an uncategorised category'
}

function budgetDrift(input: AdviceInput, byMonth: Map<string, Tx[]>): AdviceCard[] {
  const month = monthOf(input.today)
  const list = byMonth.get(month) ?? []
  if (list.length === 0) return []
  const elapsed = monthElapsed(input.today)
  const cards: AdviceCard[] = []
  for (const b of input.budgets) {
    if (b.period !== 'monthly' || b.amount <= 0) continue
    if (b.end_date !== null && b.end_date < `${month}-01`) continue
    const spent = sumTypes(
      list.filter((t) => t.category_id === b.category_id),
      ['expense']
    )
    if (spent === 0) continue
    const pace = spent / elapsed
    const over = spent > b.amount
    if (!over && pace <= b.amount) continue
    const name = categoryName(input, b.category_id)
    cards.push({
      id: `budget-drift:${b.category_id}:${month}`,
      kind: 'budget-drift',
      tone: 'warn',
      title: over ? `${name} is over budget` : `${name} is running hot`,
      detail: over
        ? `You have spent more on ${name} this month than the budget allows.`
        : `At this pace ${name} finishes the month above its budget.`,
      figure: `${round(spent)} of ${round(b.amount)}`,
      link: { page: 'budgets', label: 'Budgets' },
      weight: over ? spent - b.amount : pace - b.amount,
    })
  }
  return cards
}

function goalPace(input: AdviceInput): AdviceCard[] {
  const cards: AdviceCard[] = []
  for (const g of input.goals) {
    if (!g.deadline || g.target_amount <= 0) continue
    const remaining = g.target_amount - g.current_amount
    if (remaining <= 0) continue
    const months = monthsBetween(monthOf(input.today), monthOf(g.deadline))
    if (months <= 0) continue
    const needed = remaining / months
    const contributed = g.current_amount
    const sinceStart = Math.max(1, monthsBetween(monthOf(g.created_at), monthOf(input.today)))
    const pace = contributed / sinceStart
    if (pace >= needed) continue
    const name = (g as { name?: string }).name ?? 'a savings goal'
    cards.push({
      id: `goal-pace:${name}:${g.deadline}`,
      kind: 'goal-pace',
      tone: 'warn',
      title: `${name} will miss its date`,
      detail: `Reaching it by ${MONTH_NAME(monthOf(g.deadline))} needs more each month than you have been putting aside.`,
      figure: `${round(needed)} a month, ${round(pace)} so far`,
      link: { page: 'goals', label: 'Savings Goals' },
      weight: needed - pace,
    })
  }
  return cards
}

function monthsBetween(from: string, to: string): number {
  let n = 0
  let m = from
  while (m < to && n < 600) {
    m = addMonths(m, 1)
    n++
  }
  return n
}

function inTheRed(input: AdviceInput, byMonth: Map<string, Tx[]>): AdviceCard[] {
  const last = addMonths(monthOf(input.today), -1)
  const list = byMonth.get(last)
  if (!list || list.length < 3) return []
  const income = sumTypes(list, ['income'])
  const out = sumTypes(list, ['expense', 'deduction'])
  if (out <= income) return []
  return [
    {
      id: `in-the-red:${last}`,
      kind: 'in-the-red',
      tone: 'warn',
      title: `${MONTH_NAME(last)} spent more than it earned`,
      detail: 'A month in the red breaks a saving streak. Worth a look at where it went.',
      figure: `${round(out - income)} over`,
      link: { page: 'analytics', label: 'Analytics' },
      weight: out - income,
    },
  ]
}

function uncategorised(input: AdviceInput, byMonth: Map<string, Tx[]>): AdviceCard[] {
  const month = monthOf(input.today)
  const list = byMonth.get(month) ?? []
  const n = list.filter((t) => t.type !== 'transfer' && t.category_id === null).length
  if (n === 0) return []
  return [
    {
      id: `uncategorised:${month}`,
      kind: 'uncategorised',
      tone: 'info',
      title: 'Some entries have no category',
      detail: 'Categorise them and this month counts towards "Named everything".',
      figure: String(n),
      link: { page: 'transactions', label: 'Transactions' },
      weight: n,
    },
  ]
}

function unbudgetedSubscriptions(input: AdviceInput, byMonth: Map<string, Tx[]>): AdviceCard[] {
  const month = monthOf(input.today)
  const budgeted = new Set(input.budgets.map((b) => b.category_id))
  const billed = new Set(input.bills.map((b) => b.category_id).filter((id) => id != null))
  const counts = new Map<number, number>()
  for (const t of byMonth.get(month) ?? []) {
    if (t.type !== 'expense' || t.category_id === null) continue
    if (budgeted.has(t.category_id) || billed.has(t.category_id)) continue
    counts.set(t.category_id, (counts.get(t.category_id) ?? 0) + Math.abs(t.amount))
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!top || top[1] <= 0) return []
  return [
    {
      id: `unbudgeted-subscription:${top[0]}:${month}`,
      kind: 'unbudgeted-subscription',
      tone: 'info',
      title: `${categoryName(input, top[0])} has no budget`,
      detail: 'It is the biggest thing you spend on with nothing set aside for it.',
      figure: round(top[1]),
      link: { page: 'budgets', label: 'Budgets' },
      weight: top[1],
    },
  ]
}

const TRACKED_MIN = 3
const LATE_IN_MONTH_DAYS = 8

function streakAtRisk(
  input: AdviceInput,
  byMonth: Map<string, Tx[]>,
  streak: number
): AdviceCard[] {
  if (streak < 2) return []
  const month = monthOf(input.today)
  const have = (byMonth.get(month) ?? []).length
  if (have >= TRACKED_MIN) return []
  const [y, m] = input.today.split('-').map(Number)
  const daysLeft = new Date(Date.UTC(y, m, 0)).getUTCDate() - Number(input.today.slice(8, 10))
  if (daysLeft > LATE_IN_MONTH_DAYS) return []
  const need = TRACKED_MIN - have
  return [
    {
      id: `streak-at-risk:${month}`,
      kind: 'streak-at-risk',
      tone: 'warn',
      title: `Your ${streak}-month streak needs this month`,
      detail: `A month counts once it holds ${TRACKED_MIN} entries, and this one is nearly over.`,
      figure: plural(need, 'entry to go', 'entries to go'),
      link: { page: 'transactions', label: 'Transactions' },
      weight: streak,
    },
  ]
}

const TONE_ORDER: Record<AdviceCard['tone'], number> = { warn: 0, info: 1 }

/** Everything worth saying, most urgent first, minus what the user dismissed. */
export function buildAdvice(input: AdviceInput, streak = 0): AdviceCard[] {
  const byMonth = bucketByMonth(input.transactions)
  const dismissed = new Set(input.dismissed)
  return [
    ...budgetDrift(input, byMonth),
    ...goalPace(input),
    ...inTheRed(input, byMonth),
    ...streakAtRisk(input, byMonth, streak),
    ...uncategorised(input, byMonth),
    ...unbudgetedSubscriptions(input, byMonth),
  ]
    .filter((c) => !dismissed.has(c.id))
    .sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || b.weight - a.weight)
}
