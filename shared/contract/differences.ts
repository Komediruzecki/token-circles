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
  'budget-zero-based-unbudgeted':
    "GET /api/budgets/zero-based gives a category with spending and no budget an amount of 0 and 0% used on the Worker, but an amount equal to its spending and 100% used in local-first, so the Budgets page marks it 'warning' in local-first only. Slice 3 (budgets).",
  'budget-allocation-alerts':
    "An over-budget row of GET /api/budgets/zero-based/summary says 'Over budget by $-10.00' from 100% exclusive on the Worker, and 'Over budget by $10.00' from 100% inclusive in local-first; the Budgets page does not show these sentences. Slice 3 (budgets).",
  'budget-trend-spending':
    "The months of GET /api/budgets/improvements and of the forecast's history count only the spending of budgeted categories on the Worker, but every expense of the month, unbudgeted and uncategorised included, in local-first, so the Budgets page's trend and average adherence differ between modes. Slice 3 (budgets).",
  'day-of-month-default':
    'A bill or a recurring rule saved without a day of the month (neither form requires one) stores day_of_month NULL on the Worker and 1 in local-first, and the Recurring form then opens with day 1 in local-first. Slices 3 (bills) and 5 (recurring).',
  'delete-missing':
    "DELETE /api/bills/:id and DELETE /api/recurring/:id answer 200 { ok: true } on the Worker when the profile has no such row, another profile's included, and 404 in local-first; neither deletes anything. Slices 3 (bills) and 5 (recurring).",
  'recurring-populate-answer':
    'POST /api/recurring/:id/populate answers { ok, transactionId, next_date } on the Worker and { ok } in local-first; the Recurring section reads neither. Slice 5 (recurring).',
  'recurring-upcoming':
    'GET /api/recurring/upcoming answers { transactions, byCategory, totalMonthly, currency }, every occurrence of the next 30 days, on the Worker, and the active rules themselves in local-first; nothing in the app calls it. Slice 5 (recurring).',
  'recurring-pause':
    "A recurring rule is paused with `active` on the Worker, whose list then leaves it out, and with `is_active` in local-first, whose list keeps it; each ignores the other's field, and no screen pauses a rule. Slice 5 (recurring).",
  'loan-total-prepaid-none':
    'GET /api/loans answers total_prepaid null for a loan with no extra payments on the Worker (SUM over no rows) and 0 in local-first; the Loans page does not read it. Slice 4 (loans).',
  'emergency-fund-extras':
    'GET /api/calculator/emergency-fund also answers monthsOfCoverage on the Worker, and totalBalance with the savings accounts themselves in local-first; the Emergency Fund page reads none of the three. Slice 2 (accounts), whose data it reads.',
  'fire-inflation':
    'POST /api/calculator/retire ignores an inflationRate in the body on the Worker, projecting in nominal money, but deflates the projection by it (and echoes it in inputs) in local-first, so the same body reaches its FIRE number later there; nothing in the app calls it. Slice 4 (the Retirement forms).',
  'housing-answer-shape':
    "POST /api/housing answers 200 on the Worker and 201 in local-first, and GET /api/housing answers autopay as 0 or 1 with the stored columns on the Worker, but as true or false with the form's own fields (property_name, due_day, due_month) too in local-first; the Housing page reads both. Slice 5 (housing).",
  'housing-due-month-default':
    'A housing expense posted without a due month falls due in January on the Worker and in the current month in local-first; the Housing form always sends one. Slice 5 (housing).',
  'portfolio-prices':
    'POST /api/portfolio/prices answers live quotes from Yahoo Finance on the Worker and none, ever, in local-first, which cannot reach a quote service from the browser; the Portfolio page then values holdings at their purchase price and says no live prices are available. Slice 5 (portfolio).',
  'import-upload-answer':
    "POST /api/import/upload answers { headers, rows, selectedSheet, sheetNames } with each row a list of cells on the Worker, but { session_id, filename, rows, row_count } with each row an object keyed by its column in local-first. The Import page reads the Worker's shape, so a file upload fails in local-first (it reads sheetNames[0] of nothing); and it drops rows[0], which on the Worker is the first transaction, not the header. Slice 4 (import).",
  'goal-unsent-defaults':
    "A savings goal saved without a monthly amount or a tracking date (the Goals form sends null and leaves the date out when the goal has no category) stores monthly_contribution 0 and today's tracking_start_date on the Worker, but null and no tracking date in local-first; the Goals page reads both through `|| 0` and `|| null`, and a goal without a tracking date counts from the day it was created. Slice 3 (goals).",
  'bills-upcoming':
    'GET /api/bills/upcoming answers every active bill with a next_due_date worked out from day_of_month alone (1 when unset), rolling a bill due today to next month, on the Worker, but the stored rows whose due day of the month is today or later, with no next_due_date, in local-first; nothing in the app calls it. Slice 3 (bills).',
  'category-apply-mappings':
    'POST /api/categories/apply-mappings files the transactions listed in { mappings: [{ transaction_id, category_id, pattern }] } and learns each pattern, answering { ok, updated }, on the Worker, but runs the stored mappings named in { mapping_ids, apply_to } over uncategorised rows, answering { ok, applied }, in local-first; nothing in the app calls it. Slice 4 (import).',
  'category-mapping-upsert':
    'A mapping saved again for a pattern the profile already has updates that row and counts it (use_count 2) on the Worker, which also trims the pattern and lists mappings with their category name, most used first; local-first adds a second row and lists raw rows. Only the auto-categorise dialog reads mappings, and nothing in the app saves one through this route. Slice 4 (import).',
  'category-auto-map':
    'POST /api/categories/auto-map only suggests a category per transaction ({ total, mapped, mappings }) on the Worker, but files the rows itself ({ ok, mapped }), without moving a linked goal, in local-first; nothing in the app calls it. Slice 4 (import).',
};
