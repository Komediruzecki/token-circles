-- Users
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Profiles
CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Profile names are unique PER USER, not globally (matches Worker migration 0002). A global
  -- UNIQUE(name) made a second user's default 'Personal Profile' collide. NOTE: only applies to
  -- freshly-created databases (CREATE TABLE IF NOT EXISTS) — existing self-host DBs need a manual
  -- table rebuild to adopt this.
  UNIQUE(user_id, name)
);

-- Categories
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
CREATE INDEX IF NOT EXISTS idx_categories_profile ON categories(profile_id);

-- Transactions
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
  exchange_rate REAL NOT NULL DEFAULT 1.0,
  type TEXT NOT NULL DEFAULT 'expense',
  notes TEXT DEFAULT '',
  reconciled INTEGER DEFAULT 0,
  reconciled_at TEXT,
  means_of_payment TEXT DEFAULT '',
  receipt_id INTEGER,
  receipt_name TEXT DEFAULT '',
  account_id INTEGER,
  transfer_account_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  profile_id INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_transactions_profile ON transactions(profile_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_profile_date ON transactions(profile_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_profile_type_date ON transactions(profile_id, type, date);

-- Budgets
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  period TEXT NOT NULL DEFAULT 'monthly',
  start_date TEXT NOT NULL,
  end_date TEXT,
  rollover_enabled INTEGER DEFAULT 0,
  rollover_amount REAL DEFAULT 0,
  rollover_used REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  profile_id INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_budgets_profile ON budgets(profile_id);
CREATE INDEX IF NOT EXISTS idx_budgets_category ON budgets(category_id);
CREATE INDEX IF NOT EXISTS idx_budgets_start_date ON budgets(start_date);
CREATE INDEX IF NOT EXISTS idx_budgets_profile_date ON budgets(profile_id, start_date);

-- Zero Based Budgets
CREATE TABLE IF NOT EXISTS budgets_zero_based (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  month TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (profile_id) REFERENCES profiles(id),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);
CREATE INDEX IF NOT EXISTS idx_budgets_zero_based_profile ON budgets_zero_based(profile_id);
CREATE INDEX IF NOT EXISTS idx_budgets_zero_based_month ON budgets_zero_based(month);
CREATE INDEX IF NOT EXISTS idx_budgets_zero_based_category ON budgets_zero_based(category_id);

-- Savings Goals
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
CREATE INDEX IF NOT EXISTS idx_savings_goals_profile ON savings_goals(profile_id);
CREATE INDEX IF NOT EXISTS idx_savings_goals_category ON savings_goals(category_id);

-- Retirement Goals
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
CREATE INDEX IF NOT EXISTS idx_retirement_goals_profile ON retirement_goals(profile_id);

-- Emergency Fund
CREATE TABLE IF NOT EXISTS emergency_fund_config (
  id INTEGER PRIMARY KEY,
  monthly_expenses REAL NOT NULL DEFAULT 0,
  profile_id INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_emergency_fund_profile ON emergency_fund_config(profile_id);

-- Loans
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
CREATE INDEX IF NOT EXISTS idx_loans_profile ON loans(profile_id);

CREATE TABLE IF NOT EXISTS loan_rate_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id INTEGER NOT NULL,
  rate REAL NOT NULL,
  start_month INTEGER NOT NULL,
  end_month INTEGER
);

CREATE TABLE IF NOT EXISTS loan_prepayments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id INTEGER NOT NULL,
  month INTEGER NOT NULL,
  amount REAL NOT NULL,
  note TEXT DEFAULT ''
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  profile_id INTEGER DEFAULT 1,
  PRIMARY KEY (key, profile_id)
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expire TEXT NOT NULL
);

-- Accounts
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  bank_name TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'giro',
  currency TEXT NOT NULL DEFAULT 'USD',
  balance REAL NOT NULL DEFAULT 0,
  starting_balance REAL NOT NULL DEFAULT 0,
  starting_date TEXT DEFAULT NULL,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  profile_id INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_accounts_profile ON accounts(profile_id);

CREATE TABLE IF NOT EXISTS account_balance_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  balance REAL NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_balance_history_account ON account_balance_history(account_id);
CREATE INDEX IF NOT EXISTS idx_balance_history_recorded ON account_balance_history(recorded_at);

-- Recurring Transactions
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
);
CREATE INDEX IF NOT EXISTS idx_recurring_profile ON recurring_transactions(profile_id);

-- Bills
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'monthly',
  day_of_month INTEGER,
  category_id INTEGER,
  due_date TEXT NOT NULL,
  next_due_date TEXT,
  recurring INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_paid TEXT,
  last_paid_date TEXT,
  notes TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'bill',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bills_profile ON bills(profile_id);
CREATE INDEX IF NOT EXISTS idx_bills_profile_due_date ON bills(profile_id, due_date);

-- Housings
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
);
CREATE INDEX IF NOT EXISTS idx_housings_profile ON housings(profile_id);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6b7280',
  profile_id INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(name, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_tags_profile ON tags(profile_id);

CREATE TABLE IF NOT EXISTS transaction_tags (
  transaction_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (transaction_id, tag_id),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tx_tags_tx ON transaction_tags(transaction_id);
CREATE INDEX IF NOT EXISTS idx_tx_tags_tag ON transaction_tags(tag_id);

-- Category Mappings
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
CREATE INDEX IF NOT EXISTS idx_mappings_profile ON category_mappings(profile_id);
CREATE INDEX IF NOT EXISTS idx_mappings_pattern ON category_mappings(pattern);

-- Receipts
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
);
CREATE INDEX IF NOT EXISTS idx_receipts_profile ON receipts(profile_id);
CREATE INDEX IF NOT EXISTS idx_receipts_transaction ON receipts(transaction_id);

-- Portfolio Holdings
CREATE TABLE IF NOT EXISTS portfolio_holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  shares REAL NOT NULL,
  purchase_price REAL NOT NULL,
  purchase_date TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  profile_id INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_portfolio_profile ON portfolio_holdings(profile_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_ticker ON portfolio_holdings(profile_id, ticker);
