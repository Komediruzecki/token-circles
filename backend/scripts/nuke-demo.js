#!/usr/bin/env node
/**
 * Nuke only demo profiles (IDs 1, 2, 3) and all their data, then reinitialize.
 * Keeps any non-demo profiles and the admin user intact.
 */
const db = require('../database');
const { PROFILE_DATA_TABLES, PROFILE_CHILD_TABLES } = require('../lib/profileTables');

const DEMO_IDS = db.PROFILES_TO_NUKE || [1, 2, 3];
const idList = DEMO_IDS.join(',');

console.log('Nuking demo profiles and their data...');

// 1. Junction/child tables (linked via parent table)
for (const jt of PROFILE_CHILD_TABLES) {
  const sql = `DELETE FROM ${jt.table} WHERE ${jt.key} IN (SELECT id FROM ${jt.parent} WHERE profile_id IN (${idList}))`;
  const r = db.prepare(sql).run();
  console.log(`  ${jt.table}: ${r.changes} rows`);
}

// 2. Direct profile_id tables
for (const table of PROFILE_DATA_TABLES) {
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
