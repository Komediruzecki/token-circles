/**
 * Bank statement import: the built-in category rules as earlier versions had them.
 *
 * Until now a mapping switch stored a full copy of the group's built-in rules in this browser, and
 * so did a save with nothing changed (rulesStore.ts). The copy was never edited, but it read as an
 * edit: it kept giving the names of the version that stored it after the built-in rules moved on,
 * and switching the mapping warned that edits would be lost. A stored set equal to one of these
 * loads as its group's rules now. Saving the built-in rules as they are stores nothing any more, so
 * this list holds only what earlier versions stored.
 *
 * Frozen: each is a group's built-in rules exactly as git has them at that version. The tests keep
 * their own copies (__tests__/fixtures), so a change here fails them.
 */
import type { CategoryRuleSet } from '../../../../shared/bankImport/types'

/** DEFAULT_CATEGORY_RULES from the Bank Imports tab (5.3.0) through 5.17.3. */
const CROATIAN_5_17_3: CategoryRuleSet = [
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

/**
 * DEFAULT_CATEGORY_RULES on main after #671 gave Car (Gas), Apartment (Bills) and Salary Eur
 * default names. Never released, but dev ran it.
 */
const CROATIAN_671: CategoryRuleSet = [
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
    category: 'Transportation',
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
    category: 'Utilities',
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

/** DEFAULT_CATEGORY_RULES_WORLDWIDE from the Worldwide group (5.3.5) through 5.17.3 and #671. */
const WORLDWIDE_5_17_3: CategoryRuleSet = [
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
    category: 'Dining',
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
    category: 'Transport',
    keywords: ['uber', 'lyft', 'bolt', 'taxi', 'transit', 'metro', 'parking', 'toll', 'railway'],
  },
  {
    category: 'Fuel',
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
    category: 'Health',
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
    keywords: ['rent payment', 'monthly rent', 'mortgage', 'landlord', 'property management'],
  },
]

/** Each group's earlier built-in rules, by group id (RULE_GROUPS), oldest first. */
export const EARLIER_BUILT_IN_RULES: Readonly<Record<string, readonly CategoryRuleSet[]>> = {
  croatian: [CROATIAN_5_17_3, CROATIAN_671],
  worldwide: [WORLDWIDE_5_17_3],
}

/** Whether two JSON values are equal: arrays item by item, objects key by key in any order. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameJson(item, b[i]))
    )
  }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]))
  )
}

/**
 * The id of the group whose built-in rules `rules` is an earlier version of, or null: an edited
 * set, or the rules as they are now.
 */
export function earlierBuiltInGroup(rules: unknown): string | null {
  for (const [group, versions] of Object.entries(EARLIER_BUILT_IN_RULES)) {
    if (versions.some((version) => sameJson(rules, version))) return group
  }
  return null
}
