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

import { BRANDS } from './subscriptionBrands'
import { CATALOG_ITEMS } from './subscriptionCatalog'
import type { CatalogItem, CatalogPlan } from './subscriptionCatalog'

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
}

export interface ExistingBillLike {
  name: string
  type?: string | null
}

export type DetectedFrequency = 'weekly' | 'biweekly' | 'monthly' | 'yearly'
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
  matchedVia: 'catalog' | 'brand'
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
])

// Catalogue entries with no brand keywords of their own get minimal aliases so
// common statement wordings still hit them.
const CATALOG_ALIASES: Record<string, string[]> = {
  'Gym membership': ['gym', 'fitness'],
  Internet: ['internet'],
  'Mobile plan': ['mobile'],
}

const DAY_MS = 24 * 60 * 60 * 1000

export function normalizeMerchantText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
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

/** Whole-token match with a typo budget scaled to the keyword length. */
function tokenMatches(token: string, keyword: string): boolean {
  // eslint-disable-next-line security/detect-possible-timing-attacks -- merchant text vs catalog keyword; nothing secret
  if (token === keyword) return true
  if (keyword.length >= 8) return editDistance(token, keyword) <= 2
  if (keyword.length >= 5) return editDistance(token, keyword) <= 1
  return false
}

/**
 * Match a normalized text against a keyword. Multi-word keywords match as a
 * phrase (or all tokens present); single-word keywords must match a whole
 * token — never a substring, so "max" can't hit "MAXIMA MARKET".
 */
function textMatchesKeyword(normText: string, tokens: string[], keyword: string): boolean {
  const normKey = normalizeMerchantText(keyword)
  if (!normKey) return false
  const keyTokens = normKey.split(' ')
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
  for (const item of CATALOG_ITEMS) {
    const keys = [item.name, ...(CATALOG_ALIASES[item.name] ?? [])]
    for (const key of keys) {
      if (textMatchesKeyword(normText, tokens, key)) {
        catalogCandidates.push({ key: normalizeMerchantText(key), item })
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
  for (const brand of BRANDS) {
    const sorted = [...brand.keywords].sort((a, b) => b.length - a.length)
    for (const keyword of sorted) {
      if (textMatchesKeyword(normText, tokens, keyword)) {
        return {
          name: brand.displayName,
          matchedVia: 'brand',
          keyword: normalizeMerchantText(keyword),
          categoryHints: [brand.defaultCategory],
          catalogItem: catalogItemFor(brand.displayName),
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

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** Bucket a median day-gap into a bill frequency; null = no clear cadence. */
export function cadenceFromGapDays(gap: number): DetectedFrequency | null {
  if (gap >= 5 && gap <= 9) return 'weekly'
  if (gap >= 11 && gap <= 17) return 'biweekly'
  if (gap >= 24 && gap <= 38) return 'monthly'
  if (gap >= 330 && gap <= 400) return 'yearly'
  return null
}

function parseDay(date: string): number {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).getTime()
}

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function addPeriod(dateMs: number, frequency: DetectedFrequency): number {
  if (frequency === 'weekly') return dateMs + 7 * DAY_MS
  if (frequency === 'biweekly') return dateMs + 14 * DAY_MS
  const d = new Date(dateMs)
  if (frequency === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1)
  else d.setUTCFullYear(d.getUTCFullYear() + 1)
  return d.getTime()
}

interface GroupTxn {
  amount: number
  dateMs: number
  date: string
  currency: string | null
  raw: string
}

const sameAmount = (a: number, ref: number) => Math.abs(a - ref) <= Math.max(0.5, ref * 0.05)

/**
 * The recurring-amount evidence within a group: cluster charges by amount and
 * pick the cluster that looks like the plan — the one holding the most recent
 * charge when it repeats, else the largest repeating cluster. Returns null when
 * no amount repeats (one-off shopping, or a single charge). This keeps a real
 * "AMAZON PRIME 8.99" cadence detectable amid unrelated "AMAZON.DE" orders that
 * share the group, and follows price changes once the new price has recurred.
 */
function pickAmountCluster(txns: GroupTxn[]): GroupTxn[] | null {
  if (txns.length < 2) return null
  const byAmount = [...txns].sort((a, b) => a.amount - b.amount)
  const clusters: GroupTxn[][] = []
  for (const txn of byAmount) {
    const last = clusters[clusters.length - 1]
    if (last && sameAmount(txn.amount, median(last.map((t) => t.amount)))) last.push(txn)
    else clusters.push([txn])
  }
  const repeating = clusters.filter((c) => c.length >= 2)
  if (repeating.length === 0) return null
  const latestMs = Math.max(...txns.map((t) => t.dateMs))
  const withLatest = repeating.find((c) => c.some((t) => t.dateMs === latestMs))
  const best =
    withLatest ??
    repeating.sort(
      (a, b) =>
        b.length - a.length ||
        Math.max(...b.map((t) => t.dateMs)) - Math.max(...a.map((t) => t.dateMs))
    )[0]
  return [...best].sort((a, b) => a.dateMs - b.dateMs)
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
 */
export function detectSubscriptions(
  transactions: DetectableTransaction[],
  existingBills: ExistingBillLike[] = [],
  opts: DetectSubscriptionsOptions = {}
): DetectedSubscription[] {
  const todayMs = parseDay(opts.today ?? new Date().toISOString())

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

  for (const txn of transactions) {
    if (!txn.date || !Number.isFinite(txn.amount) || txn.amount === 0) continue
    if (!isExpense(txn)) continue
    const text = merchantText(txn)
    if (!text.trim()) continue
    const match = matchMerchant(text)
    if (!match) continue
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
    const gaps: number[] = []
    for (let i = 1; i < txns.length; i++) {
      const gap = (txns[i].dateMs - txns[i - 1].dateMs) / DAY_MS
      if (gap >= 2) gaps.push(gap)
    }
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

    // Next expected charge, rolled forward so it's never in the past.
    let dueMs = addPeriod(latest.dateMs, frequency)
    while (dueMs < todayMs) dueMs = addPeriod(dueMs, frequency)

    const currencyCounts = new Map<string, number>()
    for (const t of txns) {
      if (t.currency) currencyCounts.set(t.currency, (currencyCounts.get(t.currency) ?? 0) + 1)
    }
    const currency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    results.push({
      key,
      name: group.match.name,
      amount,
      currency,
      frequency,
      confidence,
      occurrences: txns.length,
      firstDate: txns[0].date,
      lastDate: latest.date,
      suggestedDueDate: toIsoDate(dueMs),
      categoryHints: group.match.categoryHints,
      alreadyTracked: trackedKeys.has(key),
      matchedVia: group.match.matchedVia,
      sampleDescriptions: [...new Set(txns.map((t) => t.raw))].slice(-3),
      catalogItem: group.match.catalogItem,
      matchedPlan,
    })
  }

  const confidenceRank: Record<DetectionConfidence, number> = { high: 0, medium: 1, low: 2 }
  return results.sort(
    (a, b) =>
      Number(a.alreadyTracked) - Number(b.alreadyTracked) ||
      confidenceRank[a.confidence] - confidenceRank[b.confidence] ||
      b.occurrences - a.occurrences ||
      a.name.localeCompare(b.name)
  )
}
