import type { Scenario } from '../types';
import { accounts } from './accounts';
import { bills } from './bills';
import { budgets } from './budgets';
import { categories } from './categories';
import { goalScenarios } from './goals';
import { loanScenarios } from './loans';
import { recurring } from './recurring';
import { retirement } from './retirement';
import { tags } from './tags';
import { transactions } from './transactions';

/** Every scenario, by the entity it writes. Both runners run all of them. */
export const SCENARIOS: Readonly<Record<string, readonly Scenario[]>> = {
  accounts,
  bills,
  budgets,
  categories,
  goals: goalScenarios,
  loans: loanScenarios,
  recurring,
  retirement,
  tags,
  transactions,
};
