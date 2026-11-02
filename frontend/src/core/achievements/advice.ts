/**
 * Advice: what the profile's own numbers say is worth a look this month. Pure and ranked, so
 * the page renders it and the tests pin it. Every card names the figure it was built from and
 * points at the page that shows it; none of it is computed anywhere but on this device.
 */
import { isTrackedMonth, TRACKED_MONTH_MIN_TRANSACTIONS } from '../../../../shared/trackedMonths'
import { budgetsForMonth } from './budgets'
import { bucketByMonth, sumTypes } from './evaluate'
import { biggestUnbudgeted, monthInTheRed, uncategorisedIn } from './monthFacts'
import { addMonths, monthOf } from './months'
import type { ArticleId } from '../../../../shared/articles'
import type { CircleNumber } from '../../../../shared/guidance/circles'
import type { EvaluateInput, Tx } from './evaluate'

export type AdviceKind =
  | 'budget-drift'
  | 'goal-pace'
  | 'in-the-red'
  | 'uncategorised'
  | 'unbudgeted-category'
  | 'streak-at-risk'

export interface AdviceCard {
  /** Stable across runs of the same data, so a dismissal sticks. */
  id: string
  kind: AdviceKind
  /** The circle the advice serves (ADVICE_CIRCLES); the card's Why opens it. */
  circle: CircleNumber
  tone: 'warn' | 'info'
  title: string
  detail: string
  /** The number the card is built from, already formatted. */
  figure: string
  link?: { page: string; label: string }
  /** The article on about.tokencircles.com that answers the card's question (shared/articles.ts). */
  article?: ArticleId
  /** Ranking weight within a tone; bigger is more urgent. */
  weight: number
  /** About a month already finished. Ranked after what is still happening this month. */
  past?: boolean
}

/**
 * The circle each kind of advice serves (circles part 2, design.md commit 11): sorting and keeping
 * the months going build Clear picture; a month in the red and spending past a budget, or with
 * none, are Paying your way; a goal's pace is Breathing room, where money is first put by.
 */
export const ADVICE_CIRCLES: Readonly<Record<AdviceKind, CircleNumber>> = {
  uncategorised: 1,
  'streak-at-risk': 1,
  'in-the-red': 2,
  'budget-drift': 2,
  'unbudgeted-category': 2,
  'goal-pace': 3,
}

/** A card as each kind words it, before the circle it serves is added. */
type Advice = Omit<AdviceCard, 'circle'>

export interface AdviceInput extends EvaluateInput {
  categories: Array<{ id: number; name: string }>
  /** Recurring charges already known, so a detected one is not advised twice. */
  bills: Array<{ category_id?: number | null; amount?: number; name?: string }>
  dismissed: string[]
  /** Formats an amount of money in the base currency. Plain digits when not given. */
  money?: (amount: number) => string
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

function budgetDrift(input: AdviceInput, byMonth: Map<string, Tx[]>): Advice[] {
  const month = monthOf(input.today)
  const list = byMonth.get(month) ?? []
  if (list.length === 0) return []
  const money = input.money ?? round
  const elapsed = monthElapsed(input.today)
  const cards: Advice[] = []
  for (const b of budgetsForMonth(input.budgets, month)) {
    // The amount the Budgets card shows (amount, and remaining as amount less spent). The summary
    // also works out a budget with rollover (effective_budget, shared/budgetRollover.ts), but no
    // page shows it, so advice judged by it would call a category fine that Budgets shows as over.
    if (b.amount <= 0) continue
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
      figure: `${money(spent)} of ${money(b.amount)}`,
      link: { page: 'budgets', label: 'Budgets' },
      weight: over ? spent - b.amount : pace - b.amount,
    })
  }
  return cards
}

function goalPace(input: AdviceInput): Advice[] {
  const money = input.money ?? round
  const cards: Advice[] = []
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
    const name = g.name || 'a savings goal'
    cards.push({
      id: `goal-pace:${name}:${g.deadline}`,
      kind: 'goal-pace',
      tone: 'warn',
      title: `${name} will miss its date`,
      detail: `Reaching it by ${MONTH_NAME(monthOf(g.deadline))} needs more each month than you have been putting aside.`,
      figure: `${money(needed)} a month, ${money(pace)} so far`,
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

function inTheRed(input: AdviceInput, byMonth: Map<string, Tx[]>): Advice[] {
  const last = addMonths(monthOf(input.today), -1)
  const red = monthInTheRed(byMonth.get(last))
  if (!red) return []
  const { income, out } = red
  const money = input.money ?? round
  return [
    {
      id: `in-the-red:${last}`,
      kind: 'in-the-red',
      tone: 'warn',
      title: `${MONTH_NAME(last)} spent more than it earned`,
      detail: 'A month in the red breaks a saving streak. Worth a look at where it went.',
      figure: `${money(out - income)} over`,
      link: { page: 'analytics', label: 'Analytics' },
      article: 'one-month',
      weight: out - income,
      past: true,
    },
  ]
}

function uncategorised(input: AdviceInput, byMonth: Map<string, Tx[]>): Advice[] {
  const month = monthOf(input.today)
  const n = uncategorisedIn(byMonth.get(month) ?? [])
  if (n === 0) return []
  return [
    {
      id: `uncategorised:${month}`,
      kind: 'uncategorised',
      tone: 'info',
      title: n === 1 ? 'One entry has no category' : 'Some entries have no category',
      detail: `Categorise ${n === 1 ? 'it' : 'them'} and this month counts toward "Named everything".`,
      figure: plural(n, 'entry to categorise', 'entries to categorise'),
      link: { page: 'transactions', label: 'Transactions' },
      weight: n,
    },
  ]
}

/**
 * The biggest category spent on this month with no budget and no bill behind it. Named
 * `unbudgeted-category` for what it flags; it was `unbudgeted-subscription`, and a dismissal
 * stored under that name still applies (parseDismissed in records.ts).
 */
function unbudgetedCategory(input: AdviceInput, byMonth: Map<string, Tx[]>): Advice[] {
  const month = monthOf(input.today)
  const top = biggestUnbudgeted(byMonth.get(month) ?? [], month, input.budgets, input.bills)
  if (!top) return []
  const money = input.money ?? round
  return [
    {
      id: `unbudgeted-category:${top.categoryId}:${month}`,
      kind: 'unbudgeted-category',
      tone: 'info',
      title: `${categoryName(input, top.categoryId)} has no budget`,
      detail: 'It is the biggest thing you spend on with nothing set aside for it.',
      figure: money(top.spent),
      link: { page: 'budgets', label: 'Budgets' },
      weight: top.spent,
    },
  ]
}

const LATE_IN_MONTH_DAYS = 8

function streakAtRisk(input: AdviceInput, byMonth: Map<string, Tx[]>, streak: number): Advice[] {
  if (streak < 2) return []
  const month = monthOf(input.today)
  const have = (byMonth.get(month) ?? []).length
  if (isTrackedMonth(have)) return []
  const [y, m] = input.today.split('-').map(Number)
  const daysLeft = new Date(Date.UTC(y, m, 0)).getUTCDate() - Number(input.today.slice(8, 10))
  if (daysLeft > LATE_IN_MONTH_DAYS) return []
  const need = TRACKED_MONTH_MIN_TRANSACTIONS - have
  return [
    {
      id: `streak-at-risk:${month}`,
      kind: 'streak-at-risk',
      tone: 'warn',
      title: `Your ${streak}-month streak needs this month`,
      detail: `A month counts once it holds ${TRACKED_MONTH_MIN_TRANSACTIONS} entries, and this one is nearly over.`,
      figure: plural(need, 'entry to go', 'entries to go'),
      link: { page: 'transactions', label: 'Transactions' },
      weight: streak,
    },
  ]
}

const TONE_ORDER: Record<AdviceCard['tone'], number> = { warn: 0, info: 1 }

/**
 * Everything worth saying, most urgent first, minus what the user dismissed. Warnings rank before
 * information, and within each, what is happening this month before a month already finished.
 * Two cards with the same id are one card, the first in that order; the id names what a card is
 * about (a category, a goal, a month), so two categories that share a name stay two cards and
 * dismissing one leaves the other.
 */
export function buildAdvice(input: AdviceInput, streak = 0): AdviceCard[] {
  const byMonth = bucketByMonth(input.transactions)
  const dismissed = new Set(input.dismissed)
  const said = new Set<string>()
  return [
    ...budgetDrift(input, byMonth),
    ...goalPace(input),
    ...inTheRed(input, byMonth),
    ...streakAtRisk(input, byMonth, streak),
    ...uncategorised(input, byMonth),
    ...unbudgetedCategory(input, byMonth),
  ]
    .sort(
      (a, b) =>
        TONE_ORDER[a.tone] - TONE_ORDER[b.tone] ||
        Number(a.past ?? false) - Number(b.past ?? false) ||
        b.weight - a.weight
    )
    .filter((c) => {
      if (said.has(c.id)) return false
      said.add(c.id)
      return true
    })
    .filter((c) => !dismissed.has(c.id))
    .map((c) => ({ ...c, circle: ADVICE_CIRCLES[c.kind] }))
}
