/**
 * Spotlight Store — Walkthrough/guided tour for new features
 * Based on pitch-perfect walkthrough pattern, adapted for finance-manager
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

export interface SpotlightSection {
  id: string
  title: string
  description: string
}

const SPOTLIGHT_KEY = 'finance_spotlight_completed'
const SECTIONS_KEY = 'finance_spotlight_sections'

export const SPOTLIGHT_SECTIONS: SpotlightSection[] = [
  {
    id: 'dashboard',
    title: 'Dashboard & Overview',
    description: 'Get a bird\'s-eye view of your finances',
  },
  {
    id: 'transactions',
    title: 'Transactions & Reconciliation',
    description: 'Track every movement of money',
  },
  {
    id: 'accounts-portfolio',
    title: 'Accounts & Portfolio',
    description: 'Bank accounts and investment tracking',
  },
  {
    id: 'budgets-goals',
    title: 'Budgets & Goals',
    description: 'Plan spending and saving targets',
  },
]

export const SPOTLIGHT_STEPS: SpotlightStep[] = [
  // ── Dashboard ──
  {
    title: 'Welcome to Finance Manager',
    targetSelector: '',
    description: 'Let\'s take a quick tour of what\'s new. Click "Next" to explore or "Skip Tour" anytime.',
    placement: 'bottom',
    section: 'dashboard',
  },
  {
    title: 'Dashboard Overview',
    targetSelector: '[data-test-id="dashboard-metrics"]',
    description: 'See your income, expenses, and net balance at a glance. Compare this month to last month with delta indicators.',
    placement: 'bottom',
    section: 'dashboard',
    requiredPage: 'dashboard',
  },
  {
    title: 'Budgets & Savings Rate',
    targetSelector: '[data-test-id="dashboard-widgets"]',
    description: 'Monitor budget alerts and track your savings rate. The period navigator lets you jump between months.',
    placement: 'top',
    section: 'dashboard',
    requiredPage: 'dashboard',
  },

  // ── Transactions ──
  {
    title: 'Transaction Management',
    targetSelector: '[data-test-id="transactions-header"]',
    description: 'Add, edit, and delete transactions. Use bulk actions to change categories or types for multiple transactions at once.',
    placement: 'bottom',
    section: 'transactions',
    requiredPage: 'transactions',
  },
  {
    title: 'Smart Filtering',
    targetSelector: '[data-test-id="filter-bar"]',
    description: 'Filter by category, tags, type, date range, or search. The reconcile toggle helps you track verified transactions.',
    placement: 'bottom',
    section: 'transactions',
    requiredPage: 'transactions',
  },
  {
    title: 'Reconciliation',
    targetSelector: '[data-test-id="bulk-action-bar"]',
    description: 'Select multiple transactions and reconcile them in bulk. Reconciled transactions are visually distinct for easy auditing.',
    placement: 'top',
    section: 'transactions',
    requiredPage: 'transactions',
  },

  // ── Accounts & Portfolio ──
  {
    title: 'Account Tracking',
    targetSelector: '[data-test-id="accounts-header"]',
    description: 'Manage bank, savings, investment, and cash accounts. Balances auto-update when linked transactions are created.',
    placement: 'bottom',
    section: 'accounts-portfolio',
    requiredPage: 'accounts',
  },
  {
    title: 'Portfolio Tracker',
    targetSelector: '[data-test-id="portfolio-header"]',
    description: 'Track your stock and ETF holdings with real-time prices from Yahoo Finance. See gain/loss and allocation breakdown.',
    placement: 'bottom',
    section: 'accounts-portfolio',
    requiredPage: 'portfolio',
  },

  // ── Budgets & Goals ──
  {
    title: 'Category Budgets',
    targetSelector: '[data-test-id="budgets-header"]',
    description: 'Set monthly budgets per category with rollover support. Use zero-based budgeting for precise allocation.',
    placement: 'bottom',
    section: 'budgets-goals',
    requiredPage: 'budgets',
  },
  {
    title: 'Savings Goals',
    targetSelector: '[data-test-id="goals-header"]',
    description: 'Set target amounts and deadlines. Track progress with contributions and see how close you are to each goal.',
    placement: 'bottom',
    section: 'budgets-goals',
    requiredPage: 'goals',
  },
]

// ── State ──

export const [spotlightActive, setSpotlightActive] = createSignal(false)
export const [spotlightStep, setSpotlightStep] = createSignal(0)
export const [tourSteps, setTourSteps] = createSignal<SpotlightStep[]>(SPOTLIGHT_STEPS)

// ── Persistence ──

function loadSections(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SECTIONS_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveSections(sections: Record<string, boolean>) {
  localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections))
}

export function isSpotlightCompleted(): boolean {
  return localStorage.getItem(SPOTLIGHT_KEY) === '1'
}

export function isSectionCompleted(sectionId: string): boolean {
  return loadSections()[sectionId]
}

export function getIncompleteSections(): SpotlightSection[] {
  const done = loadSections()
  return SPOTLIGHT_SECTIONS.filter((s) => !done[s.id])
}

// ── Actions ──

export function startSpotlight(sectionIds?: string[]) {
  let steps = SPOTLIGHT_STEPS
  if (sectionIds && sectionIds.length > 0) {
    steps = SPOTLIGHT_STEPS.filter((s) => sectionIds.includes(s.section || ''))
  }
  if (steps.length === 0) {
    steps = SPOTLIGHT_STEPS
  }
  setTourSteps(steps)
  setSpotlightStep(0)
  setSpotlightActive(true)
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

export function skipSection() {
  const steps = tourSteps()
  const current = spotlightStep()
  const currentSection = steps[current]?.section
  if (!currentSection) {
    endSpotlight()
    return
  }
  // Mark section as done
  const sections = loadSections()
  sections[currentSection] = true
  saveSections(sections)

  // Jump to first step of next section
  let nextIdx = current + 1
  while (nextIdx < steps.length && steps[nextIdx].section === currentSection) {
    nextIdx++
  }
  if (nextIdx >= steps.length) {
    endSpotlight()
  } else {
    setSpotlightStep(nextIdx)
  }
}

export function endSpotlight() {
  const steps = tourSteps()
  const current = spotlightStep()
  const currentSection = steps[current]?.section
  if (currentSection) {
    const sections = loadSections()
    sections[currentSection] = true
    saveSections(sections)
  }
  setSpotlightActive(false)
  setSpotlightStep(0)
  setTourSteps(SPOTLIGHT_STEPS)
  localStorage.setItem(SPOTLIGHT_KEY, '1')
}
