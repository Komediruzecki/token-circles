import type { Scenario } from '../types';
import { accounts } from './accounts';
import { categories } from './categories';

/** Every scenario, by the entity it writes. Both runners run all of them. */
export const SCENARIOS: Readonly<Record<string, readonly Scenario[]>> = {
  accounts,
  categories,
};
