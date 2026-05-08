/**
 * CategoryIcon Component
 * Shared SVG icon mapping for category names — used by Categories and Budgets pages
 */

interface CategoryIconProps {
  name: string
  size?: number
}

type IconDef = { path: string; viewBox?: string }

const defaultIcon: IconDef = {
  path: 'M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01',
}

const iconPatterns: [RegExp, IconDef][] = [
  // Transport / Car
  [/car|auto|vehicle|transport|gas|fuel|parking|uber|lyft|toll/i, {
    path: 'M5 17h14v-5H5v5zm11.5-5L18 8H6l1.5 4M7 17a1 1 0 100 2 1 1 0 000-2zm10 0a1 1 0 100 2 1 1 0 000-2zM9 4h6',
  }],
  // Food / Dining / Groceries
  [/food|dining|grocer|restaurant|eat|meal|lunch|dinner|breakfast|cafe|coffee/i, {
    path: 'M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zm4-4v4m4-4v4m4-4v4',
  }],
  // Housing / Rent / Mortgage
  [/hous|rent|mortgage|home|lease|property|real\s*estate/i, {
    path: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2zM9 22V12h6v10',
  }],
  // Utilities
  [/utilit|electric|water|gas\s*bill|sewer|trash|garbage|recycling|power|energy/i, {
    path: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  }],
  // Entertainment / Fun
  [/entertain|fun|game|movie|cinema|theatre|theater|concert|music|stream|netflix|spotify|hulu|disney|hbo/i, {
    path: 'M2 3h20v14a2 2 0 01-2 2H4a2 2 0 01-2-2V3zm6 18h8m-4-4v4',
  }],
  // Shopping / Retail
  [/shop|retail|cloth|apparel|mall|amazon|walmart|target|costco/i, {
    path: 'M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0',
  }],
  // Health / Medical
  [/health|medical|doctor|dentist|pharma|hospital|clinic|therapy|vet|vision|eye|glasses/i, {
    path: 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z',
  }],
  // Education
  [/edu|school|college|university|tuition|book|course|class|learn|study|student/i, {
    path: 'M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z',
  }],
  // Travel
  [/travel|flight|airfare|airline|hotel|airbnb|vacation|trip|holiday/i, {
    path: 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z',
  }],
  // Insurance
  [/insur/i, {
    path: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  }],
  // Savings / Investment
  [/sav|invest|retire|ira|401|stock|broker|dividend|interest/i, {
    path: 'M13 11l4-4m-4 4l2 4-5 1-2-4 1-5zM12 10a3 3 0 100 6 3 3 0 000-6zm7-5a2 2 0 100 4 2 2 0 000-4zM5 17a2 2 0 100 4 2 2 0 000-4z',
  }],
  // Phone / Internet / Communication
  [/phone|mobile|cell|internet|wifi|broadband|telecom|data\s*plan/i, {
    path: 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z',
  }],
  // Gifts / Donations
  [/gift|donat|charit|present/i, {
    path: 'M20 12v8H4v-8M22 8H2v4h20V8zM12 8v12M12 8c0-3-2-5-4-5S4 5 4 8m8 0c0-3 2-5 4-5s4 2 4 5',
  }],
  // Pets
  [/pet|dog|cat|animal/i, {
    path: 'M12 8a3 3 0 100 6 3 3 0 000-6zm-7 8.93A10 10 0 0112 3a10 10 0 017 13.93M7 6.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm10 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm-10 8a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm10 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z',
  }],
  // Fitness / Sports
  [/fit|gym|sport|exercise|workout|yoga|bike|cycling|run/i, {
    path: 'M18 20V10M12 20V4M6 20v-6',
  }],
  // Subscriptions
  [/subscri|member|recur/i, {
    path: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  }],
  // Kids / Children
  [/child|kid|baby|daycare|nanny|babysit|school\s*supp/i, {
    path: 'M8 10a4 4 0 018 0M4 20c0-4 3.6-7 8-7s8 3 8 7',
  }],
  // Beauty / Personal Care
  [/beaut|spa|salon|hair|nail|cosmet|skin|makeup|barber/i, {
    path: 'M8 10a4 4 0 018 0M4 20c0-4 3.6-7 8-7s8 3 8 7M12 14v4',
  }],
  // Business / Work
  [/business|work|office|supplies|desk/i, {
    path: 'M2 7h20v14a2 2 0 01-2 2H4a2 2 0 01-2-2V7zm14-2V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2M12 12v.01',
  }],
  // Taxes
  [/tax|irs|government/i, {
    path: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8m8 4H8m0-8h4',
  }],
  // Credit Card / Loans / Debt
  [/credit|debt|loan|card|payment/i, {
    path: 'M1 4h22v16a2 2 0 01-2 2H3a2 2 0 01-2-2V4zm0 6h22',
  }],
  // Income / Salary / Wages
  [/income|salary|wage|paycheck|payroll|earn|revenue/i, {
    path: 'M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
  }],
  // Miscellaneous / Other / General / Uncategorized
  [/misc|other|general|uncategor|unknown|various|catch.?all/i, {
    path: 'M12 8a3 3 0 100 6 3 3 0 000-6zm7.4 7a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
  }],
]

function findIcon(categoryName: string): IconDef | null {
  const lower = categoryName.toLowerCase()
  for (const [pattern, def] of iconPatterns) {
    if (pattern.test(lower)) return def
  }
  return null
}

export function getCategorySvg(name: string, size = 18) {
  const icon = findIcon(name)
  const def = icon ?? defaultIcon
  return (
    <svg width={size} height={size} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox={def.viewBox ?? '0 0 24 24'}>
      <path d={def.path} />
    </svg>
  )
}

export default function CategoryIcon(props: CategoryIconProps) {
  return getCategorySvg(props.name, props.size)
}
