/**
 * parseEntry — turn a plain-language quick-entry string into a transaction draft.
 *
 * The Orbit Command Bar reads what you type ("coffee 4.50", "salary 3000",
 * "-20 groceries yesterday") and fills the chips; this is the pure,
 * side-effect-free core it leans on, kept separate so it can be unit-tested and
 * reused by other entry surfaces. It never invents an amount or a category — it
 * proposes, the user confirms.
 */
import { categoryLookup, effectiveKind } from '../../../../shared/guidance/kinds'
import { localToday } from '../../utils/period'
import type { Kind } from '../../../../shared/guidance/kinds'

export interface ParseCategory {
  id: number
  name: string
  type: 'income' | 'expense'
  /** What it holds (shared/guidance/kinds.ts); without one, its parent's or its name's. */
  kind?: string | null
  parent_id?: number | null
}

export interface ParseContext {
  categories: ParseCategory[]
  /** ISO yyyy-mm-dd used as "today"; defaults to the real today. */
  today?: string
}

export interface ParsedEntry {
  amount: number | null
  type: 'income' | 'expense'
  categoryId: number | null
  /** Display name of the guessed category (may be set even when id is null). */
  categoryGuess: string | null
  description: string
  /** ISO yyyy-mm-dd. */
  date: string
  /** Detected recurrence, surfaced as a hint (not acted on by the bar itself). */
  recurring: 'weekly' | 'monthly' | 'yearly' | null
}

/** Words that signal income even without a leading "+". */
const INCOME_WORDS = [
  'income',
  'salary',
  'paycheck',
  'payroll',
  'refund',
  'reimbursement',
  'deposit',
  'bonus',
  'dividend',
  'interest',
  'cashback',
]

/**
 * Words that say what an entry was for: the kind of category it goes in (shared/guidance/kinds.ts),
 * and a fragment a category's name likely holds, for a category with no kind to go by. A category
 * is matched by its effective kind first, so "coffee" finds Eating out whatever it is called, and
 * by name after, so a profile that still has Food finds it.
 */
interface Hint {
  kind?: Kind
  name: string
}

const hints = (words: string[], hint: Hint): [string, Hint][] => words.map((w) => [w, hint])

const CATEGORY_HINTS = new Map<string, Hint>([
  ...hints(
    ['coffee', 'latte', 'cafe', 'lunch', 'dinner', 'breakfast', 'restaurant', 'snack', 'meal'],
    {
      kind: 'eating_out',
      name: 'food',
    }
  ),
  ...hints(['grocery', 'groceries', 'food'], { kind: 'groceries', name: 'food' }),
  ...hints(
    [
      'uber',
      'taxi',
      'tram',
      'bus',
      'train',
      'metro',
      'fuel',
      'petrol',
      'gas',
      'parking',
      'transport',
      'transit',
      'flight',
    ],
    { kind: 'transport', name: 'transport' }
  ),
  ...hints(['rent', 'mortgage', 'hoa', 'housing'], { kind: 'housing', name: 'housing' }),
  ...hints(
    ['netflix', 'spotify', 'disney', 'youtube', 'subscription', 'prime', 'icloud', 'streaming'],
    { kind: 'subscriptions', name: 'subscription' }
  ),
  ...hints(['gym', 'pharmacy', 'doctor', 'dentist', 'health', 'medical'], {
    kind: 'health',
    name: 'health',
  }),
  ...hints(['salary', 'paycheck', 'payroll', 'wage'], { name: 'salary' }),
  ...hints(['shopping', 'clothes', 'amazon'], { kind: 'shopping', name: 'shopping' }),
  ...hints(['utility', 'utilities', 'electric', 'water', 'internet'], {
    kind: 'utilities',
    name: 'utilities',
  }),
  ...hints(['entertainment', 'movie', 'game', 'concert'], {
    kind: 'leisure',
    name: 'entertainment',
  }),
])

const FILLER = new Set([
  'at',
  'for',
  'on',
  'the',
  'a',
  'an',
  'to',
  'from',
  'in',
  'of',
  'my',
  'paid',
  'spent',
  'bought',
  'got',
])
const RECUR_WORDS = new Set(['monthly', 'weekly', 'yearly', 'annually', 'annual', 'every'])

function isoToday(ctx: ParseContext): string {
  if (ctx.today) return ctx.today
  return localToday()
}

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

/**
 * Normalise a matched number token to a JS number, tolerating both "4.50" and
 * "4,50", and thousands separators ("1,234.56" / "1.234,56" / "3000").
 */
export function normalizeAmount(token: string): number | null {
  let t = token.replace(/[^\d.,-]/g, '')
  const neg = t.startsWith('-')
  t = t.replace(/-/g, '')
  if (!t) return null
  const hasDot = t.includes('.')
  const hasComma = t.includes(',')
  if (hasDot && hasComma) {
    // The right-most separator is the decimal point.
    const dec = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ','
    const thou = dec === '.' ? ',' : '.'
    t = t.split(thou).join('')
    if (dec === ',') t = t.replace(',', '.')
  } else if (hasComma) {
    // Only commas: decimal if it trails 1-2 digits, else thousands.
    t = /,\d{1,2}$/.test(t) ? t.replace(',', '.') : t.split(',').join('')
  }
  // Only dots (or none): parseFloat reads it directly.
  const n = parseFloat(t)
  if (!Number.isFinite(n)) return null
  return neg ? -n : n
}

/** Pick the best category for the given tokens, constrained to `type`. */
function matchCategory(
  tokens: string[],
  type: 'income' | 'expense',
  categories: ParseCategory[]
): { id: number; name: string } | null {
  const pool = categories.filter((c) => c.type === type)
  if (pool.length === 0) return null

  // 1) A token that equals or is contained in a category name (or vice-versa).
  let best: { id: number; name: string; score: number } | null = null
  for (const c of pool) {
    const name = c.name.toLowerCase()
    for (const tok of tokens) {
      let score = 0
      if (name === tok) score = 100
      else if (name.includes(tok) && tok.length >= 3) score = 60
      else if (tok.includes(name) && name.length >= 3) score = 55
      if (score > (best?.score ?? 0)) best = { id: c.id, name: c.name, score }
    }
  }
  if (best) return { id: best.id, name: best.name }

  // 2) A hint keyword → a category of the hint's kind, else one whose name holds its fragment.
  const lookup = categoryLookup(categories)
  for (const tok of tokens) {
    const hint = CATEGORY_HINTS.get(tok)
    if (!hint) continue
    const hit =
      (hint.kind && pool.find((c) => effectiveKind(c, lookup) === hint.kind)) ||
      pool.find((c) => c.name.toLowerCase().includes(hint.name))
    if (hit) return { id: hit.id, name: hit.name }
  }
  return null
}

export function parseEntry(raw: string, ctx: ParseContext): ParsedEntry {
  const today = isoToday(ctx)
  const input = (raw || '').trim()
  const lower = input.toLowerCase()

  // Type: leading +/- or an income word.
  const words = new Set(lower.split(/[^a-z]+/).filter(Boolean))
  let type: 'income' | 'expense' = 'expense'
  if (input.startsWith('+')) type = 'income'
  else if (input.startsWith('-')) type = 'expense'
  else if (INCOME_WORDS.some((w) => words.has(w))) type = 'income'

  // Amount: first number-like token (keep a leading minus for detection only).
  const amountMatch = input.replace(/[€$£¥]/g, '').match(/-?\d[\d.,]*/)
  const amount = amountMatch ? normalizeAmount(amountMatch[0]) : null
  const amountAbs = amount === null ? null : Math.abs(amount)

  // Date: relative keywords.
  let date = today
  if (/\byesterday\b/.test(lower)) date = shiftDate(today, -1)
  else if (/\btomorrow\b/.test(lower)) date = shiftDate(today, 1)

  // Recurrence hint.
  let recurring: ParsedEntry['recurring'] = null
  if (/\b(monthly|every month)\b/.test(lower)) recurring = 'monthly'
  else if (/\b(weekly|every week)\b/.test(lower)) recurring = 'weekly'
  else if (/\b(yearly|annually|annual|every year)\b/.test(lower)) recurring = 'yearly'

  // Tokens for category matching (letters only, drop the amount + noise words).
  const withoutAmount = amountMatch ? input.replace(amountMatch[0], ' ') : input
  const rawTokens = withoutAmount
    .toLowerCase()
    .replace(/[€$£¥+]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z]/g, ''))
    .filter(Boolean)
  const contentTokens = rawTokens.filter(
    (t) =>
      !FILLER.has(t) &&
      !RECUR_WORDS.has(t) &&
      t !== 'yesterday' &&
      t !== 'tomorrow' &&
      t !== 'today'
  )

  const cat = matchCategory(contentTokens, type, ctx.categories)

  // Description: keep the merchant words, drop the matched pure-category token,
  // filler, recurrence and date words. Preserve original casing.
  const catNameLower = cat ? cat.name.toLowerCase() : null
  const descWords = withoutAmount
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w) => {
      const t = w.toLowerCase().replace(/[^a-z]/g, '')
      if (!t) return false
      if (FILLER.has(t) || RECUR_WORDS.has(t)) return false
      if (t === 'yesterday' || t === 'tomorrow' || t === 'today') return false
      if (catNameLower && t === catNameLower) return false // drop a bare category word
      return true
    })
  const description = descWords.join(' ').replace(/[+]/g, '').trim()

  return {
    amount: amountAbs,
    type,
    categoryId: cat ? cat.id : null,
    categoryGuess: cat ? cat.name : null,
    description,
    date,
    recurring,
  }
}
