/**
 * Router - Simplified routing for SolidJS with eager loading for debugging
 */
import type { PageComponent, PageName } from './types/models.js'
import Dashboard from './features/Dashboard.js'
import Transactions from './features/Transactions.js'
import Budgets from './features/Budgets.js'
import Loans from './features/Loans.js'
import Goals from './features/Goals.js'
import Bills from './features/Bills.js'
import RentBuyCalculator from './features/RentBuyCalculator.js'
import CompoundInterestCalculator from './features/CompoundInterestCalculator.js'
import EmergencyFundCalculator from './features/EmergencyFundCalculator.js'
import Import from './features/Import.js'
import Accounts from './features/Accounts.js'
import Categories from './features/Categories.js'
import Settings from './features/Settings.js'
import Retirement from './features/Retirement.js'
import Housing from './features/Housing.js'
import Analytics from './features/Analytics.js'

export type { PageName, PageComponent }

// Eager-loaded page components for debugging
export const pages: Record<PageName, PageComponent> = {
  dashboard: Dashboard,
  transactions: Transactions,
  budgets: Budgets,
  loans: Loans,
  goals: Goals,
  bills: Bills,
  rentBuy: RentBuyCalculator,
  compound: CompoundInterestCalculator,
  emergency: EmergencyFundCalculator,
  import: Import,
  accounts: Accounts,
  categories: Categories,
  settings: Settings,
  retirement: Retirement,
  housing: Housing,
  analytics: Analytics,
}
