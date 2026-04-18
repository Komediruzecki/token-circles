/**
 * Router - Simplified routing for SolidJS
 */

import type { PageName } from './types/models';

// Page components
import Dashboard from './features/Dashboard';
import Transactions from './features/Transactions';
import Budgets from './features/Budgets';
import Loans from './features/Loans';
import Goals from './features/Goals';
import Bills from './features/Bills';
import Import from './features/Import';
import Accounts from './features/Accounts';
import Categories from './features/Categories';
import Settings from './features/Settings';
import Retirement from './features/Retirement';
import Housing from './features/Housing';
import Analytics from './features/Analytics';

export type { PageName };

export const pages: Record<PageName, any> = {
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
};