import type { Scenario } from '../types';
import { accounts } from './accounts';
import { bills } from './bills';
import { budgets } from './budgets';
import { calculators } from './calculators';
import { categories } from './categories';
import { goalScenarios } from './goals';
import { housing } from './housing';
import { imports } from './imports';
import { loanScenarios } from './loans';
import { portfolio } from './portfolio';
import { recurring } from './recurring';
import { retirement } from './retirement';
import { tags } from './tags';
import { transactions } from './transactions';

/** Every scenario, by the entity it writes. Both runners run all of them. */
export const SCENARIOS: Readonly<Record<string, readonly Scenario[]>> = {
  accounts,
  bills,
  budgets,
  calculators,
  categories,
  goals: goalScenarios,
  housing,
  imports,
  loans: loanScenarios,
  portfolio,
  recurring,
  retirement,
  tags,
  transactions,
};
