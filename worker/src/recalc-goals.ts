import * as db from './db';

// Category-linked savings goals: current_amount = sum of the linked category's
// transactions, in the user's BASE currency (amount_local), counting only rows dated
// on/after the goal's tracking_start_date (falling back to its creation day). This keeps
// pre-existing category history from instantly overfilling a freshly-linked goal.
//
// SCOPED to the active profile(s): without the profile predicate a forged/foreign
// category_id would let one user's write recompute (and corrupt) another user's goal.
export async function recalcGoalsByCategory(
  d1: D1Database,
  categoryId: number | null,
  pids: number[]
): Promise<void> {
  if (!categoryId || pids.length === 0) return;
  const inClause = pids.map(() => '?').join(',');
  const goals = await db.all<{
    id: number;
    category_id: number | null;
    tracking_start_date: string | null;
    created_day: string | null;
  }>(
    d1,
    `SELECT id, category_id, tracking_start_date, substr(created_at, 1, 10) AS created_day
       FROM savings_goals WHERE category_id = ? AND profile_id IN (${inClause})`,
    categoryId,
    ...pids
  );
  for (const g of goals) {
    if (!g.category_id) continue;
    const start = g.tracking_start_date || g.created_day || '0000-01-01';
    const total = await db.first<{ total: number }>(
      d1,
      `SELECT COALESCE(SUM(ABS(COALESCE(amount_local, amount))), 0) AS total
         FROM transactions
         WHERE category_id = ? AND profile_id IN (${inClause}) AND date >= ?`,
      g.category_id,
      ...pids,
      start
    );
    await db.update(d1, 'savings_goals', { current_amount: total?.total ?? 0 }, 'id = ?', g.id);
  }
}

// Recompute every category-linked goal for the given profile(s). Called when the Goals
// page loads so progress is always fresh — it doesn't rely on every transaction/category
// mutation having gone through a recalc path (imports, bulk edits, direct writes, or an
// older client could otherwise leave a stale current_amount until the next reload).
export async function recalcAllGoals(d1: D1Database, pids: number[]): Promise<void> {
  if (pids.length === 0) return;
  const inClause = pids.map(() => '?').join(',');
  const cats = await db.all<{ category_id: number }>(
    d1,
    `SELECT DISTINCT category_id FROM savings_goals
       WHERE category_id IS NOT NULL AND profile_id IN (${inClause})`,
    ...pids
  );
  for (const { category_id } of cats) {
    await recalcGoalsByCategory(d1, category_id, pids);
  }
}
