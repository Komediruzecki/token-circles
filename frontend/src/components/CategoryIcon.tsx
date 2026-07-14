/**
 * CategoryIcon Component
 * Shared SVG icon mapping for category names — used by Categories and Budgets pages
 */

interface CategoryIconProps {
  name: string
  size?: number
  icon?: string | null
}

type IconDef = { path: string; viewBox?: string }

const fallbackIcon: IconDef = {
  path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
}

const iconNameMap: Record<string, IconDef> = {
  briefcase: {
    path: 'M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2M12 12v.01',
  },
  'trending-up': { path: 'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6' },
  'dollar-sign': { path: 'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6' },
  'plus-circle': {
    path: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 8v8M8 12h8',
  },
  'arrow-up-circle': {
    path: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM16 12l-4-4m0 0l-4 4m4-4v8',
  },
  home: { path: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2zM9 22V12h6v10' },
  zap: { path: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z' },
  'shopping-cart': {
    path: 'M9 20a1 1 0 100 2 1 1 0 000-2zm7 0a1 1 0 100 2 1 1 0 000-2zM1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6',
  },
  shirt: { path: 'M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0' },
  package: {
    path: 'M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12',
  },
  shield: { path: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' },
  'bar-chart-2': { path: 'M18 20V10M12 20V4M6 20v-6' },
  car: {
    path: 'M5 17h14v-5H5v5zm11.5-5L18 8H6l1.5 4M7 17a1 1 0 100 2 1 1 0 000-2zm10 0a1 1 0 100 2 1 1 0 000-2zM9 4h6',
  },
  tool: {
    path: 'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z',
  },
  utensils: {
    path: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2M7 2v20M21 15V2v0a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7',
  },
  heart: {
    path: 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z',
  },
  tv: { path: 'M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM17 2l-5 5-5-5' },
  bus: {
    path: 'M7 17h10v-8H7v8zm4-8h2m3 0h2M6 8h1M5 17a1 1 0 100 2 1 1 0 000-2zm10 0a1 1 0 100 2 1 1 0 000-2zM5 4h14m-9 0v4',
  },
  plane: { path: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z' },
  book: {
    path: 'M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z',
  },
  film: { path: 'M22 2H2v20h20V2zM10 2v20M2 12h20M6 2v20M18 2v20M14 2v20' },
  smile: {
    path: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  },
  'shield-check': { path: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4' },
  gift: {
    path: 'M20 12v8H4v-8M22 8H2v4h20V8zM12 8v12M12 8c0-3-2-5-4-5S4 5 4 8m8 0c0-3 2-5 4-5s4 2 4 5',
  },
  tag: {
    path: 'M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01',
  },
  coffee: { path: 'M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zm4-4v4' },
  music: { path: 'M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z' },
  wifi: {
    path: 'M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01',
  },
  smartphone: {
    path: 'M17 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V4a2 2 0 00-2-2zm0 18H7V4h10v16zM12 18h.01',
  },
  globe: {
    path: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z',
  },
  creditcard: { path: 'M21 4H3a2 2 0 00-2 2v12a2 2 0 002 2h18a2 2 0 002-2V6a2 2 0 00-2-2zm0 7H3' },
  banknote: { path: 'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6' },
  piggybank: {
    path: 'M19 5c-1.5 0-2.8.8-3.5 2H11a5 5 0 000 10h1M7 17l-1 3M15 7h4l2 3-2 3h-4M10 10.5V13M10 3v1M5 9H2m4 2L4 9m2-2L4 7',
  },
  gamepad: {
    path: 'M6 11h4M8 9v4m7-4h.01M18 10h.01M17.32 5H6.68a4 4 0 00-3.978 3.59C2.15 11.76 2 13.84 2 16a4 4 0 004 4h12a4 4 0 004-4c0-2.16-.15-4.24-.702-6.41A4 4 0 0017.32 5z',
  },
  building: { path: 'M2 22h20M6 22V2h12v20M9 6h6M9 10h6M9 14h6M9 18h6' },
  stethoscope: { path: 'M22 12h-4l-3 9L9 3l-3 9H2M9 3v18M15 12v6' },
  dumbbell: { path: 'M6.5 6.5h11v11H6.5zM3 18V6m18 12V6M2 8h2m16 0h2M2 16h2m16 0h2' },
  baby: {
    path: 'M9 12h.01M15 12h.01M10 16c.5.8 1.3 1 2 1s1.5-.2 2-1M12 2a3 3 0 00-3 3v1H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V8a2 2 0 00-2-2h-3V5a3 3 0 00-3-3z',
  },
  shoppingbag: { path: 'M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0' },
  monitor: {
    path: 'M20 3H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V5a2 2 0 00-2-2zM8 21h8M12 17v4',
  },
  clock: {
    path: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 6v6l4 2',
  },
  calendar: {
    path: 'M19 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zM16 2v4M8 2v4M3 10h18',
  },
  'alert-circle': {
    path: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 8v4M12 16h.01',
  },
  'check-circle': { path: 'M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3' },
  target: {
    path: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 18a6 6 0 100-12 6 6 0 000 12zM12 14a2 2 0 100-4 2 2 0 000 4z',
  },
  'arrow-down': { path: 'M12 5v14M19 12l-7 7-7-7' },
  'arrow-up': { path: 'M12 19V5M5 12l7-7 7 7' },
  pen: { path: 'M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z' },
  trash: {
    path: 'M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3',
  },
  'arrow-right': { path: 'M5 12h14M12 5l7 7-7 7' },
  wallet: {
    path: 'M21 12V7H5a2 2 0 010-4h14v4M3 5v14a2 2 0 002 2h16v-5M18 12a1 1 0 100 2 1 1 0 000-2z',
  },
  sun: {
    path: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42',
  },
  moon: { path: 'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z' },
  map: { path: 'M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4zM8 2v16M16 6v16' },
  folder: { path: 'M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z' },
  star: {
    path: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  },
  users: {
    path: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  },
  more: {
    path: 'M12 13a1 1 0 100-2 1 1 0 000 2zm-7 0a1 1 0 100-2 1 1 0 000 2zm14 0a1 1 0 100-2 1 1 0 000 2z',
  },
  'arrow-left': { path: 'M19 12H5M12 19l-7-7 7-7' },
  link: {
    path: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71',
  },
  'more-horizontal': {
    path: 'M12 13a1 1 0 100-2 1 1 0 000 2zm-7 0a1 1 0 100-2 1 1 0 000 2zm14 0a1 1 0 100-2 1 1 0 000 2z',
  },
  'file-text': {
    path: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8m8 4H8m0-8h4',
  },
}

const iconPatterns: [RegExp, IconDef][] = [
  // Transport / Car
  [
    /car|auto|vehicle|transport|gas|fuel|parking|uber|lyft|toll/i,
    {
      path: 'M5 17h14v-5H5v5zm11.5-5L18 8H6l1.5 4M7 17a1 1 0 100 2 1 1 0 000-2zm10 0a1 1 0 100 2 1 1 0 000-2zM9 4h6',
    },
  ],
  // Food / Dining / Groceries
  [
    /food|dining|grocer|restaurant|eat|meal|lunch|dinner|breakfast|cafe|coffee/i,
    {
      path: 'M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zm4-4v4m4-4v4m4-4v4',
    },
  ],
  // Housing / Rent / Mortgage / Apartment
  [
    /hous|rent|mortgage|home|lease|property|real\s*estate|apartment/i,
    {
      path: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2zM9 22V12h6v10',
    },
  ],
  // Utilities
  [
    /utilit|electric|water|gas\s*bill|sewer|trash|garbage|recycling|power|energy/i,
    {
      path: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
    },
  ],
  // Entertainment / Fun
  [
    /entertain|fun|game|movie|cinema|theatre|theater|concert|music|stream|netflix|spotify|hulu|disney|hbo/i,
    {
      path: 'M2 3h20v14a2 2 0 01-2 2H4a2 2 0 01-2-2V3zm6 18h8m-4-4v4',
    },
  ],
  // Shopping / Retail
  [
    /shop|retail|cloth|apparel|mall|amazon|walmart|target|costco/i,
    {
      path: 'M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0',
    },
  ],
  // Health / Medical
  [
    /health|medical|doctor|dentist|pharma|hospital|clinic|therapy|vet|vision|eye|glasses/i,
    {
      path: 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z',
    },
  ],
  // Education
  [
    /edu|school|college|university|tuition|book|course|class|learn|study|student/i,
    {
      path: 'M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z',
    },
  ],
  // Travel
  [
    /travel|flight|airfare|airline|hotel|airbnb|vacation|trip|holiday/i,
    {
      path: 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z',
    },
  ],
  // Insurance
  [
    /insur/i,
    {
      path: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    },
  ],
  // Savings / Investment
  [
    /sav|invest|retire|ira|401|stock|broker|dividend|interest/i,
    {
      path: 'M13 11l4-4m-4 4l2 4-5 1-2-4 1-5zM12 10a3 3 0 100 6 3 3 0 000-6zm7-5a2 2 0 100 4 2 2 0 000-4zM5 17a2 2 0 100 4 2 2 0 000-4z',
    },
  ],
  // Phone / Internet / Communication
  [
    /phone|mobile|cell|internet|wifi|broadband|telecom|data\s*plan/i,
    {
      path: 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z',
    },
  ],
  // Gifts / Donations
  [
    /gift|donat|charit|present/i,
    {
      path: 'M20 12v8H4v-8M22 8H2v4h20V8zM12 8v12M12 8c0-3-2-5-4-5S4 5 4 8m8 0c0-3 2-5 4-5s4 2 4 5',
    },
  ],
  // Pets
  [
    /pet|dog|cat|animal/i,
    {
      path: 'M12 8a3 3 0 100 6 3 3 0 000-6zm-7 8.93A10 10 0 0112 3a10 10 0 017 13.93M7 6.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm10 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm-10 8a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm10 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z',
    },
  ],
  // Fitness / Sports
  [
    /fit|gym|sport|exercise|workout|yoga|bike|cycling|run/i,
    {
      path: 'M18 20V10M12 20V4M6 20v-6',
    },
  ],
  // Subscriptions / Bills
  [
    /subscri|member|recur|bill/i,
    {
      path: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
    },
  ],
  // Kids / Children
  [
    /child|kid|baby|daycare|nanny|babysit|school\s*supp/i,
    {
      path: 'M8 10a4 4 0 018 0M4 20c0-4 3.6-7 8-7s8 3 8 7',
    },
  ],
  // Beauty / Personal Care
  [
    /beaut|spa|salon|hair|nail|cosmet|skin|makeup|barber/i,
    {
      path: 'M8 10a4 4 0 018 0M4 20c0-4 3.6-7 8-7s8 3 8 7M12 14v4',
    },
  ],
  // Business / Work
  [
    /business|work|office|supplies|desk/i,
    {
      path: 'M2 7h20v14a2 2 0 01-2 2H4a2 2 0 01-2-2V7zm14-2V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2M12 12v.01',
    },
  ],
  // Taxes
  [
    /tax|irs|government/i,
    {
      path: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8m8 4H8m0-8h4',
    },
  ],
  // Credit Card / Loans / Debt
  [
    /credit|debt|loan|card|payment/i,
    {
      path: 'M1 4h22v16a2 2 0 01-2 2H3a2 2 0 01-2-2V4zm0 6h22',
    },
  ],
  // Income / Salary / Wages
  [
    /income|salary|wage|paycheck|payroll|earn|revenue/i,
    {
      path: 'M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
    },
  ],
  // Bank / Banking / Fees
  [
    /bank|fee|finance|financial|reimburs/i,
    {
      path: 'M3 3h18v18H3V3zm4 18v-6h10v6M8 9h8m-4-2v4',
    },
  ],
  // Miscellaneous / Other / General / Uncategorized
  [
    /misc|other|general|uncategor|unknown|various|catch.?all/i,
    {
      path: 'M12 8a3 3 0 100 6 3 3 0 000-6zm7.4 7a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
    },
  ],
]

// Short keywords that must appear as standalone words (with word boundaries)
// to avoid false positives like "car" inside "card", "cat" inside "categorized", etc.
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

function findIcon(categoryName: string): IconDef | null {
  const lower = categoryName.toLowerCase()
  patternLoop: for (const [pattern, def] of iconPatterns) {
    if (!pattern.test(lower)) continue

    // Accept the match if any non-boundary word appears (long words >4 chars,
    // or short words not in the boundary set, are unlikely false positives)
    const src = pattern.source
    const words = src.split('|').map((w) => w.replace(/\\[s*?.]|[()]/g, '').replace(/\\b/g, ''))
    const safeOk = words.some((w) => (w.length > 4 || !boundaryWords.has(w)) && lower.includes(w))
    if (safeOk) return def

    // For short keywords only, verify at least one matches with word boundaries
    const shortWords = words.filter((w) => w.length <= 4 && boundaryWords.has(w))
    if (shortWords.length > 0) {
      // eslint-disable-next-line security/detect-non-literal-regexp -- w is a short word from a controlled internal keyword list, not user input
      const boundaryOk = shortWords.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(lower))
      if (boundaryOk) return def
      continue patternLoop
    }

    // No short boundary words → accept the substring match
    return def
  }
  return null
}

// Stored icon values that are auto-assigned defaults (not user-chosen).
// When a category has one of these, pattern matching takes priority.
const defaultIconValues = new Set(['tag', 'folder', ''])
const isDefaultIcon = (icon?: string | null) =>
  icon === null || icon === undefined || defaultIconValues.has(icon)

export function getCategorySvg(name: string, size = 18, icon?: string | null) {
  let iconDef: IconDef | null = null

  // If the stored icon was explicitly chosen by the user (not a default), use it
  if (!isDefaultIcon(icon)) {
    iconDef = iconNameMap[icon!]
  }

  // Otherwise, try pattern matching on the category name
  if (!iconDef) {
    iconDef = findIcon(name)
  }

  // Finally, fall back to the generic fallback
  if (!iconDef) {
    iconDef = fallbackIcon
  }

  return (
    <svg
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      viewBox={iconDef.viewBox ?? '0 0 24 24'}
    >
      <path d={iconDef.path} />
    </svg>
  )
}

export default function CategoryIcon(props: CategoryIconProps) {
  return getCategorySvg(props.name, props.size, props.icon)
}
