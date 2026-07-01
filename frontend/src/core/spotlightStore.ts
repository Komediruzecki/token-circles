/**
 * Spotlight Store — Per-page guided tours with localStorage tracking
 *
 * Targeting contract: every step points at a dedicated `data-tour="<key>"` attribute
 * (NOT a CSS class, tag, placeholder, or `data-test-id`). The anchor element must be
 * ALWAYS rendered on its `requiredPage` — including empty states — so the highlight
 * never lands on a missing element. `frontend/src/core/spotlightStore.test.ts` enforces
 * both rules (valid `requiredPage`, `[data-tour="..."]` selector, and that every key
 * actually exists in the component source).
 */
import { createSignal } from 'solid-js'

export interface SpotlightStep {
  title: string
  targetSelector: string
  description: string
  placement?: 'top' | 'bottom' | 'left' | 'right'
  requiredPage?: string
}

export interface SpotlightTour {
  id: string
  label: string
  page: string
  steps: SpotlightStep[]
}

const TOURS_KEY = 'finance_spotlight_tours'

/** Build a step whose target is the `data-tour="<key>"` anchor on `page`. */
function step(
  key: string,
  page: string,
  title: string,
  description: string,
  placement: SpotlightStep['placement'] = 'bottom'
): SpotlightStep {
  return {
    title,
    description,
    placement,
    requiredPage: page,
    targetSelector: `[data-tour="${key}"]`,
  }
}

// ── Tour definitions ─────────────────────────────────────────────────────────

export const SPOTLIGHT_TOURS: SpotlightTour[] = [
  // ── Dashboard ──
  {
    id: 'dashboard',
    label: 'Dashboard',
    page: 'dashboard',
    steps: [
      step(
        'dashboard-header',
        'dashboard',
        'Dashboard',
        'Your financial command center — income, expenses, and net balance at a glance.'
      ),
      step(
        'dashboard-period',
        'dashboard',
        'Time period',
        'Switch timeframe with the period pills (1M/3M/6M/1Y/ALL) and arrows. Charts update instantly.'
      ),
      step(
        'dashboard-metrics',
        'dashboard',
        'Summary metrics',
        'Net worth, income, expenses, and the month-over-month change in the metric cards.'
      ),
      step(
        'dashboard-charts',
        'dashboard',
        'Charts',
        'Income vs expense trends, the net-worth timeline, and category breakdowns. Hover for details.',
        'top'
      ),
    ],
  },

  // ── Transactions ──
  {
    id: 'transactions',
    label: 'Transactions',
    page: 'transactions',
    steps: [
      step(
        'transactions-header',
        'transactions',
        'Transactions',
        'View, add, edit, and delete every transaction in one place.'
      ),
      step(
        'transactions-add',
        'transactions',
        'Add a transaction',
        'Open the quick-add form here — or press Ctrl+Shift+T from anywhere.'
      ),
      step(
        'transactions-filters',
        'transactions',
        'Smart filters',
        'Filter by category, tags, type, and date range, or search descriptions, beneficiaries, and payors.'
      ),
      step(
        'transactions-table',
        'transactions',
        'Transaction table',
        'FROM → TO flow, sortable columns, inline category badges and tags. Tick the checkboxes to reveal bulk actions.',
        'top'
      ),
    ],
  },

  // ── Accounts ──
  {
    id: 'accounts',
    label: 'Accounts',
    page: 'accounts',
    steps: [
      step(
        'accounts-header',
        'accounts',
        'Accounts',
        'Manage your bank, savings, investment, and cash accounts in one view.'
      ),
      step(
        'accounts-summary',
        'accounts',
        'Balances',
        "Total balance across all accounts, plus this month's income and expenses."
      ),
      step(
        'accounts-list',
        'accounts',
        'Your accounts',
        'Each card shows the type, current balance, and recent activity. This is where accounts appear once you add them.',
        'top'
      ),
      step(
        'accounts-add',
        'accounts',
        'Add an account',
        'Create giro, savings, investment, or cash accounts with a starting balance and date.'
      ),
    ],
  },

  // ── Portfolio ──
  {
    id: 'portfolio',
    label: 'Portfolio',
    page: 'portfolio',
    steps: [
      step(
        'portfolio-header',
        'portfolio',
        'Portfolio',
        'Track your stock and ETF holdings with live prices from Yahoo Finance.'
      ),
      step(
        'portfolio-holdings',
        'portfolio',
        'Holdings',
        'Ticker, shares, cost basis, current price, market value, and gain/loss for each holding.',
        'top'
      ),
      step(
        'portfolio-refresh',
        'portfolio',
        'Refresh prices',
        'Pull the latest prices from Yahoo Finance; gain/loss recalculates live.'
      ),
    ],
  },

  // ── Budgets ──
  {
    id: 'budgets',
    label: 'Budgets',
    page: 'budgets',
    steps: [
      step(
        'budgets-header',
        'budgets',
        'Budgets',
        'Zero-based budgeting — plan monthly category budgets and track budgeted vs actual spending.'
      ),
      step(
        'budgets-month',
        'budgets',
        'Month',
        "Move between months; use Duplicate Last to copy the previous month's budgets."
      ),
      step(
        'budgets-summary',
        'budgets',
        'Summary',
        'Income, allocated, spent, and remaining across all categories.'
      ),
      step(
        'budgets-allocations',
        'budgets',
        'Category allocations',
        'Per-category progress bars — green on track, amber warning, red over budget.',
        'top'
      ),
    ],
  },

  // ── Savings Goals ──
  {
    id: 'goals',
    label: 'Savings Goals',
    page: 'goals',
    steps: [
      step(
        'goals-header',
        'goals',
        'Savings goals',
        'Set financial targets with deadlines and track progress toward each one.'
      ),
      step(
        'goals-add',
        'goals',
        'Add a goal',
        'Create a savings goal with a target amount, an optional deadline, and a starting balance.'
      ),
      step(
        'goals-list',
        'goals',
        'Your goals',
        'Each card shows the name, target, progress bar, and deadline. This is where goals appear once you add them.',
        'top'
      ),
    ],
  },

  // ── Loans ──
  {
    id: 'loans',
    label: 'Loans',
    page: 'loans',
    steps: [
      step(
        'loans-header',
        'loans',
        'Loans',
        'Track loans with amortization schedules, prepayments, and variable-rate periods.'
      ),
      step(
        'loans-add',
        'loans',
        'Add a loan',
        'Enter the principal, interest rate, term in months, and start date.'
      ),
      step(
        'loans-list',
        'loans',
        'Your loans',
        'Each card shows the principal, rate, term, and monthly payment. Click one for the full amortization.',
        'top'
      ),
    ],
  },

  // ── Bills ──
  {
    id: 'bills',
    label: 'Bills',
    page: 'bills',
    steps: [
      step(
        'bills-header',
        'bills',
        'Bills',
        'Track recurring bills and subscriptions with due dates and payment status.'
      ),
      step(
        'bills-add',
        'bills',
        'Add a bill',
        'Create a recurring bill or subscription with an amount, frequency, due date, and category.'
      ),
      step(
        'bills-tabs',
        'bills',
        'Bills, subscriptions & calendar',
        'Switch between regular bills, a subscriptions overview with monthly totals, and a due-date calendar.'
      ),
    ],
  },

  // ── Categories ──
  {
    id: 'categories',
    label: 'Categories',
    page: 'categories',
    steps: [
      step(
        'categories-header',
        'categories',
        'Categories',
        'Manage income and expense categories with colors, icons, and tax-deductible flags.'
      ),
      step(
        'categories-add',
        'categories',
        'Add a category',
        'Create a category with a name, color, icon, and type (income or expense).'
      ),
      step(
        'categories-list',
        'categories',
        'Your categories',
        'Each entry shows the color, icon, name, type, and tax status. This is where categories appear once you add them.',
        'top'
      ),
    ],
  },

  // ── Import ──
  {
    id: 'import',
    label: 'Import Data',
    page: 'import',
    steps: [
      step(
        'import-header',
        'import',
        'Import data',
        'Bring in transactions from Google Sheets, a CSV/XLSX file, or pasted CSV.'
      ),
      step(
        'import-methods',
        'import',
        'Import methods',
        'Pick a source — a Google Sheets URL, a file upload, or pasted CSV — then map columns and preview before importing.'
      ),
    ],
  },

  // ── Counterparties ──
  {
    id: 'counterparties',
    label: 'Counterparties',
    page: 'counterparties',
    steps: [
      step(
        'counterparties-header',
        'counterparties',
        'Counterparties',
        'See who owes who — aggregated from the beneficiary and payor fields across your transactions.'
      ),
      step(
        'counterparties-content',
        'counterparties',
        'Balances & table',
        'We Owe, Owed to Us, and Net Position, with a sortable per-counterparty table below. Populates as you record beneficiaries and payors.',
        'top'
      ),
    ],
  },

  // ── Analytics ──
  {
    id: 'analytics',
    label: 'Analytics',
    page: 'analytics',
    steps: [
      step(
        'analytics-header',
        'analytics',
        'Analytics',
        'Deep-dive your spending with charts, a calendar heatmap, and a flow diagram.'
      ),
      step(
        'analytics-trends',
        'analytics',
        'Category trends',
        'Income and expense trends by category over time. Switch between income and expense views.',
        'top'
      ),
      step(
        'analytics-heatmap',
        'analytics',
        'Spending heatmap',
        'Daily spending intensity on a calendar — darker cells mean higher spending.',
        'top'
      ),
      step(
        'analytics-sankey',
        'analytics',
        'Budget flow diagram',
        'A Sankey diagram of how money flows from income into categories. Set budgets to populate it.',
        'top'
      ),
    ],
  },

  // ── Retirement ──
  {
    id: 'retirement',
    label: 'Retirement',
    page: 'retirement',
    steps: [
      step(
        'retirement-header',
        'retirement',
        'Retirement',
        'Project your retirement savings and track progress toward your target.'
      ),
      step(
        'retirement-add',
        'retirement',
        'Add a goal',
        'Set your current age, target age, monthly contribution, and expected return.'
      ),
      step(
        'retirement-goals',
        'retirement',
        'Your retirement goals',
        'Each card shows the target, current savings, and progress. This is where goals appear once you add them.',
        'top'
      ),
    ],
  },

  // ── Calculators (combined, one step per calculator page) ──
  {
    id: 'calculators',
    label: 'Calculators',
    page: 'compound',
    steps: [
      step(
        'calc-compound',
        'compound',
        'Compound interest',
        'Model investment growth — adjust principal, monthly contribution, rate, and years.'
      ),
      step(
        'calc-emergency',
        'emergency',
        'Emergency fund',
        'Size an emergency fund based on your monthly expenses.'
      ),
      step(
        'calc-rentbuy',
        'rentBuy',
        'Rent vs buy',
        'Compare renting against buying a home with detailed financial projections.'
      ),
      step(
        'calc-housing',
        'housing',
        'Housing',
        'Find affordable housing costs from your income, expenses, and savings goals.'
      ),
    ],
  },

  // ── Settings ──
  {
    id: 'settings',
    label: 'Settings',
    page: 'settings',
    steps: [
      step(
        'settings-header',
        'settings',
        'Settings',
        'Preferences, theme, currency, storage mode, exports, and billing.'
      ),
      step(
        'settings-tabs',
        'settings',
        'Settings tabs',
        'General is shown here; Exports holds CSV and PDF reports; Billing appears when you run in self-hosted mode.'
      ),
      step(
        'settings-currency',
        'settings',
        'Currency',
        'Set the display currency used throughout the app.'
      ),
      step('settings-theme', 'settings', 'Theme', 'Toggle between light and dark mode.'),
      step(
        'settings-storage',
        'settings',
        'Storage mode',
        'Switch between self-hosted (SQLite) and serverless (browser) storage.'
      ),
    ],
  },
]

// ── State ──

export const [spotlightActive, setSpotlightActive] = createSignal(false)
export const [spotlightStep, setSpotlightStep] = createSignal(0)
export const [tourSteps, setTourSteps] = createSignal<SpotlightStep[]>([])
export const [activeTourId, setActiveTourId] = createSignal<string | null>(null)
export const [showTourSelection, setShowTourSelection] = createSignal(false)

// ── Persistence ──

export function loadCompletedTours(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(TOURS_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveCompletedTours(tours: Record<string, boolean>) {
  localStorage.setItem(TOURS_KEY, JSON.stringify(tours))
}

export function isTourCompleted(tourId: string): boolean {
  const tours = loadCompletedTours()
  return tours[tourId] || false
}

export function getCompletedCount(): number {
  return Object.values(loadCompletedTours()).filter(Boolean).length
}

export function getTotalTourCount(): number {
  return SPOTLIGHT_TOURS.length
}

// ── Actions ──

export function startTour(tourId: string) {
  const tour = SPOTLIGHT_TOURS.find((t) => t.id === tourId)
  if (!tour) return

  setTourSteps(tour.steps)
  setActiveTourId(tourId)
  setSpotlightStep(0)
  setSpotlightActive(true)
  setShowTourSelection(false)
}

export function startFullTour() {
  // Combine all tour steps into one mega-tour
  const allSteps: SpotlightStep[] = []
  for (const tour of SPOTLIGHT_TOURS) {
    allSteps.push(...tour.steps)
  }
  setTourSteps(allSteps)
  setActiveTourId('full')
  setSpotlightStep(0)
  setSpotlightActive(true)
  setShowTourSelection(false)
}

export function nextSpotlightStep() {
  const steps = tourSteps()
  const current = spotlightStep()
  if (current < steps.length - 1) {
    setSpotlightStep(current + 1)
  } else {
    endSpotlight()
  }
}

export function prevSpotlightStep() {
  const current = spotlightStep()
  if (current > 0) {
    setSpotlightStep(current - 1)
  }
}

export function endSpotlight() {
  const tourId = activeTourId()
  if (tourId && tourId !== 'full') {
    const tours = loadCompletedTours()
    tours[tourId] = true
    saveCompletedTours(tours)
  }

  // If full tour, mark all individual tours as completed
  if (tourId === 'full') {
    const tours = loadCompletedTours()
    for (const tour of SPOTLIGHT_TOURS) {
      tours[tour.id] = true
    }
    saveCompletedTours(tours)
  }

  setSpotlightActive(false)
  setSpotlightStep(0)
  setTourSteps([])
  setActiveTourId(null)
}

export function resetAllTours() {
  localStorage.removeItem(TOURS_KEY)
}
