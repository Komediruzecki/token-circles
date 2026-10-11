/**
 * Subscription auto-detection — scans transactions for charges that look like
 * entries from the subscription catalogue / brand registry ("Netflix",
 * "Google One", "Claude", ...) and proposes them as subscriptions with the
 * price, cadence, and next due date inferred from the actual charges.
 *
 * Pure module (no signals, no fetching): callers pass transactions + existing
 * bills and render the returned proposals. Matching is deliberately stricter
 * than `matchBrand` (which is presentation-only substring matching): text is
 * tokenized, single-word keys must match a whole token (with a bounded edit
 * distance for typos like "NETFLX"), and bare mega-retailer tokens such as
 * "amazon" or "google" — which mostly mean one-off shopping, not a plan — are
 * only accepted with a stable, recurring amount.
 */

import { localToday } from '../utils/period'
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
import { findRecurringPayments } from './recurringPayments'
import { BRANDS } from './subscriptionBrands'
import { CATALOG_ITEMS } from './subscriptionCatalog'
import type { BillType } from '../../../shared/billSchema'
import type { KindedCategory } from '../../../shared/guidance/kinds'
import type { DetectedFrequency, GroupTxn } from './chargePatterns'
import type { CatalogItem, CatalogPlan } from './subscriptionCatalog'

export { cadenceFromGapDays, normalizeMerchantText }
export type { DetectedFrequency }

export interface DetectableTransaction {
  description?: string | null
  beneficiary?: string | null
  payor?: string | null
  notes?: string | null
  amount: number
  /** ISO date, YYYY-MM-DD (extra time suffix tolerated). */
  date: string
  type?: string | null
  currency?: string | null
  /** The category the entry is filed under: the finder reads its kind, and skips transfers. */
  category_id?: number | null
}

export interface ExistingBillLike {
  name: string
  type?: string | null
}

export type DetectionConfidence = 'high' | 'medium' | 'low'

export interface DetectedSubscription {
  /** Stable grouping key (normalized display name). */
  key: string
  /** Proposed subscription name, e.g. "Netflix" or "Google One". */
  name: string
  /** Proposed price: the most recent charge amount (absolute). */
  amount: number
  currency: string | null
  frequency: DetectedFrequency
  confidence: DetectionConfidence
  occurrences: number
  firstDate: string
  lastDate: string
  /** Next expected charge (last charge + period, rolled forward to >= today). */
  suggestedDueDate: string
  /** Category names to try, most specific first (existing categories win). */
  categoryHints: string[]
  /** A subscription/bill with this brand already exists. */
  alreadyTracked: boolean
  /**
   * What found it: the catalogue or the brand registry by name, or the recurring-payment finder
   * (recurringPayments.ts), for a payee neither has a name for.
   */
  matchedVia: 'catalog' | 'brand' | 'recurring'
  /**
   * The bill it adds: a subscription, or a bill for a regular payment the finder files under
   * housing, utilities, insurance, debt or childcare.
   */
  billType: BillType
  /** The category the finder's charges are filed under; the named finds go by `categoryHints`. */
  categoryId?: number
  /** Up to 3 raw transaction descriptions behind the proposal. */
  sampleDescriptions: string[]
  /** The catalogue entry backing this proposal, when one exists. */
  catalogItem?: CatalogItem
  /** The catalogue plan whose price matches the observed amount, if any. */
  matchedPlan?: CatalogPlan
}

export interface DetectSubscriptionsOptions {
  /** "Today" for due-date rolling — injectable for tests. Defaults to now. */
  today?: string
  /** The profile's categories: the finder reads the type and the kind of a charge's category. */
  categories?: readonly KindedCategory[]
}

// Bare tokens that overwhelmingly mean one-off purchases (or common words), not
// a plan: only propose these when the charge repeats with a stable amount.
const AMBIGUOUS_TOKENS = new Set([
  'amazon',
  'google',
  'apple',
  'microsoft',
  'xbox',
  'max',
  'medium',
  'calm',
  'steam',
  'kindle',
  'internet',
  'mobile',
  'gym',
  // Common English words that are also service names: only propose them when the
  // charge repeats with a stable amount, never off a single ambiguous line.
  'resend',
  'render',
  'linear',
  'runway',
])

// Catalogue entries with no brand keywords of their own get minimal aliases so
// common statement wordings still hit them.
const CATALOG_ALIASES: Record<string, string[]> = {
  'Gym membership': ['gym', 'fitness'],
  Internet: ['internet'],
  'Mobile plan': ['mobile'],
}

/**
 * How far back a scan reads: enough history for a yearly cadence to show up twice, without
 * chewing through decades of imported data.
 */
export const SCAN_WINDOW_DAYS = 750

/** The transactions a scan reads: those dated inside the SCAN_WINDOW_DAYS up to `nowMs`. */
export function recentForScan<T extends { date: string }>(transactions: T[], nowMs: number): T[] {
  const cutoff = nowMs - SCAN_WINDOW_DAYS * DAY_MS
  return transactions.filter((t) => {
    const ms = new Date(`${(t.date || '').slice(0, 10)}T00:00:00Z`).getTime()
    return Number.isFinite(ms) && ms >= cutoff
  })
}

/**
 * Whether a proposal is worth adding: not a bill yet, and more than a low-confidence guess. The
 * scan ticks these, and Getting started counts them.
 */
export function worthTracking(found: DetectedSubscription): boolean {
  return !found.alreadyTracked && found.confidence !== 'low'
}

/** Bounded Levenshtein distance (small inputs only). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

/** Two rows of the distance table, reused by every call (grown when a longer word arrives). */
let rowA = new Int32Array(64)
let rowB = new Int32Array(64)

/**
 * Whether `a` and `b` are at most `max` edits apart: editDistance(a, b) <= max, without finishing
 * the table once every cell in a row is already over `max` (a row's minimum never falls later),
 * and without allocating a row per call.
 */
export function withinEditDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false
  if (a === b) return true
  const n = b.length
  if (rowA.length <= n) {
    rowA = new Int32Array(n + 1)
    rowB = new Int32Array(n + 1)
  }
  let prev = rowA
  let cur = rowB
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    let rowMin = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return false
    const swap = prev
    prev = cur
    cur = swap
  }
  return prev[n] <= max
}

/** Whole-token match with a typo budget scaled to the keyword length. */
function tokenMatches(token: string, keyword: string): boolean {
  // eslint-disable-next-line security/detect-possible-timing-attacks -- merchant text vs catalog keyword; nothing secret
  if (token === keyword) return true
  const budget = keyword.length >= 8 ? 2 : keyword.length >= 5 ? 1 : 0
  return budget > 0 && withinEditDistance(token, keyword, budget)
}

/**
 * A keyword as matching reads it: normalised, and split into tokens. Every catalogue name, alias
 * and brand keyword is prepared once, when the module loads (MERCHANT_KEYS), not once per
 * transaction: a scan of a few thousand entries used to normalise the whole catalogue for each one.
 */
export interface PreparedKeyword {
  /** The keyword normalised (normalizeMerchantText); empty never matches. */
  norm: string
  /** `norm` split on spaces. */
  tokens: string[]
}

export function prepareKeyword(keyword: string): PreparedKeyword {
  const norm = normalizeMerchantText(keyword)
  return { norm, tokens: norm.split(' ') }
}

/**
 * Match a normalized text against a keyword. Multi-word keywords match as a
 * phrase (or all tokens present); single-word keywords must match a whole
 * token — never a substring, so "max" can't hit "MAXIMA MARKET".
 */
function textMatchesKeyword(normText: string, tokens: string[], key: PreparedKeyword): boolean {
  const { norm: normKey, tokens: keyTokens } = key
  if (!normKey) return false
  if (keyTokens.length > 1) {
    if (` ${normText} `.includes(` ${normKey} `)) return true
    return keyTokens.every((kt) => tokens.some((t) => tokenMatches(t, kt)))
  }
  return tokens.some((t) => tokenMatches(t, normKey))
}

interface MerchantMatch {
  name: string
  matchedVia: 'catalog' | 'brand'
  /** The keyword that hit — ambiguity is judged on this, not the brand. */
  keyword: string
  categoryHints: string[]
  catalogItem?: CatalogItem
}

const catalogByName = new Map(CATALOG_ITEMS.map((item) => [normalizeMerchantText(item.name), item]))

/** Catalogue entry for a display name ("Netflix" → the Netflix item), if any. */
function catalogItemFor(name: string): CatalogItem | undefined {
  return catalogByName.get(normalizeMerchantText(name))
}

/**
 * Every key matchMerchant tries, prepared once (prepareKeyword), in the order it tries them:
 * each catalogue entry's name then its aliases, and each brand's keywords longest first, in
 * registry order. A test holds this to preparing the catalogue and the registry on the spot.
 */
export const MERCHANT_KEYS = {
  catalog: CATALOG_ITEMS.map((item) => ({
    item,
    keys: [item.name, ...(CATALOG_ALIASES[item.name] ?? [])].map(prepareKeyword),
  })),
  brands: BRANDS.map((brand) => ({
    brand,
    keys: [...brand.keywords].sort((a, b) => b.length - a.length).map(prepareKeyword),
    catalogItem: catalogItemFor(brand.displayName),
  })),
}

/**
 * Resolve a transaction's merchant text to a catalogue/brand identity.
 * Catalogue names win over brand keywords (a "GOOGLE ONE" charge should
 * surface as "Google One", not "Google"); within each source, more specific
 * (longer) keys win.
 */
export function matchMerchant(text: string): MerchantMatch | null {
  const normText = normalizeMerchantText(text)
  if (!normText) return null
  const tokens = normText.split(' ')

  // 1) Catalogue names + aliases, longest name first so "YouTube Premium"
  //    beats "YouTube Music"'s shared prefix and multiword names beat tokens.
  const catalogCandidates: { key: string; item: CatalogItem }[] = []
  for (const { item, keys } of MERCHANT_KEYS.catalog) {
    for (const key of keys) {
      if (textMatchesKeyword(normText, tokens, key)) {
        catalogCandidates.push({ key: key.norm, item })
        break
      }
    }
  }
  if (catalogCandidates.length > 0) {
    catalogCandidates.sort((a, b) => b.key.length - a.key.length)
    const best = catalogCandidates[0]
    return {
      name: best.item.name,
      matchedVia: 'catalog',
      keyword: best.key,
      categoryHints: [...best.item.categoryHints],
      catalogItem: best.item,
    }
  }

  // 2) Brand registry keywords (registry order = specificity contract, e.g.
  //    OneDrive before Microsoft), longest keyword within a brand first.
  for (const { brand, keys, catalogItem } of MERCHANT_KEYS.brands) {
    for (const key of keys) {
      if (textMatchesKeyword(normText, tokens, key)) {
        return {
          name: brand.displayName,
          matchedVia: 'brand',
          keyword: key.norm,
          categoryHints: [brand.defaultCategory],
          catalogItem,
        }
      }
    }
  }
  return null
}

function isExpense(txn: DetectableTransaction): boolean {
  if (typeof txn.type === 'string' && txn.type !== '') return txn.type === 'expense'
  return txn.amount < 0
}

function merchantText(txn: DetectableTransaction): string {
  return [txn.description, txn.beneficiary, txn.payor, txn.notes].filter(Boolean).join(' ')
}

/** The plan (or base price) whose price matches the amount, within tolerance. */
function planForAmount(item: CatalogItem | undefined, amount: number): CatalogPlan | undefined {
  if (!item) return undefined
  const tolerance = (price: number) => Math.max(0.5, price * 0.03)
  const plans: CatalogPlan[] = item.plans?.length
    ? item.plans
    : [{ label: item.tier ?? 'Standard', price: item.price }]
  return plans.find((p) => Math.abs(p.price - amount) <= tolerance(p.price))
}

/**
 * Scan transactions and propose subscriptions.
 *
 * Grouping is by resolved identity; per group the amount is the latest charge,
 * cadence is bucketed from the median day-gap between charges (monthly when
 * there's only one charge), and confidence reflects how recurring/stable the
 * evidence is. Groups whose only evidence is an ambiguous bare token (e.g. one
 * "AMAZON.DE" charge) are dropped rather than proposed as noise.
 *
 * The expenses no name matches go on to the recurring-payment finder (recurringPayments.ts), which
 * proposes the regular ones by payee. Each expense is read by one of the two, so a payment is
 * never proposed twice.
 */
export function detectSubscriptions(
  transactions: DetectableTransaction[],
  existingBills: ExistingBillLike[] = [],
  opts: DetectSubscriptionsOptions = {}
): DetectedSubscription[] {
  const todayMs = parseDay(opts.today ?? localToday())

  // Identities already tracked as a bill/subscription, by normalized name and
  // by resolved merchant identity (a bill named "Netflix Premium" tracks the
  // Netflix brand).
  const trackedKeys = new Set<string>()
  for (const bill of existingBills) {
    trackedKeys.add(normalizeMerchantText(bill.name))
    const resolved = matchMerchant(bill.name)
    if (resolved) trackedKeys.add(normalizeMerchantText(resolved.name))
  }

  interface Group {
    match: MerchantMatch
    ambiguous: boolean
    txns: GroupTxn[]
  }
  const groups = new Map<string, Group>()
  // The expenses no name matched: the finder's to read.
  const leftovers: DetectableTransaction[] = []

  for (const txn of transactions) {
    if (!txn.date || !Number.isFinite(txn.amount) || txn.amount === 0) continue
    if (!isExpense(txn)) continue
    const text = merchantText(txn)
    if (!text.trim()) continue
    const match = matchMerchant(text)
    if (!match) {
      leftovers.push(txn)
      continue
    }
    const key = normalizeMerchantText(match.name)
    let group = groups.get(key)
    if (!group) {
      group = { match, ambiguous: true, txns: [] }
      groups.set(key, group)
    }
    // A group is ambiguous only while every hit came via an ambiguous token; a
    // single specific hit ("google one") legitimizes the whole group.
    if (!AMBIGUOUS_TOKENS.has(match.keyword)) {
      group.ambiguous = false
      // Prefer the most specific match for naming/category (catalog > brand).
      if (match.matchedVia === 'catalog' && group.match.matchedVia !== 'catalog') {
        group.match = match
      }
    }
    group.txns.push({
      amount: Math.abs(txn.amount),
      dateMs: parseDay(txn.date),
      date: txn.date.slice(0, 10),
      currency: txn.currency ?? null,
      raw: (txn.description || text).trim(),
    })
  }

  const results: DetectedSubscription[] = []

  for (const [key, group] of groups) {
    const all = [...group.txns].sort((a, b) => a.dateMs - b.dateMs)
    // The subscription evidence: the dominant repeating-amount cluster when one
    // exists, else everything (single charges, or nothing repeated).
    const cluster = pickAmountCluster(all)
    const txns = cluster ?? all
    const stable = cluster !== null

    // Cadence from the median gap between distinct charge days.
    const gaps = gapDays(txns)
    const cadence = gaps.length > 0 ? cadenceFromGapDays(median(gaps)) : null

    const latest = txns[txns.length - 1]
    const amount = Math.round(latest.amount * 100) / 100
    const matchedPlan = planForAmount(group.match.catalogItem, amount)

    // Ambiguous-only evidence must actually look like a plan: repeated with a
    // stable amount. Otherwise it's shopping, not a subscription.
    if (group.ambiguous && !stable) continue

    let confidence: DetectionConfidence = 'low'
    if ((txns.length >= 3 && stable && cadence) || (txns.length >= 2 && stable && matchedPlan)) {
      confidence = 'high'
    } else if ((txns.length >= 2 && stable) || (txns.length === 1 && matchedPlan)) {
      confidence = 'medium'
    }

    const frequency: DetectedFrequency = cadence ?? 'monthly'

    results.push({
      key,
      name: group.match.name,
      amount,
      currency: commonCurrency(txns),
      frequency,
      confidence,
      occurrences: txns.length,
      firstDate: txns[0].date,
      lastDate: latest.date,
      // Next expected charge, rolled forward so it's never in the past.
      suggestedDueDate: nextDueDate(latest.dateMs, frequency, todayMs),
      categoryHints: group.match.categoryHints,
      alreadyTracked: trackedKeys.has(key),
      matchedVia: group.match.matchedVia,
      billType: 'subscription',
      sampleDescriptions: [...new Set(txns.map((t) => t.raw))].slice(-3),
      catalogItem: group.match.catalogItem,
      matchedPlan,
    })
  }

  results.push(
    ...findRecurringPayments(leftovers, existingBills, { todayMs, categories: opts.categories })
  )

  const confidenceRank: Record<DetectionConfidence, number> = { high: 0, medium: 1, low: 2 }
  return results.sort(
    (a, b) =>
      Number(a.alreadyTracked) - Number(b.alreadyTracked) ||
      confidenceRank[a.confidence] - confidenceRank[b.confidence] ||
      b.occurrences - a.occurrences ||
      a.name.localeCompare(b.name)
  )
}
