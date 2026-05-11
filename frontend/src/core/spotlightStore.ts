/**
 * Spotlight Store — Per-page guided tours with localStorage tracking
 */
import { createSignal } from 'solid-js'

export interface SpotlightStep {
  title: string
  targetSelector: string
  description: string
  placement?: 'top' | 'bottom' | 'left' | 'right'
  section?: string
  requiredPage?: string
}

export interface SpotlightTour {
  id: string
  label: string
  page: string
  steps: SpotlightStep[]
}

const TOURS_KEY = 'finance_spotlight_tours'

// ── Tour definitions ─────────────────────────────────────────────────────────

export const SPOTLIGHT_TOURS: SpotlightTour[] = [
  // ── Dashboard ──
  {
    id: 'dashboard',
    label: 'Dashboard',
    page: 'dashboard',
    steps: [
      {
        title: 'Dashboard Overview',
        targetSelector: '[data-test-id="dashboard-header"]',
        description:
          'Your financial command center. See income, expenses, and net balance at a glance.',
        placement: 'bottom',
        section: 'dashboard',
        requiredPage: 'dashboard',
      },
      {
        title: 'Summary Metrics',
        targetSelector: '[data-test-id="dashboard-metrics"]',
        description:
          'Net worth, income, expenses, and month-over-month deltas in the four metric cards.',
        placement: 'bottom',
        section: 'dashboard',
        requiredPage: 'dashboard',
      },
      {
        title: 'Charts Section',
        targetSelector: 'canvas',
        description:
          'Income vs expense trend charts, net worth timeline, and category breakdowns. Hover for details.',
        placement: 'top',
        section: 'dashboard',
        requiredPage: 'dashboard',
      },
      {
        title: 'Period Navigation',
        targetSelector: '[data-test-id="dashboard-header"] button',
        description:
          'Use the period pills (1M/3M/6M/1Y/ALL) and arrows to switch timeframes. Charts update automatically.',
        placement: 'bottom',
        section: 'dashboard',
        requiredPage: 'dashboard',
      },
    ],
  },

  // ── Transactions ──
  {
    id: 'transactions',
    label: 'Transactions',
    page: 'transactions',
    steps: [
      {
        title: 'Transactions Page',
        targetSelector: '[data-test-id="transactions-header"]',
        description: 'View, add, edit, and delete all your financial transactions in one place.',
        placement: 'bottom',
        section: 'transactions',
        requiredPage: 'transactions',
      },
      {
        title: 'Add Transaction',
        targetSelector: '[data-test-id="add-transaction-btn"]',
        description:
          'Click to open the quick-add form. Use Ctrl+Shift+T from anywhere for rapid entry.',
        placement: 'bottom',
        section: 'transactions',
        requiredPage: 'transactions',
      },
      {
        title: 'Smart Filters',
        targetSelector: '[data-test-id="filter-bar"]',
        description:
          'Filter by category, tags, type, and date range. Search descriptions, beneficiaries, or payors.',
        placement: 'bottom',
        section: 'transactions',
        requiredPage: 'transactions',
      },
      {
        title: 'Transaction Table',
        targetSelector: '[data-test-id="data-table"]',
        description:
          'FROM → TO flow column, sortable headers, inline category badges and tags. Checkboxes enable bulk actions.',
        placement: 'top',
        section: 'transactions',
        requiredPage: 'transactions',
      },
      {
        title: 'Bulk Actions',
        targetSelector: '.page-transactions',
        description:
          'Select transactions with checkboxes. The bulk bar appears — delete, recategorize, or change type for all selected.',
        placement: 'bottom',
        section: 'transactions',
        requiredPage: 'transactions',
      },
    ],
  },

  // ── Accounts ──
  {
    id: 'accounts',
    label: 'Accounts',
    page: 'accounts',
    steps: [
      {
        title: 'Accounts Page',
        targetSelector: '[data-test-id="accounts-header"]',
        description: 'Manage all your bank, savings, investment, and cash accounts in one view.',
        placement: 'bottom',
        section: 'accounts',
        requiredPage: 'accounts',
      },
      {
        title: 'Account Balances',
        targetSelector: '[data-test-id="accounts-summary"]',
        description:
          'Total balance across all accounts, plus income and expense summaries for the current month.',
        placement: 'bottom',
        section: 'accounts',
        requiredPage: 'accounts',
      },
      {
        title: 'Account Cards',
        targetSelector: '[data-test-id="accounts-grid"]',
        description:
          'Each account shows type badge, current balance, and recent activity. Click "View All" to filter transactions.',
        placement: 'top',
        section: 'accounts',
        requiredPage: 'accounts',
      },
      {
        title: 'Add Account',
        targetSelector: '[data-test-id="add-account-btn"]',
        description:
          'Create checking, savings, investment/brokerage, or cash accounts with starting balance and date.',
        placement: 'bottom',
        section: 'accounts',
        requiredPage: 'accounts',
      },
    ],
  },

  // ── Portfolio ──
  {
    id: 'portfolio',
    label: 'Portfolio',
    page: 'portfolio',
    steps: [
      {
        title: 'Portfolio Tracker',
        targetSelector: '[data-test-id="portfolio-header"]',
        description:
          'Track your stock and ETF investments with real-time prices from Yahoo Finance.',
        placement: 'bottom',
        section: 'portfolio',
        requiredPage: 'portfolio',
      },
      {
        title: 'Portfolio Summary',
        targetSelector: '[data-test-id="portfolio-summary"]',
        description: 'Total portfolio value, cost basis, and gain/loss percentage at a glance.',
        placement: 'bottom',
        section: 'portfolio',
        requiredPage: 'portfolio',
      },
      {
        title: 'Holdings Table',
        targetSelector: '.page-portfolio table',
        description:
          'Ticker, shares, cost per share, current price, market value, and individual gain/loss for each holding.',
        placement: 'top',
        section: 'portfolio',
        requiredPage: 'portfolio',
      },
      {
        title: 'Refresh Prices',
        targetSelector: '[data-test-id="refresh-prices-btn"]',
        description:
          'Fetch the latest prices from Yahoo Finance. Holdings update with live gain/loss calculations.',
        placement: 'bottom',
        section: 'portfolio',
        requiredPage: 'portfolio',
      },
    ],
  },

  // ── Budgets ──
  {
    id: 'budgets',
    label: 'Budgets',
    page: 'budgets',
    steps: [
      {
        title: 'Budgets Page',
        targetSelector: '[data-test-id="budgets-header"]',
        description:
          'Plan your spending with monthly category budgets. Track budgeted vs actual spending.',
        placement: 'bottom',
        section: 'budgets',
        requiredPage: 'budgets',
      },
      {
        title: 'Budget Summary',
        targetSelector: '[data-test-id="budget-summary"]',
        description:
          'Total budgeted, spent, and remaining across all categories with percentage indicators.',
        placement: 'bottom',
        section: 'budgets',
        requiredPage: 'budgets',
      },
      {
        title: 'Category Allocations',
        targetSelector: '[data-test-id="budget-allocations"]',
        description:
          'Each category shows a progress bar. Green = on track, yellow = warning, red = over budget.',
        placement: 'top',
        section: 'budgets',
        requiredPage: 'budgets',
      },
      {
        title: 'Month Selector',
        targetSelector: '[data-test-id="month-selector"]',
        description:
          'Navigate between months to view and set budgets. Use "Duplicate Last" to quickly copy last month\'s budgets.',
        placement: 'bottom',
        section: 'budgets',
        requiredPage: 'budgets',
      },
    ],
  },

  // ── Savings Goals ──
  {
    id: 'goals',
    label: 'Savings Goals',
    page: 'goals',
    steps: [
      {
        title: 'Savings Goals',
        targetSelector: '[data-test-id="goals-header"]',
        description:
          'Set financial targets with deadlines and track your progress toward each goal.',
        placement: 'bottom',
        section: 'goals',
        requiredPage: 'goals',
      },
      {
        title: 'Goals Grid',
        targetSelector: '[data-test-id="goals-grid"]',
        description:
          'Each goal card shows name, target amount, current progress bar, and deadline date.',
        placement: 'top',
        section: 'goals',
        requiredPage: 'goals',
      },
      {
        title: 'Add Goal',
        targetSelector: '[data-test-id="add-goal-btn"]',
        description:
          'Create a new savings goal with a target amount, optional deadline, and starting balance.',
        placement: 'bottom',
        section: 'goals',
        requiredPage: 'goals',
      },
    ],
  },

  // ── Loans ──
  {
    id: 'loans',
    label: 'Loans',
    page: 'loans',
    steps: [
      {
        title: 'Loans Page',
        targetSelector: '[data-test-id="loans-header"]',
        description:
          'Track loans with amortization schedules, prepayments, and variable rate periods.',
        placement: 'bottom',
        section: 'loans',
        requiredPage: 'loans',
      },
      {
        title: 'Loan Cards',
        targetSelector: '.page-loans',
        description:
          'Each loan shows principal, interest rate, term, and monthly payment. Click for detailed amortization.',
        placement: 'bottom',
        section: 'loans',
        requiredPage: 'loans',
      },
      {
        title: 'Add Loan',
        targetSelector: '[data-test-id="add-loan-btn"]',
        description:
          'Create a new loan with principal amount, interest rate, term in months, and start date.',
        placement: 'bottom',
        section: 'loans',
        requiredPage: 'loans',
      },
    ],
  },

  // ── Bills ──
  {
    id: 'bills',
    label: 'Bills',
    page: 'bills',
    steps: [
      {
        title: 'Bills Page',
        targetSelector: '[data-test-id="bills-header"]',
        description:
          'Track recurring bills with due dates, payment status, and upcoming schedules.',
        placement: 'bottom',
        section: 'bills',
        requiredPage: 'bills',
      },
      {
        title: 'Upcoming Bills',
        targetSelector: '[data-test-id="bills-upcoming-section"]',
        description: 'Bills due this month with amounts and due dates. Mark as paid when complete.',
        placement: 'top',
        section: 'bills',
        requiredPage: 'bills',
      },
      {
        title: 'All Bills',
        targetSelector: '[data-test-id="bills-all-section"]',
        description:
          'Complete list of all recurring bills. Each card shows name, amount, frequency, and next due date.',
        placement: 'top',
        section: 'bills',
        requiredPage: 'bills',
      },
      {
        title: 'Add Bill',
        targetSelector: '[data-test-id="add-bill-btn"]',
        description: 'Create a new recurring bill with amount, frequency, due date, and category.',
        placement: 'bottom',
        section: 'bills',
        requiredPage: 'bills',
      },
    ],
  },

  // ── Categories ──
  {
    id: 'categories',
    label: 'Categories',
    page: 'categories',
    steps: [
      {
        title: 'Categories Page',
        targetSelector: '[data-test-id="categories-header"]',
        description:
          'Manage income and expense categories with colors, icons, and tax-deductible flags.',
        placement: 'bottom',
        section: 'categories',
        requiredPage: 'categories',
      },
      {
        title: 'Add Category',
        targetSelector: '[data-test-id="add-category-btn"]',
        description: 'Create a new category with name, color, icon, and type (income or expense).',
        placement: 'bottom',
        section: 'categories',
        requiredPage: 'categories',
      },
      {
        title: 'Category List',
        targetSelector: '[data-test-id="categories-subtitle"]',
        description:
          'Each category shows color dot, icon, name, type badge, and tax status. Use tabs to filter by type.',
        placement: 'bottom',
        section: 'categories',
        requiredPage: 'categories',
      },
    ],
  },

  // ── Import ──
  {
    id: 'import',
    label: 'Import Data',
    page: 'import',
    steps: [
      {
        title: 'Import Page',
        targetSelector: '.page-import h1',
        description:
          'Import transactions from Google Sheets or CSV/XLSX files with smart column mapping.',
        placement: 'bottom',
        section: 'import',
        requiredPage: 'import',
      },
      {
        title: 'File Upload',
        targetSelector: '#import-dropzone',
        description:
          'Drag and drop or click to upload a CSV, XLSX, or XLS file. Download the sample template for expected format.',
        placement: 'bottom',
        section: 'import',
        requiredPage: 'import',
      },
      {
        title: 'Google Sheets Import',
        targetSelector: '.page-import input[placeholder*="Google Sheets"]',
        description:
          'Paste a Google Sheets link and click Fetch to pull data directly from your spreadsheet.',
        placement: 'bottom',
        section: 'import',
        requiredPage: 'import',
      },
      {
        title: 'Column Mapping',
        targetSelector: '.page-import',
        description:
          'Map your spreadsheet columns to Finance Manager fields. The preview shows exactly what will be imported.',
        placement: 'bottom',
        section: 'import',
        requiredPage: 'import',
      },
    ],
  },

  // ── Counterparties ──
  {
    id: 'counterparties',
    label: 'Counterparties',
    page: 'counterparties',
    steps: [
      {
        title: 'Counterparties Page',
        targetSelector: '.page-counterparties h2',
        description:
          'See who owes who — aggregated from beneficiary and payor fields across all transactions.',
        placement: 'bottom',
        section: 'counterparties',
        requiredPage: 'counterparties',
      },
      {
        title: 'Summary Cards',
        targetSelector: '.page-counterparties',
        description: 'We Owe (red), Owed to Us (green), and Net Position at a glance.',
        placement: 'bottom',
        section: 'counterparties',
        requiredPage: 'counterparties',
      },
      {
        title: 'Counterparty Table',
        targetSelector: '.page-counterparties table',
        description:
          'Sortable table showing each counterparty name, amounts received and paid, net balance, and transaction count.',
        placement: 'top',
        section: 'counterparties',
        requiredPage: 'counterparties',
      },
    ],
  },

  // ── Analytics ──
  {
    id: 'analytics',
    label: 'Analytics',
    page: 'analytics',
    steps: [
      {
        title: 'Analytics Page',
        targetSelector: '.page-analytics h1',
        description:
          'Deep dive into your spending patterns with charts, heatmaps, and flow diagrams.',
        placement: 'bottom',
        section: 'analytics',
        requiredPage: 'analytics',
      },
      {
        title: 'Category Trends',
        targetSelector: '.page-analytics canvas',
        description:
          'Bar charts showing income and expense trends by category over time. Switch between income and expense views.',
        placement: 'top',
        section: 'analytics',
        requiredPage: 'analytics',
      },
      {
        title: 'Daily Heatmap',
        targetSelector: '.page-analytics',
        description:
          'Calendar heatmap showing daily spending intensity. Darker cells = higher spending. Click a day to drill down.',
        placement: 'bottom',
        section: 'analytics',
        requiredPage: 'analytics',
      },
      {
        title: 'Sankey Diagram',
        targetSelector: '.page-analytics',
        description:
          'Visual flow diagram showing how money moves from income sources to expense categories.',
        placement: 'bottom',
        section: 'analytics',
        requiredPage: 'analytics',
      },
    ],
  },

  // ── Retirement ──
  {
    id: 'retirement',
    label: 'Retirement',
    page: 'retirement',
    steps: [
      {
        title: 'Retirement Page',
        targetSelector: '[data-test-id="retirement-header"]',
        description: 'Project your retirement savings and track progress toward retirement goals.',
        placement: 'bottom',
        section: 'retirement',
        requiredPage: 'retirement',
      },
      {
        title: 'Retirement Goals',
        targetSelector: '[data-test-id="retirement-goals-grid"]',
        description:
          'Each card shows a retirement goal with target amount, current savings, and progress percentage.',
        placement: 'top',
        section: 'retirement',
        requiredPage: 'retirement',
      },
      {
        title: 'Projection Details',
        targetSelector: '[data-test-id="retirement-projection-details"]',
        description:
          'Monthly contribution, expected return rate, and projected retirement savings at target age.',
        placement: 'top',
        section: 'retirement',
        requiredPage: 'retirement',
      },
      {
        title: 'Add Goal',
        targetSelector: '[data-test-id="add-retirement-goal-btn"]',
        description:
          'Create a new retirement goal with current age, target age, monthly contribution, and expected return.',
        placement: 'bottom',
        section: 'retirement',
        requiredPage: 'retirement',
      },
    ],
  },

  // ── Calculators (combined) ──
  {
    id: 'calculators',
    label: 'Calculators',
    page: 'compound',
    steps: [
      {
        title: 'Compound Interest',
        targetSelector: '.page-compound h1',
        description:
          'Model investment growth with compound interest. Adjust principal, monthly contribution, rate, and years.',
        placement: 'bottom',
        section: 'calculators',
        requiredPage: 'compound',
      },
      {
        title: 'Emergency Fund',
        targetSelector: '.page-emergency h1',
        description:
          'Calculate how much you need for an emergency fund based on your monthly expenses.',
        placement: 'bottom',
        section: 'calculators',
        requiredPage: 'emergency',
      },
      {
        title: 'Rent vs Buy',
        targetSelector: '.page-rentBuy h1',
        description: 'Compare renting versus buying a home with detailed financial projections.',
        placement: 'bottom',
        section: 'calculators',
        requiredPage: 'rentBuy',
      },
      {
        title: 'Housing Calculator',
        targetSelector: '.page-housing h1',
        description:
          'Determine affordable housing costs based on your income, expenses, and savings goals.',
        placement: 'bottom',
        section: 'calculators',
        requiredPage: 'housing',
      },
    ],
  },

  // ── Settings ──
  {
    id: 'settings',
    label: 'Settings',
    page: 'settings',
    steps: [
      {
        title: 'Settings Page',
        targetSelector: '.page-settings h1',
        description:
          'Configure application preferences, theme, currency, storage mode, and data management.',
        placement: 'bottom',
        section: 'settings',
        requiredPage: 'settings',
      },
      {
        title: 'Theme & Currency',
        targetSelector: '.page-settings',
        description:
          'Toggle dark/light mode and set your preferred currency for display throughout the app.',
        placement: 'bottom',
        section: 'settings',
        requiredPage: 'settings',
      },
      {
        title: 'Data Export',
        targetSelector: '.page-settings',
        description:
          'Export your data as CSV or download PDF reports (monthly, annual, P&L, tax summary).',
        placement: 'bottom',
        section: 'settings',
        requiredPage: 'settings',
      },
      {
        title: 'Storage Mode',
        targetSelector: '.page-settings',
        description:
          'Switch between self-hosted (SQLite) and serverless (IndexedDB) modes. Migrate data when switching.',
        placement: 'bottom',
        section: 'settings',
        requiredPage: 'settings',
      },
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
