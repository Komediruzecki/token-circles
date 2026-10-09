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
    "A recurring rule that links another profile's account or category, and a transaction's tags that name another profile's tag (PUT /api/transactions/:id/tags), are refused with 403 on the Worker and 400 in local-first; both store nothing. A transaction's own account and category links answer 400 at the field in both runtimes since slice 2, and a bill's, a budget's and a savings goal's since slice 3. Slice 5 (recurring, tags).",
  'transactions-summary-shape':
    'GET /api/transactions/summary answers { total_income, total_expense, total_expenses, total_amount, net_balance, count } and honours the list filters on the Worker, but { totalIncome, totalExpenses, count } over every row in local-first; Analytics fetches it and discards the answer. Slice 2 (transactions).',
  'transaction-account-from-names':
    "On the Worker only, a new transaction is linked to the account named like its category as where the money went (transfer_account_id), and one with no account to the account named like its means of payment as where it came from. Through the Transactions form, which always sends an account, balances agree, but the row still names the other account, which the Transactions page's account filter then shows it under and which cannot be deleted while the row exists (409). An income written with no account (API, MCP or import) credits the account named like its category on the Worker only. Slice 2 (transactions).",
  'transactions-by-tag':
    'GET /api/transactions/by-tag/:tagId orders rows newest first and honours startDate, endDate, category_ids, type, limit and offset on the Worker, but answers every tagged row in key order, unfiltered, in local-first; nothing in the app calls it. Slice 5 (tags).',
  'tag-default-colour':
    'A tag created without a colour gets the next colour of a twelve-colour palette (#3b82f6 first) on the Worker and #6e9bff in local-first; both forms always send one. Slice 5 (tags).',
  'tag-edit-without-colour':
    'A tag edit that leaves out the colour resets it to #6b7280 on the Worker and keeps it in local-first; the Tags page always sends it. Slice 5 (tags).',
  'tag-rename-duplicate':
    "Renaming a tag to another tag's name is refused (400) on the Worker and stored in local-first, which then lists two tags of one name. Slice 5 (tags).",
  'day-of-month-default':
    'A recurring rule saved without a day of the month (the form does not require one) stores day_of_month NULL on the Worker and 1 in local-first, and the Recurring form then opens with day 1 in local-first. A bill stores none in both runtimes since slice 3. Slice 5 (recurring).',
  'delete-missing':
    "DELETE /api/recurring/:id answers 200 { ok: true } on the Worker when the profile has no such row, another profile's included, and 404 in local-first; neither deletes anything. DELETE /api/bills/:id answers 404 in both runtimes since slice 3. Slice 5 (recurring).",
  'recurring-populate-answer':
    'POST /api/recurring/:id/populate answers { ok, transactionId, next_date } on the Worker and { ok } in local-first; the Recurring section reads neither. Slice 5 (recurring).',
  'recurring-upcoming':
    'GET /api/recurring/upcoming answers { transactions, byCategory, totalMonthly, currency }, every occurrence of the next 30 days, on the Worker, and the active rules themselves in local-first; nothing in the app calls it. Slice 5 (recurring).',
  'recurring-pause':
    "A recurring rule is paused with `active` on the Worker, whose list then leaves it out, and with `is_active` in local-first, whose list keeps it; each ignores the other's field, and no screen pauses a rule. Slice 5 (recurring).",
  'emergency-fund-extras':
    'GET /api/calculator/emergency-fund also answers monthsOfCoverage on the Worker, and totalBalance with the savings accounts themselves in local-first; the Emergency Fund page reads none of the three. Slice 2 (accounts), whose data it reads.',
  'housing-answer-shape':
    "POST /api/housing answers 200 on the Worker and 201 in local-first, and GET /api/housing answers autopay as 0 or 1 with the stored columns on the Worker, but as true or false with the form's own fields (property_name, due_day, due_month) too in local-first; the Housing page reads both. Slice 5 (housing).",
  'housing-due-month-default':
    'A housing expense posted without a due month falls due in January on the Worker and in the current month in local-first; the Housing form always sends one. Slice 5 (housing).',
  'portfolio-prices':
    'POST /api/portfolio/prices answers live quotes from Yahoo Finance on the Worker and none, ever, in local-first, which cannot reach a quote service from the browser; the Portfolio page then values holdings at their purchase price and says no live prices are available. Slice 5 (portfolio).',
  'import-upload-answer':
    "POST /api/import/upload answers { headers, rows, selectedSheet, sheetNames } with each row a list of cells on the Worker, but { session_id, filename, rows, row_count } with each row an object keyed by its column in local-first. The Import page reads the Worker's shape: in cloud mode an upload goes on to the mapping step with every row of the file, and in local-first it stops at the upload step with \"Cannot read properties of undefined (reading '0')\", as the page reads sheetNames[0], which local-first does not send. Slice 4 (import).",
  'export-by-type':
    'GET /api/export/:type answers chosen columns on the Worker (the category by name; JSON as a list of rows) and other columns in local-first (the category by id; JSON as every field of each row inside { <kind>: [...] }). Settings saves either answer as the file, so the same export gives a different file in each mode. Slice 4 (settings).',
  'settings-scope':
    "Settings are kept per profile on the Worker and once per browser in local-first, so a base currency or an onboarding state saved on one profile is every profile's in local-first (the achievement record names its profile in its key there). Slice 4 (settings).",
  'receipt-answers':
    'A receipt upload answers 201 with the stored row on the Worker and 200 with the row and a url in local-first; GET /api/receipts/transaction/:id answers the receipt on the Worker and a list of it in local-first; DELETE /api/receipts/:id answers { message } on the Worker and { ok: true } in local-first. The app finds a receipt through its transaction row, and reads none of these. Slice 2 (transactions).',
  'auth-local-user':
    "GET /api/auth/me answers the signed-in account on the Worker and a fixed local user ({ id: 1, username: 'local', role: 'admin' }) in local-first, which has no accounts; POST /api/auth/logout ends the Worker's session and changes nothing in local-first. Slice 6 (auth).",
  'health-answer':
    "GET /api/health answers { ok, env, captcha } on the Worker and { status: 'ok', timestamp } in local-first; nothing in the app reads it. Slice 6 (auth and support).",
  'stats-monthly-shape':
    'GET /api/stats/monthly answers only the months that have income or expense, each with its net, on the Worker, and every month of the window, empty ones as zeros and without a net, in local-first; Analytics reads only month, income and expense, so its monthly chart leaves out empty months in cloud mode only. Slice 2 (transactions), whose data it reads.',
  'analytics-month-to-date':
    "GET /api/stats/monthly counts the current month up to today on the Worker and the whole month in local-first, so an expense dated later this month is in Analytics' monthly figures and savings rate in local-first only. Slice 2 (transactions), whose data it reads.",
  'dashboard-uncategorised':
    "GET /api/dashboard answers uncategorised spending (in expenseByCategory) and an uncategorised recent transaction with a null category name and colour on the Worker, and as 'Uncategorized' in #999 in local-first; the Dashboard then labels that recent transaction 'No category' in cloud mode and 'Uncategorized' in local-first. Slice 2 (transactions).",
  'dashboard-charts':
    "GET /api/dashboard/charts answers byCategory over all time with uncategorised spending left out, the currency of a local_currency setting nothing writes (so EUR, whatever the base currency), and monthly rows that also carry the running total, on the Worker; byCategory over the months charted with uncategorised spending included, and the base currency, in local-first. The Dashboard reads only the monthly rows' month, income and expense. Slice 2 (transactions), whose data it reads.",
  'counterparties-from-description':
    'GET /api/counterparties names only the beneficiaries of expenses and the payors of income on the Worker, but falls back to the description of a transaction that has neither in local-first, so the Counterparties page lists every such description as a counterparty in local-first only. Slice 2 (transactions).',
  'year-summaries':
    "GET /api/reports/tax-summary and GET /api/reports/pl-summary leave uncategorised transactions out on the Worker and count them under 'Unknown' in local-first, and the tax summary lists each category's transactions on the Worker but none in local-first; nothing in the app calls either. Slice 2 (transactions), whose data they read.",
  'monthly-pdf-month':
    'GET /api/reports/monthly-pdf takes the month as YYYY-MM on the Worker, which refuses year=2025&month=3 with 400, and as a month number beside the year in local-first, which reads month=2025-03 as month 2025 of this year and still answers a PDF; nothing in the app calls it, as Settings makes its PDFs in the browser in both modes. Slice 4 (settings).',
  'custom-report':
    "POST /api/reports/custom saves the report's settings and answers them with a new id on the Worker, where GET /api/reports/custom/:id reads them back, but saves nothing and answers the report itself (totals and sums per category over the dates and category given) in local-first; nothing in the app calls it. Slice 4 (settings).",
  'category-apply-mappings':
    'POST /api/categories/apply-mappings files the transactions listed in { mappings: [{ transaction_id, category_id, pattern }] } and learns each pattern, answering { ok, updated }, on the Worker, but runs the stored mappings named in { mapping_ids, apply_to } over uncategorised rows, answering { ok, applied }, in local-first; nothing in the app calls it. Slice 4 (import).',
  'category-mapping-upsert':
    'A mapping saved again for a pattern the profile already has updates that row and counts it (use_count 2) on the Worker, which also trims the pattern and lists mappings with their category name, most used first; local-first adds a second row and lists raw rows. Only the auto-categorise dialog reads mappings, and nothing in the app saves one through this route. Slice 4 (import).',
  'category-auto-map':
    'POST /api/categories/auto-map only suggests a category per transaction ({ total, mapped, mappings }) on the Worker, but files the rows itself ({ ok, mapped }), without moving a linked goal, in local-first; nothing in the app calls it. Slice 4 (import).',
};
