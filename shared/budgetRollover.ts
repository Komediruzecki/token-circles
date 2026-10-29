/**
 * What a month's budget is worth with rollover: the figure the Budgets page shows as the budget
 * (effective_budget). The Worker's GET /api/budgets/summary, local-first's budgetsSummary and the
 * Progress page's advice all work it out here, so the three agree.
 */
import { toCents } from './money';

/** The fields of a budget row rollover reads. The Worker stores rollover_enabled as 0 or 1. */
export interface RolloverBudget {
  amount: number;
  rollover_enabled?: boolean | number | null;
  rollover_amount?: number | null;
  rollover_used?: number | null;
}

export interface Rollover {
  /** The amount plus what carried in, never less than the amount. */
  effective_budget: number;
  /** What carried in, never below 0. */
  rollover_contribution: number;
  /** Last month's unused budget, carried in when both months have rollover on. */
  auto_rollover: number;
}

/**
 * With rollover on, a budget carries in last month's unused budget (when last month's budget had
 * rollover on as well) plus a manual rollover_amount, less the rollover_used of it. With it off,
 * the budget is its amount. `previous` is the category's budget the month before and what was spent
 * in that month; leave it out when the category had none.
 */
export function budgetRollover(
  budget: RolloverBudget,
  previous?: { budget: RolloverBudget; spent: number }
): Rollover {
  let contribution = 0;
  let auto_rollover = 0;
  if (budget.rollover_enabled) {
    if (previous && previous.budget.rollover_enabled) {
      auto_rollover = Math.max(0, toCents(previous.budget.amount - previous.spent));
    }
    contribution = toCents(
      (budget.rollover_amount || 0) + auto_rollover - (budget.rollover_used || 0)
    );
  }
  return {
    effective_budget: toCents(budget.amount + Math.max(0, contribution)),
    rollover_contribution: Math.max(0, contribution),
    auto_rollover,
  };
}
