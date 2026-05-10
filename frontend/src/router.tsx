/**
 * Router - Simplified routing for SolidJS with eager loading for debugging
 */
import Accounts from './features/Accounts.tsx'
import Analytics from './features/Analytics.tsx'
import Bills from './features/Bills.tsx'
import Budgets from './features/Budgets.tsx'
import Categories from './features/Categories.tsx'
import CompoundInterestCalculator from './features/CompoundInterestCalculator.tsx'
import Counterparties from './features/Counterparties.tsx'
import Dashboard from './features/Dashboard.tsx'
import EmergencyFundCalculator from './features/EmergencyFundCalculator.tsx'
import Goals from './features/Goals.tsx'
import Housing from './features/Housing.tsx'
import Import from './features/Import.tsx'
import Loans from './features/Loans.tsx'
import RentBuyCalculator from './features/RentBuyCalculator.tsx'
import Retirement from './features/Retirement.tsx'
import Settings from './features/Settings.tsx'
import Transactions from './features/Transactions.tsx'
import type { PageComponent, PageName } from './types/models.js'

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
  counterparties: Counterparties,
}
