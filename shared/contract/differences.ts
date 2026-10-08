/**
 * Where the two runtimes answer the same request differently, and the contract pins both answers
 * until the form-errors slice named in each entry settles it (docs/plans/2026-10-07-form-errors.md,
 * "Rollout"). A scenario that meets one branches on `api.runtime` under a `// DIFFERENCE <id>`
 * comment, so it passes on today's behaviour in each runtime and fails the day either changes.
 *
 * Settling one means making both runtimes answer alike, deleting the branch, and deleting the
 * entry. Each runner checks that every id named in a scenario is listed here and every entry is
 * still named by a scenario.
 */
export const DIFFERENCES: Readonly<Record<string, string>> = {
  'transactions-list-shape':
    'GET /api/transactions answers { rows, total, limit, offset } on the Worker and a bare array in local-first; the app reads both through listRows(). Slice 2 (transactions).',
  'account-history-shape':
    'A recorded balance is stored with recorded_at and answered 200 { id, balance, recorded_at } on the Worker, but stored with date and answered 201 { id, account_id, balance, date } in local-first; no screen reads the history yet. Slice 2 (accounts).',
  'account-timeline-date':
    "GET /api/accounts/history/timeline dates each day with one of that day's full recorded_at timestamps on the Worker and with YYYY-MM-DD in local-first. Slice 2 (accounts).",
  'account-recompute-answer':
    'POST /api/accounts/recompute-balances answers { ok, recomputed: <count> } on the Worker and { ok, accounts: [...] } in local-first; nothing in the app calls it. Slice 2 (accounts).',
};
