/**
 * Which of a month's budget rows for a category counts, when there are two. A month can hold two
 * (two saves, an import, a restore, an API client), and every reader takes the one saved last: the
 * later created_at, and on a tie the higher id, since D1 stores created_at to the second. The
 * Budgets page (GET /api/budgets/summary and /api/budgets/zero-based, last row per category),
 * Allocate and the MCP upsert_budget tool (the row they change), and Progress's badges and advice.
 *
 * The Worker's SQL says the same with `ORDER BY replace(substr(created_at, 1, 19), 'T', ' '), id`
 * (ascending, the counting row last) or the same key `DESC, id DESC` (the counting row first). The
 * key is savedAt below in SQL: a restore copies created_at as the backup has it, so D1 can hold
 * local-first's ISO times next to its own.
 */
export interface SavedBudgetRow {
  id?: number | null;
  created_at?: string | null;
}

/**
 * created_at to the second, in one format. D1 writes datetime('now'), 'YYYY-MM-DD HH:MM:SS';
 * local-first writes toISOString(), 'YYYY-MM-DDTHH:MM:SS.sssZ'. Both are UTC, so with the space read
 * as 'T' and the milliseconds and zone dropped they compare as times. As text, the space sorted
 * before 'T', so on one day a D1 row always counted as saved before a local one (a restore can mix
 * them). D1 keeps no milliseconds, so the second is the finest both can tell apart; within it, the
 * id decides.
 */
const savedAt = (row: SavedBudgetRow): string =>
  (row.created_at ?? '').replace(' ', 'T').slice(0, 19);

/** Sorts oldest save first, so the row that counts comes last. */
export function bySavedOrder(a: SavedBudgetRow, b: SavedBudgetRow): number {
  const ca = savedAt(a);
  const cb = savedAt(b);
  if (ca !== cb) return ca < cb ? -1 : 1;
  return (a.id ?? 0) - (b.id ?? 0);
}
