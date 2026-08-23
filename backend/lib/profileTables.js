/**
 * The one list of per-profile tables.
 *
 * Three places used to keep their own copy of "everything that belongs to a profile" — the
 * reseed/clear routes in routes/profiles.js, ProfilesRepository.deleteAllDataForProfile and
 * scripts/nuke-demo.js — and they drifted. The routes' copy named only seven tables, so it
 * left portfolio_holdings and recurring_transactions behind; seedThreeTierProfiles() re-inserts
 * both unconditionally once a profile has no transactions, and every call to
 * POST /api/profiles/reseed-demo therefore appended another full copy of the demo holdings
 * (SPY x4, VTI x4 on a database reseeded four times).
 *
 * Anything that wipes profile data now reads this file. The schema-drift test in
 * backend/test/unit/routes/profile-data-clearing.test.js fails if a new profile_id table
 * is added to schema.sql without being listed here.
 */

// Rows that hang off a parent row instead of carrying their own profile_id, so they can only
// be found through the parent. transaction_tags and account_balance_history would cascade,
// but loan_rate_periods and loan_prepayments have no foreign key at all and only ever go away
// if deleted explicitly — so all four are listed, and deleted before their parents.
const PROFILE_CHILD_TABLES = [
  { table: 'transaction_tags', key: 'transaction_id', parent: 'transactions' },
  { table: 'loan_rate_periods', key: 'loan_id', parent: 'loans' },
  { table: 'loan_prepayments', key: 'loan_id', parent: 'loans' },
  { table: 'account_balance_history', key: 'account_id', parent: 'accounts' },
];

// Tables with their own profile_id column, ordered so that a row is gone before the row it
// references: receipts/category_mappings/budgets_zero_based hold real foreign keys into
// transactions and categories, and `foreign_keys = ON` is set on the connection.
//
// `settings` is deliberately not here. It is per-profile configuration (currency, theme),
// not profile *data* — clearing or reseeding a profile keeps it; deleting the profile drops
// it via the includeSettings option on ProfilesRepository.clearDataForProfile.
const PROFILE_DATA_TABLES = [
  'receipts',
  'category_mappings',
  'budgets_zero_based',
  'transactions',
  'budgets',
  'savings_goals',
  'retirement_goals',
  'emergency_fund_config',
  'recurring_transactions',
  'bills',
  'housings',
  'tags',
  'portfolio_holdings',
  'loans',
  'categories',
  'accounts',
];

module.exports = { PROFILE_DATA_TABLES, PROFILE_CHILD_TABLES };
