import { describe, expect, it } from 'vitest'

// --- Duplicated from CategoryIcon.tsx for testing (avoids JSX import issues) ---

type IconDef = { path: string; viewBox?: string }

const iconPatterns: [RegExp, IconDef][] = [
  [/car|auto|vehicle|transport|gas|fuel|parking|uber|lyft|toll/i, { path: 'car' }],
  [/food|dining|grocer|restaurant|eat|meal|lunch|dinner|breakfast|cafe|coffee/i, { path: 'food' }],
  [/hous|rent|mortgage|home|lease|property|real\s*estate|apartment/i, { path: 'home' }],
  [/utilit|electric|water|gas\s*bill|sewer|trash|garbage|recycling|power|energy/i, { path: 'zap' }],
  [
    /entertain|fun|game|movie|cinema|theatre|theater|concert|music|stream|netflix|spotify|hulu|disney|hbo/i,
    { path: 'entertainment' },
  ],
  [/shop|retail|cloth|apparel|mall|amazon|walmart|target|costco/i, { path: 'shop' }],
  [
    /health|medical|doctor|dentist|pharma|hospital|clinic|therapy|vet|vision|eye|glasses/i,
    { path: 'health' },
  ],
  [
    /edu|school|college|university|tuition|book|course|class|learn|study|student/i,
    { path: 'book' },
  ],
  [/travel|flight|airfare|airline|hotel|airbnb|vacation|trip|holiday/i, { path: 'plane' }],
  [/insur/i, { path: 'insurance' }],
  [/sav|invest|retire|ira|401|stock|broker|dividend|interest/i, { path: 'invest' }],
  [/phone|mobile|cell|internet|wifi|broadband|telecom|data\s*plan/i, { path: 'phone' }],
  [/gift|donat|charit|present/i, { path: 'gift' }],
  [/pet|dog|cat|animal/i, { path: 'pet' }],
  [/fit|gym|sport|exercise|workout|yoga|bike|cycling|run/i, { path: 'fitness' }],
  [/subscri|member|recur|bill/i, { path: 'subscription' }],
  [/child|kid|baby|daycare|nanny|babysit|school\s*supp/i, { path: 'kids' }],
  [/beaut|spa|salon|hair|nail|cosmet|skin|makeup|barber/i, { path: 'beauty' }],
  [/business|work|office|supplies|desk/i, { path: 'business' }],
  [/tax|irs|government/i, { path: 'tax' }],
  [/credit|debt|loan|card|payment/i, { path: 'loan' }],
  [/income|salary|wage|paycheck|payroll|earn|revenue/i, { path: 'income' }],
  [/bank|fee|finance|financial|reimburs/i, { path: 'bank' }],
  [/misc|other|general|uncategor|unknown|various|catch.?all/i, { path: 'other' }],
]

// Duplicated from CategoryIcon.tsx
const boundaryWords = new Set([
  'car',
  'cat',
  'dog',
  'pet',
  'gas',
  'fun',
  'eat',
  'eye',
  'run',
  'fit',
  'gym',
  'kid',
  'vet',
  'spa',
  'tax',
  'irs',
  'fee',
  'desk',
  'cell',
  'rent',
  'nail',
  'skin',
  'hair',
])

function findIcon(categoryName: string): string | null {
  const lower = categoryName.toLowerCase()
  patternLoop: for (const [pattern, def] of iconPatterns) {
    if (!pattern.test(lower)) continue
    const src = pattern.source
    const words = src.split('|').map((w) => w.replace(/\\[s*?.]|[()]/g, '').replace(/\\b/g, ''))
    // Accept if any non-boundary word appears (long words >4 chars, or words
    // not in the boundary set, are unlikely to be false positives)
    const safeOk = words.some((w) => (w.length > 4 || !boundaryWords.has(w)) && lower.includes(w))
    if (safeOk) return def.path
    // For short keywords only, verify at least one matches with word boundaries
    const shortWords = words.filter((w) => w.length <= 4 && boundaryWords.has(w))
    if (shortWords.length > 0) {
      // eslint-disable-next-line security/detect-non-literal-regexp -- regex built from a hardcoded test keyword, not user input
      const boundaryOk = shortWords.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(lower))
      if (boundaryOk) return def.path
      continue patternLoop
    }
    return def.path
  }
  return null
}

// --- Tests ---

const expected: Record<string, string | null> = {
  // Transport
  Car: 'car',
  'Car (Gas)': 'car',
  Transport: 'car',
  Gas: 'car',
  Fuel: 'car',
  // Food
  Groceries: 'food',
  Restaurant: 'food',
  Food: 'food',
  Dining: 'food',
  Coffee: 'food',
  // Housing
  Apartment: 'home',
  'Apartment (Bills)': 'home',
  Housing: 'home',
  Rent: 'home',
  Mortgage: 'home',
  // Shopping
  Shopping: 'shop',
  'Shopping (Cloths)': 'shop',
  Clothing: 'shop',
  // Health
  Health: 'health',
  Medical: 'health',
  Doctor: 'health',
  Pharmacy: 'health',
  // Entertainment
  Fun: 'entertainment',
  Entertainment: 'entertainment',
  Games: 'entertainment',
  Music: 'entertainment',
  // Income
  'Salary Eur': 'income',
  Salary: 'income',
  'Passive Income': 'income',
  Wages: 'income',
  // Tax
  Tax: 'tax',
  // Loans
  MG18Loan: 'loan',
  Loan: 'loan',
  'Credit Card': 'loan',
  Debt: 'loan',
  // Investments
  Investments: 'invest',
  Savings: 'invest',
  Stocks: 'invest',
  // Subscriptions
  Subscriptions: 'subscription',
  // Gifts
  Gifts: 'gift',
  // Bank
  'Bank Fees': 'bank',
  Reimbursements: 'bank',
  // Other
  Other: 'other',
  Miscellaneous: 'other',
  Uncategorized: 'other',
  // Explicit nulls — these should NOT match any pattern
  IB: null,
  Revolut: null,
  WGiro: null,
  WRev: null,
  'Erste Current': null,
  'Revolut Joint': null,
}

describe('findIcon pattern matching', () => {
  for (const [name, expectedFamily] of Object.entries(expected)) {
    if (expectedFamily === null) {
      it(`"${name}" → null (no false positive match)`, () => {
        expect(findIcon(name)).toBeNull()
      })
    } else {
      it(`"${name}" → ${expectedFamily}`, () => {
        expect(findIcon(name)).toBe(expectedFamily)
      })
    }
  }

  it('matches case-insensitively', () => {
    expect(findIcon('car')).toBe('car')
    expect(findIcon('CAR')).toBe('car')
    expect(findIcon('Car')).toBe('car')
  })

  it('substring match within longer descriptive names', () => {
    expect(findIcon('My Car Expenses 2026')).toBe('car')
    expect(findIcon('HEALTH INSURANCE PREMIUM')).toBe('health')
  })

  it('empty name returns null', () => {
    expect(findIcon('')).toBeNull()
  })
})
