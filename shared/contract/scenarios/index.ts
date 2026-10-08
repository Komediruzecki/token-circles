import type { Scenario } from '../types';
import { accounts } from './accounts';
import { backup } from './backup';
import { bills } from './bills';
import { budgets } from './budgets';
import { calculators } from './calculators';
import { categories } from './categories';
import { goalScenarios } from './goals';
import { housing } from './housing';
import { imports } from './imports';
import { importSources } from './importSources';
import { loanScenarios } from './loans';
import { portfolio } from './portfolio';
import { profiles } from './profiles';
import { receipts } from './receipts';
import { recurring } from './recurring';
import { retirement } from './retirement';
import { settings } from './settings';
import { tags } from './tags';
import { transactions } from './transactions';

/** Every scenario, by the entity it writes. Both runners run all of them. */
export const SCENARIOS: Readonly<Record<string, readonly Scenario[]>> = {
  accounts,
  backup,
  bills,
  budgets,
  calculators,
  categories,
  goals: goalScenarios,
  housing,
  imports,
  importSources,
  loans: loanScenarios,
  portfolio,
  profiles,
  receipts,
  recurring,
  retirement,
  settings,
  tags,
  transactions,
};
