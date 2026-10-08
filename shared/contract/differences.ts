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
  'foreign-link-status':
    "A write that links another profile's account, category or tag is refused with 403 on the Worker and 400 in local-first; both store nothing. Slice 2 (transactions), where the plan already moves a foreign category parent to 400.",
  'transactions-summary-shape':
    'GET /api/transactions/summary answers { total_income, total_expense, total_expenses, total_amount, net_balance, count } and honours the list filters on the Worker, but { totalIncome, totalExpenses, count } over every row in local-first; Analytics fetches it and discards the answer. Slice 2 (transactions).',
  'transaction-account-from-names':
    'A new transaction with no destination account is linked to the account named like its category (and with no source account, to the one named like its means of payment) on the Worker only, so on the Worker that account then counts it and cannot be deleted. Slice 2 (transactions).',
  'transactions-by-tag':
    'GET /api/transactions/by-tag/:tagId orders rows newest first and honours startDate, endDate, category_ids, type, limit and offset on the Worker, but answers every tagged row in key order, unfiltered, in local-first; nothing in the app calls it. Slice 5 (tags).',
  'tag-default-colour':
    'A tag created without a colour gets the next colour of a twelve-colour palette (#3b82f6 first) on the Worker and #6e9bff in local-first; both forms always send one. Slice 5 (tags).',
  'tag-edit-without-colour':
    'A tag edit that leaves out the colour resets it to #6b7280 on the Worker and keeps it in local-first; the Tags page always sends it. Slice 5 (tags).',
  'tag-rename-duplicate':
    "Renaming a tag to another tag's name is refused (400) on the Worker and stored in local-first, which then lists two tags of one name. Slice 5 (tags).",
};
