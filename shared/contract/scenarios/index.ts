import type { Scenario } from '../types';
import { accounts } from './accounts';
import { budgets } from './budgets';
import { categories } from './categories';
import { tags } from './tags';
import { transactions } from './transactions';

/** Every scenario, by the entity it writes. Both runners run all of them. */
export const SCENARIOS: Readonly<Record<string, readonly Scenario[]>> = {
  accounts,
  budgets,
  categories,
  tags,
  transactions,
};
