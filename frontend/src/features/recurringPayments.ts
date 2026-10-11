/**
 * The recurring-payment finder: regular payments to a payee the subscription catalogue and the
 * brand registry have no name for, like a local gym, the landlord or the water company.
 *
 * `detectSubscriptions` runs it after the named match, on the expenses that match left over, so a
 * payment is found by one of the two at most. Transfers are not payments: an entry filed under a
 * transfer or account category, or under Transfers (where the bank import files a transfer whose
 * other account it could not tell), is skipped.
 *
 * The rest are grouped by payee: the beneficiary, else the description, normalised and without
 * digits, so reference and card numbers do not split one payee in many. A group is a regular
 * payment when three or more of its charges keep to one amount (`pickAmountCluster`), the median
 * gap between them has a cadence (`cadenceFromGapDays`), at least three gaps in four have that
 * cadence too, and the last charge is at most one and a half periods old. Four or more charges
 * make it likely; three make it a guess, which `worthTracking` leaves unticked and Getting started
 * does not count.
 *
 * Why the gaps rule: the median alone takes everyday shopping for a regular payment. A cafe paid
 * one price on random days has a median gap of about a week. On 200 invented years of shopping (a
 * supermarket, a bakery, a cafe, a petrol station, a drugstore and a restaurant on random days,
 * beside a gym and the rent), the median alone proposed 413 such payments as likely; with the
 * rule, 1. It kept every gym and rent the median found, a paused month included.
 *
 * It is a bill when its charges are filed under housing, utilities, insurance, debt or childcare,
 * and a subscription otherwise. Pure, no signals and no fetching.
 */
import { categoryLookup, effectiveKind } from '../../../shared/guidance/kinds'
import {
  cadenceFromGapDays,
  commonCurrency,
  DAY_MS,
  gapDays,
  median,
  nextDueDate,
  normalizeMerchantText,
  parseDay,
  pickAmountCluster,
} from './chargePatterns'
import type { BillType } from '../../../shared/billSchema'
import type { CategoryLookup, Kind, KindedCategory } from '../../../shared/guidance/kinds'
import type { DetectedFrequency, GroupTxn } from './chargePatterns'
import type {
  DetectableTransaction,
  DetectedSubscription,
  ExistingBillLike,
} from './subscriptionDetection'

/** The kinds whose regular payments are bills: what a home, a loan or a child costs. */
export const BILL_KINDS: ReadonlySet<Kind> = new Set<Kind>([
  'housing',
  'utilities',
  'insurance',
  'debt',
  'childcare',
])

/** The fewest charges that make a regular payment, and the fewest that make it likely. */
export const RECURRING_FEWEST = 3
export const RECURRING_LIKELY = 4

/** A payment still runs while its last charge is at most this many periods old. */
export const RUNNING_PERIODS = 1.5

/** The share of the gaps between the charges that must have the payment's cadence. */
export const STEADY_SHARE = 3 / 4

/** Each cadence's period, in days. */
const PERIOD_DAYS: Record<DetectedFrequency, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  yearly: 365,
}

/** The longest name a payee is proposed under. */
const NAME_MOST = 60

export interface FindRecurringOptions {
  /** Today, as `parseDay` reads a day. */
  todayMs: number
  /** The profile's categories: the kind and the type of what the charges are filed under. */
  categories?: readonly KindedCategory[]
}

interface PayeeCharge extends GroupTxn {
  /** The payee as the entry names it. */
  payee: string
  categoryId: number | null
}

/** The text that names who an expense paid: the beneficiary, else the description, else the payor. */
function payeeText(txn: DetectableTransaction): string {
  for (const text of [txn.beneficiary, txn.description, txn.payor]) {
    if (typeof text === 'string' && text.trim() !== '') return text.trim()
  }
  return ''
}

/** The key a payee's charges are grouped by: its text normalised, without digits. */
export function payeeKey(text: string): string {
  return normalizeMerchantText(text).replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The name a payee is proposed under: its text as the entry writes it, without the words that
 * carry digits (reference numbers, dates, card numbers), cut to NAME_MOST characters at a word.
 */
export function payeeName(text: string): string {
  const words = text.trim().split(/\s+/)
  const plain = words.filter((word) => !/\d/.test(word))
  let name = ''
  for (const word of plain.length > 0 ? plain : words) {
    const longer = name === '' ? word : `${name} ${word}`
    if (longer.length > NAME_MOST) break
    name = longer
  }
  return name === '' ? text.trim().slice(0, NAME_MOST) : name
}

/** Whether entries filed under `category` move money between accounts instead of paying anyone. */
function isTransferCategory(category: KindedCategory | undefined): boolean {
  if (category === undefined) return false
  if (category.type === 'transfer' || category.type === 'account') return true
  return typeof category.name === 'string' && normalizeMerchantText(category.name) === 'transfers'
}

/** The category most of the charges are filed under; of two as common, the later charge's. */
function commonCategory(charges: readonly PayeeCharge[]): number | null {
  const counts = new Map<number, number>()
  let best: number | null = null
  // Latest first, so that of two categories as common, the one seen first is the later charge's.
  for (const charge of [...charges].reverse()) {
    if (charge.categoryId === null) continue
    const count = (counts.get(charge.categoryId) ?? 0) + 1
    counts.set(charge.categoryId, count)
    if (best === null || count > (counts.get(best) ?? 0)) best = charge.categoryId
  }
  return best
}

function billTypeOf(categoryId: number | null, lookup: CategoryLookup): BillType {
  const category = categoryId === null ? undefined : lookup(categoryId)
  const kind = category === undefined ? null : effectiveKind(category, lookup)
  return kind !== null && BILL_KINDS.has(kind) ? 'bill' : 'subscription'
}

/**
 * The regular payments among `expenses`: the expenses the named match left over, each a dated
 * expense with a non-zero amount.
 */
export function findRecurringPayments(
  expenses: readonly DetectableTransaction[],
  existingBills: readonly ExistingBillLike[],
  opts: FindRecurringOptions
): DetectedSubscription[] {
  const lookup = categoryLookup(opts.categories ?? [])
  const tracked = new Set(existingBills.map((bill) => payeeKey(bill.name)))

  const payees = new Map<string, PayeeCharge[]>()
  for (const txn of expenses) {
    const categoryId = Number.isInteger(txn.category_id) ? Number(txn.category_id) : null
    if (categoryId !== null && isTransferCategory(lookup(categoryId))) continue
    const payee = payeeText(txn)
    const key = payeeKey(payee)
    if (key === '') continue
    let charges = payees.get(key)
    if (!charges) {
      charges = []
      payees.set(key, charges)
    }
    charges.push({
      amount: Math.abs(txn.amount),
      dateMs: parseDay(txn.date),
      date: txn.date.slice(0, 10),
      currency: txn.currency ?? null,
      raw: (txn.description || payee).trim(),
      payee,
      categoryId,
    })
  }

  const found: DetectedSubscription[] = []
  for (const [key, charges] of payees) {
    if (charges.length < RECURRING_FEWEST) continue
    const run = pickAmountCluster([...charges].sort((a, b) => a.dateMs - b.dateMs))
    if (run === null || run.length < RECURRING_FEWEST) continue
    const gaps = gapDays(run)
    const cadence = gaps.length > 0 ? cadenceFromGapDays(median(gaps)) : null
    if (cadence === null) continue
    const steady = gaps.filter((gap) => cadenceFromGapDays(gap) === cadence).length
    if (steady < gaps.length * STEADY_SHARE) continue
    const latest = run[run.length - 1]
    if (opts.todayMs - latest.dateMs > RUNNING_PERIODS * PERIOD_DAYS[cadence] * DAY_MS) continue

    const categoryId = commonCategory(run)
    found.push({
      key: `recurring:${key}`,
      name: payeeName(latest.payee),
      amount: Math.round(latest.amount * 100) / 100,
      currency: commonCurrency(run),
      frequency: cadence,
      confidence: run.length >= RECURRING_LIKELY ? 'medium' : 'low',
      occurrences: run.length,
      firstDate: run[0].date,
      lastDate: latest.date,
      suggestedDueDate: nextDueDate(latest.dateMs, cadence, opts.todayMs),
      categoryHints: [],
      alreadyTracked: tracked.has(key),
      matchedVia: 'recurring',
      billType: billTypeOf(categoryId, lookup),
      ...(categoryId === null ? {} : { categoryId }),
      sampleDescriptions: [...new Set(run.map((t) => t.raw))].slice(-3),
    })
  }
  return found
}
