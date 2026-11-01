/**
 * Bank statement import — keyword → category rule engine.
 *
 * A TypeScript port of the Apps Script `mapCategoriesToTransactions`: match a
 * transaction's text (description / counterparty) against an ordered list of
 * keyword rules and assign the first hit. The default rule set below is a small,
 * sensible seed derived from real Croatian statements; it is meant to be
 * edited/extended in-app (persistence lives in the rules store, not here).
 *
 * A rule's category is a name a newcomer's first import offers to create, so it is a default
 * category or a general name: never someone's own label, and never a second name for a default.
 * A rule that gave another name before lists it in `formerly`, oldest first, and keeps it there
 * for good: a space that has a category under that name keeps getting the rule's rows there
 * (`ruleCategory`). Renaming a rule means adding the name it gave to the end of its `formerly`.
 */
import type { CategoryRule, CategoryRuleSet } from './types';

const fold = (name: string): string => name.trim().toLowerCase();

/**
 * The rule whose **longest** matching keyword appears in `text`, or null if none
 * does. The longest keyword wins (most specific), so a rule with `"spar food & fuel"`
 * beats one with `"spar"` even if the latter is listed first; rule order only
 * breaks exact-length ties. Matching is case-insensitive substring.
 */
export function matchRule(text: string, rules: CategoryRuleSet): CategoryRule | null {
  const s = text.toLowerCase();
  if (!s.trim()) return null;
  let best: CategoryRule | null = null;
  let bestLen = 0;
  for (const rule of rules) {
    for (const kw of rule.keywords) {
      const k = kw.toLowerCase().trim();
      // Strict `>` keeps the first rule on a length tie (stable, order = priority).
      if (k.length > bestLen && s.includes(k)) {
        best = rule;
        bestLen = k.length;
      }
    }
  }
  return best;
}

/**
 * The category `rule` files a row under in a space whose categories are named `categoryNames`:
 * the first of the names it gave before (`formerly`, oldest first) that the space has a category
 * under, as the space spells it, and otherwise the name it gives now. Names match case-blind and
 * trimmed, like every import match.
 *
 * This is what lets two rules give one name. The Croatian fuel and parking rules both give
 * Transportation, and a space that holds 'Car (Gas)' and 'Transport' still gets fuel under the
 * one and parking under the other: by the time a row only carries 'Transportation', nothing can
 * tell which of the two it stands for.
 */
export function ruleCategory(rule: CategoryRule, categoryNames: readonly string[] = []): string {
  // A saved rule set is read back from browser storage unchecked.
  const formerly = Array.isArray(rule.formerly) ? rule.formerly : [];
  for (const former of formerly) {
    const key = typeof former === 'string' ? fold(former) : '';
    if (!key) continue;
    const held = categoryNames.find((name) => fold(name) === key);
    if (held !== undefined) return held.trim();
  }
  return rule.category;
}

/**
 * Return the category for `text`, or null if nothing matches: the category of the rule
 * `matchRule` finds, in a space whose categories are named `categoryNames` (`ruleCategory`).
 */
export function matchCategory(
  text: string,
  rules: CategoryRuleSet,
  categoryNames?: readonly string[]
): string | null {
  const rule = matchRule(text, rules);
  return rule ? ruleCategory(rule, categoryNames) : null;
}

export interface CategorizeOptions {
  /** The names of the categories the space being imported into has (`ruleCategory`). */
  categoryNames?: readonly string[];
  /** The category when no rule matches. */
  fallback?: string;
}

/**
 * Convenience: match against several text fragments (e.g. description then
 * counterparty), returning the first category found, else the fallback ('Other').
 */
export function categorize(
  fragments: Array<string | undefined>,
  rules: CategoryRuleSet,
  { categoryNames, fallback = 'Other' }: CategorizeOptions = {}
): string {
  for (const frag of fragments) {
    if (!frag) continue;
    const hit = matchCategory(frag, rules, categoryNames);
    if (hit) return hit;
  }
  return fallback;
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
    // Fuel stations. Transportation is the default category for the car.
    // NB: no bare "ina" — as a substring it false-matches Croatian words like
    // "član-ARINA" / "naknad-INA". Use the station forms instead.
    category: 'Transportation',
    formerly: ['Car (Gas)'],
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
    // Electricity, gas, water, waste, telecoms, the building reserve fund and insurance.
    category: 'Utilities',
    formerly: ['Apartment (Bills)'],
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
    category: 'Salary',
    formerly: ['Salary Eur'],
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
    category: 'Healthcare',
    formerly: ['Health'],
    keywords: ['ljekarn', 'ljekarne', 'pharmacy', 'poliklinik', 'dom zdravlja'],
  },
  {
    category: 'Eating out',
    formerly: ['Restaurant'],
    keywords: ['restaurant', 'restoran', 'rougemarin', 'pizzeria', 'caffe', 'bistro'],
  },
  {
    category: 'Shopping',
    keywords: ['about you', 'reserved', 'zara', 'h&m', 'steam', 'amazon'],
  },
  {
    // Zagreb's trams and buses (ZET), garages and parking, HAK, the ENC toll tag and the motorways.
    category: 'Transportation',
    formerly: ['Transport'],
    keywords: ['zet', 'garaža', 'garaza', 'parking', 'hak', 'enc', 'autoceste'],
  },
];

/**
 * A general, English/worldwide seed for users outside Croatia — common global
 * merchants and generic keywords. Deliberately modest; users refine it in the
 * rules editor. Longest-keyword-wins, so "amazon prime" → Subscriptions beats a
 * bare "amazon" → Shopping.
 */
export const DEFAULT_CATEGORY_RULES_WORLDWIDE: CategoryRuleSet = [
  {
    category: 'Groceries',
    keywords: [
      'walmart',
      'costco',
      'aldi',
      'lidl',
      'tesco',
      'sainsbury',
      'kroger',
      'carrefour',
      'whole foods',
      'trader joe',
      'supermarket',
      'grocery',
      'safeway',
    ],
  },
  {
    category: 'Eating out',
    formerly: ['Dining'],
    keywords: [
      'mcdonald',
      'burger king',
      'kfc',
      'starbucks',
      'subway',
      'domino',
      'pizza',
      'restaurant',
      'cafe',
      'coffee',
      'uber eats',
      'doordash',
      'deliveroo',
      'grubhub',
      'chipotle',
    ],
  },
  {
    category: 'Transportation',
    formerly: ['Transport'],
    keywords: ['uber', 'lyft', 'bolt', 'taxi', 'transit', 'metro', 'parking', 'toll', 'railway'],
  },
  {
    category: 'Transportation',
    formerly: ['Fuel'],
    keywords: ['shell', 'esso', 'exxon', 'chevron', 'texaco', 'gas station', 'petrol', 'fuel'],
  },
  {
    category: 'Subscriptions',
    keywords: [
      'netflix',
      'spotify',
      'youtube premium',
      'amazon prime',
      'disney',
      'hbo',
      'hulu',
      'audible',
      'patreon',
      'openai',
      'anthropic',
      'github',
      'google one',
      'icloud',
      'dropbox',
      'adobe',
      'microsoft 365',
    ],
  },
  {
    category: 'Shopping',
    keywords: [
      'amazon',
      'ebay',
      'aliexpress',
      'etsy',
      'ikea',
      'zara',
      'h&m',
      'nike',
      'adidas',
      'best buy',
      'shein',
    ],
  },
  {
    category: 'Utilities',
    keywords: [
      'electric',
      'electricity',
      'water bill',
      'gas bill',
      'internet',
      'broadband',
      'vodafone',
      'verizon',
      't-mobile',
      'comcast',
      'utility',
    ],
  },
  {
    category: 'Healthcare',
    formerly: ['Health'],
    keywords: ['pharmacy', 'cvs', 'walgreens', 'boots', 'clinic', 'hospital', 'dental', 'doctor'],
  },
  {
    category: 'Entertainment',
    keywords: [
      'cinema',
      'movie',
      'theatre',
      'steam',
      'playstation',
      'xbox',
      'nintendo',
      'ticketmaster',
    ],
  },
  {
    category: 'Travel',
    keywords: [
      'airbnb',
      'booking.com',
      'expedia',
      'hotel',
      'airlines',
      'ryanair',
      'easyjet',
      'flight',
      'hertz',
    ],
  },
  {
    category: 'Bank Fees',
    keywords: [
      'bank fee',
      'service charge',
      'atm fee',
      'overdraft',
      'interest charge',
      'monthly fee',
    ],
  },
  {
    // Not folded into the default Salary: refunds and reimbursements are money in, not pay.
    category: 'Income',
    keywords: ['salary', 'payroll', 'wages', 'direct deposit', 'refund', 'reimbursement'],
  },
  {
    category: 'Transfers',
    keywords: [
      'transfer',
      'zelle',
      'venmo',
      'paypal',
      'wise',
      'revolut',
      'cash app',
      'wire transfer',
    ],
  },
  {
    category: 'Housing',
    // NB: avoid a bare "rent" — as a substring it false-matches "current" (e.g. "Current Account").
    keywords: ['rent payment', 'monthly rent', 'mortgage', 'landlord', 'property management'],
  },
];

/** A named, selectable category-rule group (mapping). */
export interface RuleGroup {
  id: string;
  label: string;
  rules: CategoryRuleSet;
}

/** Built-in mapping groups the user can pick from in the import UI. */
export const RULE_GROUPS: RuleGroup[] = [
  { id: 'croatian', label: 'Croatian', rules: DEFAULT_CATEGORY_RULES },
  { id: 'worldwide', label: 'Worldwide (English)', rules: DEFAULT_CATEGORY_RULES_WORLDWIDE },
];

export const DEFAULT_RULE_GROUP_ID = 'croatian';

/** The seed ruleset for a group id (falls back to the Croatian default). */
export function rulesForGroup(id: string | null | undefined): CategoryRuleSet {
  return RULE_GROUPS.find((g) => g.id === id)?.rules ?? DEFAULT_CATEGORY_RULES;
}
