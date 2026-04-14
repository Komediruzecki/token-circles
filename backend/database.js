const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'db', 'finance.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run migrations
migrate();

function migrate() {
  // Create profiles table
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Create categories table
  db.exec(`
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
  db.exec('CREATE INDEX IF NOT EXISTS idx_categories_profile ON categories(profile_id)');

  // Create transactions table
  db.exec(`
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
  db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_profile ON transactions(profile_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id)');

  // Create budgets table
  db.exec(`
    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      period TEXT NOT NULL DEFAULT 'monthly',
      start_date TEXT NOT NULL,
      end_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      profile_id INTEGER NOT NULL DEFAULT 1
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_budgets_profile ON budgets(profile_id)');

  // Create loans table
  db.exec(`
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
  db.exec('CREATE INDEX IF NOT EXISTS idx_loans_profile ON loans(profile_id)');

  // Create loan_rate_periods table
  db.exec(`
    CREATE TABLE IF NOT EXISTS loan_rate_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id INTEGER NOT NULL,
      rate REAL NOT NULL,
      start_month INTEGER NOT NULL,
      end_month INTEGER
    );
  `);

  // Create loan_prepayments table
  db.exec(`
    CREATE TABLE IF NOT EXISTS loan_prepayments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id INTEGER NOT NULL,
      month INTEGER NOT NULL,
      amount REAL NOT NULL,
      note TEXT DEFAULT ''
    );
  `);

  // Create settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      profile_id INTEGER DEFAULT 1,
      PRIMARY KEY (key, profile_id)
    );
  `);

  // Create users table for authentication
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Create sessions table for express-session
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expire TEXT NOT NULL
    );
  `);

  // Create accounts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'giro',
      currency TEXT NOT NULL DEFAULT 'USD',
      balance REAL NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      profile_id INTEGER NOT NULL DEFAULT 1
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_accounts_profile ON accounts(profile_id)');

  // Migration: Add profile_id to existing tables (for upgrades)
  if (!columnExists('categories', 'profile_id')) {
    try { db.exec('ALTER TABLE categories ADD COLUMN profile_id INTEGER NOT NULL DEFAULT 1'); } catch(e) {}
  }
  if (!columnExists('transactions', 'profile_id')) {
    try { db.exec('ALTER TABLE transactions ADD COLUMN profile_id INTEGER NOT NULL DEFAULT 1'); } catch(e) {}
  }
  if (!columnExists('budgets', 'profile_id')) {
    try { db.exec('ALTER TABLE budgets ADD COLUMN profile_id INTEGER NOT NULL DEFAULT 1'); } catch(e) {}
  }
  if (!columnExists('loans', 'profile_id')) {
    try { db.exec('ALTER TABLE loans ADD COLUMN profile_id INTEGER NOT NULL DEFAULT 1'); } catch(e) {}
  }
  if (!columnExists('settings', 'profile_id')) {
    try { db.exec('ALTER TABLE settings ADD COLUMN profile_id INTEGER DEFAULT 1'); } catch(e) {}
  }

  // Migration: Fix sample transaction amounts (should be positive, type determines sign)
  if (columnExists('transactions', 'amount')) {
    try {
      db.exec("UPDATE transactions SET amount = ABS(amount) WHERE profile_id = 1 AND amount < 0");
    } catch(e) {}
  }

  // Migration: Add user_id to profiles table
  if (!columnExists('profiles', 'user_id')) {
    try { db.exec('ALTER TABLE profiles ADD COLUMN user_id INTEGER REFERENCES users(id)'); } catch(e) {}
  }

  // Create default profile if none exist
  const profileCount = db.prepare('SELECT COUNT(*) as c FROM profiles').get();
  if (profileCount.c === 0) {
    db.prepare('INSERT INTO profiles (id, name) VALUES (1, ?)').run('ExampleProfile');
  }

  // Seed default categories for the default profile (if no categories exist for profile 1)
  const catCount = db.prepare('SELECT COUNT(*) as c FROM categories WHERE profile_id = 1').get();
  if (catCount.c === 0) {
    const insertCat = db.prepare(
      'INSERT INTO categories (name, color, icon, type, profile_id) VALUES (?, ?, ?, ?, ?)'
    );
    const defaults = [
      ['Housing', '#dc2626', 'home', 'expense'],
      ['Food & Dining', '#ea580c', 'utensils', 'expense'],
      ['Transportation', '#d97706', 'car', 'expense'],
      ['Healthcare', '#16a34a', 'heart', 'expense'],
      ['Entertainment', '#0891b2', 'film', 'expense'],
      ['Shopping', '#7c3aed', 'shopping-bag', 'expense'],
      ['Utilities', '#475569', 'zap', 'expense'],
      ['Education', '#db2777', 'book', 'expense'],
      ['Personal Care', '#e11d48', 'smile', 'expense'],
      ['Travel', '#0d9488', 'plane', 'expense'],
      ['Salary', '#059669', 'briefcase', 'income'],
      ['Freelance', '#2563eb', 'laptop', 'income'],
      ['Investments', '#4f46e5', 'trending-up', 'income'],
      ['Other Income', '#9333ea', 'plus-circle', 'income'],
    ];
    for (const c of defaults) insertCat.run(...c, 1);
  }

  // Seed demo user if no users exist
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (userCount.c === 0) {
    // Demo user: maff / add2 (password will be bcrypt hashed)
    const bcrypt = require('bcrypt');
    const passwordHash = bcrypt.hashSync('add2', 10);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('maff', passwordHash);
  }

  // Seed sample transactions for ExampleProfile (id=1) if none exist
  const txCount = db.prepare('SELECT COUNT(*) as c FROM transactions WHERE profile_id = 1').get();
  if (txCount.c === 0) {
    const insertTx = db.prepare(
      'INSERT INTO transactions (description, amount, date, category_id, type, profile_id, currency) VALUES (?,?,?,?,?,?,?)'
    );
    const now = new Date();
    // Get category IDs for ExampleProfile
    const cats = {};
    db.prepare('SELECT name, id FROM categories WHERE profile_id = 1').all().forEach(c => { cats[c.name] = c.id; });

    const samples = [
      ['Monthly Salary', 4500, -15, 'Salary', 'income'],
      ['Freelance Project', 850, -30, 'Freelance', 'income'],
      ['Rent Payment', 1200, -3, 'Housing', 'expense'],
      ['Grocery Shopping', 185.50, -5, 'Food & Dining', 'expense'],
      ['Grocery Shopping', 142.30, -18, 'Food & Dining', 'expense'],
      ['Electricity Bill', 95.00, -7, 'Utilities', 'expense'],
      ['Internet Bill', 49.99, -12, 'Utilities', 'expense'],
      ['Gas Station Fill-up', 65.00, -10, 'Transportation', 'expense'],
      ['Public Transport Monthly', 45.00, -25, 'Transportation', 'expense'],
      ['Netflix Subscription', 15.99, -35, 'Entertainment', 'expense'],
      ['Gym Membership', 49.99, -20, 'Healthcare', 'expense'],
      ['Health Checkup', 120.00, -45, 'Healthcare', 'expense'],
      ['Online Shopping', 89.95, -40, 'Shopping', 'expense'],
      ['Restaurant Dinner', 78.50, -8, 'Food & Dining', 'expense'],
      ['Book Purchase', 24.99, -50, 'Education', 'expense'],
    ];

    for (const [desc, amt, daysAgo, catName, type] of samples) {
      const d = new Date(now);
      d.setDate(d.getDate() + daysAgo);
      insertTx.run(desc, amt, d.toISOString().split('T')[0], cats[catName] || null, type, 1, 'USD');
    }
  }
}

function columnExists(table, column) {
  try {
    db.prepare(`SELECT ${column} FROM ${table} WHERE 1=0`).get();
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = db;
