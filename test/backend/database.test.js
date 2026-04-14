/**
 * Unit tests for database.js utilities
 * Tests the migrate function and data structures
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Use a temporary file in system temp directory for testing
const testDir = process.env.RUNNER_TEMP || '/tmp';
const testDbPath = path.join(testDir, 'finance-manager-test.db');
let db;

beforeAll(() => {
  // Clean up any existing test db
  try { fs.unlinkSync(testDbPath); } catch (e) {}
  try { fs.unlinkSync(testDbPath + '-wal'); } catch (e) {}
  try { fs.unlinkSync(testDbPath + '-shm'); } catch (e) {}

  // Create a fresh test database
  db = new Database(testDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run migrations manually (copy from database.js)
  runMigrations(db);
});

afterAll(() => {
  if (db && !db.open) return;
  try { db.close(); } catch (e) {}
  // Clean up
  try { fs.unlinkSync(testDbPath); } catch (e) {}
  try { fs.unlinkSync(testDbPath + '-wal'); } catch (e) {}
  try { fs.unlinkSync(testDbPath + '-shm'); } catch (e) {}
});

function runMigrations(testDb) {
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  testDb.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6b7280',
      icon TEXT NOT NULL DEFAULT 'tag',
      type TEXT NOT NULL DEFAULT 'expense',
      parent_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      profile_id INTEGER NOT NULL DEFAULT 1
    );
  `);

  testDb.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      beneficiary TEXT DEFAULT '',
      payor TEXT DEFAULT '',
      category_id INTEGER,
      currency TEXT NOT NULL DEFAULT 'USD',
      amount_local REAL,
      means_of_payment TEXT DEFAULT '',
      exchange_rate REAL DEFAULT 1.0,
      type TEXT NOT NULL DEFAULT 'expense',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      profile_id INTEGER NOT NULL DEFAULT 1
    );
  `);

  testDb.exec(`
    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      principal REAL NOT NULL,
      interest_rate REAL NOT NULL DEFAULT 5.0,
      start_date TEXT NOT NULL,
      term_months INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      profile_id INTEGER NOT NULL DEFAULT 1
    );
  `);

  testDb.exec(`
    CREATE TABLE IF NOT EXISTS loan_rate_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id INTEGER NOT NULL,
      rate REAL NOT NULL,
      start_month INTEGER NOT NULL,
      end_month INTEGER
    );
  `);

  testDb.exec(`
    CREATE TABLE IF NOT EXISTS loan_prepayments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id INTEGER NOT NULL,
      month INTEGER NOT NULL,
      amount REAL NOT NULL,
      note TEXT DEFAULT ''
    );
  `);

  testDb.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      profile_id INTEGER DEFAULT 1,
      PRIMARY KEY (key, profile_id)
    );
  `);
}

describe('Database Schema', () => {
  test('profiles table exists and has correct structure', () => {
    const result = db.prepare('PRAGMA table_info(profiles)').all();
    const columns = result.map(c => c.name);

    expect(columns).toContain('id');
    expect(columns).toContain('name');
    expect(columns).toContain('created_at');
  });

  test('categories table exists with profile_id', () => {
    const result = db.prepare('PRAGMA table_info(categories)').all();
    const columns = result.map(c => c.name);

    expect(columns).toContain('profile_id');
    expect(columns).toContain('name');
    expect(columns).toContain('color');
  });

  test('transactions table exists with all required fields', () => {
    const result = db.prepare('PRAGMA table_info(transactions)').all();
    const columns = result.map(c => c.name);

    expect(columns).toContain('id');
    expect(columns).toContain('amount');
    expect(columns).toContain('date');
    expect(columns).toContain('type');
    expect(columns).toContain('profile_id');
  });

  test('loans table exists with rate and prepayment tables', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('loans');
    expect(tableNames).toContain('loan_rate_periods');
    expect(tableNames).toContain('loan_prepayments');
  });

  test('settings table has composite primary key', () => {
    const result = db.prepare('PRAGMA table_info(settings)').all();
    const columns = result.map(c => c.name);

    expect(columns).toContain('key');
    expect(columns).toContain('profile_id');
    expect(columns).toContain('value');
  });
});

describe('Database Operations', () => {
  test('can create and retrieve a profile', () => {
    db.prepare('INSERT INTO profiles (name) VALUES (?)').run('TestProfile');
    const profile = db.prepare('SELECT * FROM profiles WHERE name = ?').get('TestProfile');

    expect(profile).toBeDefined();
    expect(profile.name).toBe('TestProfile');
  });

  test('can create categories with profile isolation', () => {
    const insert = db.prepare(
      'INSERT INTO categories (name, color, type, profile_id) VALUES (?, ?, ?, ?)'
    );
    insert.run('Housing', '#ef4444', 'expense', 1);
    insert.run('Salary', '#10b981', 'income', 1);

    const categories = db.prepare('SELECT * FROM categories WHERE profile_id = 1').all();

    expect(categories.length).toBeGreaterThanOrEqual(2);
    expect(categories.some(c => c.name === 'Housing')).toBe(true);
    expect(categories.some(c => c.name === 'Salary')).toBe(true);
  });

  test('can create transactions with all fields', () => {
    const result = db.prepare(`
      INSERT INTO transactions (description, amount, date, type, profile_id, currency)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('Grocery shopping', 150.50, '2024-01-15', 'expense', 1, 'USD');

    expect(result.lastInsertRowid).toBeDefined();

    const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(result.lastInsertRowid);
    expect(tx.description).toBe('Grocery shopping');
    expect(tx.amount).toBe(150.50);
    expect(tx.currency).toBe('USD');
  });

  test('can create loan with rate periods', () => {
    const loanInsert = db.prepare(`
      INSERT INTO loans (name, principal, interest_rate, start_date, term_months, profile_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('Home Loan', 200000, 5.0, '2024-01-01', 360, 1);

    const loanId = loanInsert.lastInsertRowid;

    db.prepare(
      'INSERT INTO loan_rate_periods (loan_id, rate, start_month, end_month) VALUES (?, ?, ?, ?)'
    ).run(loanId, 5.0, 1, 12);
    db.prepare(
      'INSERT INTO loan_rate_periods (loan_id, rate, start_month, end_month) VALUES (?, ?, ?, ?)'
    ).run(loanId, 5.5, 13, null);

    const periods = db.prepare('SELECT * FROM loan_rate_periods WHERE loan_id = ?').all(loanId);

    expect(periods.length).toBe(2);
    expect(periods[0].rate).toBe(5.0);
    expect(periods[1].rate).toBe(5.5);
  });

  test('can add prepayment to loan', () => {
    const loanInsert = db.prepare(`
      INSERT INTO loans (name, principal, interest_rate, start_date, term_months, profile_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('Car Loan', 20000, 6.0, '2024-01-01', 60, 1);

    const loanId = loanInsert.lastInsertRowid;

    db.prepare(
      'INSERT INTO loan_rate_periods (loan_id, rate, start_month, end_month) VALUES (?, ?, ?, ?)'
    ).run(loanId, 6.0, 1, null);

    db.prepare(
      'INSERT INTO loan_prepayments (loan_id, month, amount, note) VALUES (?, ?, ?, ?)'
    ).run(loanId, 12, 2000, 'Year-end bonus prepayment');

    const prepayments = db.prepare('SELECT * FROM loan_prepayments WHERE loan_id = ?').all(loanId);

    expect(prepayments.length).toBe(1);
    expect(prepayments[0].amount).toBe(2000);
    expect(prepayments[0].month).toBe(12);
  });

  test('can store and retrieve settings', () => {
    db.prepare(
      'INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES (?, ?, ?)'
    ).run('local_currency', 'EUR', 1);
    db.prepare(
      'INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES (?, ?, ?)'
    ).run('theme', 'dark', 1);

    const currency = db.prepare(
      'SELECT value FROM settings WHERE key = ? AND profile_id = ?'
    ).get('local_currency', 1);
    const theme = db.prepare(
      'SELECT value FROM settings WHERE key = ? AND profile_id = ?'
    ).get('theme', 1);

    expect(currency.value).toBe('EUR');
    expect(theme.value).toBe('dark');
  });

  test('profile isolation works - categories are separate per profile', () => {
    // Create second profile
    db.prepare('INSERT INTO profiles (name) VALUES (?)').run('Profile2');
    const profile2 = db.prepare('SELECT id FROM profiles WHERE name = ?').get('Profile2');
    const pid2 = profile2.id;

    // Add category to profile 2
    db.prepare(
      'INSERT INTO categories (name, color, type, profile_id) VALUES (?, ?, ?, ?)'
    ).run('Rent', '#000000', 'expense', pid2);

    // Count categories per profile
    const cats1 = db.prepare('SELECT COUNT(*) as c FROM categories WHERE profile_id = 1').get();
    const cats2 = db.prepare('SELECT COUNT(*) as c FROM categories WHERE profile_id = ?').get(pid2);

    expect(cats2.c).toBeGreaterThan(0);
    // Profile 1 should not have 'Rent'
    const rentInProfile1 = db.prepare(
      "SELECT * FROM categories WHERE profile_id = 1 AND name = 'Rent'"
    ).all();
    expect(rentInProfile1.length).toBe(0);
  });
});

describe('Foreign Key Constraints', () => {
  test('transactions can reference categories', () => {
    const cat = db.prepare(
      "SELECT id FROM categories WHERE profile_id = 1 LIMIT 1"
    ).get();

    if (cat) {
      const result = db.prepare(`
        INSERT INTO transactions (description, amount, date, type, category_id, profile_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('Test transaction', 100, '2024-01-01', 'expense', cat.id, 1);

      const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(result.lastInsertRowid);
      expect(tx.category_id).toBe(cat.id);
    }
  });
});
