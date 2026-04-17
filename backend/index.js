const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const bcrypt = require("bcrypt");
const SQLiteStore = require("connect-sqlite3")(session);
const db = require("./database");
const loanCalc = require("./models/loanCalculator");
const XLSX = require("xlsx");
const PDFDocument = require("pdfkit");

const app = express();
const PORT = process.env.PORT || 3847;

// Ensure directories exist
const uploadsDir = path.join(__dirname, "..", "assets");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Date parsing utility - handles DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD
function parseDateString(dateStr) {
  if (!dateStr) return new Date().toISOString().split("T")[0];
  if (typeof dateStr === "number") {
    // Excel date code
    const d = XLSX.SSF.parse_date_code(dateStr);
    if (d) return new Date(d.y, d.m - 1, d.d).toISOString().split("T")[0];
  }
  const s = String(dateStr).trim();
  // Try DD/MM/YYYY or DD-MM-YYYY (European)
  const euMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (euMatch) {
    const [, d, m, y] = euMatch;
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d))
      .toISOString()
      .split("T")[0];
  }
  // Try MM/DD/YYYY (US) or ISO
  const date = new Date(s);
  if (!isNaN(date.getTime())) return date.toISOString().split("T")[0];
  return new Date().toISOString().split("T")[0];
}

// Session secret: require env var in production, use crypto random in dev
const SESSION_SECRET = process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('WARNING: Using randomly generated SESSION_SECRET. Set SESSION_SECRET env var for production!');
}

// Session middleware
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // Set to true if using HTTPS
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
    store: new SQLiteStore({
      db: "sessions.db",
      dir: path.join(__dirname, "..", "db"),
    }),
  }),
);

// ==================== RATE LIMITING ====================
// API rate limiter: 100 requests per minute per IP+profile
const apiRateLimiter = (() => {
  const store = global.__rateLimitStore || new Map();
  if (process.env.NODE_ENV === 'test') global.__rateLimitStore = store;
  const WINDOW_MS = 60 * 1000; // 1 minute
  const MAX_REQUESTS = 100;

  setInterval(() => {
    const now = Date.now();
    for (const [key, data] of store.entries()) {
      if (now > data.resetTime) store.delete(key);
    }
  }, WINDOW_MS);

  return (req, res, next) => {
    // Always set rate limit headers so tests that check them pass
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const profileId = parseInt(req.headers["x-profile-id"] || req.query.profile_id || 1);
    const key = `ip:${ip}:profile:${profileId}`;
    const now = Date.now();
    let data = store.get(key);

    if (!data || now > data.resetTime) {
      data = { count: 0, resetTime: now + WINDOW_MS };
      store.set(key, data);
    }

    data.count++;
    const remaining = MAX_REQUESTS - data.count;
    res.setHeader('X-RateLimit-Limit', String(MAX_REQUESTS));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, remaining)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(data.resetTime / 1000)));

    // In test mode, skip rate limit blocking (tests use X-Skip-RateLimit for isolation)
    if (process.env.NODE_ENV === 'test') return next();

    if (data.count > MAX_REQUESTS) {
      const retryAfter = Math.ceil((data.resetTime - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too many requests. Please wait before trying again.',
        retryAfter
      });
    }
    next();
  };
})();

// Auth rate limiter: 10 login attempts per 15 minutes per IP
const authRateLimiter = (() => {
  const store = (process.env.NODE_ENV === 'test' && global.__authRateLimitStore)
    || new Map();
  if (process.env.NODE_ENV === 'test') global.__authRateLimitStore = store;
  const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  const MAX_REQUESTS = 10; // Stricter for auth

  setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of store.entries()) {
      if (now > data.resetTime) store.delete(ip);
    }
  }, WINDOW_MS);

  return (req, res, next) => {
    // Always set rate limit headers so tests that check them pass
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    let data = store.get(ip);

    if (!data || now > data.resetTime) {
      data = { count: 0, resetTime: now + WINDOW_MS };
      store.set(ip, data);
    }

    data.count++;
    const remaining = MAX_REQUESTS - data.count;
    res.setHeader('X-RateLimit-Limit', String(MAX_REQUESTS));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, remaining)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(data.resetTime / 1000)));

    // In test mode, skip rate limit blocking
    if (process.env.NODE_ENV === 'test') return next();

    if (data.count > MAX_REQUESTS) {
      const retryAfter = Math.ceil((data.resetTime - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too many login attempts. Please wait before trying again.',
        retryAfter
      });
    }
    next();
  };
})();

// ==================== MIDDLEWARE ====================
// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "..", "frontend")));

// Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Helper: get profile ID from request (header first, then query param, then 1)
function getProfileId(req) {
  return parseInt(req.headers["x-profile-id"] || req.query.profile_id || 1);
}

// Helper: get profile IDs from request (supports JSON array via header)
function getProfileIds(req) {
  const header = req.headers["x-profile-ids"];
  if (header) {
    try {
      const parsed = JSON.parse(header);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(id => parseInt(id)).filter(id => !isNaN(id));
    } catch (e) {
      // single ID fallback
    }
  }
  // Fallback to legacy single X-Profile-Id
  return [getProfileId(req)];
}

// Helper: wrap all data queries with profile_id
function profileWhere(tableAlias = "t", extra = "") {
  return `${tableAlias}.profile_id = ?${extra ? " AND " + extra : ""}`;
}

// Helper: build profile IN clause for multiple profiles
function profileInClause(tableAlias = "t", extra = "") {
  const placeholder = extra ? `${tableAlias}.profile_id IN (?) AND ${extra}` : `${tableAlias}.profile_id IN (?)`;
  return placeholder;
}

// Helper: wrap query params with profile IDs for IN clause
function profileParams(pids, extra = []) {
  return [...pids, ...extra];
}

// ========================
// AUTH
// ========================
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.post("/api/auth/login", authRateLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    const user = db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(username);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ ok: true, username: user.username, isLoggedIn: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/logout", apiRateLimiter, (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    res.json({ ok: true });
  });
});

app.get("/api/auth/me", apiRateLimiter, requireAuth, (req, res) => {
  res.json({ userId: req.session.userId, username: req.session.username });
});
// ========================
app.get("/api/profiles", apiRateLimiter, (req, res) => {
  try {
    let profiles;
    if (req.session.userId) {
      // Logged in: return user's profiles plus ExampleProfile
      profiles = db
        .prepare(
          "SELECT * FROM profiles WHERE user_id = ? OR id = 1 ORDER BY id",
        )
        .all(req.session.userId);
    } else {
      // Not logged in: return only ExampleProfile
      profiles = db.prepare("SELECT * FROM profiles WHERE id = 1").all();
    }
    // Include transaction counts
    const counts = {};
    const txCount = db
      .prepare(
        "SELECT profile_id, COUNT(*) as c FROM transactions GROUP BY profile_id",
      )
      .all();
    for (const r of txCount) counts[r.profile_id] = r.c;
    const result = profiles.map((p) => ({
      ...p,
      transaction_count: counts[p.id] || 0,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/profiles", apiRateLimiter, (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { name } = req.body;
    if (!name || !name.trim())
      return res.status(400).json({ error: "Name is required" });
    // Check name uniqueness across all profiles
    const existing = db
      .prepare("SELECT id FROM profiles WHERE LOWER(name) = LOWER(?)")
      .get(name.trim());
    if (existing)
      return res
        .status(400)
        .json({ error: "A profile with this name already exists" });
    db.prepare("INSERT INTO profiles (name, user_id) VALUES (?, ?)").run(
      name.trim(),
      req.session.userId,
    );
    res.json({
      id: db.prepare("SELECT last_insert_rowid() as id").get().id,
      name: name.trim(),
      transaction_count: 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/profiles/:id", apiRateLimiter, (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const pid = parseInt(req.params.id);
    if (pid === 1)
      return res
        .status(400)
        .json({ error: "Cannot delete the default profile" });
    // Only allow deleting profiles owned by this user
    const profile = db.prepare("SELECT * FROM profiles WHERE id = ?").get(pid);
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    if (profile.user_id !== req.session.userId) {
      return res
        .status(403)
        .json({ error: "Cannot delete another user's profile" });
    }
    const count = db.prepare("SELECT COUNT(*) as c FROM profiles").get();
    if (count.c <= 1)
      return res.status(400).json({ error: "Cannot delete the last profile" });
    // Delete all data for this profile (cascades via foreign keys)
    db.prepare("DELETE FROM transactions WHERE profile_id = ?").run(pid);
    db.prepare("DELETE FROM budgets WHERE profile_id = ?").run(pid);
    db.prepare("DELETE FROM categories WHERE profile_id = ?").run(pid);
    db.prepare("DELETE FROM loans WHERE profile_id = ?").run(pid);
    db.prepare("DELETE FROM profiles WHERE id = ?").run(pid);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/profile/data", apiRateLimiter, (req, res) => {
  // Nuke all data for the current profile but keep the profile itself
  try {
    const pid = getProfileId(req);
    db.prepare(
      "DELETE FROM loan_prepayments WHERE loan_id IN (SELECT id FROM loans WHERE profile_id = ?)",
    ).run(pid);
    db.prepare(
      "DELETE FROM loan_rate_periods WHERE loan_id IN (SELECT id FROM loans WHERE profile_id = ?)",
    ).run(pid);
    db.prepare("DELETE FROM transactions WHERE profile_id = ?").run(pid);
    db.prepare("DELETE FROM budgets WHERE profile_id = ?").run(pid);
    db.prepare("DELETE FROM loans WHERE profile_id = ?").run(pid);
    // Reset categories to defaults
    db.prepare("DELETE FROM categories WHERE profile_id = ?").run(pid);
    const defaults = [
      ["Housing", "#ef4444", "home", "expense"],
      ["Food & Dining", "#f97316", "utensils", "expense"],
      ["Transportation", "#eab308", "car", "expense"],
      ["Healthcare", "#22c55e", "heart", "expense"],
      ["Entertainment", "#06b6d4", "film", "expense"],
      ["Shopping", "#8b5cf6", "shopping-bag", "expense"],
      ["Utilities", "#64748b", "zap", "expense"],
      ["Education", "#ec4899", "book", "expense"],
      ["Personal Care", "#f43f5e", "smile", "expense"],
      ["Travel", "#14b8a6", "plane", "expense"],
      ["Salary", "#10b981", "briefcase", "income"],
      ["Freelance", "#3b82f6", "laptop", "income"],
      ["Investments", "#6366f1", "trending-up", "income"],
      ["Other Income", "#8b5cf6", "plus-circle", "income"],
    ];
    const insertCat = db.prepare(
      "INSERT INTO categories (name, color, icon, type, profile_id) VALUES (?, ?, ?, ?, ?)",
    );
    for (const c of defaults) insertCat.run(...c, pid);
    res.json({
      ok: true,
      message:
        "All profile data has been deleted and categories reset to defaults",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// SETTINGS (per-profile)
// ========================
app.get("/api/settings", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const rows = db
      .prepare(
        "SELECT key, value FROM settings WHERE profile_id = ? OR profile_id IS NULL",
      )
      .all(pid);
    const settings = {};
    for (const r of rows) settings[r.key] = r.value;
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/settings", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const upsert = db.prepare(
      "INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES (?, ?, ?)",
    );
    const entries = Object.entries(req.body);
    for (const [k, v] of entries) upsert.run(k, String(v), pid);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// CATEGORIES (per-profile)
// ========================
app.get("/api/categories", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const rows = db
      .prepare(
        `
      SELECT c.id, c.name, c.color, c.icon, c.type, c.parent_id, c.tax_deductible, c.created_at, p.name as parent_name
      FROM categories c
      LEFT JOIN categories p ON c.parent_id = p.id AND p.profile_id = c.profile_id
      WHERE c.profile_id = ?
      ORDER BY c.type, c.name
    `,
      )
      .all(pid);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/categories", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, color, icon, type, parent_id, tax_deductible } = req.body;
    const info = db
      .prepare(
        "INSERT INTO categories (name, color, icon, type, parent_id, tax_deductible, profile_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        name,
        color || "#6b7280",
        icon || "tag",
        type || "expense",
        parent_id || null,
        tax_deductible ? 1 : 0,
        pid,
      );
    res.json({
      id: info.lastInsertRowid,
      name,
      color: color || "#6b7280",
      icon: icon || "tag",
      type: type || "expense",
      parent_id,
      profile_id: pid,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/categories/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, color, icon, type, parent_id, tax_deductible } = req.body;
    const result = db
      .prepare(
        "UPDATE categories SET name=?, color=?, icon=?, type=?, parent_id=?, tax_deductible=? WHERE id=? AND profile_id=?",
      )
      .run(
        name,
        color,
        icon || "tag",
        type,
        parent_id || null,
        tax_deductible ? 1 : 0,
        req.params.id,
        pid,
      );
    if (result.changes === 0)
      return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/categories/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const result = db
      .prepare("DELETE FROM categories WHERE id=? AND profile_id=?")
      .run(req.params.id, pid);
    if (result.changes === 0)
      return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/categories", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    db.prepare("DELETE FROM categories WHERE profile_id=?").run(pid);
    res.json({ ok: true, message: "All categories deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// TAGS (per-profile)
// ========================
app.get("/api/tags", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const rows = db
      .prepare("SELECT id, name, color, created_at FROM tags WHERE profile_id = ? ORDER BY name")
      .all(pid);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tags", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, color } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Tag name is required' });
    }
    const info = db
      .prepare("INSERT INTO tags (name, color, profile_id) VALUES (?, ?, ?)")
      .run(name.trim(), color || '#6b7280', pid);
    res.json({ id: info.lastInsertRowid, name: name.trim(), color: color || '#6b7280' });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: 'Tag already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/tags/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, color } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Tag name is required' });
    }
    const result = db
      .prepare("UPDATE tags SET name = ?, color = ? WHERE id = ? AND profile_id = ?")
      .run(name.trim(), color || '#6b7280', req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: 'Tag name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/tags/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const result = db
      .prepare("DELETE FROM tags WHERE id = ? AND profile_id = ?")
      .run(req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add tags to a transaction
app.post("/api/transactions/:id/tags", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { tagIds } = req.body;
    if (!Array.isArray(tagIds)) {
      return res.status(400).json({ error: 'tagIds must be an array' });
    }
    // Verify transaction belongs to profile
    const tx = db.prepare("SELECT id FROM transactions WHERE id = ? AND profile_id = ?").get(req.params.id, pid);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    // Replace existing tags with new ones
    db.prepare("DELETE FROM transaction_tags WHERE transaction_id = ?").run(req.params.id);
    const insertStmt = db.prepare("INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)");
    for (const tagId of tagIds) {
      insertStmt.run(req.params.id, tagId);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get tags for a transaction
app.get("/api/transactions/:id/tags", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    // Verify transaction belongs to profile
    const tx = db.prepare("SELECT id FROM transactions WHERE id = ? AND profile_id = ?").get(req.params.id, pid);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const tags = db
      .prepare(`
        SELECT t.id, t.name, t.color
        FROM tags t
        JOIN transaction_tags tt ON t.id = tt.tag_id
        WHERE tt.transaction_id = ? AND t.profile_id = ?
        ORDER BY t.name
      `)
      .all(req.params.id, pid);
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search transactions by tag
app.get("/api/transactions/by-tag/:tagId", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { startDate, endDate, category_ids, type, limit, offset } = req.query;

    let sql = `
      SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      JOIN transaction_tags tt ON t.id = tt.transaction_id
      WHERE t.profile_id = ? AND tt.tag_id = ?
    `;
    const params = [pid, req.params.tagId];

    if (startDate) { sql += " AND t.date >= ?"; params.push(startDate); }
    if (endDate) { sql += " AND t.date <= ?"; params.push(endDate); }
    if (category_ids) {
      const ids = category_ids.split(',').map((id) => parseInt(id)).filter((id) => !isNaN(id));
      if (ids.length > 0) {
        sql += ` AND t.category_id IN (${ids.map(() => '?').join(',')})`;
        params.push(...ids);
      }
    }
    if (type) { sql += " AND t.type = ?"; params.push(type); }

    sql += " ORDER BY t.date DESC, t.id DESC";
    if (limit) sql += ` LIMIT ${parseInt(limit)}`;
    if (offset) sql += ` OFFSET ${parseInt(offset)}`;

    const rows = db.prepare(sql).all(...params);
    res.json({ rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// TRANSACTIONS (per-profile, multi-profile for combined view)
// ========================
app.get("/api/transactions", apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const {
      startDate,
      endDate,
      category_ids,
      type,
      search,
      limit,
      offset,
      sort,
      order,
    } = req.query;
    let sql = `
      SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause})
    `;
    const params = [...pids];
    if (startDate) {
      sql += " AND t.date >= ?";
      params.push(startDate);
    }
    if (endDate) {
      sql += " AND t.date <= ?";
      params.push(endDate);
    }
    if (category_ids) {
      const ids = category_ids.split(',').map((id) => parseInt(id)).filter((id) => !isNaN(id));
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        sql += ` AND t.category_id IN (${placeholders})`;
        params.push(...ids);
      }
    }
    if (type) {
      sql += " AND t.type = ?";
      params.push(type);
    }
    if (search) {
      sql +=
        " AND (t.description LIKE ? OR t.beneficiary LIKE ? OR t.payor LIKE ? OR t.notes LIKE ?)";
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (sort) {
      const sortCol = ['date', 'amount', 'description', 'category_name', 'type', 'beneficiary', 'payor'].includes(sort) ? (sort === 'category_name' ? 'c.name' : `t.${sort}`) : 't.date';
      const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
      sql += ` ORDER BY ${sortCol} ${sortOrder}, t.id ${sortOrder}`;
    } else {
      sql += ` ORDER BY t.date DESC, t.id DESC`;
    }
    if (limit) sql += ` LIMIT ${parseInt(limit)}`;
    if (offset) sql += ` OFFSET ${parseInt(offset)}`;
    const rows = db.prepare(sql).all(...params);

    // Count total
    let countSql = `SELECT COUNT(*) as c FROM transactions t WHERE t.profile_id IN (${inClause})`;
    const cparams = [...pids];
    if (startDate) {
      countSql += " AND t.date >= ?";
      cparams.push(startDate);
    }
    if (endDate) {
      countSql += " AND t.date <= ?";
      cparams.push(endDate);
    }
    if (category_ids) {
      const ids = category_ids.split(',').map((id) => parseInt(id)).filter((id) => !isNaN(id));
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        countSql += ` AND t.category_id IN (${placeholders})`;
        cparams.push(...ids);
      }
    }
    if (type) {
      countSql += " AND t.type = ?";
      cparams.push(type);
    }
    if (search) {
      countSql +=
        " AND (t.description LIKE ? OR t.beneficiary LIKE ? OR t.payor LIKE ? OR t.notes LIKE ?)";
      cparams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    const total = db.prepare(countSql).get(...cparams).c;
    res.json({ rows, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/transactions/summary", apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const { startDate, endDate, category_ids, type, search } = req.query;

    let sql = `
      SELECT
        SUM(t.amount) as total_amount,
        SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END) as total_expense,
        SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END) as total_income,
        COUNT(*) as count
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause})
    `;
    const params = [...pids];

    if (startDate) {
      sql += " AND t.date >= ?";
      params.push(startDate);
    }
    if (endDate) {
      sql += " AND t.date <= ?";
      params.push(endDate);
    }
    if (category_ids) {
      const ids = category_ids.split(',').map((id) => parseInt(id)).filter((id) => !isNaN(id));
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        sql += ` AND t.category_id IN (${placeholders})`;
        params.push(...ids);
      }
    }
    if (type) {
      sql += " AND t.type = ?";
      params.push(type);
    }
    if (search) {
      sql += " AND (t.description LIKE ? OR t.beneficiary LIKE ? OR t.payor LIKE ? OR t.notes LIKE ?)";
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const result = db.prepare(sql).get(...params);
    res.json({
      total_amount: result.total_amount || 0,
      total_expense: result.total_expense || 0,
      total_income: result.total_income || 0,
      count: result.count || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/transactions", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const {
      description,
      amount,
      date,
      beneficiary,
      payor,
      category_id,
      currency,
      amount_local,
      means_of_payment,
      exchange_rate,
      type,
      notes,
    } = req.body;

    // Validate required fields
    if (!description || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ error: 'Description is required' });
    }
    if (amount === undefined || amount === null || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'A valid date is required' });
    }

    const info = db
      .prepare(
        `
      INSERT INTO transactions (description, amount, date, beneficiary, payor, category_id,
        currency, amount_local, means_of_payment, exchange_rate, type, notes, profile_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        description,
        amount,
        date,
        beneficiary || "",
        payor || "",
        category_id || null,
        currency || "USD",
        amount_local ?? amount,
        means_of_payment || "",
        exchange_rate || 1.0,
        type || "expense",
        notes || "",
        pid,
      );
    res.json({ id: info.lastInsertRowid, ...req.body, profile_id: pid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single transaction by ID
app.get("/api/transactions/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { id } = req.params;

    const tx = db.prepare(`
      SELECT t.*, c.name as category_name, c.color as category_color
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.id = ? AND t.profile_id = ?
    `).get(id, pid);

    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json(tx);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk update: PUT /api/transactions/bulk
app.put("/api/transactions/bulk", apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const { ids, action, data } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "No transaction IDs provided" });
    }
    if (ids.length > 1000) {
      return res.status(400).json({ error: "Cannot update more than 1000 transactions at once" });
    }

    const placeholders = ids.map(() => '?').join(',');
    const authParams = [...pids, ...ids];

    if (action === 'delete') {
      const stmt = db.prepare(`DELETE FROM transactions WHERE profile_id IN (${inClause}) AND id IN (${placeholders})`);
      const result = stmt.run(...authParams);
      return res.json({ ok: true, deleted: result.changes });
    }

    if (action === 'update') {
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: "No update data provided" });
      }

      const allowedFields = ['category_id', 'type', 'description', 'beneficiary', 'payor', 'notes'];
      const updates = [];
      const updateParams = [];

      for (const field of allowedFields) {
        if (data.hasOwnProperty(field)) {
          if (field === 'category_id') {
            updates.push('category_id = ?');
            updateParams.push(data.category_id === null || data.category_id === '' ? null : parseInt(data.category_id));
          } else if (field === 'type') {
            if (!['income', 'expense', 'transfer'].includes(data.type)) {
              return res.status(400).json({ error: "Invalid type. Must be income, expense, or transfer" });
            }
            updates.push('type = ?');
            updateParams.push(data.type);
          } else {
            updates.push(`${field} = ?`);
            updateParams.push(data[field] || '');
          }
        }
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      updates.push("updated_at = datetime('now')");
      updateParams.push(...pids, ...ids);

      const stmt = db.prepare(`UPDATE transactions SET ${updates.join(', ')} WHERE profile_id IN (${inClause}) AND id IN (${placeholders})`);
      const result = stmt.run(...updateParams);
      return res.json({ ok: true, updated: result.changes });
    }

    return res.status(400).json({ error: "Invalid action. Must be 'delete' or 'update'" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/transactions/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const {
      description,
      amount,
      date,
      beneficiary,
      payor,
      category_id,
      currency,
      amount_local,
      means_of_payment,
      exchange_rate,
      type,
      notes,
      reconciled,
    } = req.body;

    // Validate required fields
    if (!description || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ error: 'Description is required' });
    }
    if (amount === undefined || amount === null || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'A valid date is required' });
    }

    const result = db
      .prepare(
        `
      UPDATE transactions SET description=?, amount=?, date=?, beneficiary=?, payor=?,
        category_id=?, currency=?, amount_local=?, means_of_payment=?, exchange_rate=?,
        type=?, notes=?, reconciled=?, reconciled_at= CASE WHEN ? = 1 THEN datetime('now') ELSE reconciled_at END, updated_at=datetime('now')
      WHERE id=? AND profile_id=?
    `,
      )
      .run(
        description,
        amount,
        date,
        beneficiary || "",
        payor || "",
        category_id || null,
        currency,
        amount_local ?? amount,
        means_of_payment || "",
        exchange_rate || 1.0,
        type,
        notes || "",
        reconciled ? 1 : 0,
        reconciled ? 1 : 0,
        req.params.id,
        pid,
      );
    if (result.changes === 0)
      return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/transactions/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const result = db
      .prepare("DELETE FROM transactions WHERE id=? AND profile_id=?")
      .run(req.params.id, pid);
    if (result.changes === 0)
      return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/transactions", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    db.prepare("DELETE FROM transactions WHERE profile_id=?").run(pid);
    res.json({ ok: true, message: "All transactions deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// RECONCILIATION (per-profile)
// ========================
// Toggle reconciled status for a single transaction
app.patch("/api/transactions/:id/reconcile", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const existing = db
      .prepare("SELECT id, reconciled FROM transactions WHERE id = ? AND profile_id = ?")
      .get(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: "Transaction not found" });

    const newStatus = existing.reconciled ? 0 : 1;
    db.prepare(
      "UPDATE transactions SET reconciled = ?, reconciled_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END WHERE id = ? AND profile_id = ?"
    ).run(newStatus, newStatus, req.params.id, pid);
    res.json({ id: parseInt(req.params.id), reconciled: newStatus, reconciled_at: newStatus ? new Date().toISOString() : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk reconcile transactions by date range
app.post("/api/transactions/reconcile/bulk", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { startDate, endDate } = req.body;
    if (!startDate || !endDate) return res.status(400).json({ error: "startDate and endDate are required" });

    const result = db.prepare(
      `UPDATE transactions SET reconciled = 1, reconciled_at = datetime('now')
       WHERE profile_id = ? AND date >= ? AND date <= ? AND reconciled = 0`
    ).run(pid, startDate, endDate);
    res.json({ message: `${result.changes} transactions reconciled`, count: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get reconciliation status summary
app.get("/api/transactions/reconcile/summary", apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const summary = db.prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN reconciled = 1 THEN 1 ELSE 0 END) as reconciled_count,
        SUM(CASE WHEN reconciled = 0 OR reconciled IS NULL THEN 1 ELSE 0 END) as unreconciled_count,
        SUM(CASE WHEN reconciled = 0 OR reconciled IS NULL THEN amount ELSE 0 END) as unreconciled_total
       FROM transactions WHERE profile_id IN (${inClause})`
    ).get(...pids);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// BUDGETS (per-profile, multi-profile for combined view)
// ========================
app.get("/api/budgets", apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const rows = db
      .prepare(
        `
      SELECT b.*, c.name as category_name, c.color as category_color, c.icon as category_icon
      FROM budgets b
      JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
      WHERE b.profile_id IN (${inClause})
      ORDER BY b.id DESC
    `,
      )
      .all(...pids);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/budgets", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { category_id, amount, period, start_date, end_date } = req.body;
    const info = db
      .prepare(
        "INSERT INTO budgets (category_id, amount, period, start_date, end_date, profile_id) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        category_id,
        amount,
        period || "monthly",
        start_date,
        end_date || null,
        pid,
      );
    res.json({ id: info.lastInsertRowid, ...req.body, profile_id: pid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/budgets/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { category_id, amount, period, start_date, end_date } = req.body;
    const result = db
      .prepare(
        "UPDATE budgets SET category_id=?, amount=?, period=?, start_date=?, end_date=? WHERE id=? AND profile_id=?",
      )
      .run(
        category_id,
        amount,
        period,
        start_date,
        end_date || null,
        req.params.id,
        pid,
      );
    if (result.changes === 0)
      return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/budgets/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const result = db
      .prepare("DELETE FROM budgets WHERE id=? AND profile_id=?")
      .run(req.params.id, pid);
    if (result.changes === 0)
      return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/budgets/summary", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { year, month } = req.query;
    const y = year || new Date().getFullYear();
    const m = month || new Date().getMonth() + 1;
    const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    const endDate = `${nextY}-${String(nextM).padStart(2, "0")}-01`;

    const budgets = db
      .prepare(
        `
      SELECT b.*, c.name as category_name, c.color as category_color, c.icon as category_icon, c.type
      FROM budgets b
      JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
      WHERE b.profile_id = ? AND (b.end_date IS NULL OR b.end_date >= ?)
    `,
      )
      .all(pid, startDate);

    // Use amount_local if available (for imported transactions), otherwise amount
    const spent = db
      .prepare(
        `
      SELECT category_id, SUM(COALESCE(amount_local, amount)) as total
      FROM transactions
      WHERE profile_id = ? AND date >= ? AND date < ? AND type = 'expense' AND category_id IS NOT NULL
      GROUP BY category_id
    `,
      )
      .all(pid, startDate, endDate);

    const spentMap = {};
    for (const s of spent) spentMap[s.category_id] = s.total;

    const summary = budgets.map((b) => ({
      ...b,
      spent: spentMap[b.category_id] || 0,
      remaining: b.amount - (spentMap[b.category_id] || 0),
      percentage:
        b.amount > 0
          ? Math.min(100, ((spentMap[b.category_id] || 0) / b.amount) * 100)
          : 0,
    }));

    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// SAVINGS GOALS
// ========================
app.get("/api/savings-goals", apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT * FROM savings_goals WHERE profile_id IN (${inClause}) ORDER BY created_at DESC`,
      )
      .all(...pids);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/savings-goals", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, target_amount, current_amount, deadline, notes } = req.body;
    if (!name || target_amount == null) {
      return res.status(400).json({ error: "Name and target amount are required" });
    }
    const info = db
      .prepare(
        "INSERT INTO savings_goals (profile_id, name, target_amount, current_amount, deadline, notes) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        pid,
        name,
        target_amount,
        current_amount || 0,
        deadline || null,
        notes || "",
      );
    res.json({ id: info.lastInsertRowid, name, target_amount, current_amount: current_amount || 0, deadline, notes, profile_id: pid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/savings-goals/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, target_amount, current_amount, deadline, notes } = req.body;
    const result = db
      .prepare(
        "UPDATE savings_goals SET name=?, target_amount=?, current_amount=?, deadline=?, notes=? WHERE id=? AND profile_id=?",
      )
      .run(
        name,
        target_amount,
        current_amount,
        deadline || null,
        notes || "",
        req.params.id,
        pid,
      );
    if (result.changes === 0)
      return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/savings-goals/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const result = db
      .prepare("DELETE FROM savings_goals WHERE id=? AND profile_id=?")
      .run(req.params.id, pid);
    if (result.changes === 0)
      return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// LOANS (per-profile)
// ========================
app.get("/api/loans", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const rows = db
      .prepare(
        `
      SELECT l.*,
        (SELECT SUM(amount) FROM loan_prepayments WHERE loan_id = l.id) as total_prepaid,
        (SELECT COUNT(*) FROM loan_prepayments WHERE loan_id = l.id) as prepayment_count
      FROM loans l
      WHERE l.profile_id = ?
      ORDER BY l.created_at DESC
    `,
      )
      .all(pid);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/loans", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const {
      name,
      principal,
      interest_rate,
      start_date,
      term_months,
      rate_periods,
    } = req.body;
    const info = db
      .prepare(
        "INSERT INTO loans (name, principal, interest_rate, start_date, term_months, profile_id) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(name, principal, interest_rate || 5.0, start_date, term_months, pid);
    const loanId = info.lastInsertRowid;

    if (rate_periods && rate_periods.length > 0) {
      const insert = db.prepare(
        "INSERT INTO loan_rate_periods (loan_id, rate, start_month, end_month) VALUES (?, ?, ?, ?)",
      );
      for (const rp of rate_periods) {
        insert.run(loanId, rp.rate, rp.start_month, rp.end_month || null);
      }
    } else if (interest_rate !== undefined) {
      db.prepare(
        "INSERT INTO loan_rate_periods (loan_id, rate, start_month, end_month) VALUES (?, ?, ?, ?)",
      ).run(loanId, interest_rate, 1, null);
    }

    res.json({
      id: loanId,
      name,
      principal,
      interest_rate,
      start_date,
      term_months,
      profile_id: pid,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/loans/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db
      .prepare("SELECT * FROM loans WHERE id=? AND profile_id=?")
      .get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: "Not found" });
    loan.rate_periods = db
      .prepare(
        "SELECT * FROM loan_rate_periods WHERE loan_id=? ORDER BY start_month",
      )
      .all(req.params.id);
    loan.prepayments = db
      .prepare("SELECT * FROM loan_prepayments WHERE loan_id=? ORDER BY month")
      .all(req.params.id);
    res.json(loan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/loans/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const {
      name,
      principal,
      interest_rate,
      start_date,
      term_months,
      rate_periods,
    } = req.body;
    const result = db
      .prepare(
        "UPDATE loans SET name=?, principal=?, interest_rate=?, start_date=?, term_months=? WHERE id=? AND profile_id=?",
      )
      .run(
        name,
        principal,
        interest_rate || 5.0,
        start_date,
        term_months,
        req.params.id,
        pid,
      );
    if (result.changes === 0)
      return res.status(404).json({ error: "Not found" });

    if (rate_periods !== undefined) {
      db.prepare("DELETE FROM loan_rate_periods WHERE loan_id=?").run(
        req.params.id,
      );
      if (rate_periods.length > 0) {
        const insert = db.prepare(
          "INSERT INTO loan_rate_periods (loan_id, rate, start_month, end_month) VALUES (?, ?, ?, ?)",
        );
        for (const rp of rate_periods) {
          insert.run(
            req.params.id,
            rp.rate,
            rp.start_month,
            rp.end_month || null,
          );
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/loans/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const result = db
      .prepare("DELETE FROM loans WHERE id=? AND profile_id=?")
      .run(req.params.id, pid);
    if (result.changes === 0)
      return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rate periods CRUD
app.post("/api/loans/:id/rates", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db
      .prepare("SELECT id FROM loans WHERE id=? AND profile_id=?")
      .get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: "Loan not found" });
    const { rate, start_month, end_month } = req.body;
    const info = db
      .prepare(
        "INSERT INTO loan_rate_periods (loan_id, rate, start_month, end_month) VALUES (?, ?, ?, ?)",
      )
      .run(req.params.id, rate, start_month, end_month || null);
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/loans/:id/rates/:rateId", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db
      .prepare("SELECT id FROM loans WHERE id=? AND profile_id=?")
      .get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: "Loan not found" });
    const { rate, start_month, end_month } = req.body;
    db.prepare(
      "UPDATE loan_rate_periods SET rate=?, start_month=?, end_month=? WHERE id=? AND loan_id=?",
    ).run(
      rate,
      start_month,
      end_month || null,
      req.params.rateId,
      req.params.id,
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/loans/:id/rates/:rateId", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db
      .prepare("SELECT id FROM loans WHERE id=? AND profile_id=?")
      .get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: "Loan not found" });
    db.prepare("DELETE FROM loan_rate_periods WHERE id=? AND loan_id=?").run(
      req.params.rateId,
      req.params.id,
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Prepayments CRUD
app.post("/api/loans/:id/prepayments", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db
      .prepare("SELECT id FROM loans WHERE id=? AND profile_id=?")
      .get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: "Loan not found" });
    const { month, amount, note } = req.body;
    const info = db
      .prepare(
        "INSERT INTO loan_prepayments (loan_id, month, amount, note) VALUES (?, ?, ?, ?)",
      )
      .run(req.params.id, month, amount, note || "");
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/loans/:id/prepayments/:prepayId", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db
      .prepare("SELECT id FROM loans WHERE id=? AND profile_id=?")
      .get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: "Loan not found" });
    db.prepare("DELETE FROM loan_prepayments WHERE id=? AND loan_id=?").run(
      req.params.prepayId,
      req.params.id,
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Calculate amortization
app.post("/api/loans/:id/calculate", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db
      .prepare("SELECT * FROM loans WHERE id=? AND profile_id=?")
      .get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: "Not found" });

    const ratePeriods = db
      .prepare(
        "SELECT * FROM loan_rate_periods WHERE loan_id=? ORDER BY start_month",
      )
      .all(req.params.id);
    const prepayments = db
      .prepare("SELECT * FROM loan_prepayments WHERE loan_id=? ORDER BY month")
      .all(req.params.id);

    // Prepend the loan's initial rate as the first rate period (months 1 to before first user-set change)
    const initialRatePeriod = [
      { rate: loan.interest_rate, start_month: 1, end_month: undefined },
    ];
    const allRatePeriods = [
      ...initialRatePeriod,
      ...ratePeriods.map((rp) => ({
        rate: rp.rate,
        start_month: rp.start_month,
        end_month: rp.end_month,
      })),
    ];

    const scheduleWithPrepayments = loanCalc.calculateSchedule(
      loan.principal,
      loan.start_date,
      loan.term_months,
      allRatePeriods,
      prepayments.map((p) => ({
        month: p.month,
        amount: p.amount,
        note: p.note,
      })),
    );

    const scheduleNoPrepayments = loanCalc.calculateSchedule(
      loan.principal,
      loan.start_date,
      loan.term_months,
      allRatePeriods,
      [],
    );

    const summary = loanCalc.getSummary(
      scheduleWithPrepayments,
      scheduleNoPrepayments,
    );

    res.json({
      schedule: scheduleWithPrepayments,
      summary,
      comparison: {
        withPrepayments: summary,
        withoutPrepayments: loanCalc.getSummary(
          scheduleNoPrepayments,
          scheduleNoPrepayments,
        ),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// DASHBOARD (per-profile, multi-profile for combined view)
// ========================
app.get("/api/dashboard/summary", apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const { year, month } = req.query;
    // Support both "YYYY-MM" format and just "MM"
    const monthPart = month ? (month.includes('-') ? month.split('-')[1] : month) : null;
    const y = year || new Date().getFullYear();
    const m = monthPart;
    let startDate, endDate;

    if (m) {
      // Specific month
      startDate = `${y}-${String(m).padStart(2, "0")}-01`;
      const nextM = m === 12 ? 1 : m + 1;
      const nextY = m === 12 ? y + 1 : y;
      endDate = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
    } else {
      // Full year
      startDate = `${y}-01-01`;
      endDate = `${y + 1}-01-01`;
    }

    // Use amount_local if available (for imported transactions), otherwise amount
    const monthly = db
      .prepare(
        `
      SELECT type, SUM(COALESCE(amount_local, amount)) as total, COUNT(*) as count
      FROM transactions
      WHERE profile_id IN (${inClause}) AND date >= ? AND date < ?
      GROUP BY type
    `,
      )
      .all(...pids, startDate, endDate);

    const summary = { income: 0, expense: 0, transfer: 0, balance: 0 };
    for (const r of monthly) {
      if (r.type === "income") summary.income = r.total;
      else if (r.type === "expense") summary.expense = r.total;
      else if (r.type === "transfer") summary.transfer = r.total;
    }
    summary.balance = summary.income - summary.expense;

    const recent = db
      .prepare(
        `
      SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date < ?
      ORDER BY t.date DESC, t.id DESC
      LIMIT 10
    `,
      )
      .all(...pids, startDate, endDate);

    // Use amount_local if available (for imported transactions), otherwise amount
    const yearStart = `${y}-01-01`;
    const ytd = db
      .prepare(
        `
      SELECT type, SUM(COALESCE(amount_local, amount)) as total FROM transactions WHERE profile_id IN (${inClause}) AND date >= ? GROUP BY type
    `,
      )
      .all(...pids, yearStart);
    const ytdSummary = { income: 0, expense: 0 };
    for (const r of ytd) {
      if (r.type === "income") ytdSummary.income = r.total;
      else if (r.type === "expense") ytdSummary.expense = r.total;
    }
    ytdSummary.net = ytdSummary.income - ytdSummary.expense;

    // Get currency setting
    // Previous period comparison
    let prevStartDate, prevEndDate;
    if (m) {
      // Previous month
      const pm = m == 1 ? 12 : m - 1;
      const py = m == 1 ? y - 1 : y;
      prevStartDate = `${py}-${String(pm).padStart(2, "0")}-01`;
      const nextPm = pm == 12 ? 1 : pm + 1;
      const nextPy = pm == 12 ? py + 1 : py;
      prevEndDate = `${nextPy}-${String(nextPm).padStart(2, "0")}-01`;
    } else {
      // Previous year
      prevStartDate = `${y - 1}-01-01`;
      prevEndDate = `${y}-01-01`;
    }

    const prevMonthly = db
      .prepare(
        `SELECT type, SUM(COALESCE(amount_local, amount)) as total FROM transactions WHERE profile_id IN (${inClause}) AND date >= ? AND date < ? GROUP BY type`,
      )
      .all(...pids, prevStartDate, prevEndDate);
    const prevSummary = { income: 0, expense: 0 };
    for (const r of prevMonthly) {
      if (r.type === "income") prevSummary.income = r.total;
      else if (r.type === "expense") prevSummary.expense = r.total;
    }

    // Get currency setting
    const currencyRow = db
      .prepare(
        `SELECT value FROM settings WHERE key = 'local_currency' AND (profile_id IN (${inClause}) OR profile_id IS NULL) ORDER BY profile_id DESC LIMIT 1`,
      )
      .get(...pids);
    const currency = currencyRow ? currencyRow.value : "EUR";

    res.json({
      summary,
      prevSummary,
      recent,
      ytd: ytdSummary,
      month: m ? `${y}-${String(m).padStart(2, "0")}` : y,
      currency,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/dashboard/charts", apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const { months = 12 } = req.query;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months) + 1);
    const startStr = startDate.toISOString().split("T")[0];
    const endStr = endDate.toISOString().split("T")[0];

    // Use amount_local if available (for imported transactions), otherwise amount
    const byCategory = db
      .prepare(
        `
      SELECT c.name, c.color, c.icon, SUM(COALESCE(t.amount_local, t.amount)) as total, COUNT(*) as count
      FROM transactions t
      JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.type = 'expense'
      GROUP BY c.id
      ORDER BY total DESC
    `,
      )
      .all(...pids);

    const monthly = db
      .prepare(
        `
      SELECT strftime('%Y-%m', date) as month, type, SUM(COALESCE(amount_local, amount)) as total
      FROM transactions
      WHERE profile_id IN (${inClause}) AND date >= ? AND date <= ? AND type IN ('income', 'expense')
      GROUP BY month, type
      ORDER BY month
    `,
      )
      .all(...pids, startStr, endStr);

    const monthlyMap = {};
    for (const r of monthly) {
      if (!monthlyMap[r.month])
        monthlyMap[r.month] = { month: r.month, income: 0, expense: 0 };
      if (r.type === "income") monthlyMap[r.month].income = r.total;
      if (r.type === "expense") monthlyMap[r.month].expense = r.total;
    }

    const cashFlow = Object.values(monthlyMap);
    let running = 0;
    for (const row of cashFlow) {
      running += row.income - row.expense;
      row.cumulative = running;
    }

    // Get currency setting
    const currencyRow = db
      .prepare(
        `SELECT value FROM settings WHERE key = 'local_currency' AND (profile_id IN (${inClause}) OR profile_id IS NULL) ORDER BY profile_id DESC LIMIT 1`,
      )
      .get(...pids);
    const currency = currencyRow ? currencyRow.value : "EUR";

    res.json({
      byCategory,
      monthly: Object.values(monthlyMap),
      cashFlow,
      currency,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/dashboard/net-worth", apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    // Get account balances
    const accounts = db
      .prepare(
        `SELECT id, name, type, currency, balance FROM accounts WHERE profile_id IN (${inClause})`,
      )
      .all(...pids);
    const totalNetWorth = accounts.reduce(
      (sum, a) => sum + (a.balance || 0),
      0,
    );

    // Get monthly net flow (income - expense) from earliest transaction to now
    const monthly = db
      .prepare(
        `
      SELECT strftime('%Y-%m', date) as month, type, SUM(COALESCE(amount_local, amount)) as total
      FROM transactions
      WHERE profile_id IN (${inClause}) AND type IN ('income', 'expense')
      GROUP BY month, type
      ORDER BY month
    `,
      )
      .all(...pids);

    const monthlyMap = {};
    for (const r of monthly) {
      if (!monthlyMap[r.month])
        monthlyMap[r.month] = { month: r.month, net: 0 };
      if (r.type === "income") monthlyMap[r.month].net += r.total;
      if (r.type === "expense") monthlyMap[r.month].net -= r.total;
    }

    // Build timeline from earliest transaction to now with running total
    const timeline = [];
    const sortedMonths = Object.keys(monthlyMap).sort();
    if (sortedMonths.length > 0) {
      // Total net from all months in range
      const totalNet = Object.values(monthlyMap).reduce((s, m) => s + m.net, 0);
      // Opening balance = current net worth - total net accumulated
      const opening = totalNetWorth - totalNet;

      let balance = opening;
      for (const m of sortedMonths) {
        balance += monthlyMap[m].net;
        timeline.push({
          month: m,
          balance: Math.round(balance * 100) / 100,
          netChange: Math.round(monthlyMap[m].net * 100) / 100,
        });
      }
    }

    res.json({
      totalNetWorth: Math.round(totalNetWorth * 100) / 100,
      accounts,
      timeline,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// IMPORT (per-profile)
// ========================
const importFiles = {}; // temp storage for reloading specific sheets

app.post("/api/import/upload", apiRateLimiter, upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const workbook = XLSX.readFile(req.file.path);
    const sheetNames = workbook.SheetNames;

    const selectedSheet =
      req.body.sheetName && sheetNames.includes(req.body.sheetName)
        ? req.body.sheetName
        : sheetNames[0];
    const sheet = workbook.Sheets[selectedSheet];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    const fileId = Date.now().toString(36);
    importFiles[fileId] = {
      path: req.file.path,
      workbook,
      uploadedAt: Date.now(),
    };

    res.json({
      fileId,
      filename: req.file.originalname,
      sheetName: selectedSheet,
      sheetNames,
      headers: (data[0] || []).map(String),
      rows: data.slice(1).filter((r) => r.some((c) => c != null && c !== "")),
      totalRows: data.length - 1,
    });

    // Cleanup old entries
    const cutoff = Date.now() - 3600000;
    Object.keys(importFiles).forEach((k) => {
      if (importFiles[k].uploadedAt < cutoff) {
        try {
          fs.unlinkSync(importFiles[k].path);
        } catch (e) {}
        delete importFiles[k];
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/import/file-sheet", apiRateLimiter, (req, res) => {
  try {
    const { fileId, sheetName } = req.body;
    const entry = importFiles[fileId];
    if (!entry)
      return res
        .status(400)
        .json({ error: "File session expired. Please re-upload." });

    const sheetNames = entry.workbook.SheetNames;
    if (!sheetNames.includes(sheetName))
      return res.status(400).json({ error: "Sheet not found" });

    const sheet = entry.workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    res.json({
      fileId,
      sheetName,
      sheetNames,
      headers: (data[0] || []).map(String),
      rows: data.slice(1).filter((r) => r.some((c) => c != null && c !== "")),
      totalRows: data.length - 1,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/import/googlesheet", apiRateLimiter, (req, res) => {
  const { url, sheetName } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  // Extract sheet ID and gid from URL
  // URL can be: /d/ID/edit?gid=N#gid=N or just /d/ID/export?format=csv
  const idMatch = (url || "").match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch)
    return res.status(400).json({ error: "Invalid Google Sheets URL or ID" });

  const sheetId = idMatch[1];
  // Extract gid from query param ?gid= or URL fragment #gid=
  const urlWithoutFragment = url.split("#")[0];
  const gidMatch = urlWithoutFragment.match(/[?&]gid=([0-9]+)/);
  const gid = gidMatch ? gidMatch[1] : null;

  // Strategy 1: CSV export with gid (works for publicly accessible sheets, respects specific sheet tab)
  function tryCsvExport() {
    return new Promise((resolve) => {
      const csvUrl = gid
        ? `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`
        : `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
      fetch(csvUrl, { headers: { "User-Agent": "Mozilla/5.0" } })
        .then((r) => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.text();
        })
        .then((text) => {
          // Check if it's actually CSV or an error page
          if (
            text.trim().startsWith("<!DOCTYPE") ||
            text.trim().startsWith("<html")
          ) {
            throw new Error(
              "Sheet is not publicly accessible (got HTML instead of CSV)",
            );
          }
          // Parse CSV manually (handles quoted fields, commas in values)
          const rows = [];
          const lines = text.trim().split("\n");
          for (const line of lines) {
            const cols = [];
            let cur = "";
            let inQuotes = false;
            for (const ch of line) {
              if (ch === '"') {
                inQuotes = !inQuotes;
              } else if (ch === "," && !inQuotes) {
                cols.push(cur.trim().replace(/^"|"$/g, ""));
                cur = "";
              } else cur += ch;
            }
            cols.push(cur.trim().replace(/^"|"$/g, ""));
            rows.push(cols);
          }
          const headers = rows[0] || [];
          const dataRows = rows.slice(1).filter((r) => r.some((c) => c));
          resolve({
            headers,
            rows: dataRows,
            sheetName: sheetName || "Sheet1",
          });
        })
        .catch((err) => resolve({ error: err.message }));
    });
  }

  // Strategy 2: Get all sheet names via XLSX export, then fetch CSV for specific sheet
  function tryXlsxAndListSheets() {
    return new Promise((resolve) => {
      fetch(
        `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`,
        {
          headers: { "User-Agent": "Mozilla/5.0" },
        },
      )
        .then((r) => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.arrayBuffer();
        })
        .then((buf) => {
          const workbook = XLSX.read(buf, { type: "array" });
          resolve({ sheetNames: workbook.SheetNames, workbook });
        })
        .catch((err) => resolve({ error: err.message }));
    });
  }

  // Execute: try CSV first (respects gid), then fall back to XLSX for sheet listing
  (async () => {
    try {
      if (sheetName) {
        // Specific sheet requested — try CSV with gid first, then XLSX workbook
        const csvResult = await tryCsvExport();
        if (!csvResult.error) {
          return res.json({
            headers: csvResult.headers,
            rows: csvResult.rows,
            selectedSheet: csvResult.sheetName,
            sheetNames: [csvResult.sheetName],
          });
        }

        // CSV failed — try XLSX, find the matching sheet by name
        const xlsxResult = await tryXlsxAndListSheets();
        if (xlsxResult.error) {
          return res.status(500).json({
            error:
              "Failed to fetch Google Sheet: " +
              xlsxResult.error +
              ". Make sure the sheet is shared as 'Anyone with link can view'.",
          });
        }

        const targetSheet = xlsxResult.sheetNames.includes(sheetName)
          ? sheetName
          : xlsxResult.sheetNames[0];
        const sheet = xlsxResult.workbook.Sheets[targetSheet];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        const headers = (data[0] || []).map(String);
        const rows = data
          .slice(1)
          .filter((r) => r.some((c) => c != null && c !== ""));
        return res.json({
          headers,
          rows,
          selectedSheet: targetSheet,
          sheetNames: xlsxResult.sheetNames,
        });
      } else {
        // No specific sheet — try CSV first, fall back to XLSX for sheet list
        const csvResult = await tryCsvExport();
        if (!csvResult.error && csvResult.headers.length > 0) {
          return res.json({
            headers: csvResult.headers,
            rows: csvResult.rows,
            selectedSheet: csvResult.sheetName,
            sheetNames: [csvResult.sheetName],
          });
        }

        // CSV failed or returned empty — get sheet names via XLSX
        const xlsxResult = await tryXlsxAndListSheets();
        if (xlsxResult.error) {
          return res.status(500).json({
            error:
              "Failed to fetch Google Sheet: " +
              xlsxResult.error +
              ". Make sure the sheet is shared as 'Anyone with link can view'.",
          });
        }
        return res.json({
          sheetNames: xlsxResult.sheetNames,
          selectedSheet: xlsxResult.sheetNames[0],
        });
      }
    } catch (err) {
      res
        .status(500)
        .json({ error: "Failed to fetch Google Sheet: " + err.message });
    }
  })();
});

app.post("/api/import/execute", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { rows, mapping, categoryTypes } = req.body;
    if (!rows || !mapping)
      return res.status(400).json({ error: "Missing data" });

    const insert = db.prepare(`
      INSERT INTO transactions (description, amount, date, beneficiary, payor, category_id,
        currency, amount_local, means_of_payment, exchange_rate, type, notes, profile_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const getCat = db.prepare(
      "SELECT id, color FROM categories WHERE LOWER(name) = LOWER(?) AND profile_id = ? LIMIT 1",
    );
    const insertCat = db.prepare(
      "INSERT INTO categories (name, type, color, icon, profile_id) VALUES (?, ?, ?, ?, ?)",
    );

    // Diverse color palette for new categories
    const newCategoryColors = [
      "#ef4444",
      "#f97316",
      "#f59e0b",
      "#eab308",
      "#84cc16",
      "#22c55e",
      "#14b8a6",
      "#06b6d4",
      "#0ea5e9",
      "#3b82f6",
      "#6366f1",
      "#8b5cf6",
      "#a855f7",
      "#d946ef",
      "#ec4899",
      "#f43f5e",
      "#64748b",
      "#78716c",
    ];
    let colorIndex = 0;

    let imported = 0;
    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        const categoryId = (() => {
          const catName =
            row[mapping.category] ||
            row[mapping.Category] ||
            row[mapping.CATEGORY];
          if (!catName) return null;
          const existing = getCat.get(String(catName).trim(), pid);
          if (existing) return existing.id;
          // Reuse the same diverse color each time a new category is created (consistent within same import)
          const color =
            newCategoryColors[colorIndex % newCategoryColors.length];
          colorIndex++;
          const icon = "tag";
          // Use user-specified type, or fallback to auto-detected default
          const catType =
            (categoryTypes && categoryTypes[catName]) || "expense";
          const r = insertCat.run(
            String(catName).trim(),
            catType,
            color,
            icon,
            pid,
          );
          return r.lastInsertRowid;
        })();

        const amountRaw =
          parseFloat(
            row[mapping.amount] || row[mapping.Amount] || row[mapping.AMOUNT],
          ) || 0;
        const amount = Math.abs(amountRaw);
        const dateRaw =
          row[mapping.date] ||
          row[mapping.Date] ||
          row[mapping.DATE] ||
          new Date().toISOString().split("T")[0];
        const currency =
          row[mapping.currency] ||
          row[mapping.Currency] ||
          row[mapping.CURRENCY] ||
          "USD";

        // Determine transaction type
        let validatedType;
        if (mapping.type) {
          const rawType = String(row[mapping.type] || "")
            .trim()
            .toLowerCase();
          if (["income", "expense", "transfer"].includes(rawType)) {
            validatedType = rawType;
          } else {
            // Auto-detect based on amount sign or common keywords
            validatedType =
              amountRaw < 0 ||
              rawType.includes("expense") ||
              rawType.includes("debit") ||
              rawType.includes("spent")
                ? "expense"
                : amountRaw > 0 ||
                    rawType.includes("income") ||
                    rawType.includes("credit") ||
                    rawType.includes("received")
                  ? "income"
                  : "expense";
          }
        } else {
          // No type mapped — auto-detect from amount sign
          validatedType =
            amountRaw < 0 ? "expense" : amountRaw > 0 ? "income" : "expense";
        }

        insert.run(
          row[mapping.description] ||
            row[mapping.Description] ||
            row[mapping.DESCRIPTION] ||
            "",
          amount,
          parseDateString(dateRaw),
          row[mapping.beneficiary] ||
            row[mapping.Beneficiary] ||
            row[mapping.BENEFICIARY] ||
            "",
          row[mapping.payor] || row[mapping.Payor] || row[mapping.PAYOR] || "",
          categoryId,
          currency,
          parseFloat(
            row[mapping.amount_local] || row[mapping.AmountLocal] || amount,
          ) || amount,
          row[mapping.means_of_payment] ||
            row[mapping.MeansOfPayment] ||
            row[mapping.MEANS_OF_PAYMENT] ||
            "",
          parseFloat(
            row[mapping.exchange_rate] || row[mapping.ExchangeRate] || 1.0,
          ) || 1.0,
          validatedType,
          row[mapping.notes] || row[mapping.Notes] || row[mapping.NOTES] || "",
          pid,
        );
        imported++;
      }
    });

    insertMany(rows);
    res.json({
      imported,
      message: `Successfully imported ${imported} transactions`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// ACCOUNTS (per-profile)
// ========================
app.get("/api/accounts", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const accounts = db
      .prepare(
        "SELECT * FROM accounts WHERE profile_id = ? ORDER BY type, name",
      )
      .all(pid);
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/accounts", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, type, currency, balance, notes } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    const validTypes = ["giro", "ib", "savings"];
    const accountType = validTypes.includes(type) ? type : "giro";
    const result = db
      .prepare(
        "INSERT INTO accounts (name, type, currency, balance, notes, profile_id) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        name.trim(),
        accountType,
        currency || "USD",
        parseFloat(balance) || 0,
        notes || "",
        pid,
      );
    res.json({ id: result.lastInsertRowid, message: "Account created" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/accounts/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, type, currency, balance, notes } = req.body;
    const existing = db
      .prepare("SELECT id FROM accounts WHERE id = ? AND profile_id = ?")
      .get(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: "Account not found" });
    const validTypes = ["giro", "ib", "savings"];
    const accountType = validTypes.includes(type) ? type : "giro";
    db.prepare(
      "UPDATE accounts SET name = ?, type = ?, currency = ?, balance = ?, notes = ? WHERE id = ? AND profile_id = ?",
    ).run(
      name.trim(),
      accountType,
      currency || "USD",
      parseFloat(balance) || 0,
      notes || "",
      req.params.id,
      pid,
    );
    res.json({ message: "Account updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/accounts/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const existing = db
      .prepare("SELECT id FROM accounts WHERE id = ? AND profile_id = ?")
      .get(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: "Account not found" });
    db.prepare("DELETE FROM accounts WHERE id = ? AND profile_id = ?").run(
      req.params.id,
      pid,
    );
    res.json({ message: "Account deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// ACCOUNT BALANCE HISTORY
// ========================
app.get("/api/accounts/:id/history", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const account = db
      .prepare("SELECT id FROM accounts WHERE id = ? AND profile_id = ?")
      .get(req.params.id, pid);
    if (!account) return res.status(404).json({ error: "Account not found" });

    const history = db
      .prepare(
        "SELECT id, balance, recorded_at FROM account_balance_history WHERE account_id = ? ORDER BY recorded_at DESC",
      )
      .all(req.params.id);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/accounts/:id/history", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const account = db
      .prepare("SELECT balance FROM accounts WHERE id = ? AND profile_id = ?")
      .get(req.params.id, pid);
    if (!account) return res.status(404).json({ error: "Account not found" });

    const result = db
      .prepare(
        "INSERT INTO account_balance_history (account_id, balance, recorded_at) VALUES (?, ?, datetime('now'))",
      )
      .run(req.params.id, account.balance);
    res.json({ id: result.lastInsertRowid, balance: account.balance, recorded_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/accounts/:id/history", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const account = db
      .prepare("SELECT id FROM accounts WHERE id = ? AND profile_id = ?")
      .get(req.params.id, pid);
    if (!account) return res.status(404).json({ error: "Account not found" });

    db.prepare("DELETE FROM account_balance_history WHERE account_id = ?").run(req.params.id);
    res.json({ message: "Balance history deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Net worth timeline from balance history
app.get("/api/accounts/history/timeline", apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT abh.recorded_at as date, SUM(abh.balance) as net_worth
         FROM account_balance_history abh
         JOIN accounts a ON abh.account_id = a.id
         WHERE a.profile_id IN (${inClause})
         GROUP BY date(abh.recorded_at)
         ORDER BY date ASC`,
      )
      .all(...pids);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// RECURRING TRANSACTIONS
// ========================
app.get("/api/recurring", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const rows = db
      .prepare(
        `
      SELECT r.*, c.name as category_name, c.color as category_color, c.type as category_type
      FROM recurring_transactions r
      LEFT JOIN categories c ON r.category_id = c.id
      WHERE r.profile_id = ? AND r.active = 1
      ORDER BY r.next_date ASC
    `,
      )
      .all(pid);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/recurring", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const {
      description,
      amount,
      type,
      category_id,
      frequency,
      day_of_month,
      next_date,
      notes,
    } = req.body;
    const info = db
      .prepare(
        `INSERT INTO recurring_transactions (profile_id, description, amount, type, category_id, frequency, day_of_month, next_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pid,
        description || "",
        amount,
        type || "expense",
        category_id || null,
        frequency || "monthly",
        day_of_month || null,
        next_date || null,
        notes || "",
      );
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/recurring/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const existing = db
      .prepare(
        "SELECT id FROM recurring_transactions WHERE id = ? AND profile_id = ?",
      )
      .get(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: "Not found" });
    const {
      description,
      amount,
      type,
      category_id,
      frequency,
      day_of_month,
      next_date,
      notes,
      active,
    } = req.body;
    db.prepare(
      `UPDATE recurring_transactions SET description=?, amount=?, type=?, category_id=?, frequency=?, day_of_month=?, next_date=?, notes=?, active=? WHERE id=? AND profile_id=?`,
    ).run(
      description ?? "",
      amount ?? 0,
      type ?? "expense",
      category_id ?? null,
      frequency ?? "monthly",
      day_of_month ?? null,
      next_date ?? null,
      notes ?? "",
      active ?? 1,
      req.params.id,
      pid,
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/recurring/:id", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    db.prepare(
      "DELETE FROM recurring_transactions WHERE id = ? AND profile_id = ?",
    ).run(req.params.id, pid);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/recurring/:id/populate", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const r = db
      .prepare(
        "SELECT * FROM recurring_transactions WHERE id = ? AND profile_id = ?",
      )
      .get(req.params.id, pid);
    if (!r) return res.status(404).json({ error: "Not found" });
    const date = r.next_date || new Date().toISOString().split("T")[0];
    const info = db
      .prepare(
        `INSERT INTO transactions (profile_id, description, amount, type, category_id, date, notes, beneficiary, payor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pid,
        r.description,
        r.amount,
        r.type,
        r.category_id,
        date,
        r.notes || "",
        "",
        "",
      );

    // Advance next_date
    let next = new Date(date);
    if (r.frequency === "monthly") next.setMonth(next.getMonth() + 1);
    else if (r.frequency === "weekly") next.setDate(next.getDate() + 7);
    else if (r.frequency === "yearly") next.setFullYear(next.getFullYear() + 1);
    const nextStr = next.toISOString().split("T")[0];
    db.prepare(
      "UPDATE recurring_transactions SET next_date = ? WHERE id = ?",
    ).run(nextStr, req.params.id);

    res.json({
      ok: true,
      transactionId: info.lastInsertRowid,
      next_date: nextStr,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// STATS (per-profile)
// ========================
app.get("/api/stats/monthly", apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { months = 24 } = req.query;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months) + 1);
    const startStr = startDate.toISOString().split("T")[0];
    const endStr = endDate.toISOString().split("T")[0];

    // Use amount_local if available (for imported transactions), otherwise amount
    const rows = db
      .prepare(
        `
      SELECT strftime('%Y-%m', date) as month, type,
        SUM(COALESCE(amount_local, amount)) as total, COUNT(*) as count
      FROM transactions
      WHERE profile_id = ? AND date >= ? AND date <= ? AND type IN ('income', 'expense')
      GROUP BY month, type
      ORDER BY month
    `,
      )
      .all(pid, startStr, endStr);

    const map = {};
    for (const r of rows) {
      if (!map[r.month])
        map[r.month] = { month: r.month, income: 0, expense: 0 };
      if (r.type === "income") map[r.month].income = r.total;
      if (r.type === "expense") map[r.month].expense = r.total;
      map[r.month].net = map[r.month].income - map[r.month].expense;
    }

    res.json(Object.values(map));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// ANALYTICS
// ========================
app.get("/api/analytics/distinct-years", apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT DISTINCT substr(date, 1, 4) as year FROM transactions WHERE profile_id IN (${inClause}) ORDER BY year DESC`,
      )
      .all(...pids);
    const years = rows.map((r) => parseInt(r.year));
    const currentYear = new Date().getFullYear();
    if (years.length === 0) years.push(currentYear);
    if (!years.includes(currentYear)) years.unshift(currentYear);
    res.json({ years });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/analytics/weeks", apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const year = parseInt(req.query.year);
    const month = req.query.month
      ? String(req.query.month).padStart(2, "0")
      : null;
    if (!year) {
      res.json({ weeks: [] });
      return;
    }
    const weeks = [];
    const firstDay = month
      ? new Date(year, parseInt(month) - 1, 1)
      : new Date(year, 0, 1);
    const last = month ? new Date(year, parseInt(month), 0).getDate() : 31;
    const lastDay = month
      ? new Date(year, parseInt(month) - 1, last)
      : new Date(year, 11, 31);
    let w = 1;
    const current = new Date(firstDay);
    while (current <= lastDay) {
      const weekStart = new Date(current);
      weekStart.setDate(current.getDate() - current.getDay());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weeks.push({
        week: w,
        label: `Week ${w} (${weekStart.toISOString().slice(0, 10)} - ${weekEnd.toISOString().slice(0, 10)})`,
      });
      current.setDate(current.getDate() + 7);
      w++;
    }
    res.json({ weeks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// ANALYTICS - Stacked Category Trends
// ========================
app.get("/api/analytics/category-trends", apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = req.query.month
      ? String(req.query.month).padStart(2, "0")
      : null;
    const week = req.query.week ? parseInt(req.query.week) : null;
    const type = req.query.type || "expense";

    // Date range
    let startStr, endStr;
    if (month) {
      const lastDay = new Date(year, parseInt(month), 0).getDate();
      if (week) {
        // Specific week within a month
        const weekStartDay = (week - 1) * 7 + 1;
        const weekEndDay = Math.min(week * 7, lastDay);
        startStr = `${year}-${month}-${String(weekStartDay).padStart(2, "0")}`;
        endStr = `${year}-${month}-${String(weekEndDay).padStart(2, "0")}`;
      } else {
        // Full month
        startStr = `${year}-${month}-01`;
        endStr = `${year}-${month}-${String(lastDay).padStart(2, "0")}`;
      }
    } else {
      // Full year
      startStr = `${year}-01-01`;
      endStr = `${year}-12-31`;
    }

    // Calculate actual number of days in the selected period
    const [startY, startM, startD] = startStr.split('-').map(Number);
    const [endY, endM, endD] = endStr.split('-').map(Number);
    const startDate = new Date(startY, startM - 1, startD);
    const endDate = new Date(endY, endM - 1, endD);
    const numDays = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

    // Transactions and categories filtered by type (income or expense)
    const transactions = db
      .prepare(
        `SELECT t.date, COALESCE(t.amount_local, t.amount) as amount, c.id as cat_id, c.name as cat_name, c.color as cat_color FROM transactions t JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id WHERE t.profile_id IN (${inClause}) AND t.type = ? AND t.date >= ? AND t.date <= ? ORDER BY t.date`,
      )
      .all(...pids, type, startStr, endStr);

    const categories = db
      .prepare(
        `SELECT id, name, color FROM categories WHERE profile_id IN (${inClause}) AND type = ? ORDER BY name`,
      )
      .all(...pids, type);

    // Generate labels based on view level
    const labels = [];
    const periodMap = new Map();
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const monthNamesFull = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    if (week && month) {
      // Week view: show days of the week (Sun-Sat) for that month
      const lastDay = new Date(year, parseInt(month), 0).getDate();
      const weekStartDay = (week - 1) * 7 + 1;
      const weekEndDay = Math.min(week * 7, lastDay);
      for (let d = weekStartDay; d <= weekEndDay; d++) {
        const date = new Date(year, parseInt(month) - 1, d);
        labels.push(dayNames[date.getDay()]);
        periodMap.set(
          `${year}-${month}-${String(d).padStart(2, "0")}`,
          labels.length - 1,
        );
      }
    } else if (month) {
      // Month view: show day numbers
      const lastDay = new Date(year, parseInt(month), 0).getDate();
      for (let d = 1; d <= lastDay; d++) {
        labels.push(`${monthNamesFull[parseInt(month) - 1]} ${d}`);
        periodMap.set(
          `${year}-${month}-${String(d).padStart(2, "0")}`,
          labels.length - 1,
        );
      }
    } else {
      // Year view: show 12 months
      for (let m = 0; m < 12; m++) {
        labels.push(`${monthNames[m]} ${year}`);
        periodMap.set(`${year}-${String(m + 1).padStart(2, "0")}`, m);
      }
    }

    // Initialize datasets for each category
    const catDataMap = {};
    categories.forEach((c) => {
      catDataMap[c.id] = {
        category: c.name,
        color: c.color,
        data: new Array(labels.length).fill(0),
      };
    });

    // Aggregate transactions
    transactions.forEach((t) => {
      // For month/week views use full date (YYYY-MM-DD), for year view use YYYY-MM
      const dateKey = month ? t.date : t.date.substring(0, 7);
      const idx = periodMap.get(dateKey);
      if (idx !== undefined && catDataMap[t.cat_id]) {
        catDataMap[t.cat_id].data[idx] += t.amount;
      }
    });

    // Convert to array and sort by total
    const datasets = Object.values(catDataMap)
      .filter((d) => d.data.some((v) => v > 0))
      .sort((a, b) => {
        const totalA = a.data.reduce((x, y) => x + y, 0);
        const totalB = b.data.reduce((x, y) => x + y, 0);
        return totalB - totalA;
      });

    res.json({ labels, datasets, numDays });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// ANALYTICS: SANKEY (Budget vs Actual)
// ========================
app.get("/api/analytics/sankey", apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = req.query.month ? String(req.query.month).padStart(2, "0") : null;

    if (!month) {
      return res.json({ nodes: [], links: [] });
    }

    const lastDay = new Date(year, parseInt(month), 0).getDate();
    const startStr = `${year}-${month}-01`;
    const endStr = `${year}-${month}-${String(lastDay).padStart(2, "0")}`;

    // Get budgets for this month
    const budgets = db.prepare(`
      SELECT b.category_id, b.amount as budget_amount, c.name as cat_name, c.color as cat_color
      FROM budgets b
      JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
      WHERE b.profile_id IN (${inClause}) AND b.period = 'month'
      AND strftime('%Y-%m', b.start_date) <= ? AND (b.end_date IS NULL OR strftime('%Y-%m', b.end_date) >= ?)
    `).all(...pids, `${year}-${month}`, `${year}-${month}`);

    // Get actual spending for this month
    const actualSpending = db.prepare(`
      SELECT t.category_id, SUM(COALESCE(t.amount_local, t.amount)) as actual_amount
      FROM transactions t
      WHERE t.profile_id IN (${inClause}) AND t.type = 'expense' AND t.date >= ? AND t.date <= ?
      GROUP BY t.category_id
    `).all(...pids, startStr, endStr);

    // Create maps for easy lookup
    const budgetMap = new Map(budgets.map(b => [b.category_id, b]));
    const actualMap = new Map(actualSpending.map(a => [a.category_id, a]));

    // Build nodes and links for sankey
    const nodes = [];
    const links = [];
    const nodeNames = new Set();

    // Add "Total Budget" source node
    nodes.push({ name: 'Total Budget', category: 'budget' });
    nodeNames.add('Total Budget');

    // Add category nodes and links
    budgets.forEach(b => {
      if (!nodeNames.has(b.cat_name)) {
        nodes.push({ name: b.cat_name, category: 'category', color: b.cat_color });
        nodeNames.add(b.cat_name);
      }
    });

    // Add "Total Actual" node
    nodes.push({ name: 'Total Actual', category: 'actual' });
    nodeNames.add('Total Actual');

    // Budget -> Category links (planned flow)
    let totalBudget = 0;
    budgets.forEach(b => {
      totalBudget += b.budget_amount;
      links.push({
        source: 'Total Budget',
        target: b.cat_name,
        value: b.budget_amount,
        sourceCategory: 'budget',
        targetCategory: 'category'
      });
    });

    // Category -> Actual links (actual spent)
    let totalActual = 0;
    budgets.forEach(b => {
      const actual = actualMap.get(b.category_id);
      const actualAmount = actual ? actual.actual_amount : 0;
      totalActual += actualAmount;
      links.push({
        source: b.cat_name,
        target: 'Total Actual',
        value: actualAmount,
        sourceCategory: 'category',
        targetCategory: 'actual'
      });
    });

    // If no budgets, use actual spending as flow
    if (budgets.length === 0) {
      actualSpending.forEach(a => {
        const cat = db.prepare('SELECT name, color FROM categories WHERE id = ?').get(a.category_id);
        if (cat) {
          if (!nodeNames.has(cat.name)) {
            nodes.push({ name: cat.name, category: 'category', color: cat.color });
            nodeNames.add(cat.name);
          }
          links.push({
            source: cat.name,
            target: 'Total Actual',
            value: a.actual_amount,
            sourceCategory: 'category',
            targetCategory: 'actual'
          });
        }
      });
    }

    // Budget unused (budget - actual) -> "Savings" node if there's difference
    const budgetUnused = totalBudget - totalActual;
    if (budgetUnused > 0 && budgets.length > 0) {
      nodes.push({ name: 'Unused Budget', category: 'savings' });
      links.push({
        source: 'Total Budget',
        target: 'Unused Budget',
        value: budgetUnused,
        sourceCategory: 'budget',
        targetCategory: 'savings'
      });
    }

    res.json({ nodes, links });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// EXPORT (per-profile, multi-profile for combined view)
// ========================
app.get("/api/export/:type", apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const { type } = req.params;
    const { format = 'csv' } = req.query;

    let data, filename;
    switch (type) {
      case 'transactions': {
        const rows = db.prepare(`
          SELECT t.date, t.description, t.amount, t.type, t.currency, t.means_of_payment, t.beneficiary, t.payor, t.notes, c.name as category
          FROM transactions t
          LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
          WHERE t.profile_id IN (${inClause})
          ORDER BY t.date DESC
        `).all(...pids);
        data = rows;
        filename = 'transactions';
        break;
      }
      case 'categories': {
        const rows = db.prepare(`
          SELECT name, color, icon, type, parent_id FROM categories WHERE profile_id IN (${inClause})
        `).all(...pids);
        data = rows;
        filename = 'categories';
        break;
      }
      case 'accounts': {
        const rows = db.prepare(`
          SELECT name, type, currency, balance, notes FROM accounts WHERE profile_id IN (${inClause})
        `).all(...pids);
        data = rows;
        filename = 'accounts';
        break;
      }
      case 'budgets': {
        const rows = db.prepare(`
          SELECT b.*, c.name as category_name FROM budgets b
          JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
          WHERE b.profile_id IN (${inClause})
        `).all(...pids);
        data = rows;
        filename = 'budgets';
        break;
      }
      case 'loans': {
        const rows = db.prepare(`
          SELECT l.name, l.principal, l.interest_rate, l.start_date, l.term_months,
            (SELECT SUM(amount) FROM loan_prepayments WHERE loan_id = l.id) as total_prepaid
          FROM loans l WHERE l.profile_id IN (${inClause})
        `).all(...pids);
        data = rows;
        filename = 'loans';
        break;
      }
      case 'recurring': {
        const rows = db.prepare(`
          SELECT description, amount, type, frequency, day_of_month, next_date, notes, active
          FROM recurring_transactions WHERE profile_id IN (${inClause})
        `).all(...pids);
        data = rows;
        filename = 'recurring_transactions';
        break;
      }
      default:
        return res.status(400).json({ error: 'Invalid export type' });
    }

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      res.json(data);
    } else {
      // CSV format
      if (data.length === 0) {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        return res.end('');
      }
      const headers = Object.keys(data[0]);
      const csv = [
        headers.join(','),
        ...data.map(row => headers.map(h => {
          const val = row[h] == null ? '' : String(row[h]);
          return val.includes(',') || val.includes('"') || val.includes('\n')
            ? `"${val.replace(/"/g, '""')}"`
            : val;
        }).join(','))
      ].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.end(csv);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// RETIREMENT CALCULATOR
// ========================
app.post("/api/calculator/retire", apiRateLimiter, (req, res) => {
  try {
    const {
      currentAge = 30,
      retirementAge = 65,
      currentSavings = 0,
      monthlyContribution = 0,
      annualReturn = 7,
      annualExpenses = 30000,
      withdrawalRate = 4,
      inflationRate = 2,
      expensesAtRetirement = null,
      country = "",
    } = req.body;

    // Use direct expenses at retirement if provided, otherwise apply country cost-of-living adjustment
    const colMultipliers = {
      usa: 1.0,
      europe: 0.9,
      switzerland: 1.3,
      croatia: 0.6,
      japan: 0.85,
    };
    const col = colMultipliers[country] || 1.0;
    const adjustedExpenses =
      expensesAtRetirement !== null
        ? expensesAtRetirement
        : annualExpenses * col;

    // FIRE number: how much needed to retire (25x rule, or 100 / withdrawalRate)
    const fireNumber = adjustedExpenses / (withdrawalRate / 100);

    // Project savings until retirement
    const monthsToRetirement = (retirementAge - currentAge) * 12;
    if (monthsToRetirement <= 0) {
      return res
        .status(400)
        .json({ error: "Retirement age must be greater than current age" });
    }
    const monthlyReturn = annualReturn / 100 / 12;

    let savings = currentSavings;
    const timeline = [];
    for (let m = 0; m <= monthsToRetirement; m++) {
      if (m % 12 === 0) {
        timeline.push({
          year: currentAge + m / 12,
          age: Math.round(currentAge + m / 12),
          savings: Math.round(savings),
        });
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
        retirementSavings =
          retirementSavings * (1 + annualReturn / 100) - annualWithdrawal;
        withdrawalTimeline.push({
          year: y + 1,
          savings: Math.max(0, Math.round(retirementSavings)),
          balance: Math.max(0, Math.round(retirementSavings)),
        });
      }
    }

    res.json({
      fireNumber: Math.round(fireNumber),
      fireAge: fireAge ? Math.round(fireAge * 10) / 10 : null,
      fireMonth,
      fireYear: fireAge ? Math.floor(fireAge) : null,
      savingsAtRetirement: Math.round(savings),
      monthsToFire: fireMonth,
      currentNWAtFire: Math.round(savings),
      traditionalRetirementAge: 65,
      timeline: timeline.filter(
        (t) => t.year % 5 === 0 || t.year === currentAge,
      ),
      withdrawalTimeline,
      scenarios: [
        {
          name: "Conservative",
          return: 4,
          fireNumber: Math.round(adjustedExpenses / 0.04),
          fireAge: null,
        },
        {
          name: "Moderate",
          return: 6,
          fireNumber: Math.round(adjustedExpenses / 0.06),
          fireAge: null,
        },
        {
          name: "Optimistic",
          return: 8,
          fireNumber: Math.round(adjustedExpenses / 0.08),
          fireAge: null,
        },
      ].map((s) => {
        let m = currentSavings;
        let fa = null;
        for (let mo = 1; mo <= monthsToRetirement * 2; mo++) {
          m = m * (1 + s.return / 100 / 12) + monthlyContribution;
          if (m >= s.fireNumber && fa === null) {
            fa = currentAge + mo / 12;
          }
        }
        return {
          ...s,
          fireAge: fa ? Math.round(fa * 10) / 10 : null,
          reached: fa !== null,
          savingsAtFire: Math.round(m),
          shortfall: fa === null ? s.fireNumber - Math.round(m) : 0,
        };
      }),
      inputs: {
        currentAge,
        retirementAge,
        currentSavings,
        monthlyContribution,
        annualReturn,
        adjustedExpenses,
        withdrawalRate,
        country,
        expensesAtRetirement,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// MONTHLY PDF REPORT
// ========================
app.get("/api/reports/monthly-pdf", apiRateLimiter, async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) {
      return res.status(400).json({ error: "year and month are required" });
    }

    // Validate year format (4 digits)
    if (!/^\d{4}$/.test(String(year))) {
      return res.status(400).json({ error: "Valid year is required" });
    }

    // Validate month format and range (1-12)
    const monthNum = parseInt(month, 10);
    if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      return res.status(400).json({ error: "Valid month (1-12) is required" });
    }

    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    const startStr = `${year}-${String(month).padStart(2, "0")}-01`;
    const endStr = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const monthName = monthNames[parseInt(month) - 1] || month;

    // Fetch settings for currency
    const settings = db.prepare(`SELECT value FROM settings WHERE key = 'local_currency' AND (profile_id IN (${inClause}) OR profile_id IS NULL) ORDER BY profile_id DESC LIMIT 1`).get(...pids);
    const currency = settings ? settings.value : "EUR";

    // Fetch transactions for the month
    const transactions = db.prepare(`
      SELECT t.date, t.amount, t.description, c.name as cat_name, c.type as cat_type, c.color as cat_color, t.type as tx_type
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ?
      ORDER BY t.date
    `).all(...pids, startStr, endStr);

    // Aggregate by category
    const incomeByCat = {};
    const expenseByCat = {};
    let totalIncome = 0;
    let totalExpenses = 0;

    transactions.forEach(tx => {
      const amt = Math.abs(parseFloat(tx.amount) || 0);
      const catName = tx.cat_name || 'Uncategorized';
      const catColor = tx.cat_color || (tx.tx_type === 'income' ? '#059669' : '#dc2626');

      if (tx.tx_type === 'income') {
        totalIncome += amt;
        if (!incomeByCat[catName]) incomeByCat[catName] = { name: catName, color: catColor, total: 0 };
        incomeByCat[catName].total += amt;
      } else {
        totalExpenses += amt;
        if (!expenseByCat[catName]) expenseByCat[catName] = { name: catName, color: catColor, total: 0 };
        expenseByCat[catName].total += amt;
      }
    });

    const netSavings = totalIncome - totalExpenses;

    // Prepare data for export page
    const exportData = {
      yearMonth: `${year}-${String(month).padStart(2, "0")}`,
      currency,
      summary: { totalIncome, totalExpense: totalExpenses, netSavings },
      incomeByCategory: Object.values(incomeByCat).sort((a, b) => b.total - a.total),
      expenseByCategory: Object.values(expenseByCat).sort((a, b) => b.total - a.total),
    };

    // --- Use puppeteer to render and export as PDF directly ---
    let pdfBuffer = null;

    try {
      const puppeteer = require("puppeteer");

      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });

      try {
        const exportPage = await browser.newPage();
        await exportPage.setViewport({ width: 800, height: 1000, deviceScaleFactor: 2 });

        await exportPage.evaluateOnNewDocument((data) => {
          window.__DATA__ = data;
        }, exportData);

        const baseUrl = `http://localhost:${PORT}`;
        await exportPage.goto(`${baseUrl}/export-monthly.html`, { waitUntil: 'networkidle0', timeout: 30000 });

        // Wait for the page to signal that charts have finished rendering
        await exportPage.waitForFunction(() => window.__RENDER_DONE__ === true, { timeout: 30000 });

        pdfBuffer = Buffer.from(await exportPage.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '15px', right: '15px', bottom: '15px', left: '15px' }
        }));
      } finally {
        await browser.close();
      }
    } catch (puppeteerErr) {
      console.error('Puppeteer render failed:', puppeteerErr.message);
    }

    // --- Return the PDF directly ---
    if (pdfBuffer && pdfBuffer.length > 1000) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="report-${year}-${String(month).padStart(2, "0")}.pdf"`);
      return res.send(pdfBuffer);
    }

    // Fallback: text-only PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="report-${year}-${String(month).padStart(2, "0")}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    doc.pipe(res);

    const titleColor = "#1e293b";
    const headerBg = "#1e293b";
    const incomeColor = "#059669";
    const expenseColor = "#dc2626";
    const borderColor = "#e2e8f0";
    const mutedColor = "#64748b";

    function formatCurrencyPdf(amount, curr) {
      const symbols = { EUR: "€", USD: "$", GBP: "£", CHF: "CHF " };
      const sym = symbols[curr] || curr + " ";
      return sym + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    doc.fillColor(titleColor).fontSize(22).font("Helvetica-Bold")
      .text("Monthly Financial Report", { align: "center" });
    doc.moveDown(0.3);
    doc.fillColor(mutedColor).fontSize(13).font("Helvetica")
      .text(`${monthName} ${year}`, { align: "center" });
    doc.moveDown(0.8);

    const boxY = doc.y;
    const boxW = doc.page.width - 100;
    const colW = boxW / 3;

    doc.rect(50, boxY, boxW, 60).fill("#f8fafc");
    doc.rect(50, boxY, boxW, 60).stroke(borderColor);

    doc.moveTo(50 + colW, boxY).lineTo(50 + colW, boxY + 60).stroke(borderColor);
    doc.moveTo(50 + colW * 2, boxY).lineTo(50 + colW * 2, boxY + 60).stroke(borderColor);

    doc.fillColor(incomeColor).fontSize(10).font("Helvetica-Bold")
      .text("Total Income", 50, boxY + 10, { width: colW, align: "center" });
    doc.fillColor(incomeColor).fontSize(14).font("Helvetica-Bold")
      .text(formatCurrencyPdf(totalIncome, currency), 50, boxY + 28, { width: colW, align: "center" });

    doc.fillColor(expenseColor).fontSize(10).font("Helvetica-Bold")
      .text("Total Expenses", 50 + colW, boxY + 10, { width: colW, align: "center" });
    doc.fillColor(expenseColor).fontSize(14).font("Helvetica-Bold")
      .text(formatCurrencyPdf(totalExpenses, currency), 50 + colW, boxY + 28, { width: colW, align: "center" });

    doc.fillColor(netSavings >= 0 ? incomeColor : expenseColor).fontSize(10).font("Helvetica-Bold")
      .text("Net Savings", 50 + colW * 2, boxY + 10, { width: colW, align: "center" });
    doc.fillColor(netSavings >= 0 ? incomeColor : expenseColor).fontSize(14).font("Helvetica-Bold")
      .text(formatCurrencyPdf(netSavings, currency), 50 + colW * 2, boxY + 28, { width: colW, align: "center" });

    doc.y = boxY + 70;

    if (Object.keys(incomeByCat).length > 0) {
      doc.moveDown(0.5);
      doc.fillColor(headerBg).fontSize(12).font("Helvetica-Bold").text("Income");
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor(borderColor).stroke();
      doc.moveDown(0.3);
      doc.fontSize(10).font("Helvetica");
      const sortedIncome = Object.entries(incomeByCat).sort((a, b) => b[1].total - a[1].total);
      sortedIncome.forEach(([cat, data]) => {
        doc.fillColor(incomeColor).text(`${formatCurrencyPdf(data.total, currency)}  `, { continued: true });
        doc.fillColor(titleColor).text(cat);
      });
    }

    if (Object.keys(expenseByCat).length > 0) {
      doc.moveDown(0.5);
      doc.fillColor(headerBg).fontSize(12).font("Helvetica-Bold").text("Expenses");
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor(borderColor).stroke();
      doc.moveDown(0.3);
      doc.fontSize(10).font("Helvetica");
      const sortedExpenses = Object.entries(expenseByCat).sort((a, b) => b[1].total - a[1].total);
      sortedExpenses.forEach(([cat, data]) => {
        const pct = totalExpenses > 0 ? ((data.total / totalExpenses) * 100).toFixed(1) : "0.0";
        doc.fillColor(expenseColor).text(`${formatCurrencyPdf(data.total, currency)}  (${pct}%)  `, { continued: true });
        doc.fillColor(titleColor).text(cat);
      });
    }

    if (Object.keys(incomeByCat).length === 0 && Object.keys(expenseByCat).length === 0) {
      doc.moveDown(1);
      doc.fillColor(mutedColor).fontSize(11).font("Helvetica").text("No transactions found for this period.", { align: "center" });
    }

    doc.moveDown(2);
    doc.fillColor(mutedColor).fontSize(9).font("Helvetica")
      .text(`Generated by Finance Manager — ${new Date().toLocaleDateString()}`, { align: "center" });

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// YEAR-END TAX SUMMARY
// =====================

// JSON tax summary
app.get("/api/reports/tax-summary", apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const { year } = req.query;
    if (!year) return res.status(400).json({ error: "year is required" });

    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;

    const rows = db.prepare(`
      SELECT t.id, t.date, t.description, t.amount, t.currency, c.name as category_name, c.tax_deductible
      FROM transactions t
      JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ? AND t.type = 'expense'
      ORDER BY c.tax_deductible DESC, c.name, t.date
    `).all(...pids, startStr, endStr);

    const taxDeductible = rows.filter(r => r.tax_deductible);
    const nonDeductible = rows.filter(r => !r.tax_deductible);

    const byCategory = (rows) => {
      const map = {};
      rows.forEach(r => {
        if (!map[r.category_name]) map[r.category_name] = { total: 0, transactions: [] };
        map[r.category_name].total += r.amount;
        map[r.category_name].transactions.push({
          id: r.id, date: r.date, description: r.description, amount: r.amount, currency: r.currency
        });
      });
      return map;
    };

    res.json({
      year: parseInt(year),
      taxDeductibleTotal: taxDeductible.reduce((s, r) => s + r.amount, 0),
      nonDeductibleTotal: nonDeductible.reduce((s, r) => s + r.amount, 0),
      totalExpenses: rows.reduce((s, r) => s + r.amount, 0),
      taxDeductibleCategories: byCategory(taxDeductible),
      nonDeductibleCategories: byCategory(nonDeductible),
      transactionCount: rows.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Year-end tax summary PDF
app.get("/api/reports/tax-summary-pdf", apiRateLimiter, (req, res) => {
  try {
    const { year } = req.query;
    if (!year || !/^\d{4}$/.test(String(year))) {
      return res.status(400).json({ error: "Valid year is required" });
    }

    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');

    const rows = db.prepare(`
      SELECT t.id, t.date, t.description, t.amount, t.currency, c.name as category_name, c.tax_deductible
      FROM transactions t
      JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ? AND t.type = 'expense'
      ORDER BY c.tax_deductible DESC, c.name, t.date
    `).all(...pids, startStr, endStr);

    const taxRows = rows.filter(r => r.tax_deductible);
    const nonRows = rows.filter(r => !r.tax_deductible);

    const currency = db.prepare(`SELECT value FROM settings WHERE key='local_currency' AND profile_id IN (${inClause}) ORDER BY profile_id DESC LIMIT 1`).get(...pids)?.value || 'USD';
    const symbols = { EUR: "€", USD: "$", GBP: "£", CHF: "CHF " };
    const fmt = (amt) => (symbols[currency] || currency + " ") + amt.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

    const taxTotal = taxRows.reduce((s, r) => s + r.amount, 0);
    const nonTotal = nonRows.reduce((s, r) => s + r.amount, 0);
    const grandTotal = rows.reduce((s, r) => s + r.amount, 0);

    const PDFDocument = require("pdfkit");
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="tax-summary-${year}.pdf"`);
    doc.pipe(res);

    // Colors
    const titleColor = "#1e293b";
    const headerBg = "#f1f5f9";
    const borderColor = "#cbd5e1";
    const taxColor = "#16a34a";
    const nonTaxColor = "#94a3b8";
    const mutedColor = "#64748b";
    const positiveColor = "#059669";

    // Header
    doc.fillColor(titleColor).fontSize(20).font("Helvetica-Bold")
      .text(`Year-End Tax Summary — ${year}`, 50, 50);
    doc.moveDown(0.5);
    doc.fillColor(mutedColor).fontSize(10).font("Helvetica")
      .text(`Generated by Finance Manager — ${new Date().toLocaleDateString()}`, 50, doc.y);
    doc.moveDown(2);

    // Summary box
    const colW = (doc.page.width - 100) / 3;
    const boxY = doc.y;
    doc.rect(50, boxY, doc.page.width - 100, 70).fillColor(headerBg).fill();
    doc.strokeColor(borderColor).rect(50, boxY, doc.page.width - 100, 70).stroke();

    doc.fillColor(taxColor).fontSize(9).font("Helvetica-Bold")
      .text("Tax-Deductible Expenses", 50, boxY + 8, { width: colW, align: "center" });
    doc.fillColor(taxColor).fontSize(13).font("Helvetica-Bold")
      .text(fmt(taxTotal), 50, boxY + 28, { width: colW, align: "center" });
    const taxPct = grandTotal > 0 ? ((taxTotal / grandTotal) * 100).toFixed(1) : "0.0";
    doc.fillColor(mutedColor).fontSize(9).font("Helvetica")
      .text(`${taxPct}% of total`, 50, boxY + 50, { width: colW, align: "center" });

    doc.fillColor(nonTaxColor).fontSize(9).font("Helvetica-Bold")
      .text("Non-Deductible Expenses", 50 + colW, boxY + 8, { width: colW, align: "center" });
    doc.fillColor(nonTaxColor).fontSize(13).font("Helvetica-Bold")
      .text(fmt(nonTotal), 50 + colW, boxY + 28, { width: colW, align: "center" });
    const nonPct = grandTotal > 0 ? ((nonTotal / grandTotal) * 100).toFixed(1) : "0.0";
    doc.fillColor(mutedColor).fontSize(9).font("Helvetica")
      .text(`${nonPct}% of total`, 50 + colW, boxY + 50, { width: colW, align: "center" });

    doc.fillColor(titleColor).fontSize(9).font("Helvetica-Bold")
      .text("Total Expenses", 50 + colW * 2, boxY + 8, { width: colW, align: "center" });
    doc.fillColor(titleColor).fontSize(13).font("Helvetica-Bold")
      .text(fmt(grandTotal), 50 + colW * 2, boxY + 28, { width: colW, align: "center" });
    doc.fillColor(mutedColor).fontSize(9).font("Helvetica")
      .text(`${taxRows.length + nonRows.length} transactions`, 50 + colW * 2, boxY + 50, { width: colW, align: "center" });

    doc.y = boxY + 85;
    doc.moveDown(1);

    // Tax-deductible section
    const drawSection = (title, color, catRows) => {
      doc.fillColor(color).fontSize(12).font("Helvetica-Bold").text(title);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor(borderColor).stroke();
      doc.moveDown(0.3);

      if (catRows.length === 0) {
        doc.fillColor(mutedColor).fontSize(10).font("Helvetica").text("No transactions in this category.");
        doc.moveDown(1);
        return;
      }

      // Group by category
      const byCat = {};
      catRows.forEach(r => {
        if (!byCat[r.category_name]) byCat[r.category_name] = { total: 0, count: 0 };
        byCat[r.category_name].total += r.amount;
        byCat[r.category_name].count++;
      });

      // Table header
      doc.fillColor(mutedColor).fontSize(9).font("Helvetica-Bold")
        .text("Category", 50, doc.y, { width: 220 })
        .text("Transactions", 270, doc.y, { width: 100 })
        .text("Amount", 370, doc.y, { width: 120 });
      doc.moveDown(0.4);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor(borderColor).stroke();
      doc.moveDown(0.4);

      doc.fontSize(10).font("Helvetica");
      Object.entries(byCat).forEach(([cat, data]) => {
        doc.fillColor(titleColor).text(cat, 50, doc.y, { width: 220 })
          .fillColor(mutedColor).text(String(data.count), 270, doc.y, { width: 100 })
          .fillColor(color).text(fmt(data.total), 370, doc.y, { width: 120 });
        doc.moveDown(0.3);
      });

      doc.moveDown(0.5);
    };

    drawSection("Tax-Deductible Expenses", taxColor, taxRows);
    drawSection("Non-Deductible Expenses", nonTaxColor, nonRows);

    // Footer
    doc.moveDown(2);
    doc.fillColor(mutedColor).fontSize(9).font("Helvetica")
      .text("This report is for informational purposes only. Consult a tax professional for official filings.", { align: "center" });

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// YEAR-END P&L REPORT
// =====================

// JSON P&L summary
app.get("/api/reports/pl-summary", apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const { year } = req.query;
    if (!year) return res.status(400).json({ error: "year is required" });

    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;

    const rows = db.prepare(`
      SELECT t.id, t.date, t.description, t.amount, t.currency, t.type, c.name as category_name
      FROM transactions t
      JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ?
      ORDER BY t.type, c.name, t.date
    `).all(...pids, startStr, endStr);

    const income = rows.filter(r => r.type === 'income');
    const expenses = rows.filter(r => r.type === 'expense');

    const byCategory = (txs) => {
      const map = {};
      txs.forEach(r => {
        if (!map[r.category_name]) map[r.category_name] = { total: 0, count: 0 };
        map[r.category_name].total += r.amount;
        map[r.category_name].count++;
      });
      return map;
    };

    const incomeTotal = income.reduce((s, r) => s + r.amount, 0);
    const expenseTotal = expenses.reduce((s, r) => s + r.amount, 0);

    res.json({
      year: parseInt(year),
      income: { total: incomeTotal, byCategory: byCategory(income) },
      expenses: { total: expenseTotal, byCategory: byCategory(expenses) },
      netSavings: incomeTotal - expenseTotal,
      savingsRate: incomeTotal > 0 ? parseFloat(((incomeTotal - expenseTotal) / incomeTotal * 100).toFixed(1)) : 0,
      transactionCount: rows.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Year-end P&L PDF
app.get("/api/reports/pl-summary-pdf", apiRateLimiter, (req, res) => {
  try {
    const { year } = req.query;
    if (!year || !/^\d{4}$/.test(String(year))) {
      return res.status(400).json({ error: "Valid year is required" });
    }

    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');

    const rows = db.prepare(`
      SELECT t.id, t.date, t.description, t.amount, t.currency, t.type, c.name as category_name
      FROM transactions t
      JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ?
      ORDER BY t.type, c.name, t.date
    `).all(...pids, startStr, endStr);

    const incomeRows = rows.filter(r => r.type === 'income');
    const expenseRows = rows.filter(r => r.type === 'expense');

    const currency = db.prepare(`SELECT value FROM settings WHERE key='local_currency' AND profile_id IN (${inClause}) ORDER BY profile_id DESC LIMIT 1`).get(...pids)?.value || 'USD';
    const symbols = { EUR: "€", USD: "$", GBP: "£", CHF: "CHF " };
    const fmt = (amt) => (symbols[currency] || currency + " ") + amt.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

    const incomeTotal = incomeRows.reduce((s, r) => s + r.amount, 0);
    const expenseTotal = expenseRows.reduce((s, r) => s + r.amount, 0);
    const netSavings = incomeTotal - expenseTotal;
    const savingsRate = incomeTotal > 0 ? ((incomeTotal - expenseTotal) / incomeTotal * 100) : 0;

    const PDFDocument = require("pdfkit");
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="pl-summary-${year}.pdf"`);
    doc.pipe(res);

    const titleColor = "#1e293b";
    const headerBg = "#f1f5f9";
    const borderColor = "#cbd5e1";
    const incomeColor = "#059669";
    const expenseColor = "#dc2626";
    const mutedColor = "#64748b";
    const netColor = netSavings >= 0 ? "#059669" : "#dc2626";

    // Header
    doc.fillColor(titleColor).fontSize(20).font("Helvetica-Bold")
      .text(`Year-End P&L Summary — ${year}`, 50, 50);
    doc.moveDown(0.5);
    doc.fillColor(mutedColor).fontSize(10).font("Helvetica")
      .text(`Generated by Finance Manager — ${new Date().toLocaleDateString()}`, 50, doc.y);
    doc.moveDown(2);

    // Summary box
    const colW = (doc.page.width - 100) / 3;
    const boxY = doc.y;
    doc.rect(50, boxY, doc.page.width - 100, 70).fillColor(headerBg).fill();
    doc.strokeColor(borderColor).rect(50, boxY, doc.page.width - 100, 70).stroke();

    doc.fillColor(incomeColor).fontSize(9).font("Helvetica-Bold")
      .text("Total Income", 50, boxY + 8, { width: colW, align: "center" });
    doc.fillColor(incomeColor).fontSize(13).font("Helvetica-Bold")
      .text(fmt(incomeTotal), 50, boxY + 28, { width: colW, align: "center" });
    doc.fillColor(mutedColor).fontSize(9).font("Helvetica")
      .text(`${incomeRows.length} transactions`, 50, boxY + 50, { width: colW, align: "center" });

    doc.fillColor(expenseColor).fontSize(9).font("Helvetica-Bold")
      .text("Total Expenses", 50 + colW, boxY + 8, { width: colW, align: "center" });
    doc.fillColor(expenseColor).fontSize(13).font("Helvetica-Bold")
      .text(fmt(expenseTotal), 50 + colW, boxY + 28, { width: colW, align: "center" });
    doc.fillColor(mutedColor).fontSize(9).font("Helvetica")
      .text(`${expenseRows.length} transactions`, 50 + colW, boxY + 50, { width: colW, align: "center" });

    doc.fillColor(netColor).fontSize(9).font("Helvetica-Bold")
      .text("Net Savings", 50 + colW * 2, boxY + 8, { width: colW, align: "center" });
    doc.fillColor(netColor).fontSize(13).font("Helvetica-Bold")
      .text(fmt(netSavings), 50 + colW * 2, boxY + 28, { width: colW, align: "center" });
    doc.fillColor(mutedColor).fontSize(9).font("Helvetica")
      .text(`Savings rate: ${savingsRate.toFixed(1)}%`, 50 + colW * 2, boxY + 50, { width: colW, align: "center" });

    doc.y = boxY + 85;
    doc.moveDown(1);

    // Helper: draw section
    const drawSection = (title, color, catRows, total) => {
      doc.fillColor(titleColor).fontSize(12).font("Helvetica-Bold").text(title);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor(borderColor).stroke();
      doc.moveDown(0.3);

      if (catRows.length === 0) {
        doc.fillColor(mutedColor).fontSize(10).font("Helvetica").text("No transactions.");
        doc.moveDown(0.5);
        return;
      }

      const byCat = {};
      catRows.forEach(r => {
        if (!byCat[r.category_name]) byCat[r.category_name] = { total: 0, count: 0 };
        byCat[r.category_name].total += r.amount;
        byCat[r.category_name].count++;
      });

      doc.fillColor(mutedColor).fontSize(9).font("Helvetica-Bold")
        .text("Category", 50, doc.y, { width: 220 })
        .text("Transactions", 270, doc.y, { width: 100 })
        .text("Amount", 370, doc.y, { width: 120 })
        .text("% of Total", 470, doc.y, { width: 70 });
      doc.moveDown(0.4);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor(borderColor).stroke();
      doc.moveDown(0.4);

      doc.fontSize(10).font("Helvetica");
      Object.entries(byCat).sort((a, b) => b[1].total - a[1].total).forEach(([cat, data]) => {
        const pct = total > 0 ? ((data.total / total) * 100).toFixed(1) : "0.0";
        doc.fillColor(titleColor).text(cat, 50, doc.y, { width: 220 })
          .fillColor(mutedColor).text(String(data.count), 270, doc.y, { width: 100 })
          .fillColor(color).text(fmt(data.total), 370, doc.y, { width: 120 })
          .fillColor(mutedColor).text(`${pct}%`, 470, doc.y, { width: 70 });
        doc.moveDown(0.3);
      });

      // Total row
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold");
      doc.fillColor(titleColor).text("Total", 50, doc.y, { width: 220 })
        .fillColor(mutedColor).text(String(Object.values(byCat).reduce((s, d) => s + d.count, 0)), 270, doc.y, { width: 100 })
        .fillColor(color).text(fmt(total), 370, doc.y, { width: 120 })
        .fillColor(mutedColor).text("100.0%", 470, doc.y, { width: 70 });
      doc.font("Helvetica");
      doc.moveDown(1);
    };

    drawSection("Income", incomeColor, incomeRows, incomeTotal);
    drawSection("Expenses", expenseColor, expenseRows, expenseTotal);

    // Footer
    doc.moveDown(2);
    doc.fillColor(mutedColor).fontSize(9).font("Helvetica")
      .text(`Total: ${rows.length} transactions | Net Savings: ${fmt(netSavings)} (${savingsRate.toFixed(1)}% savings rate)`, { align: "center" });

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ANNUAL FINANCIAL REPORT PDF
// ============================
// Uses puppeteer to render charts via a dedicated export page, then embeds screenshot in PDF
app.get("/api/reports/annual-pdf", apiRateLimiter, async (req, res) => {
  try {
    const { year } = req.query;

    if (!year || !/^\d{4}$/.test(String(year))) {
      return res.status(400).json({ error: "Valid year is required" });
    }

    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');

    // --- Fetch all data server-side ---
    const currencyRow = db.prepare(
      `SELECT value FROM settings WHERE key='local_currency' AND (profile_id IN (${inClause}) OR profile_id IS NULL) ORDER BY profile_id DESC LIMIT 1`
    ).get(...pids);
    const currency = currencyRow?.value || "USD";

    // Category breakdown (for doughnut chart)
    const byCategory = db.prepare(`
      SELECT c.name, c.color, SUM(COALESCE(t.amount_local, t.amount)) as total
      FROM transactions t
      JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.type = 'expense' AND t.date >= ? AND t.date <= ?
      GROUP BY c.id
      ORDER BY total DESC
    `).all(...pids, `${year}-01-01`, `${year}-12-31`);

    // Monthly data for bar and line charts + breakdown table
    const monthly = db.prepare(`
      SELECT strftime('%m', date) as month_num,
             type, SUM(COALESCE(amount_local, amount)) as total
      FROM transactions
      WHERE profile_id IN (${inClause}) AND date >= ? AND date <= ? AND type IN ('income', 'expense')
      GROUP BY month_num, type
      ORDER BY month_num
    `).all(...pids, `${year}-01-01`, `${year}-12-31`);

    const monthlyMap = {};
    for (let m = 1; m <= 12; m++) {
      monthlyMap[String(m).padStart(2, '0')] = { income: 0, expense: 0 };
    }
    for (const r of monthly) {
      if (r.type === "income") monthlyMap[r.month_num].income = r.total;
      if (r.type === "expense") monthlyMap[r.month_num].expense = r.total;
    }

    const monthlyArr = Object.entries(monthlyMap).map(([m, v]) => ({
      month: m,
      income: v.income,
      expense: v.expense,
    }));

    let totalIncome = 0, totalExpenses = 0;
    let running = 0;
    const cashFlow = [];
    for (const row of monthlyArr) {
      totalIncome += row.income;
      totalExpenses += row.expense;
      running += row.income - row.expense;
      cashFlow.push({ month: row.month, cumulative: running });
    }

    const netSavings = totalIncome - totalExpenses;
    const savingsRate = totalIncome > 0 ? Math.round((netSavings / totalIncome) * 100) : 0;

    // Prepare data for the export page
    const exportData = {
      year: parseInt(year),
      currency,
      summary: { totalIncome, totalExpense: totalExpenses, netSavings, savingsRate },
      byCategory,
      monthly: monthlyArr,
      cashFlow,
    };

    // --- Use puppeteer to render and export as PDF directly ---
    let pdfBuffer = null;

    try {
      const puppeteer = require("puppeteer");

      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });

      try {
        const exportPage = await browser.newPage();
        await exportPage.setViewport({ width: 900, height: 1200, deviceScaleFactor: 2 });

        // Inject data into the page before it loads scripts
        await exportPage.evaluateOnNewDocument((data) => {
          window.__DATA__ = data;
        }, exportData);

        const baseUrl = `http://localhost:${PORT}`;
        await exportPage.goto(`${baseUrl}/export.html`, { waitUntil: 'networkidle0', timeout: 30000 });

        // Wait for the page to signal that charts have finished rendering
        await exportPage.waitForFunction(() => window.__RENDER_DONE__ === true, { timeout: 30000 });

        // Generate PDF directly from the rendered page (puppeteer returns Uint8Array, convert to Buffer)
        pdfBuffer = Buffer.from(await exportPage.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
        }));
      } finally {
        await browser.close();
      }
    } catch (puppeteerErr) {
      console.error('Puppeteer render failed:', puppeteerErr.message);
    }

    // --- Return the PDF directly ---
    if (pdfBuffer && pdfBuffer.length > 1000) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="annual-report-${year}.pdf"`);
      return res.send(pdfBuffer);
    }

    // Fallback: if puppeteer failed, generate text-only PDF
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="annual-report-${year}.pdf"`);
    doc.pipe(res);

    const titleColor = "#1e293b";
    const headerBg = "#f1f5f9";
    const borderColor = "#cbd5e1";
    const incomeColor = "#059669";
    const expenseColor = "#dc2626";
    const mutedColor = "#64748b";
    const netColor = netSavings >= 0 ? "#059669" : "#dc2626";
    const pageW = doc.page.width - 80;
    const symbols = { EUR: "€", USD: "$", GBP: "£", CHF: "CHF " };
    const fmt = (amt) => (symbols[currency] || currency + " ") + amt.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

    // Header
    doc.fillColor(titleColor).fontSize(22).font("Helvetica-Bold")
      .text(`Annual Financial Report \u2014 ${year}`, 50, 50, { width: pageW, align: "center" });
    doc.moveDown(0.3);
    doc.fillColor(mutedColor).fontSize(11).font("Helvetica")
      .text(`Finance Manager  |\u00a0 Generated: ${new Date().toLocaleDateString()}`, { align: "center" });

    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor(borderColor).stroke();

    // P&L Summary box
    const boxH = 65;
    const boxY = doc.y + 10;
    const colW = pageW / 3;

    doc.fillColor(headerBg).rect(50, boxY, pageW, boxH).fill();
    doc.strokeColor(borderColor).rect(50, boxY, pageW, boxH).stroke();

    doc.y = boxY + 10;
    doc.fillColor(titleColor).fontSize(12).font("Helvetica-Bold")
      .text(`${year} Annual Summary`, 50, doc.y, { width: pageW, align: "center" });
    doc.y += 14;

    doc.fontSize(10).font("Helvetica");
    doc.fillColor(incomeColor).font("Helvetica-Bold").fontSize(10)
      .text("Total Income", 50 + 10, doc.y, { width: colW, align: "center" });
    doc.fillColor(incomeColor).fontSize(14)
      .text(fmt(totalIncome), 50 + 10, doc.y + 14, { width: colW, align: "center" });

    doc.fillColor(expenseColor).font("Helvetica-Bold").fontSize(10)
      .text("Total Expenses", 50 + colW + 10, doc.y, { width: colW, align: "center" });
    doc.fillColor(expenseColor).fontSize(14)
      .text(fmt(totalExpenses), 50 + colW + 10, doc.y + 14, { width: colW, align: "center" });

    doc.fillColor(netColor).font("Helvetica-Bold").fontSize(10)
      .text("Net Savings", 50 + colW * 2 + 10, doc.y, { width: colW, align: "center" });
    doc.fillColor(netColor).fontSize(14)
      .text(fmt(netSavings), 50 + colW * 2 + 10, doc.y + 14, { width: colW, align: "center" });

    // Note about charts
    doc.moveDown(2);
    doc.addPage();
    doc.fillColor(mutedColor).fontSize(12).font("Helvetica")
      .text("Note: Charts could not be rendered in this session. Please try again later.", 50, doc.y, { width: pageW, align: "center" });

    // Monthly Breakdown Table
    doc.moveDown(2);
    if (doc.y > doc.page.height - 280) {
      doc.addPage();
      doc.y = 50;
    }

    doc.moveDown(0.5);
    doc.fillColor(titleColor).fontSize(13).font("Helvetica-Bold").text("Monthly Breakdown");
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor(borderColor).stroke();
    doc.moveDown(0.3);

    const tableTop = doc.y;
    const tcol = { month: 90, income: 120, expense: 120, net: 110, balance: 110 };
    const rowH = 18;
    const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

    doc.fillColor(headerBg).rect(50, tableTop, pageW, rowH).fill();
    doc.strokeColor(borderColor).rect(50, tableTop, pageW, rowH).stroke();
    doc.fillColor(titleColor).fontSize(9).font("Helvetica-Bold");
    doc.text("Month", 54, tableTop + 5, { width: tcol.month, align: "left" });
    doc.text("Income", 54 + tcol.month, tableTop + 5, { width: tcol.income, align: "right" });
    doc.text("Expenses", 54 + tcol.month + tcol.income, tableTop + 5, { width: tcol.expense, align: "right" });
    doc.text("Net", 54 + tcol.month + tcol.income + tcol.expense, tableTop + 5, { width: tcol.net, align: "right" });
    doc.text("Balance", 54 + tcol.month + tcol.income + tcol.expense + tcol.net, tableTop + 5, { width: tcol.balance, align: "right" });

    let runningBal = 0;
    for (let m = 1; m <= 12; m++) {
      const monthStr = String(m).padStart(2, '0');
      const inc = monthlyMap[monthStr].income;
      const exp = monthlyMap[monthStr].expense;
      const net = inc - exp;
      runningBal += net;

      const rowY = tableTop + rowH * m;
      const bg = m % 2 === 0 ? "#f8fafc" : "#ffffff";
      doc.fillColor(bg).rect(50, rowY, pageW, rowH).fill();
      doc.strokeColor(borderColor).rect(50, rowY, pageW, rowH).stroke();

      doc.fillColor(titleColor).fontSize(9).font("Helvetica");
      doc.text(monthNames[m - 1], 54, rowY + 4, { width: tcol.month, align: "left" });
      doc.fillColor(incomeColor).fontSize(9).text(inc.toFixed(2), 54 + tcol.month, rowY + 4, { width: tcol.income, align: "right" });
      doc.fillColor(expenseColor).fontSize(9).text(exp.toFixed(2), 54 + tcol.month + tcol.income, rowY + 4, { width: tcol.expense, align: "right" });
      doc.fillColor(net >= 0 ? incomeColor : expenseColor).fontSize(9).text(net.toFixed(2), 54 + tcol.month + tcol.income + tcol.expense, rowY + 4, { width: tcol.net, align: "right" });
      doc.fillColor(runningBal >= 0 ? incomeColor : expenseColor).fontSize(9).text(runningBal.toFixed(2), 54 + tcol.month + tcol.income + tcol.expense + tcol.net, rowY + 4, { width: tcol.balance, align: "right" });
    }

    doc.y = Math.max(doc.y, tableTop + rowH * 13) + 20;
    doc.fillColor(mutedColor).fontSize(9).font("Helvetica")
      .text(`Generated by Finance Manager \u2014 ${new Date().toLocaleDateString()}`, { align: "center" });

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catch-all: serve index.html for SPA
// Test-only endpoint to reset rate limit store (used between test files)
if (process.env.NODE_ENV === 'test') {
  app.post('/api/test/reset-rate-limit', (req, res) => {
    if (global.__rateLimitStore) global.__rateLimitStore.clear();
    if (global.__authRateLimitStore) global.__authRateLimitStore.clear();
    res.json({ ok: true });
  });
}

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Finance Manager running on port ${PORT}`);
});
