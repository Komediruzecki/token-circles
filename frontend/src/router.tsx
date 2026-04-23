/**
 * Router - Simplified routing for SolidJS
 */

// Page components
import Accounts from './features/Accounts.js'
import Analytics from './features/Analytics.js'
import Bills from './features/Bills.js'
import Budgets from './features/Budgets.js'
import Categories from './features/Categories.js'
import Dashboard from './features/Dashboard.js'
import Goals from './features/Goals.js'
import Housing from './features/Housing.js'
import Import from './features/Import.js'
import Loans from './features/Loans.js'
import Retirement from './features/Retirement.js'
import Settings from './features/Settings.js'
import Transactions from './features/Transactions.js'
import type { PageComponent,PageName } from './types/models.js'

export type { PageName, PageComponent }

export const pages: Record<PageName, PageComponent> = {
  dashboard: Dashboard,
  transactions: Transactions,
  budgets: Budgets,
  loans: Loans,
  goals: Goals,
  bills: Bills,
  import: Import,
  accounts: Accounts,
  categories: Categories,
  settings: Settings,
  retirement: Retirement,
  housing: Housing,
  analytics: Analytics,
}
