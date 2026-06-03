#!/usr/bin/env node
/**
 * Nuke only demo profiles (IDs 1, 2, 3) and all their data, then reinitialize.
 * Keeps any non-demo profiles and the admin user intact.
 */
const db = require('../database');

const DEMO_IDS = db.PROFILES_TO_NUKE || [1, 2, 3];
const idList = DEMO_IDS.join(',');

console.log('Nuking demo profiles and their data...');

// 1. Junction/child tables (linked via parent table)
const junctionTables = [
  { name: 'transaction_tags', key: 'transaction_id', link: 'transactions' },
  { name: 'loan_rate_periods', key: 'loan_id', link: 'loans' },
  { name: 'loan_prepayments', key: 'loan_id', link: 'loans' },
  { name: 'account_balance_history', key: 'account_id', link: 'accounts' },
];

for (const jt of junctionTables) {
  const sql = `DELETE FROM ${jt.name} WHERE ${jt.key} IN (SELECT id FROM ${jt.link} WHERE profile_id IN (${idList}))`;
  const r = db.prepare(sql).run();
  console.log(`  ${jt.name}: ${r.changes} rows`);
}

// 2. Direct profile_id tables
const directTables = [
  'transactions',
  'categories',
  'accounts',
  'budgets',
  'budgets_zero_based',
  'savings_goals',
  'retirement_goals',
  'emergency_fund_config',
  'loans',
  'bills',
  'housings',
  'tags',
  'category_mappings',
  'recurring_transactions',
  'receipts',
  'portfolio_holdings',
];

for (const table of directTables) {
  const sql = `DELETE FROM ${table} WHERE profile_id IN (${idList})`;
  const r = db.prepare(sql).run();
  console.log(`  ${table}: ${r.changes} rows`);
}

// 3. Settings
const r = db.prepare(`DELETE FROM settings WHERE profile_id IN (${idList})`).run();
console.log(`  settings: ${r.changes} rows`);

// 4. Demo profiles
for (const pid of DEMO_IDS) {
  db.prepare('DELETE FROM profiles WHERE id = ?').run(pid);
}
console.log(`  profiles: ${DEMO_IDS.length} deleted`);

// 5. Reset autoincrement sequences so IDs start fresh
db.prepare('DELETE FROM sqlite_sequence').run();
console.log('  sqlite_sequence: reset');

// 6. Re-seed
console.log('\nRe-seeding demo profiles...');
db.seedThreeTierProfiles();

// 7. Verify
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
console.log('\nDemo profiles nuked and re-seeded.');
