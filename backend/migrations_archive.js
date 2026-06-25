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
      tax_deductible INTEGER DEFAULT 0,
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
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_transactions_profile_date ON transactions(profile_id, date)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_transactions_profile_type_date ON transactions(profile_id, type, date)'
  );

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
  db.exec('CREATE INDEX IF NOT EXISTS idx_budgets_category ON budgets(category_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_budgets_start_date ON budgets(start_date)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_budgets_profile_date ON budgets(profile_id, start_date)');

  // Create savings_goals table
  db.exec(`
    CREATE TABLE IF NOT EXISTS savings_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      target_amount REAL NOT NULL,
      current_amount REAL NOT NULL DEFAULT 0,
      deadline TEXT,
      notes TEXT DEFAULT '',
      category_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      profile_id INTEGER NOT NULL DEFAULT 1
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_savings_goals_profile ON savings_goals(profile_id)');

  // Add category_id column if upgrading from older schema
  try {
    db.exec('ALTER TABLE savings_goals ADD COLUMN category_id INTEGER');
  } catch (_) {
    /* exists */
  }

  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_savings_goals_category ON savings_goals(category_id)');
  } catch (_) {
    /* missing column */
  }

  // Create retirement_goals table
  db.exec(`
    CREATE TABLE IF NOT EXISTS retirement_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      target_amount REAL NOT NULL,
      current_amount REAL NOT NULL DEFAULT 0,
      deadline TEXT,
      notes TEXT DEFAULT '',
      current_age INTEGER DEFAULT 30,
      retirement_age INTEGER DEFAULT 65,
      monthly_contribution REAL DEFAULT 0,
      expected_return_rate REAL DEFAULT 7,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      profile_id INTEGER NOT NULL DEFAULT 1
    );
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_retirement_goals_profile ON retirement_goals(profile_id)'
  );

  // Create emergency_fund_config table
  db.exec(`
    CREATE TABLE IF NOT EXISTS emergency_fund_config (
      id INTEGER PRIMARY KEY,
      monthly_expenses REAL NOT NULL DEFAULT 0,
      profile_id INTEGER NOT NULL DEFAULT 1
    );
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_emergency_fund_profile ON emergency_fund_config(profile_id)'
  );

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

  // Create account_balance_history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_balance_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      balance REAL NOT NULL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_balance_history_account ON account_balance_history(account_id)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_balance_history_recorded ON account_balance_history(recorded_at)'
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS recurring_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL DEFAULT 1,
      description TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL,
      type TEXT NOT NULL DEFAULT 'expense',
      category_id INTEGER,
      frequency TEXT NOT NULL DEFAULT 'monthly',
      day_of_month INTEGER,
      next_date TEXT,
      notes TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_recurring_profile ON recurring_transactions(profile_id)');

  // Create bills table
  db.exec(`
    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'monthly',
      day_of_month INTEGER,
      category_id INTEGER,
      due_date TEXT,
      next_due_date TEXT,
      recurring INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_paid TEXT,
      last_paid_date TEXT,
      notes TEXT DEFAULT '',
      type TEXT NOT NULL DEFAULT 'bill',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_bills_profile ON bills(profile_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_bills_profile_due_date ON bills(profile_id, due_date)');

  // Create housings table
  db.exec(`
  CREATE TABLE IF NOT EXISTS housings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'other',
    monthly_amount REAL NOT NULL,
    due_date TEXT NOT NULL DEFAULT '',
    autopay INTEGER NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_housings_profile ON housings(profile_id)');
  // Add type column if upgrading from older schema
  try {
    db.exec("ALTER TABLE housings ADD COLUMN type TEXT NOT NULL DEFAULT 'other'");
  } catch (_) {
    /* exists */
  }

  // Create zero-based budgeting table
  db.exec(`
    CREATE TABLE IF NOT EXISTS budgets_zero_based (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      month TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (profile_id) REFERENCES profiles(id),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_budgets_zero_based_profile ON budgets_zero_based(profile_id)'
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_budgets_zero_based_month ON budgets_zero_based(month)');
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_budgets_zero_based_category ON budgets_zero_based(category_id)'
  );

  // Create tags table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#6b7280',
      profile_id INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(name, profile_id)
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_tags_profile ON tags(profile_id)');

  // Create transaction_tags junction table
  db.exec(`
    CREATE TABLE IF NOT EXISTS transaction_tags (
      transaction_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (transaction_id, tag_id),
      FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_tx_tags_tx ON transaction_tags(transaction_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tx_tags_tag ON transaction_tags(tag_id)');

  // Create category_mappings table for auto-categorization
  db.exec(`
    CREATE TABLE IF NOT EXISTS category_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL,
      pattern TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      confidence REAL NOT NULL,
      use_count INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (profile_id) REFERENCES profiles(id),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_mappings_profile ON category_mappings(profile_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_mappings_pattern ON category_mappings(pattern)');

  // Migration: Add profile_id to existing tables (for upgrades)
  if (!columnExists('categories', 'profile_id')) {
    try {
      db.exec('ALTER TABLE categories ADD COLUMN profile_id INTEGER NOT NULL DEFAULT 1');
    } catch (e) {}
  }
  if (!columnExists('transactions', 'profile_id')) {
    try {
      db.exec('ALTER TABLE transactions ADD COLUMN profile_id INTEGER NOT NULL DEFAULT 1');
    } catch (e) {}
  }
  if (!columnExists('budgets', 'profile_id')) {
    try {
      db.exec('ALTER TABLE budgets ADD COLUMN profile_id INTEGER NOT NULL DEFAULT 1');
    } catch (e) {}
  }
  if (!columnExists('loans', 'profile_id')) {
    try {
      db.exec('ALTER TABLE loans ADD COLUMN profile_id INTEGER NOT NULL DEFAULT 1');
    } catch (e) {}
  }
  if (!columnExists('settings', 'profile_id')) {
    try {
      db.exec('ALTER TABLE settings ADD COLUMN profile_id INTEGER DEFAULT 1');
    } catch (e) {}
  }

  // Migration: Fix sample transaction amounts (should be positive, type determines sign)
  if (columnExists('transactions', 'amount')) {
    try {
      db.exec('UPDATE transactions SET amount = ABS(amount) WHERE profile_id = 1 AND amount < 0');
    } catch (e) {}
  }

  // Migration: Add user_id to profiles table
  if (!columnExists('profiles', 'user_id')) {
    try {
      db.exec('ALTER TABLE profiles ADD COLUMN user_id INTEGER REFERENCES users(id)');
    } catch (e) {}
  }

  // Migration: Add reconciled column to transactions
  if (!columnExists('transactions', 'reconciled')) {
    try {
      db.exec('ALTER TABLE transactions ADD COLUMN reconciled INTEGER DEFAULT 0');
    } catch (e) {}
  }

  // Migration: Add reconciled_at column to transactions
  if (!columnExists('transactions', 'reconciled_at')) {
    try {
      db.exec('ALTER TABLE transactions ADD COLUMN reconciled_at TEXT');
    } catch (e) {}
  }

  // Migration: Add means_of_payment column to transactions
  if (!columnExists('transactions', 'means_of_payment')) {
    try {
      db.exec("ALTER TABLE transactions ADD COLUMN means_of_payment TEXT DEFAULT ''");
    } catch (e) {}
  }

  // Migration: Add receipt_id column to transactions
  if (!columnExists('transactions', 'receipt_id')) {
    try {
      db.exec('ALTER TABLE transactions ADD COLUMN receipt_id INTEGER');
    } catch (e) {}
  }
  if (!columnExists('transactions', 'receipt_name')) {
    try {
      db.exec("ALTER TABLE transactions ADD COLUMN receipt_name TEXT DEFAULT ''");
    } catch (e) {}
  }

  // Create receipts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER UNIQUE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      profile_id INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_receipts_profile ON receipts(profile_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_receipts_transaction ON receipts(transaction_id)');

  // Migration: Add rollover columns to budgets
  if (!columnExists('budgets', 'rollover_enabled')) {
    try {
      db.exec('ALTER TABLE budgets ADD COLUMN rollover_enabled INTEGER DEFAULT 0');
    } catch (e) {}
  }
  if (!columnExists('budgets', 'rollover_amount')) {
    try {
      db.exec('ALTER TABLE budgets ADD COLUMN rollover_amount REAL DEFAULT 0');
    } catch (e) {}
  }
  if (!columnExists('budgets', 'rollover_used')) {
    try {
      db.exec('ALTER TABLE budgets ADD COLUMN rollover_used REAL DEFAULT 0');
    } catch (e) {}
  }

  // Migration: Add missing columns to bills table (due_date, next_due_date, recurring)
  if (!columnExists('bills', 'due_date')) {
    try {
      db.exec('ALTER TABLE bills ADD COLUMN due_date TEXT');
    } catch (e) {}
  }
  if (!columnExists('bills', 'next_due_date')) {
    try {
      db.exec('ALTER TABLE bills ADD COLUMN next_due_date TEXT');
    } catch (e) {}
  }
  if (!columnExists('bills', 'recurring')) {
    try {
      db.exec('ALTER TABLE bills ADD COLUMN recurring INTEGER DEFAULT 1');
    } catch (e) {}
  }

  // Migration: Add last_paid_date column to bills table
  if (!columnExists('bills', 'last_paid_date')) {
    try {
      db.exec('ALTER TABLE bills ADD COLUMN last_paid_date TEXT');
    } catch (e) {}
  }

  // Migration: Add type column to bills table
  if (!columnExists('bills', 'type')) {
    try {
      db.exec("ALTER TABLE bills ADD COLUMN type TEXT NOT NULL DEFAULT 'bill'");
    } catch (e) {}
  }

  // Migration: Add account_id column to transactions table
  if (!columnExists('transactions', 'account_id')) {
    try {
      db.exec('ALTER TABLE transactions ADD COLUMN account_id INTEGER');
    } catch (e) {}
  }

  // Migration: Add transfer_account_id column to transactions table
  if (!columnExists('transactions', 'transfer_account_id')) {
    try {
      db.exec('ALTER TABLE transactions ADD COLUMN transfer_account_id INTEGER');
    } catch (e) {}
  }

  // Create portfolio_holdings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      shares REAL NOT NULL,
      purchase_price REAL NOT NULL,
      purchase_date TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      profile_id INTEGER NOT NULL DEFAULT 1
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_portfolio_profile ON portfolio_holdings(profile_id)');
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_portfolio_ticker ON portfolio_holdings(profile_id, ticker)'
  );

  // Migration: Add updated_at column to portfolio_holdings
  if (!columnExists('portfolio_holdings', 'updated_at')) {
    try {
      db.exec(
        "ALTER TABLE portfolio_holdings ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))"
      );
    } catch (e) {}
  }

  // Migration: Add starting_balance and starting_date columns to accounts table
  if (!columnExists('accounts', 'starting_balance')) {
    try {
      db.exec('ALTER TABLE accounts ADD COLUMN starting_balance REAL NOT NULL DEFAULT 0');
      // Migrate existing accounts: set starting_balance = current balance
      db.exec('UPDATE accounts SET starting_balance = balance WHERE starting_balance = 0');
    } catch (e) {}
  }
  if (!columnExists('accounts', 'starting_date')) {
    try {
      db.exec('ALTER TABLE accounts ADD COLUMN starting_date TEXT DEFAULT NULL');
      // Migrate existing accounts: set starting_date = created_at
      db.exec('UPDATE accounts SET starting_date = created_at WHERE starting_date IS NULL');
    } catch (e) {}
  }

  // Migration: Add email column to users table
  if (!columnExists('users', 'email')) {
    try {
      db.exec("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''");
    } catch (e) {}
  }

  // Seed demo user if no users exist
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (userCount.c === 0) {
    const bcrypt = require('bcrypt');
    const passwordHash = bcrypt.hashSync('add2', 10);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
      'maff',
      passwordHash
    );
  }

  // Seed the three example profiles if they don't exist
  seedThreeTierProfiles();
}

function columnExists(table, column) {
  try {
    db.prepare(`SELECT ${column} FROM ${table} WHERE 1=0`).get();
    return true;
  } catch (e) {
    return false;
  }
}
