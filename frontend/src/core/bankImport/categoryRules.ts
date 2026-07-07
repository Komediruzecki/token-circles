/**
 * Bank statement import — keyword → category rule engine.
 *
 * A TypeScript port of the Apps Script `mapCategoriesToTransactions`: match a
 * transaction's text (description / counterparty) against an ordered list of
 * keyword rules and assign the first hit. The default rule set below is a small,
 * sensible seed derived from the user's real statements; it is meant to be
 * edited/extended in-app (persistence lives in the rules store, not here).
 */
import type { CategoryRuleSet } from './types'

/**
 * Return the category for `text`, or null if nothing matches. The **longest**
 * matching keyword wins (most specific), so a rule with `"spar food & fuel"`
 * beats one with `"spar"` even if the latter is listed first; rule order only
 * breaks exact-length ties. Matching is case-insensitive substring.
 */
export function matchCategory(text: string, rules: CategoryRuleSet): string | null {
  const s = text.toLowerCase()
  if (!s.trim()) return null
  let best: string | null = null
  let bestLen = 0
  for (const rule of rules) {
    for (const kw of rule.keywords) {
      const k = kw.toLowerCase().trim()
      // Strict `>` keeps the first rule on a length tie (stable, order = priority).
      if (k.length > bestLen && s.includes(k)) {
        best = rule.category
        bestLen = k.length
      }
    }
  }
  return best
}

/**
 * Convenience: match against several text fragments (e.g. description then
 * counterparty), returning the first category found, else `fallback`.
 */
export function categorize(
  fragments: Array<string | undefined>,
  rules: CategoryRuleSet,
  fallback = 'Other'
): string {
  for (const frag of fragments) {
    if (!frag) continue
    const hit = matchCategory(frag, rules)
    if (hit) return hit
  }
  return fallback
}

/**
 * Default seed rules. Keep this modest and general — the user refines it in the
 * rules editor. Ordered most-specific-first so e.g. "Google One" → Subscriptions
 * wins over a bare "google" elsewhere.
 */
export const DEFAULT_CATEGORY_RULES: CategoryRuleSet = [
  {
    category: 'Groceries',
    keywords: [
      'kaufland',
      'konzum',
      'spar',
      'lidl',
      'plodine',
      'dm drogerie',
      'müller',
      'muller',
      'vrutak',
      'bio&bio',
      'tommy',
      'studenac',
    ],
  },
  {
    category: 'Subscriptions',
    keywords: [
      'netflix',
      'spotify',
      'google one',
      'youtube',
      'audible',
      'apple',
      'openai',
      'anthropic',
      'github',
      'cloudflare',
      'patreon',
    ],
  },
  {
    // NB: no bare "ina" — as a substring it false-matches Croatian words like
    // "član-ARINA" / "naknad-INA". Use the station forms instead.
    category: 'Car (Gas)',
    keywords: ['ina bp', 'lukoil', 'petrol', 'crodux', 'tifon', 'shell', 'benzinska'],
  },
  {
    category: 'Bank Fees',
    keywords: [
      'naknad',
      'uplata naknade',
      'pripis kamate',
      'pasivne kamate',
      'bank fee',
      'vođenje računa',
      'vodenje racuna',
    ],
  },
  {
    category: 'Apartment (Bills)',
    keywords: [
      'pričuva',
      'pricuva',
      'vodne usluge',
      'zbrinjavanje otpada',
      'obračun plina',
      'obracun plina',
      'hep',
      'a1 usluge',
      'a1 hrvatska',
      'plina za',
      'osiguranj',
    ],
  },
  {
    category: 'Salary Eur',
    keywords: [
      'isplata plaće',
      'isplata place',
      'isplata potpore',
      'naknada za prijevoz',
      'plaća',
      'salary',
      'payroll',
    ],
  },
  {
    category: 'Health',
    keywords: ['ljekarn', 'ljekarne', 'pharmacy', 'poliklinik', 'dom zdravlja'],
  },
  {
    category: 'Restaurant',
    keywords: ['restaurant', 'restoran', 'rougemarin', 'pizzeria', 'caffe', 'bistro'],
  },
  {
    category: 'Shopping',
    keywords: ['about you', 'reserved', 'zara', 'h&m', 'steam', 'amazon'],
  },
  {
    category: 'Transport',
    keywords: ['zet', 'garaža', 'garaza', 'parking', 'hak', 'enc', 'autoceste', 'badminton'],
  },
]
