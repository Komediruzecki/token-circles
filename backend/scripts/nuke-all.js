#!/usr/bin/env node
/**
 * Nuke ALL data from all tables. Keeps schema structure and the admin user.
 * After nuking, re-seeds the three demo profiles from scratch.
 *
 * Use --no-seed flag to skip re-seeding (empty DB).
 */
const db = require('../database');

const skipSeed = process.argv.includes('--no-seed');

console.log('Nuking ALL data...');

// Order matters: child tables first, then parents
const allTables = [
  'transaction_tags',
  'loan_rate_periods',
  'loan_prepayments',
  'account_balance_history',
  'transactions',
  'receipts',
  'category_mappings',
  'recurring_transactions',
  'budgets',
  'budgets_zero_based',
  'savings_goals',
  'retirement_goals',
  'emergency_fund_config',
  'loans',
  'bills',
  'housings',
  'tags',
  'categories',
  'accounts',
  'portfolio_holdings',
  'settings',
  'profiles',
];

let total = 0;
for (const table of allTables) {
  const r = db.prepare(`DELETE FROM ${table}`).run();
  console.log(`  ${table}: ${r.changes} rows`);
  total += r.changes;
}

// Reset autoincrement
db.prepare('DELETE FROM sqlite_sequence').run();
console.log('  sqlite_sequence: reset');

console.log(`\nTotal rows deleted: ${total}`);

if (!skipSeed) {
  console.log('\nRe-seeding demo profiles...');
  db.seedThreeTierProfiles();

  const counts = {
    profiles: db.prepare('SELECT COUNT(*) as c FROM profiles').get().c,
    transactions: db.prepare('SELECT COUNT(*) as c FROM transactions').get().c,
    accounts: db.prepare('SELECT COUNT(*) as c FROM accounts').get().c,
    portfolio: db.prepare('SELECT COUNT(*) as c FROM portfolio_holdings').get().c,
  };

  console.log('\n=== Results ===');
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log('\nAll data nuked and re-seeded.');
} else {
  console.log('\nAll data nuked. No seed data was created (--no-seed).');
}
