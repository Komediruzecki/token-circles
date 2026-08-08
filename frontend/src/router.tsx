/**
 * Router - Route-based code splitting with SolidJS lazy() + Suspense
 */
import { lazy } from 'solid-js'
import type { PageComponent, PageName } from './types/models.js'

export type { PageName, PageComponent }

// Each page is its own chunk, loaded on demand
export const pages: Record<PageName, PageComponent> = {
  dashboard: lazy(() => import('./features/Dashboard.tsx')),
  transactions: lazy(() => import('./features/Transactions.tsx')),
  budgets: lazy(() => import('./features/Budgets.tsx')),
  loans: lazy(() => import('./features/Loans.tsx')),
  goals: lazy(() => import('./features/Goals.tsx')),
  bills: lazy(() => import('./features/Bills.tsx')),
  rentBuy: lazy(() => import('./features/RentBuyCalculator.tsx')),
  compound: lazy(() => import('./features/CompoundInterestCalculator.tsx')),
  emergency: lazy(() => import('./features/EmergencyFundCalculator.tsx')),
  import: lazy(() => import('./features/Import.tsx')),
  accounts: lazy(() => import('./features/Accounts.tsx')),
  categories: lazy(() => import('./features/Categories.tsx')),
  settings: lazy(() => import('./features/Settings.tsx')),
  retirement: lazy(() => import('./features/Retirement.tsx')),
  housing: lazy(() => import('./features/Housing.tsx')),
  analytics: lazy(() => import('./features/Analytics.tsx')),
  counterparties: lazy(() => import('./features/Counterparties.tsx')),
  portfolio: lazy(() => import('./features/Portfolio.tsx')),
  tags: lazy(() => import('./features/Tags.tsx')),
}
