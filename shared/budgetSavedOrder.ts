/**
 * Which of a month's budget rows for a category counts, when there are two. A month can hold two
 * (two saves, an import, a restore, an API client), and every reader takes the one saved last: the
 * later created_at, and on a tie the higher id, since D1 stores created_at to the second. The
 * Budgets page (GET /api/budgets/summary and /api/budgets/zero-based, last row per category),
 * Allocate and the MCP upsert_budget tool (the row they change), and Progress's badges and advice.
 *
 * The Worker's SQL says the same with `ORDER BY created_at, id` (ascending, the counting row last)
 * or `ORDER BY created_at DESC, id DESC` (the counting row first).
 */
export interface SavedBudgetRow {
  id?: number | null;
  created_at?: string | null;
}

/** Sorts oldest save first, so the row that counts comes last. */
export function bySavedOrder(a: SavedBudgetRow, b: SavedBudgetRow): number {
  const ca = a.created_at ?? '';
  const cb = b.created_at ?? '';
  if (ca !== cb) return ca < cb ? -1 : 1;
  return (a.id ?? 0) - (b.id ?? 0);
}
