const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcrypt');
const SQLiteStore = require('connect-sqlite3')(session);
const db = require('./database');
const loanCalc = require('./models/loanCalculator');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3847;

// Ensure directories exist
const uploadsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Date parsing utility - handles DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD
function parseDateString(dateStr) {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  if (typeof dateStr === 'number') {
    // Excel date code
    const d = XLSX.SSF.parse_date_code(dateStr);
    if (d) return new Date(d.y, d.m - 1, d.d).toISOString().split('T')[0];
  }
  const s = String(dateStr).trim();
  // Try DD/MM/YYYY or DD-MM-YYYY (European)
  const euMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (euMatch) {
    const [, d, m, y] = euMatch;
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d)).toISOString().split('T')[0];
  }
  // Try MM/DD/YYYY (US) or ISO
  const date = new Date(s);
  if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
  return new Date().toISOString().split('T')[0];
}

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'finance-manager-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true if using HTTPS
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  },
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: path.join(__dirname, '..', 'db')
  })
}));

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Helper: get profile ID from request (header first, then query param, then 1)
function getProfileId(req) {
  return parseInt(req.headers['x-profile-id'] || req.query.profile_id || 1);
}

// Helper: wrap all data queries with profile_id
function profileWhere(tableAlias = 't', extra = '') {
  return `${tableAlias}.profile_id = ?${extra ? ' AND ' + extra : ''}`;
}

// ========================
// AUTH
// ========================
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ ok: true, username: user.username, isLoggedIn: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.json({ ok: true });
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ userId: req.session.userId, username: req.session.username });
});
// ========================
app.get('/api/profiles', (req, res) => {
  try {
    let profiles;
    if (req.session.userId) {
      // Logged in: return user's profiles plus ExampleProfile
      profiles = db.prepare(
        'SELECT * FROM profiles WHERE user_id = ? OR id = 1 ORDER BY id'
      ).all(req.session.userId);
    } else {
      // Not logged in: return only ExampleProfile
      profiles = db.prepare('SELECT * FROM profiles WHERE id = 1').all();
    }
    // Include transaction counts
    const counts = {};
    const txCount = db.prepare('SELECT profile_id, COUNT(*) as c FROM transactions GROUP BY profile_id').all();
    for (const r of txCount) counts[r.profile_id] = r.c;
    const result = profiles.map(p => ({
      ...p,
      transaction_count: counts[p.id] || 0
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/profiles', (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    // Check name uniqueness across all profiles
    const existing = db.prepare('SELECT id FROM profiles WHERE LOWER(name) = LOWER(?)').get(name.trim());
    if (existing) return res.status(400).json({ error: 'A profile with this name already exists' });
    db.prepare('INSERT INTO profiles (name, user_id) VALUES (?, ?)').run(name.trim(), req.session.userId);
    res.json({ id: db.prepare('SELECT last_insert_rowid() as id').get().id, name: name.trim(), transaction_count: 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/profiles/:id', (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const pid = parseInt(req.params.id);
    if (pid === 1) return res.status(400).json({ error: 'Cannot delete the default profile' });
    // Only allow deleting profiles owned by this user
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(pid);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    if (profile.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Cannot delete another user\'s profile' });
    }
    const count = db.prepare('SELECT COUNT(*) as c FROM profiles').get();
    if (count.c <= 1) return res.status(400).json({ error: 'Cannot delete the last profile' });
    // Delete all data for this profile (cascades via foreign keys)
    db.prepare('DELETE FROM transactions WHERE profile_id = ?').run(pid);
    db.prepare('DELETE FROM budgets WHERE profile_id = ?').run(pid);
    db.prepare('DELETE FROM categories WHERE profile_id = ?').run(pid);
    db.prepare('DELETE FROM loans WHERE profile_id = ?').run(pid);
    db.prepare('DELETE FROM profiles WHERE id = ?').run(pid);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/profile/data', (req, res) => {
  // Nuke all data for the current profile but keep the profile itself
  try {
    const pid = getProfileId(req);
    db.prepare('DELETE FROM loan_prepayments WHERE loan_id IN (SELECT id FROM loans WHERE profile_id = ?)').run(pid);
    db.prepare('DELETE FROM loan_rate_periods WHERE loan_id IN (SELECT id FROM loans WHERE profile_id = ?)').run(pid);
    db.prepare('DELETE FROM transactions WHERE profile_id = ?').run(pid);
    db.prepare('DELETE FROM budgets WHERE profile_id = ?').run(pid);
    db.prepare('DELETE FROM loans WHERE profile_id = ?').run(pid);
    // Reset categories to defaults
    db.prepare('DELETE FROM categories WHERE profile_id = ?').run(pid);
    const defaults = [
      ['Housing', '#ef4444', 'home', 'expense'],
      ['Food & Dining', '#f97316', 'utensils', 'expense'],
      ['Transportation', '#eab308', 'car', 'expense'],
      ['Healthcare', '#22c55e', 'heart', 'expense'],
      ['Entertainment', '#06b6d4', 'film', 'expense'],
      ['Shopping', '#8b5cf6', 'shopping-bag', 'expense'],
      ['Utilities', '#64748b', 'zap', 'expense'],
      ['Education', '#ec4899', 'book', 'expense'],
      ['Personal Care', '#f43f5e', 'smile', 'expense'],
      ['Travel', '#14b8a6', 'plane', 'expense'],
      ['Salary', '#10b981', 'briefcase', 'income'],
      ['Freelance', '#3b82f6', 'laptop', 'income'],
      ['Investments', '#6366f1', 'trending-up', 'income'],
      ['Other Income', '#8b5cf6', 'plus-circle', 'income'],
    ];
    const insertCat = db.prepare('INSERT INTO categories (name, color, icon, type, profile_id) VALUES (?, ?, ?, ?, ?)');
    for (const c of defaults) insertCat.run(...c, pid);
    res.json({ ok: true, message: 'All profile data has been deleted and categories reset to defaults' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================
// SETTINGS (per-profile)
// ========================
app.get('/api/settings', (req, res) => {
  try {
    const pid = getProfileId(req);
    const rows = db.prepare('SELECT key, value FROM settings WHERE profile_id = ? OR profile_id IS NULL').all(pid);
    const settings = {};
    for (const r of rows) settings[r.key] = r.value;
    res.json(settings);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/settings', (req, res) => {
  try {
    const pid = getProfileId(req);
    const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES (?, ?, ?)');
    const entries = Object.entries(req.body);
    for (const [k, v] of entries) upsert.run(k, String(v), pid);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================
// CATEGORIES (per-profile)
// ========================
app.get('/api/categories', (req, res) => {
  try {
    const pid = getProfileId(req);
    const rows = db.prepare(`
      SELECT c.*, p.name as parent_name
      FROM categories c
      LEFT JOIN categories p ON c.parent_id = p.id AND p.profile_id = c.profile_id
      WHERE c.profile_id = ?
      ORDER BY c.type, c.name
    `).all(pid);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/categories', (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, color, icon, type, parent_id } = req.body;
    const info = db.prepare(
      'INSERT INTO categories (name, color, icon, type, parent_id, profile_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, color || '#6b7280', icon || 'tag', type || 'expense', parent_id || null, pid);
    res.json({ id: info.lastInsertRowid, name, color: color || '#6b7280', icon: icon || 'tag', type: type || 'expense', parent_id, profile_id: pid });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/categories/:id', (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, color, icon, type, parent_id } = req.body;
    const result = db.prepare(
      'UPDATE categories SET name=?, color=?, icon=?, type=?, parent_id=? WHERE id=? AND profile_id=?'
    ).run(name, color, icon || 'tag', type, parent_id || null, req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/categories/:id', (req, res) => {
  try {
    const pid = getProfileId(req);
    const result = db.prepare('DELETE FROM categories WHERE id=? AND profile_id=?').run(req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/categories', (req, res) => {
  try {
    const pid = getProfileId(req);
    db.prepare('DELETE FROM categories WHERE profile_id=?').run(pid);
    res.json({ ok: true, message: 'All categories deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================
// TRANSACTIONS (per-profile)
// ========================
app.get('/api/transactions', (req, res) => {
  try {
    const pid = getProfileId(req);
    const { startDate, endDate, category_id, type, search, limit, offset, sort, order } = req.query;
    let sql = `
      SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id = ?
    `;
    const params = [pid];
    if (startDate) { sql += ' AND t.date >= ?'; params.push(startDate); }
    if (endDate) { sql += ' AND t.date <= ?'; params.push(endDate); }
    if (category_id) { sql += ' AND t.category_id = ?'; params.push(category_id); }
    if (type) { sql += ' AND t.type = ?'; params.push(type); }
    if (search) { sql += ' AND (t.description LIKE ? OR t.beneficiary LIKE ? OR t.payor LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    sql += ` ORDER BY t.date DESC, t.id DESC`;
    if (sort) sql += `, t.${sort} ${order === 'asc' ? 'ASC' : 'DESC'}`;
    if (limit) sql += ` LIMIT ${parseInt(limit)}`;
    if (offset) sql += ` OFFSET ${parseInt(offset)}`;
    const rows = db.prepare(sql).all(...params);

    // Count total
    let countSql = `SELECT COUNT(*) as c FROM transactions t WHERE t.profile_id = ?`;
    const cparams = [pid];
    if (startDate) { countSql += ' AND t.date >= ?'; cparams.push(startDate); }
    if (endDate) { countSql += ' AND t.date <= ?'; cparams.push(endDate); }
    if (category_id) { countSql += ' AND t.category_id = ?'; cparams.push(category_id); }
    if (type) { countSql += ' AND t.type = ?'; cparams.push(type); }
    if (search) { countSql += ' AND (t.description LIKE ? OR t.beneficiary LIKE ? OR t.payor LIKE ?)'; cparams.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    const total = db.prepare(countSql).get(...cparams).c;
    res.json({ rows, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/transactions', (req, res) => {
  try {
    const pid = getProfileId(req);
    const { description, amount, date, beneficiary, payor, category_id, currency,
            amount_local, means_of_payment, exchange_rate, type, notes } = req.body;
    const info = db.prepare(`
      INSERT INTO transactions (description, amount, date, beneficiary, payor, category_id,
        currency, amount_local, means_of_payment, exchange_rate, type, notes, profile_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(description, amount, date, beneficiary || '', payor || '',
           category_id || null, currency || 'USD', amount_local ?? amount,
           means_of_payment || '', exchange_rate || 1.0, type || 'expense', notes || '', pid);
    res.json({ id: info.lastInsertRowid, ...req.body, profile_id: pid });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/transactions/:id', (req, res) => {
  try {
    const pid = getProfileId(req);
    const { description, amount, date, beneficiary, payor, category_id, currency,
            amount_local, means_of_payment, exchange_rate, type, notes } = req.body;
    const result = db.prepare(`
      UPDATE transactions SET description=?, amount=?, date=?, beneficiary=?, payor=?,
        category_id=?, currency=?, amount_local=?, means_of_payment=?, exchange_rate=?,
        type=?, notes=?, updated_at=datetime('now')
      WHERE id=? AND profile_id=?
    `).run(description, amount, date, beneficiary || '', payor || '',
           category_id || null, currency, amount_local ?? amount,
           means_of_payment || '', exchange_rate || 1.0, type, notes || '', req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/transactions/:id', (req, res) => {
  try {
    const pid = getProfileId(req);
    const result = db.prepare('DELETE FROM transactions WHERE id=? AND profile_id=?').run(req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/transactions', (req, res) => {
  try {
    const pid = getProfileId(req);
    db.prepare('DELETE FROM transactions WHERE profile_id=?').run(pid);
    res.json({ ok: true, message: 'All transactions deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================
// BUDGETS (per-profile)
// ========================
app.get('/api/budgets', (req, res) => {
  try {
    const pid = getProfileId(req);
    const rows = db.prepare(`
      SELECT b.*, c.name as category_name, c.color as category_color, c.icon as category_icon
      FROM budgets b
      JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
      WHERE b.profile_id = ?
      ORDER BY b.id DESC
    `).all(pid);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/budgets', (req, res) => {
  try {
    const pid = getProfileId(req);
    const { category_id, amount, period, start_date, end_date } = req.body;
    const info = db.prepare(
      'INSERT INTO budgets (category_id, amount, period, start_date, end_date, profile_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(category_id, amount, period || 'monthly', start_date, end_date || null, pid);
    res.json({ id: info.lastInsertRowid, ...req.body, profile_id: pid });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/budgets/:id', (req, res) => {
  try {
    const pid = getProfileId(req);
    const { category_id, amount, period, start_date, end_date } = req.body;
    const result = db.prepare(
      'UPDATE budgets SET category_id=?, amount=?, period=?, start_date=?, end_date=? WHERE id=? AND profile_id=?'
    ).run(category_id, amount, period, start_date, end_date || null, req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/budgets/:id', (req, res) => {
  try {
    const pid = getProfileId(req);
    const result = db.prepare('DELETE FROM budgets WHERE id=? AND profile_id=?').run(req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/budgets/summary', (req, res) => {
  try {
    const pid = getProfileId(req);
    const { year, month } = req.query;
    const y = year || new Date().getFullYear();
    const m = month || new Date().getMonth() + 1;
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    const endDate = `${nextY}-${String(nextM).padStart(2, '0')}-01`;

    const budgets = db.prepare(`
      SELECT b.*, c.name as category_name, c.color as category_color, c.icon as category_icon, c.type
      FROM budgets b
      JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
      WHERE b.profile_id = ? AND (b.end_date IS NULL OR b.end_date >= ?)
    `).all(pid, startDate);

    // Use amount_local if available (for imported transactions), otherwise amount
    const spent = db.prepare(`
      SELECT category_id, SUM(COALESCE(amount_local, amount)) as total
      FROM transactions
      WHERE profile_id = ? AND date >= ? AND date < ? AND type = 'expense' AND category_id IS NOT NULL
      GROUP BY category_id
    `).all(pid, startDate, endDate);

    const spentMap = {};
    for (const s of spent) spentMap[s.category_id] = s.total;

    const summary = budgets.map(b => ({
      ...b,
      spent: spentMap[b.category_id] || 0,
      remaining: b.amount - (spentMap[b.category_id] || 0),
      percentage: b.amount > 0 ? Math.min(100, ((spentMap[b.category_id] || 0) / b.amount) * 100) : 0
    }));

    res.json(summary);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================
// LOANS (per-profile)
// ========================
app.get('/api/loans', (req, res) => {
  try {
    const pid = getProfileId(req);
    const rows = db.prepare(`
      SELECT l.*,
        (SELECT SUM(amount) FROM loan_prepayments WHERE loan_id = l.id) as total_prepaid,
        (SELECT COUNT(*) FROM loan_prepayments WHERE loan_id = l.id) as prepayment_count
      FROM loans l
      WHERE l.profile_id = ?
      ORDER BY l.created_at DESC
    `).all(pid);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/loans', (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, principal, interest_rate, start_date, term_months, rate_periods } = req.body;
    const info = db.prepare(
      'INSERT INTO loans (name, principal, interest_rate, start_date, term_months, profile_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, principal, interest_rate || 5.0, start_date, term_months, pid);
    const loanId = info.lastInsertRowid;

    if (rate_periods && rate_periods.length > 0) {
      const insert = db.prepare(
        'INSERT INTO loan_rate_periods (loan_id, rate, start_month, end_month) VALUES (?, ?, ?, ?)'
      );
      for (const rp of rate_periods) {
        insert.run(loanId, rp.rate, rp.start_month, rp.end_month || null);
      }
    } else if (interest_rate !== undefined) {
      db.prepare(
        'INSERT INTO loan_rate_periods (loan_id, rate, start_month, end_month) VALUES (?, ?, ?, ?)'
      ).run(loanId, interest_rate, 1, null);
    }

    res.json({ id: loanId, name, principal, interest_rate, start_date, term_months, profile_id: pid });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/loans/:id', (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db.prepare('SELECT * FROM loans WHERE id=? AND profile_id=?').get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: 'Not found' });
    loan.rate_periods = db.prepare('SELECT * FROM loan_rate_periods WHERE loan_id=? ORDER BY start_month').all(req.params.id);
    loan.prepayments = db.prepare('SELECT * FROM loan_prepayments WHERE loan_id=? ORDER BY month').all(req.params.id);
    res.json(loan);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/loans/:id', (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, principal, interest_rate, start_date, term_months, rate_periods } = req.body;
    const result = db.prepare(
      'UPDATE loans SET name=?, principal=?, interest_rate=?, start_date=?, term_months=? WHERE id=? AND profile_id=?'
    ).run(name, principal, interest_rate || 5.0, start_date, term_months, req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });

    if (rate_periods !== undefined) {
      db.prepare('DELETE FROM loan_rate_periods WHERE loan_id=?').run(req.params.id);
      if (rate_periods.length > 0) {
        const insert = db.prepare(
          'INSERT INTO loan_rate_periods (loan_id, rate, start_month, end_month) VALUES (?, ?, ?, ?)'
        );
        for (const rp of rate_periods) {
          insert.run(req.params.id, rp.rate, rp.start_month, rp.end_month || null);
        }
      }
    }

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/loans/:id', (req, res) => {
  try {
    const pid = getProfileId(req);
    const result = db.prepare('DELETE FROM loans WHERE id=? AND profile_id=?').run(req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Rate periods CRUD
app.post('/api/loans/:id/rates', (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db.prepare('SELECT id FROM loans WHERE id=? AND profile_id=?').get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    const { rate, start_month, end_month } = req.body;
    const info = db.prepare(
      'INSERT INTO loan_rate_periods (loan_id, rate, start_month, end_month) VALUES (?, ?, ?, ?)'
    ).run(req.params.id, rate, start_month, end_month || null);
    res.json({ id: info.lastInsertRowid });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/loans/:id/rates/:rateId', (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db.prepare('SELECT id FROM loans WHERE id=? AND profile_id=?').get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    const { rate, start_month, end_month } = req.body;
    db.prepare(
      'UPDATE loan_rate_periods SET rate=?, start_month=?, end_month=? WHERE id=? AND loan_id=?'
    ).run(rate, start_month, end_month || null, req.params.rateId, req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/loans/:id/rates/:rateId', (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db.prepare('SELECT id FROM loans WHERE id=? AND profile_id=?').get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    db.prepare('DELETE FROM loan_rate_periods WHERE id=? AND loan_id=?').run(req.params.rateId, req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Prepayments CRUD
app.post('/api/loans/:id/prepayments', (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db.prepare('SELECT id FROM loans WHERE id=? AND profile_id=?').get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    const { month, amount, note } = req.body;
    const info = db.prepare(
      'INSERT INTO loan_prepayments (loan_id, month, amount, note) VALUES (?, ?, ?, ?)'
    ).run(req.params.id, month, amount, note || '');
    res.json({ id: info.lastInsertRowid });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/loans/:id/prepayments/:prepayId', (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db.prepare('SELECT id FROM loans WHERE id=? AND profile_id=?').get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    db.prepare('DELETE FROM loan_prepayments WHERE id=? AND loan_id=?').run(req.params.prepayId, req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Calculate amortization
app.post('/api/loans/:id/calculate', (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db.prepare('SELECT * FROM loans WHERE id=? AND profile_id=?').get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: 'Not found' });

    const ratePeriods = db.prepare('SELECT * FROM loan_rate_periods WHERE loan_id=? ORDER BY start_month').all(req.params.id);
    const prepayments = db.prepare('SELECT * FROM loan_prepayments WHERE loan_id=? ORDER BY month').all(req.params.id);

    // Prepend the loan's initial rate as the first rate period (months 1 to before first user-set change)
    const initialRatePeriod = [{ rate: loan.interest_rate, start_month: 1, end_month: undefined }];
    const allRatePeriods = [...initialRatePeriod, ...ratePeriods.map(rp => ({ rate: rp.rate, start_month: rp.start_month, end_month: rp.end_month }))];

    const scheduleWithPrepayments = loanCalc.calculateSchedule(
      loan.principal, loan.start_date, loan.term_months,
      allRatePeriods,
      prepayments.map(p => ({ month: p.month, amount: p.amount, note: p.note }))
    );

    const scheduleNoPrepayments = loanCalc.calculateSchedule(
      loan.principal, loan.start_date, loan.term_months,
      allRatePeriods,
      []
    );

    const summary = loanCalc.getSummary(scheduleWithPrepayments, scheduleNoPrepayments);

    res.json({
      schedule: scheduleWithPrepayments,
      summary,
      comparison: {
        withPrepayments: summary,
        withoutPrepayments: loanCalc.getSummary(scheduleNoPrepayments, scheduleNoPrepayments)
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================
// DASHBOARD (per-profile)
// ========================
app.get('/api/dashboard/summary', (req, res) => {
  try {
    const pid = getProfileId(req);
    const { year, month } = req.query;
    const y = year || new Date().getFullYear();
    const m = month;
    let startDate, endDate;

    if (m) {
      // Specific month
      startDate = `${y}-${String(m).padStart(2, '0')}-01`;
      const nextM = m === 12 ? 1 : m + 1;
      const nextY = m === 12 ? y + 1 : y;
      endDate = `${nextY}-${String(nextM).padStart(2, '0')}-01`;
    } else {
      // Full year
      startDate = `${y}-01-01`;
      endDate = `${y + 1}-01-01`;
    }

    // Use amount_local if available (for imported transactions), otherwise amount
    const monthly = db.prepare(`
      SELECT type, SUM(COALESCE(amount_local, amount)) as total, COUNT(*) as count
      FROM transactions
      WHERE profile_id = ? AND date >= ? AND date < ?
      GROUP BY type
    `).all(pid, startDate, endDate);

    const summary = { income: 0, expense: 0, transfer: 0, balance: 0 };
    for (const r of monthly) {
      if (r.type === 'income') summary.income = r.total;
      else if (r.type === 'expense') summary.expense = r.total;
      else if (r.type === 'transfer') summary.transfer = r.total;
    }
    summary.balance = summary.income - summary.expense;

    const recent = db.prepare(`
      SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id = ? AND t.date >= ? AND t.date < ?
      ORDER BY t.date DESC, t.id DESC
      LIMIT 10
    `).all(pid, startDate, endDate);

    // Use amount_local if available (for imported transactions), otherwise amount
    const yearStart = `${y}-01-01`;
    const ytd = db.prepare(`
      SELECT type, SUM(COALESCE(amount_local, amount)) as total FROM transactions WHERE profile_id = ? AND date >= ? GROUP BY type
    `).all(pid, yearStart);
    const ytdSummary = { income: 0, expense: 0 };
    for (const r of ytd) {
      if (r.type === 'income') ytdSummary.income = r.total;
      else if (r.type === 'expense') ytdSummary.expense = r.total;
    }
    ytdSummary.net = ytdSummary.income - ytdSummary.expense;

    // Get currency setting
    const currencyRow = db.prepare(`SELECT value FROM settings WHERE key = 'local_currency' AND (profile_id = ? OR profile_id IS NULL) ORDER BY profile_id DESC LIMIT 1`).get(pid);
    const currency = currencyRow ? currencyRow.value : 'EUR';

    res.json({ summary, recent, ytd: ytdSummary, month: m ? `${y}-${String(m).padStart(2, '0')}` : y, currency });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/dashboard/charts', (req, res) => {
  try {
    const pid = getProfileId(req);
    const { months = 12 } = req.query;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months) + 1);
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    // Use amount_local if available (for imported transactions), otherwise amount
    const byCategory = db.prepare(`
      SELECT c.name, c.color, c.icon, SUM(COALESCE(t.amount_local, t.amount)) as total, COUNT(*) as count
      FROM transactions t
      JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id = ? AND t.type = 'expense'
      GROUP BY c.id
      ORDER BY total DESC
    `).all(pid);

    const monthly = db.prepare(`
      SELECT strftime('%Y-%m', date) as month, type, SUM(COALESCE(amount_local, amount)) as total
      FROM transactions
      WHERE profile_id = ? AND date >= ? AND date <= ? AND type IN ('income', 'expense')
      GROUP BY month, type
      ORDER BY month
    `).all(pid, startStr, endStr);

    const monthlyMap = {};
    for (const r of monthly) {
      if (!monthlyMap[r.month]) monthlyMap[r.month] = { month: r.month, income: 0, expense: 0 };
      if (r.type === 'income') monthlyMap[r.month].income = r.total;
      if (r.type === 'expense') monthlyMap[r.month].expense = r.total;
    }

    const cashFlow = Object.values(monthlyMap);
    let running = 0;
    for (const row of cashFlow) {
      running += row.income - row.expense;
      row.cumulative = running;
    }

    // Get currency setting
    const currencyRow = db.prepare(`SELECT value FROM settings WHERE key = 'local_currency' AND (profile_id = ? OR profile_id IS NULL) ORDER BY profile_id DESC LIMIT 1`).get(pid);
    const currency = currencyRow ? currencyRow.value : 'EUR';

    res.json({
      byCategory,
      monthly: Object.values(monthlyMap),
      cashFlow,
      currency
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/dashboard/net-worth', (req, res) => {
  try {
    const pid = getProfileId(req);
    // Get account balances
    const accounts = db.prepare(`SELECT id, name, type, currency, balance FROM accounts WHERE profile_id = ?`).all(pid);
    const totalNetWorth = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);

    // Get monthly net flow (income - expense) per month for last 24 months
    const twoYearsAgo = new Date();
    twoYearsAgo.setMonth(twoYearsAgo.getMonth() - 24);
    const startStr = twoYearsAgo.toISOString().split('T')[0];

    const monthly = db.prepare(`
      SELECT strftime('%Y-%m', date) as month, type, SUM(COALESCE(amount_local, amount)) as total
      FROM transactions
      WHERE profile_id = ? AND date >= ? AND type IN ('income', 'expense')
      GROUP BY month, type
      ORDER BY month
    `).all(pid, startStr);

    const monthlyMap = {};
    for (const r of monthly) {
      if (!monthlyMap[r.month]) monthlyMap[r.month] = { month: r.month, net: 0 };
      if (r.type === 'income') monthlyMap[r.month].net += r.total;
      if (r.type === 'expense') monthlyMap[r.month].net -= r.total;
    }

    // Build timeline starting from 24 months ago with running balance
    const timeline = [];
    let running = totalNetWorth;

    // Go backwards from now to build historical balance
    const sortedMonths = Object.keys(monthlyMap).sort();
    const balanceByMonth = {};
    // First pass: accumulate running balance forward
    let forward = 0;
    for (const m of sortedMonths) {
      forward += monthlyMap[m].net;
      balanceByMonth[m] = forward;
    }

    // Build output: current balance minus future net flows = historical balance
    // Actually simpler: show balance trend from 24 months ago to now
    for (const m of sortedMonths) {
      // The net change from 24mo ago perspective
    }

    // Simpler approach: show monthly net changes with running total
    // Starting from oldest month with the total current balance minus total future net
    const allMonths = sortedMonths;
    if (allMonths.length > 0) {
      // Total net from all months in range
      const totalNet = Object.values(monthlyMap).reduce((s, m) => s + m.net, 0);
      // Opening balance = current net worth - total net
      const opening = totalNetWorth - totalNet;

      let balance = opening;
      for (const m of allMonths) {
        balance += monthlyMap[m].net;
        timeline.push({ month: m, balance: Math.round(balance * 100) / 100, netChange: Math.round(monthlyMap[m].net * 100) / 100 });
      }
      // Always end with current balance
      if (timeline.length > 0) {
        timeline[timeline.length - 1].balance = totalNetWorth;
      }
    }

    res.json({
      totalNetWorth: Math.round(totalNetWorth * 100) / 100,
      accounts,
      timeline
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================
// IMPORT (per-profile)
// ========================
const importFiles = {}; // temp storage for reloading specific sheets

app.post('/api/import/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const workbook = XLSX.readFile(req.file.path);
    const sheetNames = workbook.SheetNames;

    const selectedSheet = req.body.sheetName && sheetNames.includes(req.body.sheetName)
      ? req.body.sheetName
      : sheetNames[0];
    const sheet = workbook.Sheets[selectedSheet];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    const fileId = Date.now().toString(36);
    importFiles[fileId] = { path: req.file.path, workbook, uploadedAt: Date.now() };

    res.json({
      fileId,
      filename: req.file.originalname,
      sheetName: selectedSheet,
      sheetNames,
      headers: (data[0] || []).map(String),
      rows: data.slice(1).filter(r => r.some(c => c != null && c !== '')),
      totalRows: data.length - 1
    });

    // Cleanup old entries
    const cutoff = Date.now() - 3600000;
    Object.keys(importFiles).forEach(k => {
      if (importFiles[k].uploadedAt < cutoff) {
        try { fs.unlinkSync(importFiles[k].path); } catch(e) {}
        delete importFiles[k];
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/import/file-sheet', (req, res) => {
  try {
    const { fileId, sheetName } = req.body;
    const entry = importFiles[fileId];
    if (!entry) return res.status(400).json({ error: 'File session expired. Please re-upload.' });

    const sheetNames = entry.workbook.SheetNames;
    if (!sheetNames.includes(sheetName)) return res.status(400).json({ error: 'Sheet not found' });

    const sheet = entry.workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    res.json({
      fileId,
      sheetName,
      sheetNames,
      headers: (data[0] || []).map(String),
      rows: data.slice(1).filter(r => r.some(c => c != null && c !== '')),
      totalRows: data.length - 1
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/import/googlesheet', (req, res) => {
  const { url, sheetName } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  // Extract sheet ID and gid from URL
  // URL can be: /d/ID/edit?gid=N#gid=N or just /d/ID/export?format=csv
  const idMatch = (url || '').match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return res.status(400).json({ error: 'Invalid Google Sheets URL or ID' });

  const sheetId = idMatch[1];
  // Extract gid from query param ?gid= or URL fragment #gid=
  const urlWithoutFragment = url.split('#')[0];
  const gidMatch = urlWithoutFragment.match(/[?&]gid=([0-9]+)/);
  const gid = gidMatch ? gidMatch[1] : null;

  // Strategy 1: CSV export with gid (works for publicly accessible sheets, respects specific sheet tab)
  function tryCsvExport() {
    return new Promise((resolve) => {
      const csvUrl = gid
        ? `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`
        : `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
      fetch(csvUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        .then(r => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then(text => {
          // Check if it's actually CSV or an error page
          if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
            throw new Error('Sheet is not publicly accessible (got HTML instead of CSV)');
          }
          // Parse CSV manually (handles quoted fields, commas in values)
          const rows = [];
          const lines = text.trim().split('\n');
          for (const line of lines) {
            const cols = [];
            let cur = ''; let inQuotes = false;
            for (const ch of line) {
              if (ch === '"') { inQuotes = !inQuotes; }
              else if (ch === ',' && !inQuotes) { cols.push(cur.trim().replace(/^"|"$/g, '')); cur = ''; }
              else cur += ch;
            }
            cols.push(cur.trim().replace(/^"|"$/g, ''));
            rows.push(cols);
          }
          const headers = rows[0] || [];
          const dataRows = rows.slice(1).filter(r => r.some(c => c));
          resolve({ headers, rows: dataRows, sheetName: sheetName || 'Sheet1' });
        })
        .catch(err => resolve({ error: err.message }));
    });
  }

  // Strategy 2: Get all sheet names via XLSX export, then fetch CSV for specific sheet
  function tryXlsxAndListSheets() {
    return new Promise((resolve) => {
      fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      })
        .then(r => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.arrayBuffer();
        })
        .then(buf => {
          const workbook = XLSX.read(buf, { type: 'array' });
          resolve({ sheetNames: workbook.SheetNames, workbook });
        })
        .catch(err => resolve({ error: err.message }));
    });
  }

  // Execute: try CSV first (respects gid), then fall back to XLSX for sheet listing
  (async () => {
    try {
      if (sheetName) {
        // Specific sheet requested — try CSV with gid first, then XLSX workbook
        const csvResult = await tryCsvExport();
        if (!csvResult.error) {
          return res.json({ headers: csvResult.headers, rows: csvResult.rows, selectedSheet: csvResult.sheetName, sheetNames: [csvResult.sheetName] });
        }

        // CSV failed — try XLSX, find the matching sheet by name
        const xlsxResult = await tryXlsxAndListSheets();
        if (xlsxResult.error) {
          return res.status(500).json({ error: 'Failed to fetch Google Sheet: ' + xlsxResult.error + '. Make sure the sheet is shared as "Anyone with link can view".' });
        }

        const targetSheet = xlsxResult.sheetNames.includes(sheetName) ? sheetName : xlsxResult.sheetNames[0];
        const sheet = xlsxResult.workbook.Sheets[targetSheet];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        const headers = (data[0] || []).map(String);
        const rows = data.slice(1).filter(r => r.some(c => c != null && c !== ''));
        return res.json({ headers, rows, selectedSheet: targetSheet, sheetNames: xlsxResult.sheetNames });
      } else {
        // No specific sheet — try CSV first, fall back to XLSX for sheet list
        const csvResult = await tryCsvExport();
        if (!csvResult.error && csvResult.headers.length > 0) {
          return res.json({ headers: csvResult.headers, rows: csvResult.rows, selectedSheet: csvResult.sheetName, sheetNames: [csvResult.sheetName] });
        }

        // CSV failed or returned empty — get sheet names via XLSX
        const xlsxResult = await tryXlsxAndListSheets();
        if (xlsxResult.error) {
          return res.status(500).json({ error: 'Failed to fetch Google Sheet: ' + xlsxResult.error + '. Make sure the sheet is shared as "Anyone with link can view".' });
        }
        return res.json({ sheetNames: xlsxResult.sheetNames, selectedSheet: xlsxResult.sheetNames[0] });
      }
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch Google Sheet: ' + err.message });
    }
  })();
});

app.post('/api/import/execute', (req, res) => {
  try {
    const pid = getProfileId(req);
    const { rows, mapping, categoryTypes } = req.body;
    if (!rows || !mapping) return res.status(400).json({ error: 'Missing data' });

    const insert = db.prepare(`
      INSERT INTO transactions (description, amount, date, beneficiary, payor, category_id,
        currency, amount_local, means_of_payment, exchange_rate, type, notes, profile_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const getCat = db.prepare('SELECT id, color FROM categories WHERE LOWER(name) = LOWER(?) AND profile_id = ? LIMIT 1');
    const insertCat = db.prepare('INSERT INTO categories (name, type, color, icon, profile_id) VALUES (?, ?, ?, ?, ?)');

    // Diverse color palette for new categories
    const newCategoryColors = [
      '#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e',
      '#14b8a6','#06b6d4','#0ea5e9','#3b82f6','#6366f1','#8b5cf6',
      '#a855f7','#d946ef','#ec4899','#f43f5e','#64748b','#78716c'
    ];
    let colorIndex = 0;

    let imported = 0;
    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        const categoryId = (() => {
          const catName = row[mapping.category] || row[mapping.Category] || row[mapping.CATEGORY];
          if (!catName) return null;
          const existing = getCat.get(String(catName).trim(), pid);
          if (existing) return existing.id;
          // Reuse the same diverse color each time a new category is created (consistent within same import)
          const color = newCategoryColors[colorIndex % newCategoryColors.length];
          colorIndex++;
          const icon = 'tag';
          // Use user-specified type, or fallback to auto-detected default
          const catType = (categoryTypes && categoryTypes[catName]) || 'expense';
          const r = insertCat.run(String(catName).trim(), catType, color, icon, pid);
          return r.lastInsertRowid;
        })();

        const amountRaw = parseFloat(row[mapping.amount] || row[mapping.Amount] || row[mapping.AMOUNT]) || 0;
        const amount = Math.abs(amountRaw);
        const dateRaw = row[mapping.date] || row[mapping.Date] || row[mapping.DATE] || new Date().toISOString().split('T')[0];
        const currency = row[mapping.currency] || row[mapping.Currency] || row[mapping.CURRENCY] || 'USD';

        // Determine transaction type
        let validatedType;
        if (mapping.type) {
          const rawType = String(row[mapping.type] || '').trim().toLowerCase();
          if (['income', 'expense', 'transfer'].includes(rawType)) {
            validatedType = rawType;
          } else {
            // Auto-detect based on amount sign or common keywords
            validatedType = (amountRaw < 0 || rawType.includes('expense') || rawType.includes('debit') || rawType.includes('spent')) ? 'expense'
              : (amountRaw > 0 || rawType.includes('income') || rawType.includes('credit') || rawType.includes('received')) ? 'income'
              : 'expense';
          }
        } else {
          // No type mapped — auto-detect from amount sign
          validatedType = amountRaw < 0 ? 'expense' : (amountRaw > 0 ? 'income' : 'expense');
        }

        insert.run(
          row[mapping.description] || row[mapping.Description] || row[mapping.DESCRIPTION] || '',
          amount,
          parseDateString(dateRaw),
          row[mapping.beneficiary] || row[mapping.Beneficiary] || row[mapping.BENEFICIARY] || '',
          row[mapping.payor] || row[mapping.Payor] || row[mapping.PAYOR] || '',
          categoryId,
          currency,
          parseFloat(row[mapping.amount_local] || row[mapping.AmountLocal] || amount) || amount,
          row[mapping.means_of_payment] || row[mapping.MeansOfPayment] || row[mapping.MEANS_OF_PAYMENT] || '',
          parseFloat(row[mapping.exchange_rate] || row[mapping.ExchangeRate] || 1.0) || 1.0,
          validatedType,
          row[mapping.notes] || row[mapping.Notes] || row[mapping.NOTES] || '',
          pid
        );
        imported++;
      }
    });

    insertMany(rows);
    res.json({ imported, message: `Successfully imported ${imported} transactions` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================
// ACCOUNTS (per-profile)
// ========================
app.get('/api/accounts', (req, res) => {
  try {
    const pid = getProfileId(req);
    const accounts = db.prepare('SELECT * FROM accounts WHERE profile_id = ? ORDER BY type, name').all(pid);
    res.json(accounts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/accounts', (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, type, currency, balance, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const validTypes = ['giro', 'ib', 'savings'];
    const accountType = validTypes.includes(type) ? type : 'giro';
    const result = db.prepare(
      'INSERT INTO accounts (name, type, currency, balance, notes, profile_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name.trim(), accountType, currency || 'USD', parseFloat(balance) || 0, notes || '', pid);
    res.json({ id: result.lastInsertRowid, message: 'Account created' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/accounts/:id', (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, type, currency, balance, notes } = req.body;
    const existing = db.prepare('SELECT id FROM accounts WHERE id = ? AND profile_id = ?').get(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: 'Account not found' });
    const validTypes = ['giro', 'ib', 'savings'];
    const accountType = validTypes.includes(type) ? type : 'giro';
    db.prepare(
      'UPDATE accounts SET name = ?, type = ?, currency = ?, balance = ?, notes = ? WHERE id = ? AND profile_id = ?'
    ).run(name.trim(), accountType, currency || 'USD', parseFloat(balance) || 0, notes || '', req.params.id, pid);
    res.json({ message: 'Account updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/accounts/:id', (req, res) => {
  try {
    const pid = getProfileId(req);
    const existing = db.prepare('SELECT id FROM accounts WHERE id = ? AND profile_id = ?').get(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: 'Account not found' });
    db.prepare('DELETE FROM accounts WHERE id = ? AND profile_id = ?').run(req.params.id, pid);
    res.json({ message: 'Account deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================
// RECURRING TRANSACTIONS
// ========================
app.get('/api/recurring', (req, res) => {
  try {
    const pid = getProfileId(req);
    const rows = db.prepare(`
      SELECT r.*, c.name as category_name, c.color as category_color, c.type as category_type
      FROM recurring_transactions r
      LEFT JOIN categories c ON r.category_id = c.id
      WHERE r.profile_id = ? AND r.active = 1
      ORDER BY r.next_date ASC
    `).all(pid);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/recurring', (req, res) => {
  try {
    const pid = getProfileId(req);
    const { description, amount, type, category_id, frequency, day_of_month, next_date, notes } = req.body;
    const info = db.prepare(
      `INSERT INTO recurring_transactions (profile_id, description, amount, type, category_id, frequency, day_of_month, next_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(pid, description || '', amount, type || 'expense', category_id || null, frequency || 'monthly', day_of_month || null, next_date || null, notes || '');
    res.json({ id: info.lastInsertRowid });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/recurring/:id', (req, res) => {
  try {
    const pid = getProfileId(req);
    const existing = db.prepare('SELECT id FROM recurring_transactions WHERE id = ? AND profile_id = ?').get(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { description, amount, type, category_id, frequency, day_of_month, next_date, notes, active } = req.body;
    db.prepare(
      `UPDATE recurring_transactions SET description=?, amount=?, type=?, category_id=?, frequency=?, day_of_month=?, next_date=?, notes=?, active=? WHERE id=? AND profile_id=?`
    ).run(description ?? '', amount ?? 0, type ?? 'expense', category_id ?? null, frequency ?? 'monthly', day_of_month ?? null, next_date ?? null, notes ?? '', active ?? 1, req.params.id, pid);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/recurring/:id', (req, res) => {
  try {
    const pid = getProfileId(req);
    db.prepare('DELETE FROM recurring_transactions WHERE id = ? AND profile_id = ?').run(req.params.id, pid);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/recurring/:id/populate', (req, res) => {
  try {
    const pid = getProfileId(req);
    const r = db.prepare('SELECT * FROM recurring_transactions WHERE id = ? AND profile_id = ?').get(req.params.id, pid);
    if (!r) return res.status(404).json({ error: 'Not found' });
    const date = r.next_date || new Date().toISOString().split('T')[0];
    const info = db.prepare(
      `INSERT INTO transactions (profile_id, description, amount, type, category_id, date, notes, beneficiary, payor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(pid, r.description, r.amount, r.type, r.category_id, date, r.notes || '', '', '');

    // Advance next_date
    let next = new Date(date);
    if (r.frequency === 'monthly') next.setMonth(next.getMonth() + 1);
    else if (r.frequency === 'weekly') next.setDate(next.getDate() + 7);
    else if (r.frequency === 'yearly') next.setFullYear(next.getFullYear() + 1);
    const nextStr = next.toISOString().split('T')[0];
    db.prepare('UPDATE recurring_transactions SET next_date = ? WHERE id = ?').run(nextStr, req.params.id);

    res.json({ ok: true, transactionId: info.lastInsertRowid, next_date: nextStr });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================
// STATS (per-profile)
// ========================
app.get('/api/stats/monthly', (req, res) => {
  try {
    const pid = getProfileId(req);
    const { months = 24 } = req.query;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months) + 1);
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    // Use amount_local if available (for imported transactions), otherwise amount
    const rows = db.prepare(`
      SELECT strftime('%Y-%m', date) as month, type,
        SUM(COALESCE(amount_local, amount)) as total, COUNT(*) as count
      FROM transactions
      WHERE profile_id = ? AND date >= ? AND date <= ? AND type IN ('income', 'expense')
      GROUP BY month, type
      ORDER BY month
    `).all(pid, startStr, endStr);

    const map = {};
    for (const r of rows) {
      if (!map[r.month]) map[r.month] = { month: r.month, income: 0, expense: 0 };
      if (r.type === 'income') map[r.month].income = r.total;
      if (r.type === 'expense') map[r.month].expense = r.total;
      map[r.month].net = map[r.month].income - map[r.month].expense;
    }

    res.json(Object.values(map));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================
// ANALYTICS
// ========================
app.get('/api/analytics/year-range', (req, res) => {
  try {
    const pid = getProfileId(req);
    const range = db.prepare(`SELECT MIN(date) as min_date, MAX(date) as max_date FROM transactions WHERE profile_id = ?`).get(pid);
    const minYear = range.min_date ? parseInt(range.min_date.slice(0, 4)) : null;
    const maxYear = range.max_date ? parseInt(range.max_date.slice(0, 4)) : null;
    res.json({ minYear, maxYear });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================
// ANALYTICS - Stacked Category Trends
// ========================
app.get('/api/analytics/category-trends', (req, res) => {
  try {
    const pid = getProfileId(req);
    const year = req.query.year ? parseInt(req.query.year) : null;
    const month = req.query.month ? String(req.query.month).padStart(2, '0') : null;
    const period = req.query.period || 'day'; // day, week, month

    let startStr, endStr;
    if (year) {
      if (month) {
        // Specific year + month
        const lastDay = new Date(year, parseInt(month), 0).getDate();
        startStr = `${year}-${month}-01`;
        endStr = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
      } else {
        // Full year
        startStr = `${year}-01-01`;
        endStr = `${year}-12-31`;
      }
    } else {
      // All years — no date filter
      startStr = null;
      endStr = null;
    }

    // Get all expense transactions with categories - use amount_local if available
    const transactions = startStr
      ? db.prepare(`SELECT t.date, COALESCE(t.amount_local, t.amount) as amount, c.id as cat_id, c.name as cat_name, c.color as cat_color FROM transactions t JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id WHERE t.profile_id = ? AND t.type = 'expense' AND t.date >= ? AND t.date <= ? ORDER BY t.date`).all(pid, startStr, endStr)
      : db.prepare(`SELECT t.date, COALESCE(t.amount_local, t.amount) as amount, c.id as cat_id, c.name as cat_name, c.color as cat_color FROM transactions t JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id WHERE t.profile_id = ? AND t.type = 'expense' ORDER BY t.date`).all(pid);

    // Get all expense categories for this profile
    const categories = db.prepare(`
      SELECT id, name, color
      FROM categories
      WHERE profile_id = ? AND type = 'expense'
      ORDER BY name
    `).all(pid);

    // Generate time periods based on the period type
    const labels = [];
    const periodMap = new Map();
    const monthNamesFull = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    if (year && month) {
      // Specific month — show all days
      const lastDay = new Date(year, parseInt(month), 0).getDate();
      for (let d = 1; d <= lastDay; d++) {
        const dayStr = `${year}-${month}-${String(d).padStart(2, '0')}`;
        labels.push(`${monthNamesFull[parseInt(month) - 1]} ${d}`);
        periodMap.set(dayStr, labels.length - 1);
      }
    } else if (year) {
      // Full year view — always show 12 months
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      for (let m = 0; m < 12; m++) {
        labels.push(`${monthNames[m]} ${year}`);
        periodMap.set(`${year}-${String(m + 1).padStart(2, '0')}`, m);
      }
    } else if (period === 'day') {
      // Daily view - last 30 days
      for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const label = d.toISOString().split('T')[0];
        labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        periodMap.set(label, labels.length - 1);
      }
    } else if (period === 'week') {
      // Weekly view - group by week
      for (let i = 11; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - (i * 7));
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        const label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (!labels.includes(label)) {
          labels.push(label);
        }
      }
      // Map dates to week indices
      transactions.forEach(t => {
        const d = new Date(t.date);
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        const label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        periodMap.set(t.date, labels.indexOf(label));
      });
    } else {
      // All years — monthly buckets spanning actual data range
      const range = db.prepare(`SELECT MIN(date) as min_date, MAX(date) as max_date FROM transactions WHERE profile_id = ?`).get(pid);
      if (range.min_date && range.max_date) {
        const minY = parseInt(range.min_date.slice(0, 4));
        const maxY = parseInt(range.max_date.slice(0, 4));
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        let idx = 0;
        for (let y = minY; y <= maxY; y++) {
          const maxM = y === maxY ? parseInt(range.max_date.slice(5, 7)) : 12;
          const minM = y === minY ? parseInt(range.min_date.slice(5, 7)) : 1;
          for (let m = minM; m <= maxM; m++) {
            labels.push(`${monthNames[m - 1]} ${y}`);
            periodMap.set(`${y}-${String(m).padStart(2, '0')}`, idx++);
          }
        }
      }
      if (labels.length === 0) labels.push('No data');
    }

    // Initialize datasets for each category
    const catDataMap = {};
    categories.forEach(c => {
      catDataMap[c.id] = {
        category: c.name,
        color: c.color,
        data: new Array(labels.length).fill(0)
      };
    });

    // Aggregate transactions
    transactions.forEach(t => {
      let idx;
      if (year && month) {
        // Day-level for specific month
        idx = periodMap.get(t.date);
      } else if (year) {
        // Month-level for full year
        const monthKey = t.date.slice(0, 7);
        idx = periodMap.get(monthKey);
      } else if (period === 'day') {
        idx = periodMap.get(t.date);
      } else if (period === 'week') {
        idx = periodMap.get(t.date);
      } else {
        const monthKey = t.date.slice(0, 7);
        idx = periodMap.get(monthKey);
      }

      if (idx !== undefined && catDataMap[t.cat_id]) {
        catDataMap[t.cat_id].data[idx] += t.amount;
      }
    });

    // Convert to array and sort by total
    const datasets = Object.values(catDataMap)
      .filter(d => d.data.some(v => v > 0))
      .sort((a, b) => {
        const totalA = a.data.reduce((x, y) => x + y, 0);
        const totalB = b.data.reduce((x, y) => x + y, 0);
        return totalB - totalA;
      });

    res.json({ labels, datasets });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================
// RETIREMENT CALCULATOR
// ========================
app.post('/api/calculator/retire', (req, res) => {
  try {
    const { currentAge = 30, retirementAge = 65, currentSavings = 0, monthlyContribution = 0,
      annualReturn = 7, annualExpenses = 30000, withdrawalRate = 4, inflationRate = 2,
      country = 'default' } = req.body;

    // Cost-of-living multipliers by country
    const colMultipliers = {
      default: 1.0, usa: 1.2, uk: 1.0, germany: 0.95, japan: 0.85,
      portugal: 0.75, spain: 0.8, thailand: 0.5, mexico: 0.6, india: 0.4
    };
    const col = colMultipliers[country] || 1.0;
    const adjustedExpenses = annualExpenses * col;

    // FIRE number: how much needed to retire (25x rule, or 100 / withdrawalRate)
    const fireNumber = adjustedExpenses / (withdrawalRate / 100);

    // Project savings until retirement
    const monthsToRetirement = (retirementAge - currentAge) * 12;
    const monthlyReturn = annualReturn / 100 / 12;

    let savings = currentSavings;
    const timeline = [];
    for (let m = 0; m <= monthsToRetirement; m++) {
      if (m % 12 === 0) {
        timeline.push({ year: currentAge + m / 12, age: Math.round(currentAge + m / 12), savings: Math.round(savings) });
      }
      savings = savings * (1 + monthlyReturn) + monthlyContribution;
    }

    // FIRE date: find first month where savings >= fireNumber
    let fireMonth = null;
    let fireAge = null;
    savings = currentSavings;
    for (let m = 1; m <= monthsToRetirement * 2; m++) {
      savings = savings * (1 + monthlyReturn) + monthlyContribution;
      if (savings >= fireNumber && fireMonth === null) {
        fireMonth = m;
        fireAge = currentAge + m / 12;
      }
    }

    // Withdrawal phase projection (20 years)
    let retirementSavings = savings;
    const withdrawalTimeline = [];
    if (fireMonth !== null) {
      const annualWithdrawal = adjustedExpenses;
      for (let y = 0; y < 20; y++) {
        retirementSavings = retirementSavings * (1 + annualReturn / 100) - annualWithdrawal;
        withdrawalTimeline.push({ year: y + 1, savings: Math.max(0, Math.round(retirementSavings))), balance: Math.max(0, Math.round(retirementSavings)) });
      }
    }

    res.json({
      fireNumber: Math.round(fireNumber),
      fireAge: fireAge ? Math.round(fireAge * 10) / 10 : null,
      fireMonth,
      fireYear: fireAge ? Math.floor(fireAge) : null,
      savingsAtRetirement: Math.round(savings),
      timeline: timeline.filter(t => t.year % 5 === 0 || t.year === currentAge),
      withdrawalTimeline,
      scenarios: [
        { name: 'Conservative (4%)', return: 4, fireNumber: Math.round(adjustedExpenses / 0.04), fireAge: null },
        { name: 'Moderate (6%)', return: 6, fireNumber: Math.round(adjustedExpenses / 0.06), fireAge: null },
        { name: 'Optimistic (8%)', return: 8, fireNumber: Math.round(adjustedExpenses / 0.08), fireAge: null },
      ].map(s => {
        let m = currentSavings;
        let fa = null;
        for (let mo = 1; mo <= monthsToRetirement * 2; mo++) {
          m = m * (1 + s.return / 100 / 12) + monthlyContribution;
          if (m >= s.fireNumber && fa === null) { fa = currentAge + mo / 12; }
        }
        return { ...s, fireAge: fa ? Math.round(fa * 10) / 10 : null };
      }),
      inputs: { currentAge, retirementAge, currentSavings, monthlyContribution, annualReturn, adjustedExpenses, withdrawalRate, country }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Catch-all: serve index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Finance Manager running on port ${PORT}`);
});
