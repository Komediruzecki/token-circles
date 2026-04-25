/**
 * Router - Simplified routing for SolidJS with lazy loading
 */
import { lazy } from 'solid-js'
import type { PageComponent, PageName } from './types/models.js'

export type { PageName, PageComponent }

// Lazy-loaded page components for code-splitting
// Dashboard is kept as eager load since it's the landing page
const Dashboard = lazy(() => import('./features/Dashboard.js'))

export const pages: Record<PageName, PageComponent> = {
  dashboard: Dashboard,
  transactions: lazy(() => import('./features/Transactions.js')),
  budgets: lazy(() => import('./features/Budgets.js')),
  loans: lazy(() => import('./features/Loans.js')),
  goals: lazy(() => import('./features/Goals.js')),
  bills: lazy(() => import('./features/Bills.js')),
  rentBuy: lazy(() => import('./features/RentBuyCalculator.js')),
  compound: lazy(() => import('./features/CompoundInterestCalculator.js')),
  emergency: lazy(() => import('./features/EmergencyFundCalculator.js')),
  import: lazy(() => import('./features/Import.js')),
  accounts: lazy(() => import('./features/Accounts.js')),
  categories: lazy(() => import('./features/Categories.js')),
  settings: lazy(() => import('./features/Settings.js')),
  retirement: lazy(() => import('./features/Retirement.js')),
  housing: lazy(() => import('./features/Housing.js')),
  analytics: lazy(() => import('./features/Analytics.js')),
}
