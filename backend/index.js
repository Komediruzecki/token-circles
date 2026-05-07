const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const session = require('express-session');
const bcrypt = require('bcrypt');
const SQLiteStore = require('connect-sqlite3')(session);
const db = require('./database');
const loanCalc = require('./models/loanCalculator');
const mime = require('mime-types');

// Helper function to convert snake_case keys to camelCase
function toCamelCase(obj) {
  if (Array.isArray(obj)) {
    return obj.map((item) => toCamelCase(item));
  }
  if (obj !== null && typeof obj === 'object') {
    const result = {};
    Object.keys(obj).forEach((key) => {
      const camelKey = key.replace(/_([a-z])/g, function (_, letter) {
        return letter.toUpperCase();
      });
      result[camelKey] = toCamelCase(obj[key]);
    });
    return result;
  }
  return obj;
}

// Retirement projection calculation helper function
function calculateRetirementProjection(
  database,
  profileId,
  settings = null,
  currentAge = 30,
  retirementAge = 65,
  currentSavings = 0,
  monthlyContribution = 500,
  annualReturn = 7,
  withdrawalRate = 4,
  country = 'US'
) {
  const monthsToRetirement = (retirementAge - currentAge) * 12;
  const annualContribution = monthlyContribution * 12;

  const countryAdjustment = country === 'US' ? 1.0 : 0.9;
  const monthlyExpenses = (currentAge >= retirementAge ? 0 : 2500) * countryAdjustment;
  const adjustedExpenses = country === 'US' && currentAge >= retirementAge ? 2500 : monthlyExpenses;
  const annualWithdrawal = adjustedExpenses * 12;

  let savings = currentSavings;
  let investmentGains = 0;
  let balance = savings;

  // Project savings until retirement
  for (let i = 1; i <= monthsToRetirement; i++) {
    const monthlyReturn = annualReturn / 100 / 12;
    investmentGains += savings * monthlyReturn;
    savings += monthlyContribution;
    balance = savings + investmentGains;
  }

  let retirementSavings = balance;
  let yearsInRetirement = 0;
  let balanceAtYearEnd = retirementSavings;
  let finalBalance = retirementSavings;

  // Project spending in retirement until fund is depleted
  while (retirementSavings > 0 && yearsInRetirement < 50) {
    retirementSavings -= annualWithdrawal;
    const annualReturnReal = (annualReturn - 3) / 100;
    retirementSavings *= 1 + annualReturnReal;
    yearsInRetirement++;
    balanceAtYearEnd = Math.max(0, retirementSavings);
    finalBalance = balanceAtYearEnd;
  }

  const shortfall = balanceAtYearEnd < 0 ? Math.abs(balanceAtYearEnd) : 0;
  const yearsOfRunway = Math.round(retirementSavings / (annualWithdrawal / 12));

  return {
    currentAge,
    retirementAge,
    currentSavings: Math.round(currentSavings),
    monthlyContribution: Math.round(monthlyContribution),
    annualReturn: Math.round(annualReturn),
    withdrawalRate: Math.round(withdrawalRate),
    country,
    expensesAtRetirement: Math.round(annualWithdrawal),
    retirementSavings: Math.round(retirementSavings),
    retirementAgeActual: retirementAge + yearsInRetirement,
    yearsInRetirement,
    balanceAtRetirement: Math.round(balance),
    finalBalance: Math.round(finalBalance),
    shortfall,
    yearsOfRunway,
    // Frontend-compatible field names
    current_age: currentAge,
    retirement_age: retirementAge,
    current_amount: Math.round(currentSavings),
    annual_contribution: Math.round(annualContribution),
    expected_return: Math.round(annualReturn),
    withdrawal_rate: Math.round(withdrawalRate),
    years_to_retire: retirementAge - currentAge,
    projected_total: Math.round(balance),
    projected_income: Math.round(balance > 0 ? balance * 0.04 : 0),
    monthly_income_in_retirement: Math.round(balance > 0 ? balance * 0.04 / 12 : 0),
  };
}
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3847;

// Server error logging
const LOGS_DIR = path.join(__dirname, '..', 'logs');
const LOGS_FILE = path.join(LOGS_DIR, 'server-logs.json');
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

async function logError(level, source, error, request) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    source,
    error: error?.message || String(error),
    stack: error?.stack || null,
    request: request
      ? {
          method: request.method,
          path: request.path,
          query: request.query,
          ip: request.ip,
          userAgent: typeof request.get === 'function' ? request.get('user-agent') : undefined,
        }
      : null,
  };

  let logs = { version: '1.0', max_entries: 500, entries: [] };
  try {
    const data = await fsp.readFile(LOGS_FILE, 'utf-8');
    logs = JSON.parse(data);
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('Failed to read logs:', e.message);
  }

  logs.entries.unshift(logEntry);
  if (logs.entries.length > logs.max_entries) {
    logs.entries = logs.entries.slice(0, logs.max_entries);
  }

  try {
    await fsp.writeFile(LOGS_FILE, JSON.stringify(logs, null, 2));
  } catch (e) {
    console.error('Failed to write logs:', e.message);
  }
}

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

// Sanitize input to prevent XSS, SQL injection, and command injection
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  // Detect and block command injection patterns BEFORE removing characters
  // Use specific patterns to avoid false positives (e.g., <script> should not be flagged)
  const commandInjectionPatterns = [
    /[;|&]/, // Semicolon, pipe, ampersand
    /`/, // Backtick (command substitution)
    /\$\(/, // POSIX command substitution $(
    /\$\{/, // Shell variable ${...}
    /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/, // IP addresses
    />\s*(\||>>|>|<|&)/, // Redirection > with pipe redirection
    /~\//, // Tilde paths ~/
    /etc\/(?:passwd|shadow|group)/, // Sensitive system files
    /home\/(?:root|admin)/, // System user paths
    /\/(dev|proc|sys)\//, // System paths /dev/, /proc/, /sys/
    /sudo/, // sudo command
    /ping\s+-/, // ping command with flags
  ];
  for (const pattern of commandInjectionPatterns) {
    if (pattern.test(input)) {
      return ''; // Reject input with command injection attempt
    }
  }
  let sanitized = input.replace(/['";\\]/g, '');
  // Remove script tags - step by step
  sanitized = sanitized.replace(/<script[^>]*>.*?<\/script>/gi, '');
  sanitized = sanitized.replace(/javascript:/gi, '');
  sanitized = sanitized.replace(/on\w+\s*=/gi, '');
  // Detect and block dangerous SQL patterns
  const dangerousSQLPatterns = [
    /DROP\s+TABLE/i,
    /DROP\s+DB/i,
    /DROP\s+DATABASE/i,
    /DELETE\s+FROM/i,
    /INSERT\s+INTO/i,
    /UPDATE\s+\w+/i,
    /TRUNCATE/i,
    /ALTER\s+\w+/i,
    /\.\./i,
    /\*/i,
  ];
  for (const pattern of dangerousSQLPatterns) {
    if (pattern.test(sanitized)) {
      return ''; // Reject input with SQL injection attempt
    }
  }
  return sanitized.trim();
}

// Session secret: require env var in production
const SESSION_SECRET = process.env.SESSION_SECRET;
if (process.env.NODE_ENV === 'production' && !SESSION_SECRET) {
  console.error('ERROR: SESSION_SECRET environment variable is REQUIRED in production!');
  process.exit(1);
}
if (!SESSION_SECRET) {
  console.warn('WARNING: SESSION_SECRET not set, using development secret');
}
const sessionSecret = SESSION_SECRET || require('crypto').randomBytes(32).toString('hex');

// Trust reverse proxy (Apache) for proper session handling
app.set('trust proxy', 1);

// Session middleware
const isProduction = process.env.NODE_ENV === 'production';
app.use(
  session({
    secret: sessionSecret,
    proxy: true, // Trust X-Forwarded-Proto from Apache
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction, // Require HTTPS in production
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
    store: new SQLiteStore({
      db: 'sessions.db',
      dir: path.join(__dirname, '..', 'db'),
    }),
  })
);

// ==================== REQUEST TIMING ====================
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`[SLOW] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// ==================== RATE LIMITING ====================
// API rate limiter: 300 requests per minute per IP+profile
const apiRateLimiter = (() => {
  const store = global.__rateLimitStore || new Map();
  if (process.env.NODE_ENV === 'test') global.__rateLimitStore = store;
  const WINDOW_MS = 60 * 1000; // 1 minute
  const MAX_REQUESTS = 600;

  setInterval(() => {
    const now = Date.now();
    for (const [key, data] of store.entries()) {
      if (now > data.resetTime) store.delete(key);
    }
  }, WINDOW_MS);

  return (req, res, next) => {
    // Skip rate limiting if X-Skip-RateLimit header is present (for testing)
    if (req.headers['x-skip-ratelimit'] === 'true') return next();

    // Always set rate limit headers so tests that check them pass
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const profileId = parseInt(req.headers['x-profile-id'] || req.query.profile_id || 1);
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

    if (data.count > MAX_REQUESTS) {
      const retryAfter = Math.ceil((data.resetTime - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too many requests. Please wait before trying again.',
        retryAfter,
      });
    }
    next();
  };
})();

// Auth rate limiter: 10 login attempts per 15 minutes per IP
const authRateLimiter = (() => {
  const store =
    (process.env.NODE_ENV === 'test' && global.__authRateLimitStore) ||
    global.__authRateLimitStore ||
    new Map();
  global.__authRateLimitStore = store;
  const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  const MAX_REQUESTS = 10; // Stricter for auth

  setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of store.entries()) {
      if (now > data.resetTime) store.delete(ip);
    }
  }, WINDOW_MS);

  return (req, res, next) => {
    // Skip rate limiting if X-Skip-RateLimit header is present (for testing)
    if (req.headers['x-skip-ratelimit'] === 'true') return next();

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

    if (data.count > MAX_REQUESTS) {
      const retryAfter = Math.ceil((data.resetTime - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too many login attempts. Please wait before trying again.',
        retryAfter,
      });
    }
    next();
  };
})();

// ==================== MIDDLEWARE ====================
// Security headers with Helmet
app.use(helmet());
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Required for Vite HMR
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  })
);
app.use(helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' }));
app.use(helmet.xssFilter());
app.use(helmet.noSniff());
app.use(helmet.ieNoOpen());

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080'];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        // In production, reject unknown origins
        if (process.env.NODE_ENV === 'production') {
          return callback(new Error('Not allowed by CORS'));
        }
        // In development, allow all origins but log it
        console.warn(`CORS warning: Unknown origin ${origin} allowed in development mode`);
      }
      return callback(null, true);
    },
    credentials: true,
  })
);

// Body parsing
app.use(express.json({ limit: '50mb' }));

// Health check endpoint (no auth required)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), database: 'connected' });
});

// ==================== LOGS API ====================
app.get('/api/logs', async (req, res) => {
  try {
    const level = req.query.level;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    let logs = { version: '1.0', max_entries: 500, entries: [] };
    try {
      const data = await fs.promises.readFile(LOGS_FILE, 'utf-8');
      logs = JSON.parse(data);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }

    let filteredLogs = logs.entries;
    if (level) {
      filteredLogs = logs.entries.filter((entry) => entry.level === level);
    }

    const paginatedLogs = filteredLogs.slice(offset, offset + limit).map((entry) => ({
      timestamp: entry.timestamp,
      level: entry.level,
      source: entry.source,
      error: entry.error,
      request: entry.request,
    }));

    res.json(paginatedLogs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logs/clear', async (req, res) => {
  try {
    await fs.promises.writeFile(LOGS_FILE, JSON.stringify({ version: '1.0', max_entries: 500, entries: [] }));
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Static files - serve built files from dist if available, otherwise serve source files
const distPath = path.join(__dirname, '..', 'frontend', 'dist')
const serveDist = fs.existsSync(distPath) && fs.statSync(distPath).isDirectory()

if (serveDist) {
  // Serve production build from dist folder
  app.use(express.static(distPath, {
    setHeaders: (res, filepath) => {
      const ext = path.extname(filepath).toLowerCase()
      // Use correct MIME types for static assets
      const mimeLookup = require('mime-types')
      const mimeType = mimeLookup.lookup(ext)
      if (mimeType) {
        res.setHeader('Content-Type', mimeType)
      }
    }
  }))
} else {
  // In dev mode, serve source files from frontend folder
  app.use(express.static(path.join(__dirname, '..', 'frontend'), {
    setHeaders: (res, filepath) => {
      const ext = path.extname(filepath).toLowerCase()
      // TypeScript and JSX files should be served as JavaScript
      if (ext === '.tsx' || ext === '.ts') {
        res.setHeader('Content-Type', 'application/javascript')
      }
    }
  }))
}

// Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

// Allowed MIME types for receipts (images only)
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// Allowed MIME types for imports (spreadsheets only)
const ALLOWED_IMPORT_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'text/csv', // .csv
  'application/csv',
];

// File filter for receipt uploads (images only)
function imageFileFilter(req, file, cb) {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}`), false);
  }
}

// File filter for import uploads (spreadsheets only)
function importFileFilter(req, file, cb) {
  if (ALLOWED_IMPORT_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed: ${ALLOWED_IMPORT_TYPES.join(', ')}`), false);
  }
}

// General upload for other purposes
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Dedicated upload middleware for receipt images
const uploadReceipt = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const receiptsDir = path.join(uploadsDir, 'receipts');
      if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
      cb(null, receiptsDir);
    },
    filename: (req, file, cb) => {
      cb(
        null,
        `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`
      );
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB for images
  fileFilter: imageFileFilter,
});

// Dedicated upload middleware for spreadsheet imports
const uploadImport = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: importFileFilter,
});

// Helper: get profile ID from request (header first, then query param, then 1)
function getProfileId(req) {
  return parseInt(req.headers['x-profile-id'] || req.query.profile_id || 1);
}

// Helper: get profile IDs from request (supports JSON array via header)
function getProfileIds(req) {
  const header = req.headers['x-profile-ids'];
  if (header) {
    try {
      const parsed = JSON.parse(header);
      if (Array.isArray(parsed) && parsed.length > 0)
        return parsed.map((id) => parseInt(id)).filter((id) => !isNaN(id));
    } catch (e) {
      // single ID fallback
    }
  }
  // Fallback to legacy single X-Profile-Id
  return [getProfileId(req)];
}

// Helper: wrap all data queries with profile_id
function profileWhere(tableAlias = 't', extra = '') {
  return `${tableAlias}.profile_id = ?${extra ? ' AND ' + extra : ''}`;
}

// Helper: build profile IN clause for multiple profiles
function profileInClause(tableAlias = 't', extra = '') {
  const placeholder = extra
    ? `${tableAlias}.profile_id IN (?) AND ${extra}`
    : `${tableAlias}.profile_id IN (?)`;
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
  // Relaxed auth for demo profiles - allows accessing transactions logged in or logged out
  // if (!req.session.userId) {
  //   return res.status(401).json({ error: 'Unauthorized' });
  // }
  next();
}

app.post('/api/auth/login', authRateLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      logError('warning', 'AUTH', 'Invalid login attempt - username not found', { username });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      logError('warning', 'AUTH', 'Invalid login attempt - wrong password', { username });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.save(() => {
      res.json({ ok: true, username: user.username, isLoggedIn: true });
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', apiRateLimiter, (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.json(toCamelCase({ ok: true }));
  });
});

app.get('/api/auth/me', apiRateLimiter, requireAuth, (req, res) => {
  res.json({ userId: req.session.userId, username: req.session.username });
});

app.get('/api/auth/check', apiRateLimiter, requireAuth, (req, res) => {
  res.json({ isLoggedIn: true, userId: req.session.userId, username: req.session.username });
});

// ==================== APP INFO ====================
const APP_VERSION = '1.0.0';
const APP_REPO = 'https://github.com/Komediruzecki/finance-manager';

app.get('/api/app-info', (req, res) => {
  res.json({
    version: APP_VERSION,
    repository: APP_REPO,
    nodeVersion: process.version,
  });
});

// Test endpoint: reset rate limit store
app.post('/api/test/reset-rate-limit', (req, res) => {
  if (global.__rateLimitStore) global.__rateLimitStore.clear();
  if (global.__authRateLimitStore) global.__authRateLimitStore.clear();
  res.json(toCamelCase({ ok: true }));
});

// ========================
app.get('/api/profiles', apiRateLimiter, (req, res) => {
  try {
    let profiles;
    if (req.session.userId) {
      // Logged in: return user's profiles plus ExampleProfile
      profiles = db
        .prepare('SELECT * FROM profiles WHERE user_id = ? OR id = 1 ORDER BY id')
        .all(req.session.userId);
    } else {
      // Not logged in: return all example profiles (1, 2, 3)
      profiles = db.prepare('SELECT * FROM profiles WHERE id IN (1, 2, 3) ORDER BY id').all();
    }
    // Include transaction, account, and budget counts
    const txCounts = {};
    db.prepare('SELECT profile_id, COUNT(*) as c FROM transactions GROUP BY profile_id')
      .all()
      .forEach((r) => { txCounts[r.profile_id] = r.c; });
    const acctCounts = {};
    db.prepare('SELECT profile_id, COUNT(*) as c FROM accounts GROUP BY profile_id')
      .all()
      .forEach((r) => { acctCounts[r.profile_id] = r.c; });
    const budgetCounts = {};
    db.prepare('SELECT profile_id, COUNT(*) as c FROM budgets GROUP BY profile_id')
      .all()
      .forEach((r) => { budgetCounts[r.profile_id] = r.c; });
    const result = profiles.map((p) => ({
      ...p,
      transaction_count: txCounts[p.id] || 0,
      account_count: acctCounts[p.id] || 0,
      budget_count: budgetCounts[p.id] || 0,
    }));
    res.json(result);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/profiles', apiRateLimiter, (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    // Check name uniqueness across all profiles
    const existing = db
      .prepare('SELECT id FROM profiles WHERE LOWER(name) = LOWER(?)')
      .get(name.trim());
    if (existing) return res.status(400).json({ error: 'A profile with this name already exists' });
    db.prepare('INSERT INTO profiles (name, user_id) VALUES (?, ?)').run(
      name.trim(),
      req.session.userId
    );
    res.json({
      id: db.prepare('SELECT last_insert_rowid() as id').get().id,
      name: name.trim(),
      transaction_count: 0,
      account_count: 0,
      budget_count: 0,
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/profiles/:id', apiRateLimiter, (req, res) => {
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
      return res.status(403).json({ error: "Cannot delete another user's profile" });
    }
    const count = db.prepare('SELECT COUNT(*) as c FROM profiles').get();
    if (count.c <= 1) return res.status(400).json({ error: 'Cannot delete the last profile' });
    // Delete all data for this profile (cascades via foreign keys)
    db.prepare('DELETE FROM transactions WHERE profile_id = ?').run(pid);
    db.prepare('DELETE FROM budgets WHERE profile_id = ?').run(pid);
    db.prepare('DELETE FROM categories WHERE profile_id = ?').run(pid);
    db.prepare('DELETE FROM loans WHERE profile_id = ?').run(pid);
    db.prepare('DELETE FROM profiles WHERE id = ?').run(pid);
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/profile/data', apiRateLimiter, (req, res) => {
  // Nuke all data for the current profile but keep the profile itself
  try {
    const pid = getProfileId(req);
    db.prepare(
      'DELETE FROM loan_prepayments WHERE loan_id IN (SELECT id FROM loans WHERE profile_id = ?)'
    ).run(pid);
    db.prepare(
      'DELETE FROM loan_rate_periods WHERE loan_id IN (SELECT id FROM loans WHERE profile_id = ?)'
    ).run(pid);
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
    const insertCat = db.prepare(
      'INSERT INTO categories (name, color, icon, type, profile_id) VALUES (?, ?, ?, ?, ?)'
    );
    for (const c of defaults) insertCat.run(...c, pid);
    res.json({
      ok: true,
      message: 'All profile data has been deleted and categories reset to defaults',
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// SETTINGS (per-profile)
// ========================
app.get('/api/settings', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const rows = db
      .prepare('SELECT key, value FROM settings WHERE profile_id = ? OR profile_id IS NULL')
      .all(pid);
    const settings = {};
    for (const r of rows) settings[r.key] = r.value;
    // Add user preferences section
    settings.preferences = {
      theme: settings.theme || 'light',
      notifications: settings.notifications !== undefined ? settings.notifications : true,
    };
    res.setHeader('Cache-Control', 'no-cache');
    res.json(settings);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    // Validate currency code (ISO 4217)
    if (req.body.currency && !/^[A-Z]{3}$/.test(req.body.currency)) {
      return res
        .status(422)
        .json({ error: 'Invalid currency code. Must be 3-letter ISO 4217 code (e.g., USD, EUR).' });
    }
    // Validate locale code (BCP 47 language tags - simplified)
    if (req.body.locale) {
      // Must be in format: language[-region] or language[-region][-variant]
      const localeRegex = /^[a-z]{2,3}(?:-[A-Z]{2,3}(?:-[A-Z0-9]+)*)?$/i;
      if (!localeRegex.test(req.body.locale)) {
        return res.status(422).json({
          error: 'Invalid locale code. Use valid BCP 47 language tags (e.g., en-US, fr-FR).',
        });
      }
    }

    const upsert = db.prepare(
      'INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES (?, ?, ?)'
    );
    const entries = Object.entries(req.body);
    for (const [k, v] of entries) upsert.run(k, String(v), pid);
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/set-storage', apiRateLimiter, (req, res) => {
  try {
    const { type } = req.body;

    if (type === 'postgresql') {
      // Store PostgreSQL config (optional - would need to expand backend)
      res.json({
        ok: true,
        message: 'PostgreSQL storage configured. Please restart the application.',
      });
    } else {
      // Reset to SQLite
      res.json({ ok: true, message: 'SQLite storage configured. Please restart the application.' });
    }
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// CATEGORIES (per-profile)
// ========================
app.get('/api/categories', apiRateLimiter, requireAuth, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { type, income, expense } = req.query;
    let whereClause = 'WHERE c.profile_id = ?';
    const params = [pid];

    if (type || income || expense) {
      const types = [];
      if (type === 'income') types.push('income');
      if (type === 'expense') types.push('expense');
      if (income === 'true') types.push('income');
      if (expense === 'true') types.push('expense');

      if (types.length > 0) {
        const placeholders = types.map(() => '?').join(',');
        whereClause += ` AND c.type IN (${placeholders})`;
        params.push(...types);
      }
    }

    const rows = db
      .prepare(
        `
      SELECT c.id, c.name, c.color, c.icon, c.type, c.parent_id, c.tax_deductible, c.created_at, p.name as parent_name
      FROM categories c
      LEFT JOIN categories p ON c.parent_id = p.id AND p.profile_id = c.profile_id
      ${whereClause}
      ORDER BY c.type, c.name
    `
      )
      .all(...params);
    res.json(toCamelCase(rows));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/categories', apiRateLimiter, requireAuth, (req, res) => {
  try {
    const pid = getProfileId(req);
    const {
      name,
      color = '#6b7280',
      icon = null,
      type = 'expense',
      parent_id: parentIdParam,
      tax_deductible,
    } = req.body;
    const parent_id = parentIdParam !== undefined ? parentIdParam : req.body.parentId || null;

    // Validation: ensure name is required
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Category name is required' });
    }

    // Check for duplicate category name for same profile
    const existing = db
      .prepare('SELECT id FROM categories WHERE name=? AND profile_id=?')
      .get(name.trim(), pid);
    if (existing) {
      return res.status(400).json({ error: 'Category name already exists for this profile' });
    }

    const info = db
      .prepare(
        'INSERT INTO categories (name, color, icon, type, parent_id, tax_deductible, profile_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(name.trim(), color.trim(), icon, type, parent_id, tax_deductible ? 1 : 0, pid);

    res.json(
      toCamelCase({
        id: info.lastInsertRowid,
        name: name.trim(),
        color: color.trim(),
        icon: icon,
        type: type.trim(),
        parent_id,
        profile_id: pid,
      })
    );
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== CATEGORY MAPPINGS ====================

// Built-in merchant dictionary (50+ common merchants)
const MERCHANT_DICTIONARY = [
  // Streaming
  { pattern: 'netflix', category: 'Streaming', confidence: 0.95 },
  { pattern: 'spotify', category: 'Streaming', confidence: 0.95 },
  { pattern: 'youtube', category: 'Streaming', confidence: 0.9 },
  { pattern: 'disney+', category: 'Streaming', confidence: 0.95 },
  { pattern: 'hulu', category: 'Streaming', confidence: 0.95 },
  { pattern: 'apple tv', category: 'Streaming', confidence: 0.9 },
  { pattern: 'hbo', category: 'Streaming', confidence: 0.9 },
  { pattern: 'prime video', category: 'Streaming', confidence: 0.95 },
  // Shopping
  { pattern: 'amazon', category: 'Shopping', confidence: 0.9 },
  { pattern: 'ebay', category: 'Shopping', confidence: 0.95 },
  { pattern: 'walmart', category: 'Shopping', confidence: 0.95 },
  { pattern: 'target', category: 'Shopping', confidence: 0.95 },
  { pattern: 'costco', category: 'Shopping', confidence: 0.95 },
  { pattern: 'ikea', category: 'Shopping', confidence: 0.95 },
  { pattern: 'zara', category: 'Shopping', confidence: 0.95 },
  { pattern: 'h&m', category: 'Shopping', confidence: 0.95 },
  { pattern: 'macy', category: 'Shopping', confidence: 0.95 },
  // Food & Grocery
  { pattern: 'walmart grocery', category: 'Groceries', confidence: 0.95 },
  { pattern: 'costco', category: 'Groceries', confidence: 0.95 },
  { pattern: 'trader joe', category: 'Groceries', confidence: 0.95 },
  { pattern: 'whole foods', category: 'Groceries', confidence: 0.95 },
  { pattern: 'target grocery', category: 'Groceries', confidence: 0.95 },
  { pattern: 'kroger', category: 'Groceries', confidence: 0.9 },
  { pattern: 'safeway', category: 'Groceries', confidence: 0.9 },
  { pattern: 'albertsons', category: 'Groceries', confidence: 0.9 },
  { pattern: 'stop & shop', category: 'Groceries', confidence: 0.9 },
  { pattern: 'publix', category: 'Groceries', confidence: 0.9 },
  { pattern: 'whole foods market', category: 'Groceries', confidence: 0.95 },
  { pattern: 'sams club', category: 'Groceries', confidence: 0.9 },
  // Dining
  { pattern: 'starbucks', category: 'Dining', confidence: 0.95 },
  { pattern: 'mcdonalds', category: 'Dining', confidence: 0.95 },
  { pattern: 'burger king', category: 'Dining', confidence: 0.9 },
  { pattern: 'wendy', category: 'Dining', confidence: 0.9 },
  { pattern: 'taco bell', category: 'Dining', confidence: 0.9 },
  { pattern: 'pizza hut', category: 'Dining', confidence: 0.9 },
  { pattern: 'dominos', category: 'Dining', confidence: 0.9 },
  { pattern: 'subway', category: 'Dining', confidence: 0.9 },
  { pattern: 'panera', category: 'Dining', confidence: 0.9 },
  { pattern: 'chipotle', category: 'Dining', confidence: 0.9 },
  { pattern: 'chipotle mexican grill', category: 'Dining', confidence: 0.9 },
  { pattern: 'dunkin', category: 'Dining', confidence: 0.9 },
  { pattern: 'krispy kreme', category: 'Dining', confidence: 0.85 },
  { pattern: 'dunkin donuts', category: 'Dining', confidence: 0.85 },
  { pattern: 'starbucks coffee', category: 'Dining', confidence: 0.9 },
  { pattern: 'cafe', category: 'Dining', confidence: 0.85 },
  { pattern: 'restaurant', category: 'Dining', confidence: 0.85 },
  { pattern: 'dinner', category: 'Dining', confidence: 0.85 },
  { pattern: 'lunch', category: 'Dining', confidence: 0.85 },
  { pattern: 'breakfast', category: 'Dining', confidence: 0.85 },
  { pattern: 'brunch', category: 'Dining', confidence: 0.85 },
  { pattern: 'cafe coffee', category: 'Dining', confidence: 0.85 },
  // Utilities
  { pattern: 'electric', category: 'Utilities', confidence: 0.95 },
  { pattern: 'power', category: 'Utilities', confidence: 0.9 },
  { pattern: 'gas bill', category: 'Utilities', confidence: 0.9 },
  { pattern: 'gas', category: 'Utilities', confidence: 0.9 },
  { pattern: 'water bill', category: 'Utilities', confidence: 0.9 },
  { pattern: 'water', category: 'Utilities', confidence: 0.9 },
  { pattern: 'internet', category: 'Utilities', confidence: 0.85 },
  { pattern: 'phone', category: 'Utilities', confidence: 0.85 },
  { pattern: 'mobile', category: 'Utilities', confidence: 0.85 },
  { pattern: 'at&t', category: 'Utilities', confidence: 0.9 },
  { pattern: 'verizon', category: 'Utilities', confidence: 0.9 },
  { pattern: 't-mobile', category: 'Utilities', confidence: 0.9 },
  // Healthcare
  { pattern: 'pharmacy', category: 'Healthcare', confidence: 0.85 },
  { pattern: 'cvs', category: 'Healthcare', confidence: 0.95 },
  { pattern: 'walgreens', category: 'Healthcare', confidence: 0.95 },
  { pattern: 'hospital', category: 'Healthcare', confidence: 0.9 },
  { pattern: 'doctor', category: 'Healthcare', confidence: 0.85 },
  { pattern: 'clinic', category: 'Healthcare', confidence: 0.85 },
  { pattern: 'dental', category: 'Healthcare', confidence: 0.9 },
  { pattern: 'optometrist', category: 'Healthcare', confidence: 0.9 },
  // Entertainment
  { pattern: 'cinema', category: 'Entertainment', confidence: 0.9 },
  { pattern: 'theater', category: 'Entertainment', confidence: 0.9 },
  { pattern: 'concert', category: 'Entertainment', confidence: 0.9 },
  { pattern: 'ticketmaster', category: 'Entertainment', confidence: 0.95 },
  { pattern: 'steam', category: 'Entertainment', confidence: 0.9 },
  { pattern: 'playstation', category: 'Entertainment', confidence: 0.9 },
  { pattern: 'xbox', category: 'Entertainment', confidence: 0.9 },
  // Housing
  { pattern: 'rent', category: 'Housing', confidence: 0.95 },
  { pattern: 'mortgage', category: 'Housing', confidence: 0.95 },
  { pattern: 'hoa', category: 'Housing', confidence: 0.9 },
  { pattern: 'insurance', category: 'Housing', confidence: 0.7 },
  // Income
  { pattern: 'payroll', category: 'Salary', confidence: 0.95 },
  { pattern: 'salary', category: 'Salary', confidence: 0.95 },
  { pattern: 'direct deposit', category: 'Salary', confidence: 0.9 },
  { pattern: 'freelance', category: 'Freelance', confidence: 0.9 },
  { pattern: 'dividend', category: 'Investments', confidence: 0.95 },
  { pattern: 'interest', category: 'Investments', confidence: 0.9 },
];

// Get learned mappings for profile
app.get('/api/categories/mappings', apiRateLimiter, requireAuth, (req, res) => {
  try {
    const pid = getProfileId(req);
    const rows = db
      .prepare(
        `
      SELECT cm.*, c.name as category_name, c.color as category_color
      FROM category_mappings cm
      JOIN categories c ON cm.category_id = c.id
      WHERE cm.profile_id = ?
      ORDER BY cm.use_count DESC, cm.confidence DESC
    `
      )
      .all(pid);
    res.json(toCamelCase(rows));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Add/update a mapping
app.post('/api/categories/mappings', apiRateLimiter, requireAuth, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { pattern, category_id, confidence, use_count } = req.body;

    // Validation
    if (!pattern || typeof pattern !== 'string' || pattern.trim() === '') {
      return res.status(400).json({ error: 'Pattern is required' });
    }
    if (!category_id || typeof category_id !== 'number' || category_id <= 0) {
      return res.status(400).json({ error: 'Valid category_id is required' });
    }

    // Check if mapping already exists
    const existing = db
      .prepare('SELECT id, use_count FROM category_mappings WHERE profile_id=? AND pattern=?')
      .get(pid, pattern);

    if (existing) {
      // Update existing mapping
      db.prepare(
        `
        UPDATE category_mappings
        SET category_id=?, confidence=?, use_count=?
        WHERE id=?
      `
      ).run(category_id, confidence || 0.9, (use_count || existing.use_count) + 1, existing.id);
      res.json(
        toCamelCase({ ok: true, id: existing.id, use_count: (use_count || existing.use_count) + 1 })
      );
    } else {
      // Insert new mapping
      const info = db
        .prepare(
          `
        INSERT INTO category_mappings (profile_id, pattern, category_id, confidence, use_count)
        VALUES (?, ?, ?, ?, ?)
      `
        )
        .run(pid, pattern.trim(), category_id, confidence || 0.9, use_count || 1);
      res.json(toCamelCase({ ok: true, id: info.lastInsertRowid }));
    }
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete a mapping
app.delete('/api/categories/mappings/:id', apiRateLimiter, requireAuth, (req, res) => {
  try {
    const pid = getProfileId(req);
    const result = db
      .prepare('DELETE FROM category_mappings WHERE id=? AND profile_id=?')
      .run(req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== CATEGORY CRUD ====================

app.delete('/api/categories', apiRateLimiter, requireAuth, (req, res) => {
  try {
    const pid = getProfileId(req);
    db.prepare('DELETE FROM categories WHERE profile_id=?').run(pid);
    res.json({ ok: true, message: 'All categories deleted' });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/categories/:id', apiRateLimiter, requireAuth, (req, res) => {
  try {
    const pid = getProfileId(req);
    const cat = db
      .prepare(
        'SELECT id, name, color, icon, type, parent_id, tax_deductible, created_at FROM categories WHERE id=? AND profile_id=?'
      )
      .get(req.params.id, pid);
    if (!cat) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(toCamelCase(cat));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/categories/:id', apiRateLimiter, requireAuth, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, color, icon, type, parent_id: parentIdParam, tax_deductible } = req.body;
    const parent_id = parentIdParam !== undefined ? parentIdParam : req.body.parentId || null;
    const result = db
      .prepare(
        'UPDATE categories SET name=?, color=?, icon=?, type=?, parent_id=?, tax_deductible=? WHERE id=? AND profile_id=?'
      )
      .run(
        name || '',
        color || '',
        icon || 'tag',
        type || 'expense',
        parent_id || null,
        tax_deductible ? 1 : 0,
        req.params.id,
        pid
      );
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/categories/:id', apiRateLimiter, requireAuth, (req, res) => {
  try {
    const pid = getProfileId(req);
    const result = db
      .prepare('DELETE FROM categories WHERE id=? AND profile_id=?')
      .run(req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/categories', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    db.prepare('DELETE FROM categories WHERE profile_id=?').run(pid);
    res.json({ ok: true, message: 'All categories deleted' });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete a mapping
app.delete('/api/categories/mappings/:id', apiRateLimiter, requireAuth, (req, res) => {
  try {
    const pid = getProfileId(req);
    const result = db
      .prepare('DELETE FROM category_mappings WHERE id=? AND profile_id=?')
      .run(req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Fuzzy matching helper using Dice coefficient (faster than Levenshtein for this use case)
function diceCoefficient(a, b) {
  if (!a || !b) return 0;
  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();
  const bigrams1 = new Set();
  const bigrams2 = new Set();

  for (let i = 0; i < s1.length - 1; i++) {
    bigrams1.add(s1.slice(i, i + 2));
  }
  for (let i = 0; i < s2.length - 1; i++) {
    bigrams2.add(s2.slice(i, i + 2));
  }

  let intersection = 0;
  bigrams1.forEach((bg) => {
    if (bigrams2.has(bg)) intersection++;
  });

  return (2 * intersection) / (bigrams1.size + bigrams2.size);
}

// Auto-map uncategorized transactions
app.post('/api/categories/auto-map', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { transaction_ids, description, amount } = req.body;

    // Fetch categories and learned mappings for matching
    const categories = db.prepare('SELECT * FROM categories WHERE profile_id = ?').all(pid);
    const learnedMappings = db
      .prepare(
        `
      SELECT cm.pattern, cm.category_id, cm.confidence, cm.use_count
      FROM category_mappings cm
      WHERE cm.profile_id = ?
    `
      )
      .all(pid);

    // If transaction_ids provided, use those; otherwise filter by description+amount
    let txQuery = `
      SELECT t.id, t.description, t.beneficiary, t.payor, t.amount, c.name as category_name
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.profile_id = ? AND (t.category_id IS NULL OR c.name = 'Other')
    `;
    let params = [pid];

    if (transaction_ids && transaction_ids.length > 0) {
      txQuery += ' AND t.id IN (' + transaction_ids.map(() => '?').join(',') + ')';
      params = params.concat(transaction_ids);
    } else if (description && amount) {
      // Match by description and amount
      const normalizedDesc = description
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]/g, '');
      const amountMatch = amount.toString().replace(/[^0-9.]/g, '');
      txQuery += ' AND (LOWER(t.description) LIKE ? OR LOWER(t.beneficiary) LIKE ?)';
      params.push('%' + normalizedDesc + '%', '%' + normalizedDesc + '%');
    }

    const transactions = db.prepare(txQuery).all(...params);

    const proposedMappings = [];

    for (const tx of transactions) {
      const searchText =
        `${tx.description} ${tx.beneficiary || ''} ${tx.payor || ''}`.toLowerCase();
      const normalizedSearch = searchText.replace(/[^a-z0-9]/g, '');

      let bestMatch = null;
      let bestScore = 0;

      // 1. Check learned mappings first (highest priority, boosted by use_count)
      for (const mapping of learnedMappings) {
        const patternLower = mapping.pattern.toLowerCase();
        if (normalizedSearch.includes(patternLower.replace(/[^a-z0-9]/g, ''))) {
          const score =
            mapping.confidence * Math.min(1 + Math.log10(mapping.use_count + 1) * 0.2, 1.5);
          if (score > bestScore) {
            bestScore = score;
            const cat = categories.find((c) => c.id === mapping.category_id);
            if (cat) {
              bestMatch = {
                category_id: cat.id,
                category_name: cat.name,
                category_color: cat.color,
                confidence: score,
              };
            }
          }
        }
      }

      // 2. Check merchant dictionary
      if (!bestMatch || bestScore < 0.8) {
        for (const merchant of MERCHANT_DICTIONARY) {
          const patternLower = merchant.pattern.toLowerCase();
          if (normalizedSearch.includes(patternLower.replace(/[^a-z0-9]/g, ''))) {
            if (merchant.confidence > bestScore) {
              bestScore = merchant.confidence;
              const cat = categories.find(
                (c) => c.name.toLowerCase() === merchant.category.toLowerCase()
              );
              if (cat) {
                bestMatch = {
                  category_id: cat.id,
                  category_name: cat.name,
                  category_color: cat.color,
                  confidence: merchant.confidence,
                };
              }
            }
          }
        }
      }

      // 3. Token overlap matching with category names
      if (!bestMatch || bestScore < 0.6) {
        const searchTokens = normalizedSearch.split(/[0-9]+/).filter((t) => t.length > 2);

        for (const cat of categories) {
          const catTokens = cat.name
            .toLowerCase()
            .replace(/[^a-z]/g, '')
            .split('')
            .filter((c) => c.length > 2);

          // Calculate token overlap
          let matches = 0;
          for (const token of searchTokens) {
            if (
              cat.name.toLowerCase().includes(token) ||
              (token.length > 3 &&
                cat.name
                  .toLowerCase()
                  .split('')
                  .some((c) => c.startsWith(token.slice(0, 3))))
            ) {
              matches++;
            }
          }

          if (matches > 0) {
            const score = (matches / Math.max(searchTokens.length, catTokens.length)) * 0.5;
            if (score > bestScore) {
              bestScore = score;
              bestMatch = {
                category_id: cat.id,
                category_name: cat.name,
                category_color: cat.color,
                confidence: score,
              };
            }
          }
        }
      }

      if (bestMatch) {
        proposedMappings.push({
          transaction_id: tx.id,
          description: tx.description,
          proposed_category_id: bestMatch.category_id,
          proposed_category_name: bestMatch.category_name,
          proposed_category_color: bestMatch.category_color,
          confidence: Math.min(bestMatch.confidence, 1),
        });
      }
    }

    res.json({
      total: transactions.length,
      mapped: proposedMappings.length,
      mappings: proposedMappings,
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Apply confirmed mappings to transactions
app.post('/api/categories/apply-mappings', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { mappings } = req.body;

    if (!mappings || !Array.isArray(mappings)) {
      return res.status(400).json({ error: 'Invalid mappings array' });
    }

    const updateTx = db.prepare(
      "UPDATE transactions SET category_id = ?, updated_at = datetime('now') WHERE id = ? AND profile_id = ?"
    );
    const insertMapping = db.prepare(`
      INSERT OR REPLACE INTO category_mappings (profile_id, pattern, category_id, confidence, use_count)
      VALUES (?, ?, ?, ?, 1)
    `);

    let updated = 0;

    for (const mapping of mappings) {
      const { transaction_id, category_id, pattern } = mapping;

      // Update transaction
      const result = updateTx.run(category_id, transaction_id, pid);
      if (result.changes > 0) updated++;

      // Store mapping for future use
      if (pattern) {
        const normalizedPattern = pattern.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalizedPattern.length >= 3) {
          try {
            insertMapping.run(pid, normalizedPattern, category_id, 0.9);
          } catch (e) {
            // Ignore duplicate errors
          }
        }
      }
    }

    res.json({ ok: true, updated });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// TAGS (per-profile)
// ========================
app.get('/api/tags', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const rows = db
      .prepare('SELECT id, name, color, created_at FROM tags WHERE profile_id = ? ORDER BY name')
      .all(pid);
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Tag color palette for auto-assignment
const TAG_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#84cc16',
  '#6366f1',
  '#14b8a6',
  '#a855f7',
];

app.post('/api/tags', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, color } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Tag name is required' });
    }
    let tagColor = color;
    if (!tagColor) {
      // Cycle through palette based on existing tag count
      const count = db.prepare('SELECT COUNT(*) as c FROM tags WHERE profile_id = ?').get(pid).c;
      tagColor = TAG_COLORS[count % TAG_COLORS.length];
    }
    const info = db
      .prepare('INSERT INTO tags (name, color, profile_id) VALUES (?, ?, ?)')
      .run(name.trim(), tagColor, pid);
    res.json({ id: info.lastInsertRowid, name: name.trim(), color: tagColor });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: 'Tag already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tags/:id', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, color } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Tag name is required' });
    }
    const result = db
      .prepare('UPDATE tags SET name = ?, color = ? WHERE id = ? AND profile_id = ?')
      .run(name.trim(), color || '#6b7280', req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: 'Tag name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tags/:id', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const result = db
      .prepare('DELETE FROM tags WHERE id = ? AND profile_id = ?')
      .run(req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Add tags to a transaction (replaces existing)
app.post('/api/transactions/:id/tags', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { tagIds } = req.body;
    if (!Array.isArray(tagIds)) {
      return res.status(400).json({ error: 'tagIds must be an array' });
    }
    // Verify transaction belongs to profile
    const tx = db
      .prepare('SELECT id FROM transactions WHERE id = ? AND profile_id = ?')
      .get(req.params.id, pid);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    // Replace existing tags with new ones
    db.prepare('DELETE FROM transaction_tags WHERE transaction_id = ?').run(req.params.id);
    const insertStmt = db.prepare(
      'INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)'
    );
    for (const tagId of tagIds) {
      insertStmt.run(req.params.id, tagId);
    }
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Update tags for a transaction (alias for POST — replaces existing)
app.put('/api/transactions/:id/tags', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { tagIds } = req.body;
    if (!Array.isArray(tagIds)) {
      return res.status(400).json({ error: 'tagIds must be an array' });
    }
    // Verify transaction belongs to profile
    const tx = db
      .prepare('SELECT id FROM transactions WHERE id = ? AND profile_id = ?')
      .get(req.params.id, pid);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    db.prepare('DELETE FROM transaction_tags WHERE transaction_id = ?').run(req.params.id);
    const insertStmt = db.prepare(
      'INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)'
    );
    for (const tagId of tagIds) {
      insertStmt.run(req.params.id, tagId);
    }
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Get tags for a transaction
app.get('/api/transactions/:id/tags', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    // Verify transaction belongs to profile
    const tx = db
      .prepare('SELECT id FROM transactions WHERE id = ? AND profile_id = ?')
      .get(req.params.id, pid);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const tags = db
      .prepare(
        `
        SELECT t.id, t.name, t.color
        FROM tags t
        JOIN transaction_tags tt ON t.id = tt.tag_id
        WHERE tt.transaction_id = ? AND t.profile_id = ?
        ORDER BY t.name
      `
      )
      .all(req.params.id, pid);
    res.json(tags);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Search transactions by tag
app.get('/api/transactions/by-tag/:tagId', apiRateLimiter, (req, res) => {
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

    if (startDate) {
      sql += ' AND t.date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      sql += ' AND t.date <= ?';
      params.push(endDate);
    }
    if (category_ids) {
      const ids = category_ids
        .split(',')
        .map((id) => parseInt(id))
        .filter((id) => !isNaN(id));
      if (ids.length > 0) {
        sql += ` AND t.category_id IN (${ids.map(() => '?').join(',')})`;
        params.push(...ids);
      }
    }
    if (type) {
      sql += ' AND t.type = ?';
      params.push(type);
    }

    sql += ' ORDER BY t.date DESC, t.id DESC';
    if (limit) sql += ` LIMIT ${parseInt(limit)}`;
    if (offset) sql += ` OFFSET ${parseInt(offset)}`;

    const rows = db.prepare(sql).all(...params);
    res.json({ rows, total: rows.length });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// TRANSACTIONS (per-profile, multi-profile for combined view)
// ========================
app.get('/api/transactions', apiRateLimiter, requireAuth, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const {
      startDate,
      endDate,
      category_ids,
      type,
      search,
      reconciled,
      limit,
      offset,
      sort,
      order,
      tag_ids,
    } = req.query;
    let sql = `
      SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause})
    `;
    const params = [...pids];
    let tagFilterApplied = false;
    if (tag_ids) {
      const tids = tag_ids
        .split(',')
        .map((id) => parseInt(id))
        .filter((id) => !isNaN(id));
      if (tids.length > 0) {
        const tagPlaceholders = tids.map(() => '?').join(',');
        sql += ` AND t.id IN (SELECT transaction_id FROM transaction_tags WHERE tag_id IN (${tagPlaceholders}))`;
        params.push(...tids);
        tagFilterApplied = true;
      }
    }
    if (startDate) {
      sql += ' AND t.date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      sql += ' AND t.date <= ?';
      params.push(endDate);
    }
    if (category_ids) {
      const ids = category_ids
        .split(',')
        .map((id) => parseInt(id))
        .filter((id) => !isNaN(id));
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        sql += ` AND t.category_id IN (${placeholders})`;
        params.push(...ids);
      }
    }
    if (type) {
      sql += ' AND t.type = ?';
      params.push(type);
    }
    if (search) {
      sql +=
        ' AND (t.description LIKE ? OR t.beneficiary LIKE ? OR t.payor LIKE ? OR t.notes LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (reconciled !== undefined) {
      if (reconciled === '0' || reconciled === 'false') {
        sql += ' AND (t.reconciled = 0 OR t.reconciled IS NULL)';
      } else if (reconciled === '1' || reconciled === 'true') {
        sql += ' AND t.reconciled = 1';
      }
    }
    if (sort) {
      const sortCol = [
        'date',
        'amount',
        'description',
        'category_name',
        'type',
        'beneficiary',
        'payor',
      ].includes(sort)
        ? sort === 'category_name'
          ? 'c.name'
          : `t.${sort}`
        : 't.date';
      const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
      sql += ` ORDER BY ${sortCol} ${sortOrder}, t.id ${sortOrder}`;
    } else {
      sql += ` ORDER BY t.date DESC, t.id DESC`;
    }
    if (limit) sql += ` LIMIT ${parseInt(limit)}`;
    if (offset) sql += ` OFFSET ${parseInt(offset)}`;
    const rows = db.prepare(sql).all(...params);

    // Attach tags to each transaction
    const tagStmt = db.prepare(`
      SELECT tg.id, tg.name, tg.color
      FROM tags tg
      JOIN transaction_tags tt ON tg.id = tt.tag_id
      WHERE tt.transaction_id = ?
      ORDER BY tg.name
    `);
    for (const row of rows) {
      row.tags = tagStmt.all(row.id);
    }

    // Count total
    let countSql = `SELECT COUNT(*) as c FROM transactions t WHERE t.profile_id IN (${inClause})`;
    const cparams = [...pids];
    if (startDate) {
      countSql += ' AND t.date >= ?';
      cparams.push(startDate);
    }
    if (endDate) {
      countSql += ' AND t.date <= ?';
      cparams.push(endDate);
    }
    if (category_ids) {
      const ids = category_ids
        .split(',')
        .map((id) => parseInt(id))
        .filter((id) => !isNaN(id));
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        countSql += ` AND t.category_id IN (${placeholders})`;
        cparams.push(...ids);
      }
    }
    if (type) {
      countSql += ' AND t.type = ?';
      cparams.push(type);
    }
    if (search) {
      countSql +=
        ' AND (t.description LIKE ? OR t.beneficiary LIKE ? OR t.payor LIKE ? OR t.notes LIKE ?)';
      cparams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (reconciled !== undefined) {
      if (reconciled === '0' || reconciled === 'false') {
        countSql += ' AND (t.reconciled = 0 OR t.reconciled IS NULL)';
      } else if (reconciled === '1' || reconciled === 'true') {
        countSql += ' AND t.reconciled = 1';
      }
    }
    if (tag_ids) {
      const tids = tag_ids
        .split(',')
        .map((id) => parseInt(id))
        .filter((id) => !isNaN(id));
      if (tids.length > 0) {
        const tagPlaceholders = tids.map(() => '?').join(',');
        countSql += ` AND t.id IN (SELECT transaction_id FROM transaction_tags WHERE tag_id IN (${tagPlaceholders}))`;
        cparams.push(...tids);
      }
    }
    const total = db.prepare(countSql).get(...cparams).c;
    res.json({
      rows,
      total,
      limit: limit ? parseInt(limit) : total,
      offset: offset ? parseInt(offset) : 0,
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/transactions/summary', apiRateLimiter, (req, res) => {
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
      sql += ' AND t.date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      sql += ' AND t.date <= ?';
      params.push(endDate);
    }
    if (category_ids) {
      const ids = category_ids
        .split(',')
        .map((id) => parseInt(id))
        .filter((id) => !isNaN(id));
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        sql += ` AND t.category_id IN (${placeholders})`;
        params.push(...ids);
      }
    }
    if (type) {
      sql += ' AND t.type = ?';
      params.push(type);
    }
    if (search) {
      sql +=
        ' AND (t.description LIKE ? OR t.beneficiary LIKE ? OR t.payor LIKE ? OR t.notes LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const result = db.prepare(sql).get(...params);
    const data = {
      total_amount: result.total_amount || 0,
      total_expense: result.total_expense || 0,
      total_expenses: result.total_expense || 0, // Support plural form
      total_income: result.total_income || 0,
      net_balance: (result.total_income || 0) - (result.total_expense || 0),
      count: result.count || 0,
    };
    res.json(toCamelCase(data));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/transactions', apiRateLimiter, requireAuth, (req, res) => {
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

    // Sanitize description to prevent XSS and injection
    const sanitizedDescription = sanitizeInput(description);
    if (!sanitizedDescription || sanitizedDescription.trim().length < 1) {
      return res.status(400).json({ error: 'Invalid description' });
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
    `
      )
      .run(
        sanitizedDescription,
        amount,
        date,
        beneficiary || '',
        payor || '',
        category_id || null,
        currency || 'USD',
        amount_local ?? amount,
        means_of_payment || '',
        exchange_rate || 1.0,
        type || 'expense',
        notes || '',
        pid
      );
    // Return created transaction with all fields including timestamps
    const created = db
      .prepare(
        `SELECT * FROM transactions WHERE id = ? AND profile_id = ?`
      )
      .get(info.lastInsertRowid, pid);
    res.json(toCamelCase(created));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// GET single transaction by ID
app.get('/api/transactions/:id', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { id } = req.params;

    const tx = db
      .prepare(
        `
      SELECT t.*, c.name as category_name, c.color as category_color
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.id = ? AND t.profile_id = ?
    `
      )
      .get(id, pid);

    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    tx.tags = db
      .prepare(
        `
      SELECT tg.id, tg.name, tg.color
      FROM tags tg
      JOIN transaction_tags tt ON tg.id = tt.tag_id
      WHERE tt.transaction_id = ?
      ORDER BY tg.name
    `
      )
      .all(id);

    const response = toCamelCase(tx);
    response.category = response.categoryName || null;
    delete response.categoryName;
    res.json(response);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Bulk update: PUT /api/transactions/bulk
app.put('/api/transactions/bulk', apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join('');
    // Support both 'ids' and 'transactionIds' field names
    let ids = req.body.ids || req.body.transactionIds || [];
    const action = req.body.action || req.body._method || 'update';
    const data = req.body.data || req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'No transaction IDs provided' });
    }
    if (ids.length > 1000) {
      return res.status(400).json({ error: 'Cannot update more than 1000 transactions at once' });
    }

    const placeholders = ids.map(() => '?').join(',');
    const authParams = [...pids, ...ids];

    if (action === 'delete' || action === 'DELETE' || action.toLowerCase() === 'delete') {
      const stmt = db.prepare(
        `DELETE FROM transactions WHERE profile_id IN (${inClause}) AND id IN (${placeholders})`
      );
      const result = stmt.run(...authParams);
      return res.json({ ok: true, deleted: result.changes });
    }

    if (action === 'update' || action === 'UPDATE' || action.toLowerCase() === 'update') {
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'No update data provided' });
      }

      const allowedFields = ['category_id', 'type', 'description', 'beneficiary', 'payor', 'notes', 'reconciled'];
      const updates = [];
      const updateParams = [];

      for (const field of allowedFields) {
        if (data.hasOwnProperty(field)) {
          if (field === 'category_id') {
            updates.push('category_id = ?');
            updateParams.push(
              data.category_id === null || data.category_id === ''
                ? null
                : parseInt(data.category_id)
            );
          } else if (field === 'reconciled') {
            // Convert boolean to integer for SQLite
            updates.push('reconciled = ?');
            updateParams.push(data.reconciled ? 1 : 0);
          } else if (field === 'type') {
            if (!['income', 'expense', 'transfer'].includes(data.type)) {
              return res
                .status(400)
                .json({ error: 'Invalid type. Must be income, expense, or transfer' });
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
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      updates.push("updated_at = datetime('now')");
      updateParams.push(...pids, ...ids);

      const stmt = db.prepare(
        `UPDATE transactions SET ${updates.join(', ')} WHERE profile_id IN (${inClause}) AND id IN (${placeholders})`
      );
      const result = stmt.run(...updateParams);
      return res.json({ ok: true, updated: result.changes });
    }

    return res.status(400).json({ error: "Invalid action. Must be 'delete' or 'update'" });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/transactions/:id', apiRateLimiter, requireAuth, (req, res) => {
  try {
    const pid = getProfileId(req);
    let hasUpdate = false;
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

    let updates = [];
    let params = [];

    if (description !== undefined) {
      updates.push('description=?');
      params.push(description);
      hasUpdate = true;
    }
    if (amount !== undefined) {
      updates.push('amount=?');
      params.push(amount);
      hasUpdate = true;
    }
    if (date !== undefined) {
      updates.push('date=?');
      params.push(date);
      hasUpdate = true;
    }
    if (beneficiary !== undefined) {
      updates.push('beneficiary=?');
      params.push(beneficiary || '');
      hasUpdate = true;
    }
    if (payor !== undefined) {
      updates.push('payor=?');
      params.push(payor || '');
      hasUpdate = true;
    }
    if (category_id !== undefined) {
      updates.push('category_id=?');
      params.push(category_id || null);
      hasUpdate = true;
    }
    if (currency !== undefined) {
      updates.push('currency=?');
      params.push(currency);
      hasUpdate = true;
    }
    if (amount_local !== undefined) {
      updates.push('amount_local=?');
      params.push(amount_local ?? amount);
      hasUpdate = true;
    }
    if (means_of_payment !== undefined) {
      updates.push('means_of_payment=?');
      params.push(means_of_payment || '');
      hasUpdate = true;
    }
    if (exchange_rate !== undefined) {
      updates.push('exchange_rate=?');
      params.push(exchange_rate || 1.0);
      hasUpdate = true;
    }
    if (type !== undefined) {
      updates.push('type=?');
      params.push(type);
      hasUpdate = true;
    }
    if (notes !== undefined) {
      updates.push('notes=?');
      params.push(notes || '');
      hasUpdate = true;
    }
    if (reconciled !== undefined) {
      updates.push('reconciled=?');
      updates.push("reconciled_at=CASE WHEN ?=1 THEN datetime('now') ELSE reconciled_at END");
      params.push(reconciled ? 1 : 0);
      params.push(reconciled ? 1 : 0);
      hasUpdate = true;
    }

    if (!hasUpdate) {
      return res.status(400).json({ error: 'No valid fields provided for update' });
    }

    updates.push("updated_at=datetime('now')");
    params.push(req.params.id);
    params.push(pid);

    const result = db
      .prepare(`UPDATE transactions SET ${updates.join(', ')} WHERE id=? AND profile_id=?`)
      .run(...params);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/transactions/:id', apiRateLimiter, requireAuth, (req, res) => {
  try {
    const pid = getProfileId(req);
    const result = db
      .prepare('DELETE FROM transactions WHERE id=? AND profile_id=?')
      .run(req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/transactions', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    db.prepare('DELETE FROM transactions WHERE profile_id=?').run(pid);
    res.json({ ok: true, message: 'All transactions deleted' });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// RECONCILIATION (per-profile)
// ========================
// Toggle reconciled status for a single transaction
app.patch('/api/transactions/:id/reconcile', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const existing = db
      .prepare('SELECT id, reconciled FROM transactions WHERE id = ? AND profile_id = ?')
      .get(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: 'Transaction not found' });

    const newStatus = existing.reconciled ? 0 : 1;
    db.prepare(
      "UPDATE transactions SET reconciled = ?, reconciled_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END WHERE id = ? AND profile_id = ?"
    ).run(newStatus, newStatus, req.params.id, pid);
    res.json({
      id: parseInt(req.params.id),
      reconciled: newStatus,
      reconciled_at: newStatus ? new Date().toISOString() : null,
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Bulk reconcile transactions by date range
app.post('/api/transactions/reconcile/bulk', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { startDate, endDate } = req.body;
    if (!startDate || !endDate)
      return res.status(400).json({ error: 'startDate and endDate are required' });

    const result = db
      .prepare(
        `UPDATE transactions SET reconciled = 1, reconciled_at = datetime('now')
       WHERE profile_id = ? AND date >= ? AND date <= ? AND reconciled = 0`
      )
      .run(pid, startDate, endDate);
    res.json({ message: `${result.changes} transactions reconciled`, count: result.changes });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Get reconciliation status summary
app.get('/api/transactions/reconcile/summary', apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const summary = db
      .prepare(
        `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN reconciled = 1 THEN 1 ELSE 0 END) as reconciled_count,
        SUM(CASE WHEN reconciled = 0 OR reconciled IS NULL THEN 1 ELSE 0 END) as unreconciled_count,
        SUM(CASE WHEN reconciled = 0 OR reconciled IS NULL THEN amount ELSE 0 END) as unreconciled_total
       FROM transactions WHERE profile_id IN (${inClause})`
      )
      .get(...pids);
    res.json(summary);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Batch mark transactions as reconciled by ID list
app.put('/api/transactions/reconcile-batch', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { transaction_ids } = req.body;
    if (!Array.isArray(transaction_ids) || transaction_ids.length === 0) {
      return res.status(400).json({ error: 'transaction_ids array is required' });
    }
    const placeholders = transaction_ids.map(() => '?').join(',');
    const result = db
      .prepare(
        `UPDATE transactions SET reconciled = 1, reconciled_at = datetime('now')
       WHERE id IN (${placeholders}) AND profile_id = ?`
      )
      .run(...transaction_ids, pid);
    res.json({ message: `${result.changes} transactions reconciled`, updated: result.changes });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// RECEIPTS
// ========================

// Upload receipt for a transaction
app.post('/api/receipts/upload', apiRateLimiter, uploadReceipt.single('receipt'), (req, res) => {
  try {
    const pid = getProfileId(req);

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { transaction_id } = req.body;
    if (!transaction_id) {
      return res.status(400).json({ error: 'Transaction ID is required' });
    }

    const filename = `${Date.now()}-${req.file.originalname}`;
    const storagePath = path.join(__dirname, 'uploads', 'receipts', filename);

    // Ensure uploads directory exists
    const uploadsDir = path.join(__dirname, 'uploads', 'receipts');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Save the file
    fs.writeFileSync(storagePath, req.file.buffer);

    // Get file size
    const stats = fs.statSync(storagePath);
    const fileSize = stats.size;

    // Get file type from MIME type
    const fileType = req.file.mimetype;

    // Store receipt in database
    const stmt = db.prepare(
      `INSERT INTO receipts (transaction_id, filename, original_name, file_type, file_size, storage_path, profile_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const result = stmt.run(
      transaction_id,
      filename,
      req.file.originalname,
      fileType,
      fileSize,
      storagePath,
      pid
    );

    res.json({
      id: result.lastInsertRowid,
      transaction_id: parseInt(transaction_id),
      filename,
      original_name: req.file.originalname,
      file_type: fileType,
      file_size: fileSize,
      url: `/receipts/${filename}`,
      uploaded_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    if (err.code === 'ENOENT' || err.code === 'EACCES') {
      res.status(500).json({ error: 'Upload directory not accessible' });
    } else {
      res.status(500).json({ error: 'Upload failed. Please try again.' });
    }
  }
});

// Error handler middleware for receipt upload
app.use('/api/receipts/upload', (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message && err.message.includes('Invalid file type')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// Get receipt by ID
app.get('/api/receipts/:id', apiRateLimiter, (req, res) => {
  try {
    const { id } = req.params;
    const receipt = db.prepare(`SELECT * FROM receipts WHERE id = ?`).get(id);

    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    res.json(receipt);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Get receipt by transaction ID
app.get('/api/receipts/transaction/:transactionId', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { transactionId } = req.params;
    const receipt = db
      .prepare(`SELECT * FROM receipts WHERE transaction_id = ? AND profile_id = ?`)
      .get(transactionId, pid);

    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    res.json(receipt);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Get receipt file data
app.get('/api/receipts/file/:filename', apiRateLimiter, (req, res) => {
  try {
    const { filename } = req.params;
    const storagePath = path.join(__dirname, 'uploads', 'receipts', filename);

    if (!fs.existsSync(storagePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const ext = path.extname(filename).toLowerCase();

    // Set appropriate content type
    let contentType = 'application/octet-stream';
    if (['.jpg', '.jpeg'].includes(ext)) contentType = 'image/jpeg';
    else if (['.png'].includes(ext)) contentType = 'image/png';
    else if (['.gif'].includes(ext)) contentType = 'image/gif';
    else if (['.pdf'].includes(ext)) contentType = 'application/pdf';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.sendFile(storagePath, {}, (err) => {
      if (err && err.code !== 'ECONNABORTED') {
        console.error('Error sending file:', err);
      }
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete receipt
app.delete('/api/receipts/:id', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { id } = req.params;

    const receipt = db
      .prepare('SELECT * FROM receipts WHERE id = ? AND profile_id = ?')
      .get(id, pid);

    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    // Delete the file if it exists
    try {
      if (fs.existsSync(receipt.storage_path)) {
        fs.unlinkSync(receipt.storage_path);
      }
    } catch (err) {
      console.error('Error deleting receipt file:', err);
    }

    // Delete from database
    db.prepare('DELETE FROM receipts WHERE id = ?').run(id);

    res.json({ message: 'Receipt deleted successfully' });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// BUDGETS (per-profile, multi-profile for combined view)
// ========================
app.get('/api/budgets', apiRateLimiter, (req, res) => {
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
    `
      )
      .all(...pids);
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/budgets', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { category_id, amount, period, start_date, end_date, rollover_enabled } = req.body;
    const info = db
      .prepare(
        'INSERT INTO budgets (category_id, amount, period, start_date, end_date, rollover_enabled, profile_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        category_id,
        amount,
        period || 'monthly',
        start_date,
        end_date || null,
        rollover_enabled ? 1 : 0,
        pid
      );
    res.json({ id: info.lastInsertRowid, ...req.body, profile_id: pid });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/budgets/:id', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { category_id, amount, period, start_date, end_date, rollover_enabled } = req.body;
    const result = db
      .prepare(
        'UPDATE budgets SET category_id=?, amount=?, period=?, start_date=?, end_date=?, rollover_enabled=? WHERE id=? AND profile_id=?'
      )
      .run(
        category_id,
        amount,
        period,
        start_date,
        end_date || null,
        rollover_enabled ? 1 : 0,
        req.params.id,
        pid
      );
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/budgets/:id', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const result = db
      .prepare('DELETE FROM budgets WHERE id=? AND profile_id=?')
      .run(req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Manual rollover adjustment
app.put('/api/budgets/:id/rollover', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { rollover_amount, rollover_used, rollover_enabled } = req.body;

    // Build dynamic update based on what was provided
    const updates = [];
    const values = [];

    if (rollover_amount !== undefined) {
      updates.push('rollover_amount = ?');
      values.push(rollover_amount);
    }
    if (rollover_used !== undefined) {
      updates.push('rollover_used = ?');
      values.push(rollover_used);
    }
    if (rollover_enabled !== undefined) {
      updates.push('rollover_enabled = ?');
      values.push(rollover_enabled ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No rollover fields provided' });
    }

    values.push(req.params.id, pid);

    const result = db
      .prepare(`UPDATE budgets SET ${updates.join(', ')} WHERE id = ? AND profile_id = ?`)
      .run(...values);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    // Return updated budget
    const budget = db
      .prepare('SELECT * FROM budgets WHERE id = ? AND profile_id = ?')
      .get(req.params.id, pid);

    res.json({ ok: true, budget });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/budgets/summary', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { year, month, apply_rollover } = req.query;
    const y = year || new Date().getFullYear();
    const m = month || new Date().getMonth() + 1;
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    const endDate = `${nextY}-${String(nextM).padStart(2, '0')}-01`;

    const budgets = db
      .prepare(
        `
      SELECT b.*, c.name as category_name, c.color as category_color, c.icon as category_icon, c.type
      FROM budgets b
      JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
      WHERE b.profile_id = ? AND (b.end_date IS NULL OR b.end_date >= ?)
    `
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
    `
      )
      .all(pid, startDate, endDate);

    const spentMap = {};
    for (const s of spent) spentMap[s.category_id] = s.total;

    // Calculate automatic rollover from previous month
    let prevY = m === 1 ? y - 1 : y;
    let prevM = m === 1 ? 12 : m - 1;
    const prevStart = `${prevY}-${String(prevM).padStart(2, '0')}-01`;
    const prevEnd = `${y}-${String(m).padStart(2, '0')}-01`;

    // Get previous month's budgets with their spent amounts
    const prevBudgets = db
      .prepare(
        `
        SELECT b.category_id, b.amount as budget_amount, b.rollover_enabled, b.rollover_amount, b.rollover_used
        FROM budgets b
        WHERE b.profile_id = ? AND b.start_date >= ? AND b.start_date < ?
      `
      )
      .all(pid, prevStart, prevEnd);

    // Get previous month's spent
    const prevSpent = db
      .prepare(
        `
        SELECT category_id, SUM(COALESCE(amount_local, amount)) as total
        FROM transactions
        WHERE profile_id = ? AND date >= ? AND date < ? AND type = 'expense' AND category_id IS NOT NULL
        GROUP BY category_id
      `
      )
      .all(pid, prevStart, prevEnd);

    const prevSpentMap = {};
    for (const s of prevSpent) prevSpentMap[s.category_id] = s.total;

    // Calculate unused from previous month for each category
    const prevUnusedMap = {};
    for (const pb of prevBudgets) {
      const unused = Math.max(0, pb.budget_amount - (prevSpentMap[pb.category_id] || 0));
      prevUnusedMap[pb.category_id] = { unused, rollover_enabled: pb.rollover_enabled };
    }

    const summary = budgets.map((b) => {
      const spentAmt = spentMap[b.category_id] || 0;
      const baseRemaining = b.amount - spentAmt;

      // Calculate rollover contribution
      let rollover_contribution = 0;
      let auto_rollover = 0;

      if (b.rollover_enabled) {
        const prevInfo = prevUnusedMap[b.category_id];
        if (prevInfo && prevInfo.rollover_enabled) {
          auto_rollover = prevInfo.unused;
        }
        rollover_contribution = (b.rollover_amount || 0) + auto_rollover - (b.rollover_used || 0);
      }

      // Effective budget = base budget + rollover contribution
      const effective_budget = b.amount + Math.max(0, rollover_contribution);
      const effective_remaining = effective_budget - spentAmt;

      return {
        ...b,
        spent: spentAmt,
        remaining: baseRemaining, // base remaining without rollover
        effective_budget,
        effective_remaining,
        rollover_contribution: Math.max(0, rollover_contribution),
        auto_rollover,
        percentage: b.amount > 0 ? Math.min(100, (spentAmt / b.amount) * 100) : 0,
      };
    });

    res.json(summary);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Duplicate budgets from previous month
app.post('/api/budgets/duplicate-last', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { year, month } = req.body;

    // Calculate previous month
    let prevYear = year || new Date().getFullYear();
    let prevMonth = (month || new Date().getMonth() + 1) - 1;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear--;
    }

    const prevStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;

    // Get previous month's budgets
    const prevBudgets = db
      .prepare(
        `
        SELECT category_id, amount, period
        FROM budgets
        WHERE profile_id = ? AND start_date >= ? AND start_date < ?
      `
      )
      .all(pid, prevStart, `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`);

    if (prevBudgets.length === 0) {
      return res.json({ ok: false, message: 'No budgets found for previous month' });
    }

    // Create current month start date
    const currYear = year || new Date().getFullYear();
    const currMonth = month || new Date().getMonth() + 1;
    const currStart = `${currYear}-${String(currMonth).padStart(2, '0')}-01`;

    // Clear existing budgets for current month and insert from previous
    db.prepare(
      'DELETE FROM budgets WHERE profile_id = ? AND start_date >= ? AND start_date < ?'
    ).run(pid, currStart, `${currYear}-${String(currMonth + 1).padStart(2, '0')}-01`);

    const insert = db.prepare(
      'INSERT INTO budgets (category_id, amount, period, start_date, profile_id) VALUES (?, ?, ?, ?, ?)'
    );

    for (const b of prevBudgets) {
      insert.run(b.category_id, b.amount, b.period, currStart, pid);
    }

    res.json({ ok: true, count: prevBudgets.length });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Set budgets from last month's actual expenses
app.post('/api/budgets/from-expenses', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { year, month } = req.body;

    // Calculate previous month
    let prevYear = year || new Date().getFullYear();
    let prevMonth = (month || new Date().getMonth() + 1) - 1;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear--;
    }

    const prevStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
    const prevEnd = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`;

    // Get actual expenses by category
    const expenses = db
      .prepare(
        `
        SELECT t.category_id, c.name, SUM(COALESCE(t.amount_local, t.amount)) as total
        FROM transactions t
        JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
        WHERE t.profile_id = ? AND t.date >= ? AND t.date < ? AND t.type = 'expense' AND t.category_id IS NOT NULL
        GROUP BY t.category_id
      `
      )
      .all(pid, prevStart, prevEnd);

    if (expenses.length === 0) {
      return res.json({ ok: false, message: 'No expenses found for previous month' });
    }

    // Create current month start date
    const currYear = year || new Date().getFullYear();
    const currMonth = month || new Date().getMonth() + 1;
    const currStart = `${currYear}-${String(currMonth).padStart(2, '0')}-01`;

    // Clear existing budgets for current month
    db.prepare(
      'DELETE FROM budgets WHERE profile_id = ? AND start_date >= ? AND start_date < ?'
    ).run(pid, currStart, `${currYear}-${String(currMonth + 1).padStart(2, '0')}-01`);

    const insert = db.prepare(
      "INSERT INTO budgets (category_id, amount, period, start_date, profile_id) VALUES (?, ?, 'monthly', ?, ?)"
    );

    for (const e of expenses) {
      insert.run(e.category_id, e.total, currStart, pid);
    }

    res.json({ ok: true, count: expenses.length });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Get budget history for a category
app.get('/api/budgets/history', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { category_id, months = 6 } = req.query;

    const history = db
      .prepare(
        `
        SELECT b.start_date as month, b.amount as budget_amount,
               COALESCE(SUM(COALESCE(t.amount_local, t.amount)), 0) as spent
        FROM budgets b
        LEFT JOIN transactions t ON t.category_id = b.category_id
          AND t.profile_id = b.profile_id
          AND t.date >= b.start_date
          AND t.date < date(b.start_date, '+1 month')
          AND t.type = 'expense'
        WHERE b.profile_id = ? AND b.category_id = ?
        GROUP BY b.start_date
        ORDER BY b.start_date DESC
        LIMIT ?
      `
      )
      .all(pid, parseInt(category_id), parseInt(months));

    res.json(history);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Get budget improvements (month-over-month adherence)
app.get('/api/budgets/improvements', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { months = 6 } = req.query;
    const numMonths = parseInt(months);

    // Get monthly aggregated adherence
    const history = db
      .prepare(
        `
      WITH monthly_data AS (
        SELECT
          strftime('%Y-%m', b.start_date) as month,
          b.amount as budget_amount,
          COALESCE(SUM(CASE WHEN t.type = 'expense' THEN COALESCE(t.amount_local, t.amount) ELSE 0 END), 0) as spent
        FROM budgets b
        LEFT JOIN transactions t ON t.category_id = b.category_id
          AND t.profile_id = b.profile_id
          AND t.date >= b.start_date
          AND t.date < date(b.start_date, '+1 month')
        WHERE b.profile_id = ?
        GROUP BY b.start_date
      ),
      aggregated AS (
        SELECT
          month,
          SUM(budget_amount) as total_budget,
          SUM(spent) as total_spent,
          CASE WHEN SUM(budget_amount) > 0 THEN (SUM(spent) / SUM(budget_amount) * 100) ELSE 0 END as adherence_pct
        FROM monthly_data
        GROUP BY month
        ORDER BY month DESC
      )
      SELECT
        month,
        total_budget,
        total_spent,
        adherence_pct,
        LAG(adherence_pct) OVER (ORDER BY month) as prev_adherence,
        CASE WHEN LAG(adherence_pct) OVER (ORDER BY month) IS NOT NULL
             THEN adherence_pct - LAG(adherence_pct) OVER (ORDER BY month)
             ELSE NULL END as change_pct
      FROM aggregated
      ORDER BY month DESC
      LIMIT ?
    `
      )
      .all(pid, numMonths);

    // Get category breakdown for latest month (for donut chart)
    let categoryBudgets = [];
    if (history.length > 0) {
      const latestMonth = history[0].month;
      const catData = db
        .prepare(
          `
        SELECT c.name, c.color, b.amount as budget_amount
        FROM budgets b
        JOIN categories c ON c.id = b.category_id
        WHERE b.profile_id = ? AND strftime('%Y-%m', b.start_date) = ?
        ORDER BY b.amount DESC
      `
        )
        .all(pid, latestMonth);
      categoryBudgets = catData;
    }

    // Attach category_budgets JSON to last item for donut
    if (history.length > 0) {
      history[0].category_budgets = JSON.stringify(categoryBudgets);
    }

    res.json(history);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// BUDGET ALERTS
// ========================
app.get('/api/budgets/alerts', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { threshold = 80, year, month } = req.query;
    const alertThreshold = parseFloat(threshold);

    // Support optional year/month for historical alerts, default to current month
    let startDate, endDate;
    if (year && month) {
      const y = parseInt(year);
      const m = parseInt(month);
      startDate = `${y}-${String(m).padStart(2, '0')}-01`;
      const nextM = m === 12 ? 1 : m + 1;
      const nextY = m === 12 ? y + 1 : y;
      endDate = `${nextY}-${String(nextM).padStart(2, '0')}-01`;
    } else {
      const now = new Date();
      startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const nextM = now.getMonth() === 11 ? 1 : now.getMonth() + 2;
      const nextY = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
      endDate = `${nextY}-${String(nextM).padStart(2, '0')}-01`;
    }

    const budgets = db
      .prepare(
        `SELECT b.*, c.name as category_name, c.color as category_color, c.icon as category_icon
         FROM budgets b
         JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
         WHERE b.profile_id = ? AND (b.end_date IS NULL OR b.end_date >= ?)`
      )
      .all(pid, startDate);

    const spent = db
      .prepare(
        `SELECT category_id, SUM(COALESCE(amount_local, amount)) as total
         FROM transactions
         WHERE profile_id = ? AND date >= ? AND date < ? AND type = 'expense' AND category_id IS NOT NULL
         GROUP BY category_id`
      )
      .all(pid, startDate, endDate);

    const spentMap = {};
    for (const s of spent) spentMap[s.category_id] = Math.abs(s.total);

    const alerts = budgets
      .map((b) => {
        const s = spentMap[b.category_id] || 0;
        const pct = b.amount > 0 ? (s / b.amount) * 100 : 0;
        const remaining = b.amount - s;
        return {
          categoryId: b.category_id,
          categoryName: b.category_name,
          categoryColor: b.category_color,
          categoryIcon: b.category_icon,
          budgetAmount: b.amount,
          spent: s,
          remaining,
          percentage: Math.round(pct),
          status: pct > 100 ? 'over' : pct >= alertThreshold ? 'warning' : 'ok',
        };
      })
      .filter((b) => b.percentage >= alertThreshold)
      .sort((a, b) => b.percentage - a.percentage);

    res.json({ alerts, threshold: alertThreshold, startDate, endDate });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// ZERO-BASED BUDGETING
// ========================

// Get budget allocation form - categories with remaining allocation
app.get('/api/budgets/zero-based', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const startOfMonth = `${month}-01`;
    const nextMonth = new Date(
      new Date(month + '-01').setMonth(new Date(month + '-01').getMonth() + 1)
    );
    const endOfMonth = nextMonth.toISOString().slice(0, 10);

    // Get all expense categories for this profile
    const categories = db
      .prepare(
        `SELECT id, name, color, icon FROM categories WHERE profile_id = ? AND type = 'expense' ORDER BY name`
      )
      .all(pid);

    // Get existing budgets for this month
    const budgets = db
      .prepare(
        `SELECT * FROM budgets WHERE profile_id = ? AND start_date >= ? AND start_date < ? AND period = 'monthly'`
      )
      .all(pid, startOfMonth, endOfMonth);

    const budgetMap = {};
    budgets.forEach((b) => (budgetMap[b.category_id] = b));

    // Get actual spending for this month
    const spent = db
      .prepare(
        `SELECT category_id, SUM(COALESCE(amount_local, amount)) as total
       FROM transactions
       WHERE profile_id = ? AND date >= ? AND date < ? AND type = 'expense' AND category_id IS NOT NULL
       GROUP BY category_id`
      )
      .all(pid, startOfMonth, endOfMonth);

    const spentMap = {};
    spent.forEach((s) => (spentMap[s.category_id] = Math.abs(s.total)));

    // Calculate remaining amount for zero-based budgeting
    const remaining =
      db
        .prepare(
          `SELECT SUM(COALESCE(amount_local, amount)) as total
       FROM transactions
       WHERE profile_id = ? AND date >= ? AND date < ? AND type = 'income'
    `
        )
        .all(pid, startOfMonth, endOfMonth)[0]?.total || 0;

    // Calculate already budgeted amounts
    const alreadyBudgetedRows = db
      .prepare(
        `SELECT SUM(amount) as total FROM budgets
       WHERE profile_id = ? AND start_date >= ? AND start_date < ?
    `
      )
      .all(pid, startOfMonth, endOfMonth);
    const alreadyBudgeted = (alreadyBudgetedRows && alreadyBudgetedRows[0]?.total) ?? 0;

    // Calculate unassigned budget for this month
    const unassignedBudget = Math.max(0, remaining - alreadyBudgeted);

    // Build category allocation details
    const allocations = categories.map((cat) => {
      const budget = budgetMap[cat.id];
      const spentAmt = spentMap[cat.id] || 0;
      const remainingBudget = budget ? budget.amount - spentAmt : 0;
      const percentUsed = budget && budget.amount > 0 ? (spentAmt / budget.amount) * 100 : 0;

      return {
        budget_id: budget?.id ?? null,
        category_id: cat.id,
        category_name: cat.name,
        category_color: cat.color,
        category_icon: cat.icon,
        amount: budget?.amount || 0,
        spent: spentAmt,
        remaining_budget: remainingBudget,
        percent_used: Math.min(100, Math.round(percentUsed)),
        is_budgeted: !!budget,
        can_allocate: unassignedBudget > 0,
        rollover_enabled: budget?.rollover_enabled ?? false,
      };
    });

    res.json({
      categories,
      allocations,
      remaining_income: remaining,
      alreadyBudgeted,
      unassigned_budget: unassignedBudget,
      period: month,
      can_allocate: unassignedBudget > 0,
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Allocate budget to a category (zero-based budgeting)
app.post('/api/budgets/allocate', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { category_id, amount, period } = req.body;

    if (!category_id || amount == null) {
      return res.status(400).json({ error: 'Category ID and amount are required' });
    }

    const budgetPeriod = period || 'monthly';

    // Get month for this budget (default to current month)
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const start_date = `${month}-01`;

    // Check if budget already exists for this category and month
    const existing = db
      .prepare(
        `SELECT * FROM budgets WHERE category_id = ? AND profile_id = ? AND start_date = ? AND period = ?`
      )
      .get(category_id, pid, start_date, period);

    if (existing) {
      return res.status(400).json({
        error: `Budget already exists for ${month}. Use PUT /api/budgets/:id to update it.`,
      });
    }

    const info = db
      .prepare(
        'INSERT INTO budgets (category_id, amount, period, start_date, profile_id) VALUES (?, ?, ?, ?, ?)'
      )
      .run(category_id, amount, period, start_date, pid);

    res.json({
      id: info.lastInsertRowid,
      category_id,
      amount,
      period,
      start_date,
      profile_id: pid,
      message: 'Budget allocated successfully',
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Get zero-based budget summary - view allocations and spending
app.get('/api/budgets/zero-based/summary', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const startOfMonth = `${month}-01`;
    const nextMonth = new Date(
      new Date(month + '-01').setMonth(new Date(month + '-01').getMonth() + 1)
    );
    const endOfMonth = nextMonth.toISOString().slice(0, 10);

    // Get allocations (budgets for this month)
    const budgets = db
      .prepare(
        `SELECT b.*, c.name as category_name, c.color as category_color, c.icon as category_icon
       FROM budgets b
       JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
       WHERE b.profile_id = ? AND b.start_date >= ? AND b.start_date < ? AND b.period = 'monthly'`
      )
      .all(pid, startOfMonth, endOfMonth);

    // Get actual spending by category
    const spent = db
      .prepare(
        `SELECT category_id, SUM(COALESCE(amount_local, amount)) as total
       FROM transactions
       WHERE profile_id = ? AND date >= ? AND date < ? AND type = 'expense' AND category_id IS NOT NULL
       GROUP BY category_id`
      )
      .all(pid, startOfMonth, endOfMonth);

    const spentMap = {};
    spent.forEach((s) => (spentMap[s.category_id] = Math.abs(s.total)));

    // Get total income for this month
    const income =
      db
        .prepare(
          `SELECT SUM(COALESCE(amount_local, amount)) as total
       FROM transactions
       WHERE profile_id = ? AND date >= ? AND date < ? AND type = 'income'
    `
        )
        .all(pid, startOfMonth, endOfMonth)[0]?.total || 0;

    // Calculate summary
    const totalBudget = budgets.reduce((sum, b) => sum + b.amount, 0);
    const totalSpent = Object.values(spentMap).reduce((sum, val) => sum + val, 0);
    const remaining = totalBudget - totalSpent;
    const zero_based_remaining = income - totalBudget;

    const summary = budgets.map((b) => ({
      budget_id: b.id,
      category_id: b.category_id,
      category_name: b.category_name,
      category_color: b.category_color,
      category_icon: b.category_icon,
      allocated: b.amount,
      spent: spentMap[b.category_id] || 0,
      remaining: b.amount - (spentMap[b.category_id] || 0),
      percent_used: b.amount > 0 ? ((spentMap[b.category_id] || 0) / b.amount) * 100 : 0,
      status: (spentMap[b.category_id] || 0) > b.amount ? 'over' : 'ok',
      is_fully_allocated: b.amount > 0 && (spentMap[b.category_id] || 0) <= b.amount,
      rollover_enabled: b.rollover_enabled ?? false,
      alerts: [],
    }));

    // Add remaining unallocated alerts
    if (zero_based_remaining > 0) {
      summary.push({
        category_id: 0,
        category_name: 'Unallocated / Future',
        category_color: '#9ca3af',
        category_icon: 'wallet',
        allocated: 0,
        spent: 0,
        remaining: zero_based_remaining,
        percent_used: 0,
        status: 'ok',
        is_fully_allocated: true,
        alerts: [
          'You have unallocated income. Consider adding a savings allocation or increase existing budgets.',
        ],
        is_unallocated: true,
      });
    }

    // Over-budget alerts
    summary.forEach((item) => {
      if (item.percent_used >= 90) {
        item.alerts.push(`Approaching limit: ${Math.round(item.percent_used)}% used`);
      }
      if (item.percent_used >= 100) {
        item.alerts.push(`Over budget by $${item.remaining.toFixed(2)}`);
      }
    });

    res.json({
      allocations: summary,
      total_budget: totalBudget,
      total_spent: totalSpent,
      remaining: remaining,
      zero_based_remaining,
      income,
      period: month,
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// BUDGET FORECASTING
// ========================
app.get('/api/budgets/forecast', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { month = new Date().toISOString().slice(0, 7) } = req.query;

    // Get budgets active in or before the forecast start month
    const startOfMonth = `${month}-01`;
    const endOfMonth = new Date(
      new Date(`${month}-01`).setMonth(new Date(`${month}-01`).getMonth() + 1)
    )
      .toISOString()
      .slice(0, 10);

    const budgets = db
      .prepare(
        `
      SELECT b.*, c.name as category_name, c.color as category_color
      FROM budgets b
      JOIN categories c ON c.id = b.category_id
      WHERE b.profile_id = ? AND b.start_date <= ?
      ORDER BY b.start_date DESC
    `
      )
      .all(pid, month);

    if (budgets.length === 0) {
      return res.json({
        period: month,
        history: [],
        forecast: [],
        total_budget: 0,
        avg_adherence: 0,
      });
    }

    // Get historical spending by category for past 12 months
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const startHistory = oneYearAgo.toISOString().slice(0, 7);

    const historicalData = db
      .prepare(
        `
      SELECT
        strftime('%Y-%m', date) as month,
        b.category_id,
        b.period,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN COALESCE(t.amount_local, t.amount) ELSE 0 END), 0) as spent
      FROM budgets b
      LEFT JOIN transactions t ON t.category_id = b.category_id
        AND t.profile_id = b.profile_id
        AND t.date >= b.start_date
        AND t.date < date(b.start_date, '+1 month')
        AND t.type = 'expense'
      WHERE b.profile_id = ?
      GROUP BY month, b.category_id, b.period
    `
      )
      .all(pid);

    // Build category historical averages
    const categoryAverages = {};
    for (const row of historicalData) {
      if (!categoryAverages[row.category_id]) {
        categoryAverages[row.category_id] = { total: 0, count: 0, avgAmount: 0 };
      }
      if (row.spent > 0) {
        categoryAverages[row.category_id].total += row.spent;
        categoryAverages[row.category_id].count += 1;
      }
    }

    for (const cid in categoryAverages) {
      if (categoryAverages[cid].count > 0) {
        categoryAverages[cid].avgAmount = categoryAverages[cid].total / categoryAverages[cid].count;
      }
    }

    // Generate forecast for next 6 months
    const forecastMonths = [];
    const now = new Date();
    for (let i = 1; i <= 6; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      forecastMonths.push({
        month: date.toISOString().slice(0, 7),
        label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      });
    }

    const forecastData = forecastMonths.map((fm) => {
      const fmMonthStr = fm.month + '-01';
      const fmNextMonthStr = new Date(
        new Date(fm.month + '-01').setMonth(new Date(fm.month + '-01').getMonth() + 1)
      )
        .toISOString()
        .slice(0, 10);

      // Get current budget amount for this month (if active)
      const currentBudget =
        budgets.find((b) => b.start_date === fmMonthStr) || budgets[budgets.length - 1];

      // Predicted spending based on historical average
      const avgSpending = categoryAverages[currentBudget.category_id]
        ? categoryAverages[currentBudget.category_id].avgAmount
        : currentBudget.amount * 0.5; // Default to 50% if no history

      // Apply inflation adjustment (3% annually)
      const monthsDiff = new Date(fm.month + '-01').getMonth() - new Date().getMonth();
      const inflationFactor = Math.pow(1.03, Math.max(0, monthsDiff));

      const predictedSpent = avgSpending * inflationFactor;
      const adherence =
        currentBudget.amount > 0 ? Math.min(100, (predictedSpent / currentBudget.amount) * 100) : 0;
      const status = adherence > 100 ? 'over' : adherence >= 80 ? 'warning' : 'ok';
      const forecastRemaining = Math.max(0, currentBudget.amount - predictedSpent);

      return {
        month: fm.month,
        label: fm.label,
        budget_amount: currentBudget.amount,
        predicted_spent: predictedSpent,
        adherence,
        status,
        forecast_remaining: forecastRemaining,
      };
    });

    // Get historical adherence for comparison
    const historyMonths = [];
    const endOfHistory = new Date(now);
    endOfHistory.setMonth(endOfHistory.getMonth() - 1);

    for (let i = 1; i <= 6; i++) {
      const date = new Date(endOfHistory.getFullYear(), endOfHistory.getMonth() - i, 1);
      historyMonths.push({
        month: date.toISOString().slice(0, 7),
        label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      });
    }

    const historyData = db
      .prepare(
        `
      SELECT
        strftime('%Y-%m', start_date) as month,
        SUM(b.amount) as total_budget,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN COALESCE(t.amount_local, t.amount) ELSE 0 END), 0) as total_spent
      FROM budgets b
      LEFT JOIN transactions t ON t.category_id = b.category_id
        AND t.profile_id = b.profile_id
        AND t.date >= b.start_date
        AND t.date < date(b.start_date, '+1 month')
      WHERE b.profile_id = ? AND strftime('%Y-%m', start_date) <= ?
      GROUP BY month
      ORDER BY month DESC
      LIMIT ?
    `
      )
      .all(pid, now.toISOString().slice(0, 7), 6);

    const history = historyData.map((h) => ({
      month: h.month,
      label: new Date(h.month + '-01').toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      }),
      total_budget: h.total_budget || 0,
      total_spent: h.total_spent || 0,
      adherence: h.total_budget > 0 ? Math.min(100, (h.total_spent / h.total_budget) * 100) : 0,
    }));

    const avgAdherence =
      history.length > 0 ? history.reduce((sum, h) => sum + h.adherence, 0) / history.length : 0;

    res.json({
      period: month,
      history,
      forecast: forecastData,
      total_budget: budgets.reduce((sum, b) => sum + b.amount, 0),
      avg_adherence: Math.round(avgAdherence),
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// SAVINGS GOALS
// ========================
app.get('/api/savings-goals', apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT * FROM savings_goals WHERE profile_id IN (${inClause}) ORDER BY created_at DESC`
      )
      .all(...pids);
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/savings-goals', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, target_amount, current_amount, deadline, notes } = req.body;
    if (!name || target_amount == null) {
      return res.status(400).json({ error: 'Name and target amount are required' });
    }
    const info = db
      .prepare(
        'INSERT INTO savings_goals (profile_id, name, target_amount, current_amount, deadline, notes) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(pid, name, target_amount, current_amount || 0, deadline || null, notes || '');
    res.json({
      id: info.lastInsertRowid,
      name,
      target_amount,
      current_amount: current_amount || 0,
      deadline,
      notes,
      profile_id: pid,
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/savings-goals/:id', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, target_amount, current_amount, deadline, notes } = req.body;
    const result = db
      .prepare(
        'UPDATE savings_goals SET name=?, target_amount=?, current_amount=?, deadline=?, notes=? WHERE id=? AND profile_id=?'
      )
      .run(name, target_amount, current_amount, deadline || null, notes || '', req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/savings-goals/:id', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const result = db
      .prepare('DELETE FROM savings_goals WHERE id=? AND profile_id=?')
      .run(req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// LOANS (per-profile)
// ========================
app.get('/api/loans', apiRateLimiter, (req, res) => {
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
    `
      )
      .all(pid);
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/loans', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, principal, interest_rate, start_date, term_months, rate_periods } = req.body;
    const info = db
      .prepare(
        'INSERT INTO loans (name, principal, interest_rate, start_date, term_months, profile_id) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(name, principal, interest_rate || 5.0, start_date, term_months, pid);
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
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/loans/:id', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db
      .prepare('SELECT * FROM loans WHERE id=? AND profile_id=?')
      .get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: 'Not found' });
    loan.rate_periods = db
      .prepare('SELECT * FROM loan_rate_periods WHERE loan_id=? ORDER BY start_month')
      .all(req.params.id);
    loan.prepayments = db
      .prepare('SELECT * FROM loan_prepayments WHERE loan_id=? ORDER BY month')
      .all(req.params.id);
    res.json(loan);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/loans/:id', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, principal, interest_rate, start_date, term_months, rate_periods } = req.body;
    const result = db
      .prepare(
        'UPDATE loans SET name=?, principal=?, interest_rate=?, start_date=?, term_months=? WHERE id=? AND profile_id=?'
      )
      .run(name, principal, interest_rate || 5.0, start_date, term_months, req.params.id, pid);
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

    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/loans/:id', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const result = db
      .prepare('DELETE FROM loans WHERE id=? AND profile_id=?')
      .run(req.params.id, pid);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Rate periods CRUD
app.post('/api/loans/:id/rates', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db
      .prepare('SELECT id FROM loans WHERE id=? AND profile_id=?')
      .get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    const { rate, start_month, end_month } = req.body;
    const info = db
      .prepare(
        'INSERT INTO loan_rate_periods (loan_id, rate, start_month, end_month) VALUES (?, ?, ?, ?)'
      )
      .run(req.params.id, rate, start_month, end_month || null);
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/loans/:id/rates/:rateId', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db
      .prepare('SELECT id FROM loans WHERE id=? AND profile_id=?')
      .get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    const { rate, start_month, end_month } = req.body;
    db.prepare(
      'UPDATE loan_rate_periods SET rate=?, start_month=?, end_month=? WHERE id=? AND loan_id=?'
    ).run(rate, start_month, end_month || null, req.params.rateId, req.params.id);
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/loans/:id/rates/:rateId', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db
      .prepare('SELECT id FROM loans WHERE id=? AND profile_id=?')
      .get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    db.prepare('DELETE FROM loan_rate_periods WHERE id=? AND loan_id=?').run(
      req.params.rateId,
      req.params.id
    );
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Prepayments CRUD
app.post('/api/loans/:id/prepayments', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db
      .prepare('SELECT id FROM loans WHERE id=? AND profile_id=?')
      .get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    const { month, amount, note } = req.body;
    const info = db
      .prepare('INSERT INTO loan_prepayments (loan_id, month, amount, note) VALUES (?, ?, ?, ?)')
      .run(req.params.id, month, amount, note || '');
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/loans/:id/prepayments/:prepayId', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db
      .prepare('SELECT id FROM loans WHERE id=? AND profile_id=?')
      .get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    db.prepare('DELETE FROM loan_prepayments WHERE id=? AND loan_id=?').run(
      req.params.prepayId,
      req.params.id
    );
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Calculate amortization
app.post('/api/loans/:id/calculate', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const loan = db
      .prepare('SELECT * FROM loans WHERE id=? AND profile_id=?')
      .get(req.params.id, pid);
    if (!loan) return res.status(404).json({ error: 'Not found' });

    const ratePeriods = db
      .prepare('SELECT * FROM loan_rate_periods WHERE loan_id=? ORDER BY start_month')
      .all(req.params.id);
    const prepayments = db
      .prepare('SELECT * FROM loan_prepayments WHERE loan_id=? ORDER BY month')
      .all(req.params.id);

    // Prepend the loan's initial rate as the first rate period (months 1 to before first user-set change)
    const initialRatePeriod = [{ rate: loan.interest_rate, start_month: 1, end_month: undefined }];
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
      }))
    );

    const scheduleNoPrepayments = loanCalc.calculateSchedule(
      loan.principal,
      loan.start_date,
      loan.term_months,
      allRatePeriods,
      []
    );

    const summary = loanCalc.getSummary(scheduleWithPrepayments, scheduleNoPrepayments);

    res.json({
      schedule: scheduleWithPrepayments,
      summary,
      comparison: {
        withPrepayments: summary,
        withoutPrepayments: loanCalc.getSummary(scheduleNoPrepayments, scheduleNoPrepayments),
      },
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// DASHBOARD (aggregated endpoint)
// ========================
app.get('/api/dashboard', apiRateLimiter, async (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');

    // Get settings for currency
    const currencyRow = db
      .prepare(
        `SELECT value FROM settings WHERE key = 'local_currency' AND (profile_id IN (${inClause}) OR profile_id IS NULL) ORDER BY profile_id DESC LIMIT 1`
      )
      .get(...pids);
    const currency = currencyRow ? currencyRow.value : 'EUR';

    // Get summary (income, expenses, balance, recent transactions)
    const dateFrom = req.query.date_from;
    const dateTo = req.query.date_to;
    let startDate;
    let endDate;
    if (dateFrom && dateTo) {
      startDate = dateFrom;
      endDate = dateTo;
    } else {
      const year = parseInt(req.query.year) || new Date().getFullYear();
      const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
      startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }

    // Previous month calculation
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevStartDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
    const prevLastDay = new Date(prevYear, prevMonth, 0).getDate();
    const prevEndDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(prevLastDay).padStart(2, '0')}`;

    const monthly = db
      .prepare(
        `SELECT type, SUM(COALESCE(amount_local, amount)) as total, COUNT(*) as count FROM transactions WHERE profile_id IN (${inClause}) AND date >= ? AND date <= ? GROUP BY type`
      )
      .all(...pids, startDate, endDate);

    const summary = { income: 0, expense: 0, balance: 0 };
    for (const r of monthly) {
      if (r.type === 'income') summary.income = r.total;
      else if (r.type === 'expense') summary.expense = r.total;
      else if (r.type === 'transfer') summary.balance += r.total;
    }

    // Get previous month summary for MoM delta
    const prevMonthly = db
      .prepare(
        `SELECT type, SUM(COALESCE(amount_local, amount)) as total FROM transactions WHERE profile_id IN (${inClause}) AND date >= ? AND date <= ? GROUP BY type`
      )
      .all(...pids, prevStartDate, prevEndDate);

    const prevSummary = { income: 0, expense: 0, balance: 0 };
    for (const r of prevMonthly) {
      if (r.type === 'income') prevSummary.income = r.total;
      else if (r.type === 'expense') prevSummary.expense = r.total;
      else if (r.type === 'transfer') prevSummary.balance += r.total;
    }

    const momIncomeDelta = summary.income - prevSummary.income;
    const momExpenseDelta = summary.expense - prevSummary.expense;
    const momBalanceDelta = (summary.income - summary.expense) - (prevSummary.income - prevSummary.expense);

    const recent = db
      .prepare(
        `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon FROM transactions t LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ? ORDER BY t.date DESC, t.id DESC LIMIT 10`
      )
      .all(...pids, startDate, endDate);

    // Get category breakdown for expenses
    const expenseByCategory = db
      .prepare(
        `SELECT c.name as category_name, c.color as category_color, SUM(COALESCE(t.amount_local, t.amount)) as total FROM transactions t LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id WHERE t.profile_id IN (${inClause}) AND t.type = 'expense' AND t.date >= ? AND t.date <= ? GROUP BY c.id, c.name, c.color ORDER BY total DESC`
      )
      .all(...pids, startDate, endDate);

    // Get account balances
    const accounts = db
      .prepare(
        `SELECT id, name, type, currency, balance FROM accounts WHERE profile_id IN (${inClause})`
      )
      .all(...pids);
    const balance = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);

    // Get upcoming bills
    const today = new Date();
    const upcomingBills = db
      .prepare(
        `SELECT b.*, p.name as profile_name FROM bills b LEFT JOIN profiles p ON b.profile_id = p.id WHERE b.profile_id IN (${inClause}) AND b.due_date >= ? AND b.due_date <= ? ORDER BY b.due_date ASC LIMIT 5`
      )
      .all(
        ...pids,
        today.toISOString().split('T')[0],
        new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      );

    res.json({
      totalIncome: summary.income,
      totalExpenses: summary.expense,
      balance,
      incomeByCategory: [],
      expenseByCategory,
      recentTransactions: recent,
      upcomingBills,
      momIncomeDelta,
      momExpenseDelta,
      momBalanceDelta,
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// DASHBOARD (per-profile, multi-profile for combined view)
// ========================
app.get('/api/dashboard/summary', apiRateLimiter, (req, res) => {
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
    const monthly = db
      .prepare(
        `
      SELECT type, SUM(COALESCE(amount_local, amount)) as total, COUNT(*) as count
      FROM transactions
      WHERE profile_id IN (${inClause}) AND date >= ? AND date < ?
      GROUP BY type
    `
      )
      .all(...pids, startDate, endDate);

    const summary = { income: 0, expense: 0, transfer: 0, balance: 0 };
    for (const r of monthly) {
      if (r.type === 'income') summary.income = r.total;
      else if (r.type === 'expense') summary.expense = r.total;
      else if (r.type === 'transfer') summary.transfer = r.total;
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
    `
      )
      .all(...pids, startDate, endDate);

    // Use amount_local if available (for imported transactions), otherwise amount
    const yearStart = `${y}-01-01`;
    const ytd = db
      .prepare(
        `
      SELECT type, SUM(COALESCE(amount_local, amount)) as total FROM transactions WHERE profile_id IN (${inClause}) AND date >= ? GROUP BY type
    `
      )
      .all(...pids, yearStart);
    const ytdSummary = { income: 0, expense: 0 };
    for (const r of ytd) {
      if (r.type === 'income') ytdSummary.income = r.total;
      else if (r.type === 'expense') ytdSummary.expense = r.total;
    }
    ytdSummary.net = ytdSummary.income - ytdSummary.expense;

    // Get currency setting
    // Previous period comparison
    let prevStartDate, prevEndDate;
    if (m) {
      // Previous month
      const pm = m == 1 ? 12 : m - 1;
      const py = m == 1 ? y - 1 : y;
      prevStartDate = `${py}-${String(pm).padStart(2, '0')}-01`;
      const nextPm = pm == 12 ? 1 : pm + 1;
      const nextPy = pm == 12 ? py + 1 : py;
      prevEndDate = `${nextPy}-${String(nextPm).padStart(2, '0')}-01`;
    } else {
      // Previous year
      prevStartDate = `${y - 1}-01-01`;
      prevEndDate = `${y}-01-01`;
    }

    const prevMonthly = db
      .prepare(
        `SELECT type, SUM(COALESCE(amount_local, amount)) as total FROM transactions WHERE profile_id IN (${inClause}) AND date >= ? AND date < ? GROUP BY type`
      )
      .all(...pids, prevStartDate, prevEndDate);
    const prevSummary = { income: 0, expense: 0 };
    for (const r of prevMonthly) {
      if (r.type === 'income') prevSummary.income = r.total;
      else if (r.type === 'expense') prevSummary.expense = r.total;
    }

    // Get currency setting
    const currencyRow = db
      .prepare(
        `SELECT value FROM settings WHERE key = 'local_currency' AND (profile_id IN (${inClause}) OR profile_id IS NULL) ORDER BY profile_id DESC LIMIT 1`
      )
      .get(...pids);
    const currency = currencyRow ? currencyRow.value : 'EUR';

    res.json({
      summary,
      prevSummary,
      recent,
      ytd: ytdSummary,
      month: m ? `${y}-${String(m).padStart(2, '0')}` : y,
      currency,
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/charts', apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const { months = 12 } = req.query;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months) + 1);
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

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
    `
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
    `
      )
      .all(...pids, startStr, endStr);

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
    const currencyRow = db
      .prepare(
        `SELECT value FROM settings WHERE key = 'local_currency' AND (profile_id IN (${inClause}) OR profile_id IS NULL) ORDER BY profile_id DESC LIMIT 1`
      )
      .get(...pids);
    const currency = currencyRow ? currencyRow.value : 'EUR';

    res.json({
      byCategory,
      monthly: Object.values(monthlyMap),
      cashFlow,
      currency,
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/net-worth', apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    // Get account balances
    const accounts = db
      .prepare(
        `SELECT id, name, type, currency, balance FROM accounts WHERE profile_id IN (${inClause})`
      )
      .all(...pids);
    const totalNetWorth = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);

    // Get monthly net flow (income - expense) from earliest transaction to now
    const monthly = db
      .prepare(
        `
      SELECT strftime('%Y-%m', date) as month, type, SUM(COALESCE(amount_local, amount)) as total
      FROM transactions
      WHERE profile_id IN (${inClause}) AND type IN ('income', 'expense')
      GROUP BY month, type
      ORDER BY month
    `
      )
      .all(...pids);

    const monthlyMap = {};
    for (const r of monthly) {
      if (!monthlyMap[r.month]) monthlyMap[r.month] = { month: r.month, net: 0 };
      if (r.type === 'income') monthlyMap[r.month].net += r.total;
      if (r.type === 'expense') monthlyMap[r.month].net -= r.total;
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
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// IMPORT (per-profile)
// ========================
const importFiles = {}; // temp storage for reloading specific sheets

app.post('/api/import/upload', apiRateLimiter, uploadImport.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
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
      rows: data.slice(1).filter((r) => r.some((c) => c != null && c !== '')),
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
    console.error(err.message);
    logError('error', err);
    // Check if error is related to invalid file type
    if (err.message && err.message.includes('Invalid file type')) {
      res.status(400).json({ error: err.message });
    } else if (err.message && err.message.includes('Cannot read')) {
      res
        .status(400)
        .json({ error: 'Invalid file format. Please upload a valid spreadsheet file.' });
    } else {
      res.status(500).json({ error: 'Import failed. Please try again.' });
    }
  }
});

// Error handler middleware for import upload
app.use('/api/import/upload', (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message && err.message.includes('Invalid file type')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

app.post('/api/import/file-sheet', apiRateLimiter, (req, res) => {
  try {
    const { fileId, sheetName, mapping } = req.body;
    const entry = importFiles[fileId];
    if (!entry) return res.status(400).json({ error: 'File session expired. Please re-upload.' });

    const sheetNames = entry.workbook.SheetNames;
    if (!sheetNames.includes(sheetName)) return res.status(400).json({ error: 'Sheet not found' });

    const sheet = entry.workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const rows = data.slice(1).filter((r) => r.some((c) => c != null && c !== ''));

    // Server-side duplicate detection
    let duplicateCount = 0;
    let duplicateIndices = [];
    if (
      mapping &&
      mapping.description !== undefined &&
      mapping.amount !== undefined &&
      mapping.date !== undefined
    ) {
      const seen = new Map();
      rows.forEach((row, idx) => {
        const desc = (row[mapping.description] || '').toString().toLowerCase().trim();
        const amount = (row[mapping.amount] || '').toString().trim();
        const date = (row[mapping.date] || '').toString().trim();
        if (!desc && !amount && !date) return;
        const key = `${date}|${amount}|${desc}`;
        if (seen.has(key)) {
          duplicateIndices.push(idx);
          const origIdx = seen.get(key);
          if (!duplicateIndices.includes(origIdx)) duplicateIndices.push(origIdx);
        } else {
          seen.set(key, idx);
        }
      });
      duplicateIndices = duplicateIndices.sort((a, b) => a - b);
      duplicateCount = duplicateIndices.length;
    }

    res.json({
      fileId,
      sheetName,
      sheetNames,
      headers: (data[0] || []).map(String),
      rows,
      totalRows: data.length - 1,
      duplicateCount,
      duplicateIndices,
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/import/googlesheet', apiRateLimiter, (req, res) => {
  const { url, sheetName } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  // Extract sheet ID and gid from URL
  // URL can be: /d/ID/edit?gid=N#gid=N or just /d/ID/export?format=csv
  const idMatch = (url || '').match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return res.status(400).json({ error: 'Invalid Google Sheets URL or ID' });

  const sheetId = idMatch[1];
  // Extract gid from query param ?gid= or URL fragment #gid=
  const gidMatch = url.match(/[?&#]gid=([0-9]+)/);
  const gid = gidMatch ? gidMatch[1] : null;

  // Strategy 1: CSV export with gid (works for publicly accessible sheets, respects specific sheet tab)
  function tryCsvExport() {
    return new Promise((resolve) => {
      const csvUrl = gid
        ? `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`
        : `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
      fetch(csvUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        .then((r) => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then((text) => {
          // Check if it's actually CSV or an error page
          if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
            throw new Error('Sheet is not publicly accessible (got HTML instead of CSV)');
          }
          // Parse CSV manually (handles quoted fields, commas in values)
          const rows = [];
          const lines = text.trim().split('\n');
          for (const line of lines) {
            const cols = [];
            let cur = '';
            let inQuotes = false;
            for (const ch of line) {
              if (ch === '"') {
                inQuotes = !inQuotes;
              } else if (ch === ',' && !inQuotes) {
                cols.push(cur.trim().replace(/^"|"$/g, ''));
                cur = '';
              } else cur += ch;
            }
            cols.push(cur.trim().replace(/^"|"$/g, ''));
            rows.push(cols);
          }
          const headers = rows[0] || [];
          const dataRows = rows.slice(1).filter((r) => r.some((c) => c));
          resolve({
            headers,
            rows: dataRows,
            sheetName: sheetName || 'Sheet1',
          });
        })
        .catch((err) => resolve({ error: err.message }));
    });
  }

  // Strategy 2: Get all sheet names via XLSX export, then fetch CSV for specific sheet
  function tryXlsxAndListSheets() {
    return new Promise((resolve) => {
      fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
        .then((r) => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.arrayBuffer();
        })
        .then((buf) => {
          const workbook = XLSX.read(buf, { type: 'array' });
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
              'Failed to fetch Google Sheet: ' +
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
        const rows = data.slice(1).filter((r) => r.some((c) => c != null && c !== ''));
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
              'Failed to fetch Google Sheet: ' +
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
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: 'Failed to fetch Google Sheet: ' + err.message });
    }
  })();
});

app.post('/api/import/execute', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { rows, mapping, categoryTypes } = req.body;
    if (!rows || !mapping) return res.status(400).json({ error: 'Missing data' });

    const insert = db.prepare(`
      INSERT INTO transactions (description, amount, date, beneficiary, payor, category_id,
        currency, amount_local, means_of_payment, exchange_rate, type, notes, profile_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const getCat = db.prepare(
      'SELECT id, color FROM categories WHERE LOWER(name) = LOWER(?) AND profile_id = ? LIMIT 1'
    );
    const insertCat = db.prepare(
      'INSERT INTO categories (name, type, color, icon, profile_id) VALUES (?, ?, ?, ?, ?)'
    );

    // Diverse color palette for new categories
    const newCategoryColors = [
      '#ef4444',
      '#f97316',
      '#f59e0b',
      '#eab308',
      '#84cc16',
      '#22c55e',
      '#14b8a6',
      '#06b6d4',
      '#0ea5e9',
      '#3b82f6',
      '#6366f1',
      '#8b5cf6',
      '#a855f7',
      '#d946ef',
      '#ec4899',
      '#f43f5e',
      '#64748b',
      '#78716c',
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

        const amountRaw =
          parseFloat(row[mapping.amount] || row[mapping.Amount] || row[mapping.AMOUNT]) || 0;
        const amount = Math.abs(amountRaw);
        const dateRaw =
          row[mapping.date] ||
          row[mapping.Date] ||
          row[mapping.DATE] ||
          new Date().toISOString().split('T')[0];
        const currency =
          row[mapping.currency] || row[mapping.Currency] || row[mapping.CURRENCY] || 'USD';

        // Determine transaction type
        let validatedType;
        if (mapping.type) {
          const rawType = String(row[mapping.type] || '')
            .trim()
            .toLowerCase();
          if (['income', 'expense', 'transfer'].includes(rawType)) {
            validatedType = rawType;
          } else {
            // Auto-detect based on amount sign or common keywords
            validatedType =
              amountRaw < 0 ||
              rawType.includes('expense') ||
              rawType.includes('debit') ||
              rawType.includes('spent')
                ? 'expense'
                : amountRaw > 0 ||
                    rawType.includes('income') ||
                    rawType.includes('credit') ||
                    rawType.includes('received')
                  ? 'income'
                  : 'expense';
          }
        } else {
          // No type mapped — auto-detect from amount sign
          validatedType = amountRaw < 0 ? 'expense' : amountRaw > 0 ? 'income' : 'expense';
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
          row[mapping.means_of_payment] ||
            row[mapping.MeansOfPayment] ||
            row[mapping.MEANS_OF_PAYMENT] ||
            '',
          parseFloat(row[mapping.exchange_rate] || row[mapping.ExchangeRate] || 1.0) || 1.0,
          validatedType,
          row[mapping.notes] || row[mapping.Notes] || row[mapping.NOTES] || '',
          pid
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
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// ACCOUNTS (per-profile)
// ========================
app.get('/api/accounts', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const accounts = db
      .prepare('SELECT * FROM accounts WHERE profile_id = ? ORDER BY type, name')
      .all(pid);
    res.json(accounts);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/accounts', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, type, currency, balance, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const validTypes = ['giro', 'ib', 'savings'];
    const accountType = validTypes.includes(type) ? type : 'giro';
    const result = db
      .prepare(
        'INSERT INTO accounts (name, type, currency, balance, notes, profile_id) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(name.trim(), accountType, currency || 'USD', parseFloat(balance) || 0, notes || '', pid);
    res.json({ id: result.lastInsertRowid, message: 'Account created' });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/accounts/:id', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, type, currency, balance, notes } = req.body;
    const existing = db
      .prepare('SELECT id FROM accounts WHERE id = ? AND profile_id = ?')
      .get(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: 'Account not found' });
    const validTypes = ['giro', 'ib', 'savings'];
    const accountType = validTypes.includes(type) ? type : 'giro';
    db.prepare(
      'UPDATE accounts SET name = ?, type = ?, currency = ?, balance = ?, notes = ? WHERE id = ? AND profile_id = ?'
    ).run(
      name.trim(),
      accountType,
      currency || 'USD',
      parseFloat(balance) || 0,
      notes || '',
      req.params.id,
      pid
    );
    res.json({ message: 'Account updated' });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/accounts/:id', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const existing = db
      .prepare('SELECT id FROM accounts WHERE id = ? AND profile_id = ?')
      .get(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: 'Account not found' });
    db.prepare('DELETE FROM accounts WHERE id = ? AND profile_id = ?').run(req.params.id, pid);
    res.json({ message: 'Account deleted' });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// ACCOUNT BALANCE HISTORY
// ========================
app.get('/api/accounts/:id/history', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const account = db
      .prepare('SELECT id FROM accounts WHERE id = ? AND profile_id = ?')
      .get(req.params.id, pid);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const history = db
      .prepare(
        'SELECT id, balance, recorded_at FROM account_balance_history WHERE account_id = ? ORDER BY recorded_at DESC'
      )
      .all(req.params.id);
    res.json(history);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/accounts/:id/history', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const account = db
      .prepare('SELECT balance FROM accounts WHERE id = ? AND profile_id = ?')
      .get(req.params.id, pid);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    // Use balance from request body, or current account balance as fallback
    const balance = parseFloat(req.body.balance ?? account.balance);
    const result = db
      .prepare(
        "INSERT INTO account_balance_history (account_id, balance, recorded_at) VALUES (?, ?, datetime('now'))"
      )
      .run(req.params.id, balance);
    res.json({ id: result.lastInsertRowid, balance, recorded_at: new Date().toISOString() });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/accounts/:id/history', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const account = db
      .prepare('SELECT id FROM accounts WHERE id = ? AND profile_id = ?')
      .get(req.params.id, pid);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    db.prepare('DELETE FROM account_balance_history WHERE account_id = ?').run(req.params.id);
    res.json({ message: 'Balance history deleted' });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Get reconciliation summary for a specific account
app.get('/api/accounts/:id/reconciliation-summary', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const account = db
      .prepare('SELECT id, name FROM accounts WHERE id = ? AND profile_id = ?')
      .get(req.params.id, pid);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    // Get unreconciled transactions for this account
    // Note: accounts table doesn't directly link to transactions, so we show all profile transactions
    const unreconciled = db
      .prepare(
        `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
         FROM transactions
         WHERE profile_id = ? AND (reconciled = 0 OR reconciled IS NULL)`
      )
      .get(pid);
    const reconciled = db
      .prepare(`SELECT COUNT(*) as count FROM transactions WHERE profile_id = ? AND reconciled = 1`)
      .get(pid);

    res.json({
      account_id: account.id,
      account_name: account.name,
      unreconciled_count: unreconciled.count,
      unreconciled_total: unreconciled.total,
      reconciled_count: reconciled.count,
      total_transactions: unreconciled.count + reconciled.count,
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Net worth timeline from balance history
app.get('/api/accounts/history/timeline', apiRateLimiter, (req, res) => {
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
         ORDER BY date ASC`
      )
      .all(...pids);
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// RECURRING TRANSACTIONS
// ========================
app.get('/api/recurring', apiRateLimiter, (req, res) => {
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
    `
      )
      .all(pid);
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/recurring', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { description, amount, type, category_id, frequency, day_of_month, next_date, notes } =
      req.body;
    const info = db
      .prepare(
        `INSERT INTO recurring_transactions (profile_id, description, amount, type, category_id, frequency, day_of_month, next_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        pid,
        description || '',
        amount,
        type || 'expense',
        category_id || null,
        frequency || 'monthly',
        day_of_month || null,
        next_date || null,
        notes || ''
      );
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/recurring/:id', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const existing = db
      .prepare('SELECT id FROM recurring_transactions WHERE id = ? AND profile_id = ?')
      .get(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: 'Not found' });
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
      `UPDATE recurring_transactions SET description=?, amount=?, type=?, category_id=?, frequency=?, day_of_month=?, next_date=?, notes=?, active=? WHERE id=? AND profile_id=?`
    ).run(
      description ?? '',
      amount ?? 0,
      type ?? 'expense',
      category_id ?? null,
      frequency ?? 'monthly',
      day_of_month ?? null,
      next_date ?? null,
      notes ?? '',
      active ?? 1,
      req.params.id,
      pid
    );
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/recurring/:id', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    db.prepare('DELETE FROM recurring_transactions WHERE id = ? AND profile_id = ?').run(
      req.params.id,
      pid
    );
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/recurring/:id/populate', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const r = db
      .prepare('SELECT * FROM recurring_transactions WHERE id = ? AND profile_id = ?')
      .get(req.params.id, pid);
    if (!r) return res.status(404).json({ error: 'Not found' });
    const date = r.next_date || new Date().toISOString().split('T')[0];
    const info = db
      .prepare(
        `INSERT INTO transactions (profile_id, description, amount, type, category_id, date, notes, beneficiary, payor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(pid, r.description, r.amount, r.type, r.category_id, date, r.notes || '', '', '');

    // Advance next_date
    let next = new Date(date);
    if (r.frequency === 'monthly') next.setMonth(next.getMonth() + 1);
    else if (r.frequency === 'weekly') next.setDate(next.getDate() + 7);
    else if (r.frequency === 'yearly') next.setFullYear(next.getFullYear() + 1);
    const nextStr = next.toISOString().split('T')[0];
    db.prepare('UPDATE recurring_transactions SET next_date = ? WHERE id = ?').run(
      nextStr,
      req.params.id
    );

    res.json({
      ok: true,
      transactionId: info.lastInsertRowid,
      next_date: nextStr,
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// RECURRING INSIGHTS
// ========================
app.get('/api/recurring/upcoming', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const now = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);

    // Get all active recurring transactions
    const recurring = db
      .prepare(
        `
      SELECT r.id, r.description, r.amount, r.type, r.frequency, r.day_of_month, r.next_date,
             c.name as category_name, c.color as category_color
      FROM recurring_transactions r
      LEFT JOIN categories c ON r.category_id = c.id
      WHERE r.profile_id = ? AND r.active = 1
    `
      )
      .all(pid);

    // Expand each recurring transaction into its upcoming occurrences in the next 30 days
    const upcoming = [];
    for (const r of recurring) {
      let cursor = new Date(r.next_date || now.toISOString().split('T')[0]);
      if (cursor < now) {
        // Advance cursor to the next occurrence from today
        cursor = new Date(now.toISOString().split('T')[0]);
      }
      // Cap to the next 30 days
      const maxDate = new Date(endDate.toISOString().split('T')[0]);

      while (cursor <= maxDate) {
        upcoming.push({
          id: r.id,
          description: r.description,
          amount: r.amount,
          type: r.type,
          frequency: r.frequency,
          day_of_month: r.day_of_month,
          next_date: cursor.toISOString().split('T')[0],
          category_name: r.category_name,
          category_color: r.category_color,
        });

        // Advance cursor to next occurrence
        if (r.frequency === 'daily') {
          cursor.setDate(cursor.getDate() + 1);
        } else if (r.frequency === 'weekly') {
          cursor.setDate(cursor.getDate() + 7);
        } else if (r.frequency === 'monthly') {
          cursor.setMonth(cursor.getMonth() + 1);
          // Normalize day of month
          const day = r.day_of_month || cursor.getDate();
          cursor.setDate(
            Math.min(day, new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate())
          );
        } else if (r.frequency === 'yearly') {
          cursor.setFullYear(cursor.getFullYear() + 1);
        } else {
          break;
        }
      }
    }

    // Sort by next_date
    upcoming.sort((a, b) => a.next_date.localeCompare(b.next_date));

    // Group by category
    const byCategory = {};
    let totalMonthly = 0;
    for (const item of upcoming) {
      const catKey = item.category_name || 'Uncategorized';
      if (!byCategory[catKey]) {
        byCategory[catKey] = { name: catKey, color: item.category_color, total: 0, items: [] };
      }
      byCategory[catKey].total += item.amount;
      byCategory[catKey].items.push(item);
      totalMonthly += item.amount;
    }

    // Get currency from settings
    const currencyRow = db
      .prepare("SELECT value FROM settings WHERE key = 'local_currency' AND profile_id = ?")
      .get(pid);
    const currency = currencyRow ? currencyRow.value : 'EUR';

    res.json({
      transactions: upcoming.slice(0, 20),
      byCategory: Object.values(byCategory).sort((a, b) => b.total - a.total),
      totalMonthly,
      currency,
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// BILLS API
// ========================
// Helper: determine if a bill is paid for the current billing period
function isBillPaidForCurrentPeriod(bill, now) {
  if (!bill.last_paid) return false;
  const lastPaid = new Date(bill.last_paid);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  if (bill.frequency === 'monthly') {
    // Paid if last_paid is in the current month
    return lastPaid.getMonth() === today.getMonth() && lastPaid.getFullYear() === today.getFullYear();
  } else if (bill.frequency === 'weekly') {
    // Paid if last_paid is within the last 7 days
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return lastPaid >= weekAgo;
  } else if (bill.frequency === 'biweekly') {
    // Paid if last_paid is within the last 14 days
    const twoWeeksAgo = new Date(today);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    return lastPaid >= twoWeeksAgo;
  } else if (bill.frequency === 'yearly') {
    // Paid if last_paid is in the current year
    return lastPaid.getFullYear() === today.getFullYear();
  }
  return false;
}

app.get('/api/bills', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const rows = db
      .prepare(
        `
      SELECT b.*, c.name as category_name, c.color as category_color
      FROM bills b
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.profile_id = ?
      ORDER BY b.is_active DESC, b.name ASC
    `
      )
      .all(pid);

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    const billsWithStatus = rows.map((b) => {
      const paid = isBillPaidForCurrentPeriod(b, now);
      return { ...b, paid };
    });

    // Filter by paid status if requested
    if (req.query.paid === 'true') {
      res.json(billsWithStatus.filter((b) => b.paid));
    } else if (req.query.paid === 'false') {
      res.json(billsWithStatus.filter((b) => !b.paid));
    } else {
      res.json(billsWithStatus);
    }
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bills/upcoming', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    const bills = db
      .prepare(
        `
      SELECT b.*, c.name as category_name, c.color as category_color
      FROM bills b
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.profile_id = ? AND b.is_active = 1
      ORDER BY b.name ASC
    `
      )
      .all(pid);

    const upcoming = bills.map((b) => {
      let nextDue = null;
      const lastPaid = b.last_paid ? new Date(b.last_paid) : null;

      if (b.frequency === 'monthly') {
        const dayOfMonth = b.day_of_month || 1;
        if (lastPaid) {
          nextDue = new Date(lastPaid);
          nextDue.setMonth(nextDue.getMonth() + 1);
          nextDue.setDate(
            Math.min(
              dayOfMonth,
              new Date(nextDue.getFullYear(), nextDue.getMonth() + 1, 0).getDate()
            )
          );
        } else {
          nextDue = new Date(
            now.getFullYear(),
            now.getMonth(),
            Math.min(dayOfMonth, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())
          );
          if (nextDue < now) nextDue.setMonth(nextDue.getMonth() + 1);
        }
      } else if (b.frequency === 'weekly') {
        if (lastPaid) {
          nextDue = new Date(lastPaid);
          nextDue.setDate(nextDue.getDate() + 7);
        } else {
          nextDue = new Date(todayStr);
          nextDue.setDate(nextDue.getDate() + 7);
        }
      } else if (b.frequency === 'yearly') {
        if (lastPaid) {
          nextDue = new Date(lastPaid);
          nextDue.setFullYear(nextDue.getFullYear() + 1);
        } else {
          const dayOfMonth = b.day_of_month || 1;
          nextDue = new Date(now.getFullYear(), 0, dayOfMonth);
          if (nextDue < now) nextDue.setFullYear(nextDue.getFullYear() + 1);
        }
      }

      const nextDueStr = nextDue ? nextDue.toISOString().split('T')[0] : null;
      const daysUntil = nextDueStr ? Math.ceil((nextDue - now) / (1000 * 60 * 60 * 24)) : null;
      const isOverdue = daysUntil !== null && daysUntil < 0;

      return {
        id: b.id,
        name: b.name,
        amount: b.amount,
        frequency: b.frequency,
        day_of_month: b.day_of_month,
        category_name: b.category_name,
        category_color: b.category_color,
        category_id: b.category_id,
        last_paid: b.last_paid,
        next_due_date: nextDueStr,
        days_until: daysUntil,
        is_overdue: isOverdue,
        paid: isBillPaidForCurrentPeriod(b, now),
      };
    });

    upcoming.sort((a, b) => {
      if (a.is_overdue && !b.is_overdue) return -1;
      if (!a.is_overdue && b.is_overdue) return 1;
      if (a.days_until !== null && b.days_until !== null) return a.days_until - b.days_until;
      if (a.days_until !== null) return -1;
      if (b.days_until !== null) return 1;
      return 0;
    });

    res.json(upcoming);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bills', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { name, amount, frequency, day_of_month, category_id, notes } = req.body;
    if (!name || amount === undefined) {
      return res.status(400).json({ error: 'Name and amount are required' });
    }
    const info = db
      .prepare(
        `
      INSERT INTO bills (profile_id, name, amount, frequency, day_of_month, category_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        pid,
        name,
        amount,
        frequency || 'monthly',
        day_of_month || null,
        category_id || null,
        notes || ''
      );
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/bills/:id', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const existing = db
      .prepare('SELECT id FROM bills WHERE id = ? AND profile_id = ?')
      .get(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { name, amount, frequency, day_of_month, category_id, is_active, notes } = req.body;
    db.prepare(
      `
      UPDATE bills SET name = ?, amount = ?, frequency = ?, day_of_month = ?, category_id = ?, is_active = ?, notes = ?
      WHERE id = ? AND profile_id = ?
    `
    ).run(
      name ?? '',
      amount ?? 0,
      frequency ?? 'monthly',
      day_of_month ?? null,
      category_id ?? null,
      is_active ?? 1,
      notes ?? '',
      req.params.id,
      pid
    );
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/bills/:id', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    db.prepare('DELETE FROM bills WHERE id = ? AND profile_id = ?').run(req.params.id, pid);
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bills/:id/mark-paid', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const bill = db
      .prepare('SELECT * FROM bills WHERE id = ? AND profile_id = ?')
      .get(req.params.id, pid);
    if (!bill) return res.status(404).json({ error: 'Not found' });

    const todayStr = new Date().toISOString().split('T')[0];
    const info = db
      .prepare(
        `
      INSERT INTO transactions (profile_id, description, amount, type, category_id, date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(pid, bill.name, bill.amount, 'expense', bill.category_id, todayStr, bill.notes || '');

    db.prepare('UPDATE bills SET last_paid = ? WHERE id = ?').run(todayStr, req.params.id);

    res.json({ ok: true, transactionId: info.lastInsertRowid });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// STATS (per-profile)
// ========================
app.get('/api/stats/monthly', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { months = 24 } = req.query;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months) + 1);
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

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
    `
      )
      .all(pid, startStr, endStr);

    const map = {};
    for (const r of rows) {
      if (!map[r.month]) map[r.month] = { month: r.month, income: 0, expense: 0 };
      if (r.type === 'income') map[r.month].income = r.total;
      if (r.type === 'expense') map[r.month].expense = r.total;
      map[r.month].net = map[r.month].income - map[r.month].expense;
    }

    res.json(Object.values(map));
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// ANALYTICS - Daily Heatmap
// ========================
app.get('/api/analytics/daily-heatmap', apiRateLimiter, (req, res) => {
  try {
    const year = parseInt(req.query.year);
    if (!year) {
      res.status(400).json({ error: 'year query parameter is required' });
      return;
    }
    const type = req.query.type === 'income' ? 'income' : 'expense';

    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');

    const rows = db
      .prepare(
        `SELECT date, SUM(amount) as total
         FROM transactions
         WHERE profile_id IN (${inClause})
           AND substr(date, 1, 4) = ?
           AND type = ?
         GROUP BY date`
      )
      .all(...pids, String(year), type);

    const dates = {};
    for (const r of rows) {
      dates[r.date] = r.total;
    }

    res.json({ dates, year, type });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// ANALYTICS
// ========================
app.get('/api/analytics/distinct-years', apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT DISTINCT substr(date, 1, 4) as year FROM transactions WHERE profile_id IN (${inClause}) ORDER BY year DESC`
      )
      .all(...pids);
    const years = rows.map((r) => parseInt(r.year));
    const currentYear = new Date().getFullYear();
    if (years.length === 0) years.push(currentYear);
    if (!years.includes(currentYear)) years.unshift(currentYear);
    res.json({ years });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics/weeks', apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const year = parseInt(req.query.year);
    const month = req.query.month ? String(req.query.month).padStart(2, '0') : null;
    if (!year) {
      res.json({ weeks: [] });
      return;
    }
    const weeks = [];
    const firstDay = month ? new Date(year, parseInt(month) - 1, 1) : new Date(year, 0, 1);
    const last = month ? new Date(year, parseInt(month), 0).getDate() : 31;
    const lastDay = month ? new Date(year, parseInt(month) - 1, last) : new Date(year, 11, 31);
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
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// ANALYTICS - Stacked Category Trends
// ========================
app.get('/api/analytics/category-trends', apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = req.query.month ? String(req.query.month).padStart(2, '0') : null;
    const week = req.query.week ? parseInt(req.query.week) : null;
    const type = req.query.type || 'expense';

    // Date range
    let startStr, endStr;
    if (month) {
      const lastDay = new Date(year, parseInt(month), 0).getDate();
      if (week) {
        // Specific week within a month
        const weekStartDay = (week - 1) * 7 + 1;
        const weekEndDay = Math.min(week * 7, lastDay);
        startStr = `${year}-${month}-${String(weekStartDay).padStart(2, '0')}`;
        endStr = `${year}-${month}-${String(weekEndDay).padStart(2, '0')}`;
      } else {
        // Full month
        startStr = `${year}-${month}-01`;
        endStr = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
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
        `SELECT t.date, COALESCE(t.amount_local, t.amount) as amount, c.id as cat_id, c.name as cat_name, c.color as cat_color FROM transactions t JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id WHERE t.profile_id IN (${inClause}) AND t.type = ? AND t.date >= ? AND t.date <= ? ORDER BY t.date`
      )
      .all(...pids, type, startStr, endStr);

    const categories = db
      .prepare(
        `SELECT id, name, color FROM categories WHERE profile_id IN (${inClause}) AND type = ? ORDER BY name`
      )
      .all(...pids, type);

    // Generate labels based on view level
    const labels = [];
    const periodMap = new Map();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const monthNamesFull = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];

    if (week && month) {
      // Week view: show days of the week (Sun-Sat) for that month
      const lastDay = new Date(year, parseInt(month), 0).getDate();
      const weekStartDay = (week - 1) * 7 + 1;
      const weekEndDay = Math.min(week * 7, lastDay);
      for (let d = weekStartDay; d <= weekEndDay; d++) {
        const date = new Date(year, parseInt(month) - 1, d);
        labels.push(dayNames[date.getDay()]);
        periodMap.set(`${year}-${month}-${String(d).padStart(2, '0')}`, labels.length - 1);
      }
    } else if (month) {
      // Month view: show day numbers
      const lastDay = new Date(year, parseInt(month), 0).getDate();
      for (let d = 1; d <= lastDay; d++) {
        labels.push(`${monthNamesFull[parseInt(month) - 1]} ${d}`);
        periodMap.set(`${year}-${month}-${String(d).padStart(2, '0')}`, labels.length - 1);
      }
    } else {
      // Year view: show 12 months
      for (let m = 0; m < 12; m++) {
        labels.push(`${monthNames[m]} ${year}`);
        periodMap.set(`${year}-${String(m + 1).padStart(2, '0')}`, m);
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
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// ANALYTICS: SANKEY (Budget vs Actual)
// ========================
app.get('/api/analytics/sankey', apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = req.query.month ? String(req.query.month).padStart(2, '0') : null;

    if (!month) {
      return res.json({ nodes: [], links: [] });
    }

    const lastDay = new Date(year, parseInt(month), 0).getDate();
    const startStr = `${year}-${month}-01`;
    const endStr = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

    // Get budgets for this month
    const budgets = db
      .prepare(
        `
      SELECT b.category_id, b.amount as budget_amount, c.name as cat_name, c.color as cat_color
      FROM budgets b
      JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
      WHERE b.profile_id IN (${inClause}) AND (b.period = 'month' OR b.period = 'monthly')
      AND strftime('%Y-%m', b.start_date) <= ? AND (b.end_date IS NULL OR strftime('%Y-%m', b.end_date) >= ?)
    `
      )
      .all(...pids, `${year}-${month}`, `${year}-${month}`);

    // Get actual spending for this month
    const actualSpending = db
      .prepare(
        `
      SELECT t.category_id, SUM(COALESCE(t.amount_local, t.amount)) as actual_amount
      FROM transactions t
      WHERE t.profile_id IN (${inClause}) AND t.type = 'expense' AND t.date >= ? AND t.date <= ?
      GROUP BY t.category_id
    `
      )
      .all(...pids, startStr, endStr);

    // Create maps for easy lookup
    const budgetMap = new Map(budgets.map((b) => [b.category_id, b]));
    const actualMap = new Map(actualSpending.map((a) => [a.category_id, a]));

    // Build nodes and links for sankey
    const nodes = [];
    const links = [];
    const nodeNames = new Set();

    // Add "Total Budget" source node
    nodes.push({ name: 'Total Budget', category: 'budget' });
    nodeNames.add('Total Budget');

    // Add category nodes and links
    budgets.forEach((b) => {
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
    budgets.forEach((b) => {
      totalBudget += b.budget_amount;
      links.push({
        source: 'Total Budget',
        target: b.cat_name,
        value: b.budget_amount,
        sourceCategory: 'budget',
        targetCategory: 'category',
      });
    });

    // Category -> Actual links (actual spent)
    let totalActual = 0;
    budgets.forEach((b) => {
      const actual = actualMap.get(b.category_id);
      const actualAmount = actual ? actual.actual_amount : 0;
      totalActual += actualAmount;
      links.push({
        source: b.cat_name,
        target: 'Total Actual',
        value: actualAmount,
        sourceCategory: 'category',
        targetCategory: 'actual',
      });
    });

    // If no budgets, use actual spending as flow
    if (budgets.length === 0) {
      actualSpending.forEach((a) => {
        const cat = db
          .prepare('SELECT name, color FROM categories WHERE id = ?')
          .get(a.category_id);
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
            targetCategory: 'actual',
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
        targetCategory: 'savings',
      });
    }

    res.json({ nodes, links });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// EXPORT (per-profile, multi-profile for combined view)
// ========================
app.get('/api/export/:type', apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const { type } = req.params;
    const { format = 'csv' } = req.query;

    let data, filename;
    switch (type) {
      case 'transactions': {
        const rows = db
          .prepare(
            `
          SELECT t.date, t.description, t.amount, t.type, t.currency, t.means_of_payment, t.beneficiary, t.payor, t.notes, c.name as category
          FROM transactions t
          LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
          WHERE t.profile_id IN (${inClause})
          ORDER BY t.date DESC
        `
          )
          .all(...pids);
        data = rows;
        filename = 'transactions';
        break;
      }
      case 'categories': {
        const rows = db
          .prepare(
            `
          SELECT name, color, icon, type, parent_id FROM categories WHERE profile_id IN (${inClause})
        `
          )
          .all(...pids);
        data = rows;
        filename = 'categories';
        break;
      }
      case 'accounts': {
        const rows = db
          .prepare(
            `
          SELECT name, type, currency, balance, notes FROM accounts WHERE profile_id IN (${inClause})
        `
          )
          .all(...pids);
        data = rows;
        filename = 'accounts';
        break;
      }
      case 'budgets': {
        const rows = db
          .prepare(
            `
          SELECT b.*, c.name as category_name FROM budgets b
          JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
          WHERE b.profile_id IN (${inClause})
        `
          )
          .all(...pids);
        data = rows;
        filename = 'budgets';
        break;
      }
      case 'loans': {
        const rows = db
          .prepare(
            `
          SELECT l.name, l.principal, l.interest_rate, l.start_date, l.term_months,
            (SELECT SUM(amount) FROM loan_prepayments WHERE loan_id = l.id) as total_prepaid
          FROM loans l WHERE l.profile_id IN (${inClause})
        `
          )
          .all(...pids);
        data = rows;
        filename = 'loans';
        break;
      }
      case 'recurring': {
        const rows = db
          .prepare(
            `
          SELECT description, amount, type, frequency, day_of_month, next_date, notes, active
          FROM recurring_transactions WHERE profile_id IN (${inClause})
        `
          )
          .all(...pids);
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
        ...data.map((row) =>
          headers
            .map((h) => {
              const val = row[h] == null ? '' : String(row[h]);
              return val.includes(',') || val.includes('"') || val.includes('\n')
                ? `"${val.replace(/"/g, '""')}"`
                : val;
            })
            .join(',')
        ),
      ].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.end(csv);
    }
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// RETIREMENT CALCULATOR
// ========================
app.post('/api/calculator/retire', apiRateLimiter, (req, res) => {
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
      country = '',
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
      expensesAtRetirement !== null ? expensesAtRetirement : annualExpenses * col;

    // FIRE number: how much needed to retire (25x rule, or 100 / withdrawalRate)
    const fireNumber = adjustedExpenses / (withdrawalRate / 100);

    // Project savings until retirement
    const monthsToRetirement = (retirementAge - currentAge) * 12;
    if (monthsToRetirement <= 0) {
      return res.status(400).json({ error: 'Retirement age must be greater than current age' });
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
        retirementSavings = retirementSavings * (1 + annualReturn / 100) - annualWithdrawal;
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
      timeline: timeline.filter((t) => t.year % 5 === 0 || t.year === currentAge),
      withdrawalTimeline,
      scenarios: [
        {
          name: 'Conservative',
          return: 4,
          fireNumber: Math.round(adjustedExpenses / 0.04),
          fireAge: null,
        },
        {
          name: 'Moderate',
          return: 6,
          fireNumber: Math.round(adjustedExpenses / 0.06),
          fireAge: null,
        },
        {
          name: 'Optimistic',
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
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// EMERGENCY FUND TRACKER
// ========================
app.get('/api/calculator/emergency-fund', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);

    // Get monthly expenses from last 12 months
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const dateStr = twelveMonthsAgo.toISOString().split('T')[0];

    const expenseRows = db
      .prepare(
        `SELECT amount, date FROM transactions
         WHERE profile_id = ? AND type = 'expense' AND date >= ?`
      )
      .all(pid, dateStr);

    // Group by month and calculate average
    const monthlyTotals = {};
    for (const r of expenseRows) {
      const m = r.date.substring(0, 7); // YYYY-MM
      monthlyTotals[m] = (monthlyTotals[m] || 0) + Math.abs(r.amount);
    }
    const monthsWithData = Object.keys(monthlyTotals).length;
    const avgMonthlyExpenses =
      monthsWithData > 0
        ? Object.values(monthlyTotals).reduce((a, b) => a + b, 0) / monthsWithData
        : 0;

    // Get account balances (emergency fund = savings accounts)
    const accounts = db
      .prepare('SELECT name, type, balance FROM accounts WHERE profile_id = ?')
      .all(pid);

    const totalEmergencyFund = accounts
      .filter((a) => a.type === 'savings')
      .reduce((s, a) => s + a.balance, 0);

    const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);

    // Coverage levels
    const coverage = [
      { months: 3, label: 'Starter', ratio: 3 },
      { months: 6, label: 'Standard', ratio: 6 },
      { months: 12, label: 'Conservative', ratio: 12 },
    ].map((c) => {
      const required = avgMonthlyExpenses * c.months;
      const current = totalEmergencyFund;
      return {
        months: c.months,
        label: c.label,
        required: Math.round(required),
        current: Math.round(current),
        coveragePct: required > 0 ? Math.min(100, Math.round((current / required) * 100)) : 0,
        status: current >= required ? 'complete' : current >= required * 0.5 ? 'partial' : 'low',
      };
    });

    res.json({
      avgMonthlyExpenses: Math.round(avgMonthlyExpenses),
      totalEmergencyFund: Math.round(totalEmergencyFund),
      totalBalance: Math.round(totalBalance),
      monthsWithData,
      coverage,
      accounts: accounts.filter((a) => a.type === 'savings'),
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// RETIREMENT ENDPOINTS
// ========================
app.get('/api/retirement-goals', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const settings = db
      .prepare('SELECT * FROM settings WHERE key = ? AND profile_id = ?')
      .get('retirement_goals', pid);

    const goals = db
      .prepare(
        `
      SELECT
        id,
        name,
        target_amount,
        current_amount,
        deadline,
        notes,
        created_at
      FROM savings_goals
      WHERE profile_id = ?
      ORDER BY deadline ASC
    `
      )
      .all(pid);

    res.json({
      settings: settings ? JSON.parse(settings.value) : null,
      goals: goals.map((g) => ({ ...g, profile_id: pid })),
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/retirement/projection', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const params = req.query;

    const settings = db
      .prepare('SELECT * FROM settings WHERE key = ? AND profile_id = ?')
      .get('retirement_goals', pid);

    const result = calculateRetirementProjection(
      db,
      pid,
      settings ? JSON.parse(settings.value) : null,
      parseFloat(params.currentAge || params.age || 30) || 30,
      parseFloat(params.retirementAge || params.retire || 65) || 65,
      parseFloat(params.currentSavings || params.savings || 0) || 0,
      parseFloat(params.monthlyContribution || params.contribution || 500) || 0,
      parseFloat(params.annualReturn || params.return || 7) || 7,
      parseFloat(params.withdrawalRate || params.rate || 4) || 4,
      params.country || 'US'
    );

    res.json(result);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// HOUSING ENDPOINTS
// ========================
app.get('/api/housing', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);

    const housings = db
      .prepare(
        `
      SELECT
        id,
        name,
        monthly_amount,
        due_date,
        autopay,
        notes,
        created_at
      FROM housings
      WHERE profile_id = ?
      ORDER BY due_date ASC
    `
      )
      .all(pid);

    const totalMonthly = housings.reduce(
      (sum, h) => sum + Math.abs(parseFloat(h.monthly_amount) || 0),
      0
    );

    res.json({
      housings: housings.map((h) => ({ ...h, profile_id: pid })),
      total_monthly: Math.round(totalMonthly),
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/housing', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { type, property_name, monthly_amount, due_day, due_month, autopay, notes } = req.body;

    if (!type || !property_name || monthly_amount === undefined) {
      return res.status(400).json({ error: 'Type, property name and monthly amount are required' });
    }

    // Calculate due_date from due_day and due_month
    const due_date = `${due_month.toString().padStart(2, '0')}-${due_day.toString().padStart(2, '0')}`;

    const info = db
      .prepare(
        `
      INSERT INTO housings (profile_id, name, monthly_amount, due_date, autopay, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(pid, property_name, parseFloat(monthly_amount), due_date, autopay ? 1 : 0, notes || '');

    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/housing/:id', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const { type, property_name, monthly_amount, due_day, due_month, autopay, notes } = req.body;

    const existing = db
      .prepare('SELECT id FROM housings WHERE id = ? AND profile_id = ?')
      .get(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const due_date = `${due_month.toString().padStart(2, '0')}-${due_day.toString().padStart(2, '0')}`;

    db.prepare(
      `
      UPDATE housings SET name = ?, monthly_amount = ?, due_date = ?, autopay = ?, notes = ?
      WHERE id = ? AND profile_id = ?
    `
    ).run(
      property_name,
      parseFloat(monthly_amount),
      due_date,
      autopay ? 1 : 0,
      notes || '',
      req.params.id,
      pid
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/housing/:id', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    const existing = db
      .prepare('SELECT id FROM housings WHERE id = ? AND profile_id = ?')
      .get(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    db.prepare('DELETE FROM housings WHERE id = ? AND profile_id = ?').run(req.params.id, pid);
    res.json({ success: true });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// STORAGE MODE MANAGEMENT (Serverless support)
// ========================
// Storage mode endpoint - gets current mode
app.get('/api/storage-mode', (req, res) => {
  try {
    const mode = req.session.storageMode || 'self-hosted';
    res.json(mode);
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Storage mode endpoint - sets current mode
app.post('/api/storage-mode', apiRateLimiter, (req, res) => {
  try {
    const { mode } = req.body;
    if (!mode || !['serverless', 'self-hosted'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Must be "serverless" or "self-hosted"' });
    }
    req.session.storageMode = mode;
    res.json({ mode });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Export all data as JSON (serverless mode support)
app.get('/api/export', apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');

    // Get all data
    const transactions = db
      .prepare(
        `
      SELECT t.* FROM transactions t
      WHERE t.profile_id IN (${inClause})
      ORDER BY t.date DESC
    `
      )
      .all(...pids);

    const categories = db
      .prepare(
        `
      SELECT c.* FROM categories c
      WHERE c.profile_id IN (${inClause})
    `
      )
      .all(...pids);

    const accounts = db
      .prepare(
        `
      SELECT a.* FROM accounts a
      WHERE a.profile_id IN (${inClause})
    `
      )
      .all(...pids);

    const budgets = db
      .prepare(
        `
      SELECT b.* FROM budgets b
      WHERE b.profile_id IN (${inClause})
    `
      )
      .all(...pids);

    const loans = db
      .prepare(
        `
      SELECT l.* FROM loans l
      WHERE l.profile_id IN (${inClause})
    `
      )
      .all(...pids);

    const settings = db
      .prepare(
        `
      SELECT s.key, s.value
      FROM settings s
      WHERE s.profile_id = ? OR s.profile_id IS NULL
    `
      )
      .get(getProfileId(req));

    // Build settings object
    const settingsObj = {};
    if (settings) {
      settingsObj[settings.key] = settings.value;
    }

    res.json({
      version: '2.0',
      export_date: new Date().toISOString(),
      storage_mode: req.session.storageMode || 'self-hosted',
      profiles: [],
      categories,
      transactions,
      accounts,
      budgets,
      goals: [],
      loans,
      balanceHistory: [],
      settings: settingsObj,
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Import data from JSON (serverless mode support)
app.post('/api/import', apiRateLimiter, (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Invalid data format' });
    }

    const pid = getProfileId(req);

    // Create transaction record ID counter
    let txId = Math.max(
      ...(db.prepare('SELECT MAX(id) as max FROM transactions').get()?.max || [0])
    );
    let catId = Math.max(
      ...(db.prepare('SELECT MAX(id) as max FROM categories').get()?.max || [0])
    );
    let accId = Math.max(...(db.prepare('SELECT MAX(id) as max FROM accounts').get()?.max || [0]));
    let budgetId = Math.max(
      ...(db.prepare('SELECT MAX(id) as max FROM budgets').get()?.max || [0])
    );
    let loanId = Math.max(...(db.prepare('SELECT MAX(id) as max FROM loans').get()?.max || [0]));

    // Map category names to IDs for reference
    const categoryMap = new Map();

    // Insert categories
    const insertCat = db.prepare(`
      INSERT INTO categories (name, color, icon, type, profile_id, tax_deductible, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    if (data.categories && data.categories.length > 0) {
      for (const cat of data.categories) {
        // Convert category data to match schema
        const insertData = [
          cat.name || cat.category_name,
          cat.color || '#6b7280',
          cat.icon || 'tag',
          cat.type || 'expense',
          pid,
          cat.tax_deductible ? 1 : 0,
          cat.created_at || new Date().toISOString(),
        ];
        catId++;
        insertCat.run(...insertData);
        categoryMap.set(cat.name, catId);
      }
    }

    // Insert accounts
    const insertAcc = db.prepare(`
      INSERT INTO accounts (name, type, currency, balance, notes, profile_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    if (data.accounts && data.accounts.length > 0) {
      for (const acc of data.accounts) {
        accId++;
        insertAcc.run(
          acc.name,
          acc.type || 'giro',
          acc.currency || 'EUR',
          acc.balance || 0,
          acc.notes || '',
          pid,
          new Date().toISOString()
        );
      }
    }

    // Insert transactions
    const insertTx = db.prepare(`
      INSERT INTO transactions (date, description, amount, type, currency, means_of_payment, beneficiary, payor, notes, category_id, profile_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let importedCount = 0;

    if (data.transactions && data.transactions.length > 0) {
      for (const tx of data.transactions) {
        txId++;
        const catIdForTx = categoryMap.get(tx.description || tx.category_name) || null;
        insertTx.run(
          tx.date,
          tx.description || tx.category_name,
          parseFloat(tx.amount) || 0,
          tx.type || 'expense',
          tx.currency || 'EUR',
          tx.means_of_payment || tx.means || '',
          tx.beneficiary || '',
          tx.payor || '',
          tx.notes || '',
          catIdForTx,
          pid,
          tx.created_at || new Date().toISOString()
        );
        importedCount++;
      }
    }

    // Update settings
    if (data.settings && Object.keys(data.settings).length > 0) {
      const upsertSettings = db.prepare(`
        INSERT OR REPLACE INTO settings (key, value, profile_id)
        VALUES (?, ?, ?)
      `);
      for (const [key, value] of Object.entries(data.settings)) {
        upsertSettings.run(key, String(value), pid);
      }
    }

    res.json({
      ok: true,
      imported: importedCount,
      message: `Successfully imported ${importedCount} transactions`,
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    console.error('Import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// IMPORT PREVIEW
// ========================
app.post('/api/import/preview', apiRateLimiter, (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Invalid data format' });
    }

    const pid = getProfileId(req);

    // Get existing data for duplicate detection
    const existingTransactions = db
      .prepare('SELECT id, date, description, amount FROM transactions WHERE profile_id = ?')
      .all(pid);
    const existingCategories = db
      .prepare('SELECT name FROM categories WHERE profile_id = ?')
      .all(pid);

    // Build lookup maps for duplicates
    const existingTransactionMap = new Map();
    existingTransactions.forEach((tx) => {
      const key = `${tx.date}|${tx.description.toLowerCase().trim()}|${tx.amount}`;
      if (!existingTransactionMap.has(key)) {
        existingTransactionMap.set(key, []);
      }
      existingTransactionMap.get(key).push(tx);
    });

    // Track duplicates by key
    const duplicateMap = new Map();
    let totalNew = 0;
    let totalDuplicates = 0;
    let totalEstimatedImport = 0;

    // Check transactions for duplicates
    if (data.transactions && data.transactions.length > 0) {
      data.transactions.forEach((tx) => {
        const key = `${tx.date}|${(tx.description || tx.category_name || '').toLowerCase().trim()}|${parseFloat(tx.amount) || 0}`;
        const existing = existingTransactionMap.get(key);

        if (existing && existing.length > 0) {
          duplicateMap.set(key, existing);
          totalDuplicates++;
        } else {
          totalNew++;
        }
        totalEstimatedImport++;
      });
    }

    // Check categories (count as duplicates if name exists)
    let newCategories = 0;
    let duplicateCategories = 0;
    if (data.categories && data.categories.length > 0) {
      data.categories.forEach((cat) => {
        const catName = (cat.name || cat.category_name || '').toLowerCase().trim();
        const exists = existingCategories.find((c) => c.name.toLowerCase() === catName);
        if (exists) {
          duplicateCategories++;
        } else {
          newCategories++;
        }
      });
    }

    // Build preview data
    const previewData = {
      totalTransactions: data.transactions?.length || 0,
      newTransactions: totalNew,
      duplicateTransactions: totalDuplicates,
      totalCategories: data.categories?.length || 0,
      newCategories: newCategories,
      duplicateCategories: duplicateCategories,
      totalEstimatedImport,
      duplicateCountByDate: duplicateMap,
    };

    res.json(previewData);
  } catch (err) {
    console.error('Import preview error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Clear all data (dangerous!)
app.delete('/api/clear-all', apiRateLimiter, (req, res) => {
  try {
    const pid = getProfileId(req);
    db.prepare(
      'DELETE FROM loan_prepayments WHERE loan_id IN (SELECT id FROM loans WHERE profile_id = ?)'
    ).run(pid);
    db.prepare(
      'DELETE FROM loan_rate_periods WHERE loan_id IN (SELECT id FROM loans WHERE profile_id = ?)'
    ).run(pid);
    db.prepare('DELETE FROM transactions WHERE profile_id = ?').run(pid);
    db.prepare('DELETE FROM budgets WHERE profile_id = ?').run(pid);
    db.prepare('DELETE FROM loans WHERE profile_id = ?').run(pid);
    db.prepare('DELETE FROM categories WHERE profile_id = ?').run(pid);
    db.prepare('DELETE FROM accounts WHERE profile_id = ?').run(pid);
    // Also clear settings
    db.prepare('DELETE FROM settings WHERE profile_id = ?').run(pid);

    res.json({ ok: true, message: 'All data cleared' });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// COMPOUND INTEREST PROJECTOR
// ========================
app.post('/api/calculator/compound-interest', apiRateLimiter, (req, res) => {
  try {
    const {
      principal = 0,
      monthlyContribution = 0,
      annualReturn = 7,
      years = 10,
      compoundsPerYear = 12,
    } = req.body;

    const rate = annualReturn / 100;
    const n = compoundsPerYear;

    const projection = [];
    let balance = principal;
    let totalContributions = principal;

    for (let y = 0; y <= years; y++) {
      projection.push({
        year: y,
        balance: Math.round(balance),
        contributions: Math.round(totalContributions),
        interest: Math.round(balance - totalContributions),
      });

      // Compound for this year
      const yearlyContribution = monthlyContribution * 12;
      for (let p = 0; p < n; p++) {
        balance = balance * (1 + rate / n) + monthlyContribution;
      }
      totalContributions += yearlyContribution;
    }

    // Scenario comparisons: vary return rate
    const scenarios = [
      { name: 'Conservative', return: 4, color: '#3b82f6' },
      { name: 'Moderate', return: 6, color: '#10b981' },
      { name: 'Optimistic', return: 8, color: '#8b5cf6' },
    ].map((s) => {
      const r = s.return / 100;
      let bal = principal;
      let contrib = principal;
      for (let y = 0; y <= years; y++) {
        if (y > 0) {
          for (let p = 0; p < n; p++) {
            bal = bal * (1 + r / n) + monthlyContribution;
          }
          contrib += monthlyContribution * 12;
        }
      }
      return {
        name: s.name,
        return: s.return,
        color: s.color,
        finalBalance: Math.round(bal),
        totalContributions: Math.round(contrib),
        interest: Math.round(bal - contrib),
      };
    });

    res.json({
      projection,
      principal,
      monthlyContribution,
      annualReturn,
      years,
      finalBalance: projection[projection.length - 1].balance,
      totalContributions: projection[projection.length - 1].contributions,
      totalInterest: projection[projection.length - 1].interest,
      scenarios,
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// MONTHLY PDF REPORT
// ========================
app.get('/api/reports/monthly-pdf', apiRateLimiter, async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) {
      return res.status(400).json({ error: 'year and month are required' });
    }

    // Validate year format (4 digits)
    if (!/^\d{4}$/.test(String(year))) {
      return res.status(400).json({ error: 'Valid year is required' });
    }

    // Validate month format and range (1-12)
    const monthNum = parseInt(month, 10);
    if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      return res.status(400).json({ error: 'Valid month (1-12) is required' });
    }

    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
    const endStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    const monthName = monthNames[parseInt(month) - 1] || month;

    // Fetch settings for currency
    const settings = db
      .prepare(
        `SELECT value FROM settings WHERE key = 'local_currency' AND (profile_id IN (${inClause}) OR profile_id IS NULL) ORDER BY profile_id DESC LIMIT 1`
      )
      .get(...pids);
    const currency = settings ? settings.value : 'EUR';

    // Fetch transactions for the month
    const transactions = db
      .prepare(
        `
      SELECT t.date, t.amount, t.description, c.name as cat_name, c.type as cat_type, c.color as cat_color, t.type as tx_type
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ?
      ORDER BY t.date
    `
      )
      .all(...pids, startStr, endStr);

    // Aggregate by category
    const incomeByCat = {};
    const expenseByCat = {};
    let totalIncome = 0;
    let totalExpenses = 0;

    transactions.forEach((tx) => {
      const amt = Math.abs(parseFloat(tx.amount) || 0);
      const catName = tx.cat_name || 'Uncategorized';
      const catColor = tx.cat_color || (tx.tx_type === 'income' ? '#059669' : '#dc2626');

      if (tx.tx_type === 'income') {
        totalIncome += amt;
        if (!incomeByCat[catName])
          incomeByCat[catName] = { name: catName, color: catColor, total: 0 };
        incomeByCat[catName].total += amt;
      } else {
        totalExpenses += amt;
        if (!expenseByCat[catName])
          expenseByCat[catName] = { name: catName, color: catColor, total: 0 };
        expenseByCat[catName].total += amt;
      }
    });

    const netSavings = totalIncome - totalExpenses;

    // Prepare data for export page
    const exportData = {
      yearMonth: `${year}-${String(month).padStart(2, '0')}`,
      currency,
      summary: { totalIncome, totalExpense: totalExpenses, netSavings },
      incomeByCategory: Object.values(incomeByCat).sort((a, b) => b.total - a.total),
      expenseByCategory: Object.values(expenseByCat).sort((a, b) => b.total - a.total),
    };

    // --- Use puppeteer to render and export as PDF directly ---
    let pdfBuffer = null;

    try {
      const puppeteer = require('puppeteer');

      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      try {
        const exportPage = await browser.newPage();
        await exportPage.setViewport({ width: 800, height: 1000, deviceScaleFactor: 2 });

        await exportPage.evaluateOnNewDocument((data) => {
          window.__DATA__ = data;
        }, exportData);

        const baseUrl = `http://localhost:${PORT}`;
        await exportPage.goto(`${baseUrl}/export-monthly.html`, {
          waitUntil: 'networkidle0',
          timeout: 30000,
        });

        // Wait for the page to signal that charts have finished rendering
        await exportPage.waitForFunction(() => window.__RENDER_DONE__ === true, { timeout: 30000 });

        pdfBuffer = Buffer.from(
          await exportPage.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '15px', right: '15px', bottom: '15px', left: '15px' },
          })
        );
      } finally {
        await browser.close();
      }
    } catch (puppeteerErr) {
      console.error('Puppeteer render failed:', puppeteerErr.message);
    }

    // --- Return the PDF directly ---
    if (pdfBuffer && pdfBuffer.length > 1000) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="report-${year}-${String(month).padStart(2, '0')}.pdf"`
      );
      return res.send(pdfBuffer);
    }

    // Fallback: text-only PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="report-${year}-${String(month).padStart(2, '0')}.pdf"`
    );

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    const titleColor = '#1e293b';
    const headerBg = '#1e293b';
    const incomeColor = '#059669';
    const expenseColor = '#dc2626';
    const borderColor = '#e2e8f0';
    const mutedColor = '#64748b';

    function formatCurrencyPdf(amount, curr) {
      const symbols = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF ' };
      const sym = symbols[curr] || curr + ' ';
      return sym + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    doc
      .fillColor(titleColor)
      .fontSize(22)
      .font('Helvetica-Bold')
      .text('Monthly Financial Report', { align: 'center' });
    doc.moveDown(0.3);
    doc
      .fillColor(mutedColor)
      .fontSize(13)
      .font('Helvetica')
      .text(`${monthName} ${year}`, { align: 'center' });
    doc.moveDown(0.8);

    const boxY = doc.y;
    const boxW = doc.page.width - 100;
    const colW = boxW / 3;

    doc.rect(50, boxY, boxW, 60).fill('#f8fafc');
    doc.rect(50, boxY, boxW, 60).stroke(borderColor);

    doc
      .moveTo(50 + colW, boxY)
      .lineTo(50 + colW, boxY + 60)
      .stroke(borderColor);
    doc
      .moveTo(50 + colW * 2, boxY)
      .lineTo(50 + colW * 2, boxY + 60)
      .stroke(borderColor);

    doc
      .fillColor(incomeColor)
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('Total Income', 50, boxY + 10, { width: colW, align: 'center' });
    doc
      .fillColor(incomeColor)
      .fontSize(14)
      .font('Helvetica-Bold')
      .text(formatCurrencyPdf(totalIncome, currency), 50, boxY + 28, {
        width: colW,
        align: 'center',
      });

    doc
      .fillColor(expenseColor)
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('Total Expenses', 50 + colW, boxY + 10, { width: colW, align: 'center' });
    doc
      .fillColor(expenseColor)
      .fontSize(14)
      .font('Helvetica-Bold')
      .text(formatCurrencyPdf(totalExpenses, currency), 50 + colW, boxY + 28, {
        width: colW,
        align: 'center',
      });

    doc
      .fillColor(netSavings >= 0 ? incomeColor : expenseColor)
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('Net Savings', 50 + colW * 2, boxY + 10, { width: colW, align: 'center' });
    doc
      .fillColor(netSavings >= 0 ? incomeColor : expenseColor)
      .fontSize(14)
      .font('Helvetica-Bold')
      .text(formatCurrencyPdf(netSavings, currency), 50 + colW * 2, boxY + 28, {
        width: colW,
        align: 'center',
      });

    doc.y = boxY + 70;

    if (Object.keys(incomeByCat).length > 0) {
      doc.moveDown(0.5);
      doc.fillColor(headerBg).fontSize(12).font('Helvetica-Bold').text('Income');
      doc
        .moveTo(50, doc.y)
        .lineTo(doc.page.width - 50, doc.y)
        .strokeColor(borderColor)
        .stroke();
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica');
      const sortedIncome = Object.entries(incomeByCat).sort((a, b) => b[1].total - a[1].total);
      sortedIncome.forEach(([cat, data]) => {
        doc
          .fillColor(incomeColor)
          .text(`${formatCurrencyPdf(data.total, currency)}  `, { continued: true });
        doc.fillColor(titleColor).text(cat);
      });
    }

    if (Object.keys(expenseByCat).length > 0) {
      doc.moveDown(0.5);
      doc.fillColor(headerBg).fontSize(12).font('Helvetica-Bold').text('Expenses');
      doc
        .moveTo(50, doc.y)
        .lineTo(doc.page.width - 50, doc.y)
        .strokeColor(borderColor)
        .stroke();
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica');
      const sortedExpenses = Object.entries(expenseByCat).sort((a, b) => b[1].total - a[1].total);
      sortedExpenses.forEach(([cat, data]) => {
        const pct = totalExpenses > 0 ? ((data.total / totalExpenses) * 100).toFixed(1) : '0.0';
        doc
          .fillColor(expenseColor)
          .text(`${formatCurrencyPdf(data.total, currency)}  (${pct}%)  `, { continued: true });
        doc.fillColor(titleColor).text(cat);
      });
    }

    if (Object.keys(incomeByCat).length === 0 && Object.keys(expenseByCat).length === 0) {
      doc.moveDown(1);
      doc
        .fillColor(mutedColor)
        .fontSize(11)
        .font('Helvetica')
        .text('No transactions found for this period.', { align: 'center' });
    }

    doc.moveDown(2);
    doc
      .fillColor(mutedColor)
      .fontSize(9)
      .font('Helvetica')
      .text(`Generated by Finance Manager — ${new Date().toLocaleDateString()}`, {
        align: 'center',
      });

    doc.end();
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// YEAR-END TAX SUMMARY
// =====================

// JSON tax summary
app.get('/api/reports/tax-summary', apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const { year } = req.query;
    if (!year) return res.status(400).json({ error: 'year is required' });

    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;

    const rows = db
      .prepare(
        `
      SELECT t.id, t.date, t.description, t.amount, t.currency, c.name as category_name, c.tax_deductible
      FROM transactions t
      JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ? AND t.type = 'expense'
      ORDER BY c.tax_deductible DESC, c.name, t.date
    `
      )
      .all(...pids, startStr, endStr);

    const taxDeductible = rows.filter((r) => r.tax_deductible);
    const nonDeductible = rows.filter((r) => !r.tax_deductible);

    const byCategory = (rows) => {
      const map = {};
      rows.forEach((r) => {
        if (!map[r.category_name]) map[r.category_name] = { total: 0, transactions: [] };
        map[r.category_name].total += r.amount;
        map[r.category_name].transactions.push({
          id: r.id,
          date: r.date,
          description: r.description,
          amount: r.amount,
          currency: r.currency,
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
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Year-end tax summary PDF
app.get('/api/reports/tax-summary-pdf', apiRateLimiter, (req, res) => {
  try {
    const { year } = req.query;
    if (!year || !/^\d{4}$/.test(String(year))) {
      return res.status(400).json({ error: 'Valid year is required' });
    }

    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');

    const rows = db
      .prepare(
        `
      SELECT t.id, t.date, t.description, t.amount, t.currency, c.name as category_name, c.tax_deductible
      FROM transactions t
      JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ? AND t.type = 'expense'
      ORDER BY c.tax_deductible DESC, c.name, t.date
    `
      )
      .all(...pids, startStr, endStr);

    const taxRows = rows.filter((r) => r.tax_deductible);
    const nonRows = rows.filter((r) => !r.tax_deductible);

    const currency =
      db
        .prepare(
          `SELECT value FROM settings WHERE key='local_currency' AND profile_id IN (${inClause}) ORDER BY profile_id DESC LIMIT 1`
        )
        .get(...pids)?.value || 'USD';
    const symbols = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF ' };
    const fmt = (amt) =>
      (symbols[currency] || currency + ' ') + amt.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    const taxTotal = taxRows.reduce((s, r) => s + r.amount, 0);
    const nonTotal = nonRows.reduce((s, r) => s + r.amount, 0);
    const grandTotal = rows.reduce((s, r) => s + r.amount, 0);

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="tax-summary-${year}.pdf"`);
    doc.pipe(res);

    // Colors
    const titleColor = '#1e293b';
    const headerBg = '#f1f5f9';
    const borderColor = '#cbd5e1';
    const taxColor = '#16a34a';
    const nonTaxColor = '#94a3b8';
    const mutedColor = '#64748b';
    const positiveColor = '#059669';

    // Header
    doc
      .fillColor(titleColor)
      .fontSize(20)
      .font('Helvetica-Bold')
      .text(`Year-End Tax Summary — ${year}`, 50, 50);
    doc.moveDown(0.5);
    doc
      .fillColor(mutedColor)
      .fontSize(10)
      .font('Helvetica')
      .text(`Generated by Finance Manager — ${new Date().toLocaleDateString()}`, 50, doc.y);
    doc.moveDown(2);

    // Summary box
    const colW = (doc.page.width - 100) / 3;
    const boxY = doc.y;
    doc
      .rect(50, boxY, doc.page.width - 100, 70)
      .fillColor(headerBg)
      .fill();
    doc
      .strokeColor(borderColor)
      .rect(50, boxY, doc.page.width - 100, 70)
      .stroke();

    doc
      .fillColor(taxColor)
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('Tax-Deductible Expenses', 50, boxY + 8, { width: colW, align: 'center' });
    doc
      .fillColor(taxColor)
      .fontSize(13)
      .font('Helvetica-Bold')
      .text(fmt(taxTotal), 50, boxY + 28, { width: colW, align: 'center' });
    const taxPct = grandTotal > 0 ? ((taxTotal / grandTotal) * 100).toFixed(1) : '0.0';
    doc
      .fillColor(mutedColor)
      .fontSize(9)
      .font('Helvetica')
      .text(`${taxPct}% of total`, 50, boxY + 50, { width: colW, align: 'center' });

    doc
      .fillColor(nonTaxColor)
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('Non-Deductible Expenses', 50 + colW, boxY + 8, { width: colW, align: 'center' });
    doc
      .fillColor(nonTaxColor)
      .fontSize(13)
      .font('Helvetica-Bold')
      .text(fmt(nonTotal), 50 + colW, boxY + 28, { width: colW, align: 'center' });
    const nonPct = grandTotal > 0 ? ((nonTotal / grandTotal) * 100).toFixed(1) : '0.0';
    doc
      .fillColor(mutedColor)
      .fontSize(9)
      .font('Helvetica')
      .text(`${nonPct}% of total`, 50 + colW, boxY + 50, { width: colW, align: 'center' });

    doc
      .fillColor(titleColor)
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('Total Expenses', 50 + colW * 2, boxY + 8, { width: colW, align: 'center' });
    doc
      .fillColor(titleColor)
      .fontSize(13)
      .font('Helvetica-Bold')
      .text(fmt(grandTotal), 50 + colW * 2, boxY + 28, { width: colW, align: 'center' });
    doc
      .fillColor(mutedColor)
      .fontSize(9)
      .font('Helvetica')
      .text(`${taxRows.length + nonRows.length} transactions`, 50 + colW * 2, boxY + 50, {
        width: colW,
        align: 'center',
      });

    doc.y = boxY + 85;
    doc.moveDown(1);

    // Tax-deductible section
    const drawSection = (title, color, catRows) => {
      doc.fillColor(color).fontSize(12).font('Helvetica-Bold').text(title);
      doc
        .moveTo(50, doc.y)
        .lineTo(doc.page.width - 50, doc.y)
        .strokeColor(borderColor)
        .stroke();
      doc.moveDown(0.3);

      if (catRows.length === 0) {
        doc
          .fillColor(mutedColor)
          .fontSize(10)
          .font('Helvetica')
          .text('No transactions in this category.');
        doc.moveDown(1);
        return;
      }

      // Group by category
      const byCat = {};
      catRows.forEach((r) => {
        if (!byCat[r.category_name]) byCat[r.category_name] = { total: 0, count: 0 };
        byCat[r.category_name].total += r.amount;
        byCat[r.category_name].count++;
      });

      // Table header
      doc
        .fillColor(mutedColor)
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('Category', 50, doc.y, { width: 220 })
        .text('Transactions', 270, doc.y, { width: 100 })
        .text('Amount', 370, doc.y, { width: 120 });
      doc.moveDown(0.4);
      doc
        .moveTo(50, doc.y)
        .lineTo(doc.page.width - 50, doc.y)
        .strokeColor(borderColor)
        .stroke();
      doc.moveDown(0.4);

      doc.fontSize(10).font('Helvetica');
      Object.entries(byCat).forEach(([cat, data]) => {
        doc
          .fillColor(titleColor)
          .text(cat, 50, doc.y, { width: 220 })
          .fillColor(mutedColor)
          .text(String(data.count), 270, doc.y, { width: 100 })
          .fillColor(color)
          .text(fmt(data.total), 370, doc.y, { width: 120 });
        doc.moveDown(0.3);
      });

      doc.moveDown(0.5);
    };

    drawSection('Tax-Deductible Expenses', taxColor, taxRows);
    drawSection('Non-Deductible Expenses', nonTaxColor, nonRows);

    // Footer
    doc.moveDown(2);
    doc
      .fillColor(mutedColor)
      .fontSize(9)
      .font('Helvetica')
      .text(
        'This report is for informational purposes only. Consult a tax professional for official filings.',
        { align: 'center' }
      );

    doc.end();
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// YEAR-END P&L REPORT
// =====================

// JSON P&L summary
app.get('/api/reports/pl-summary', apiRateLimiter, (req, res) => {
  try {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const { year } = req.query;
    if (!year) return res.status(400).json({ error: 'year is required' });

    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;

    const rows = db
      .prepare(
        `
      SELECT t.id, t.date, t.description, t.amount, t.currency, t.type, c.name as category_name
      FROM transactions t
      JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ?
      ORDER BY t.type, c.name, t.date
    `
      )
      .all(...pids, startStr, endStr);

    const income = rows.filter((r) => r.type === 'income');
    const expenses = rows.filter((r) => r.type === 'expense');

    const byCategory = (txs) => {
      const map = {};
      txs.forEach((r) => {
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
      savingsRate:
        incomeTotal > 0
          ? parseFloat((((incomeTotal - expenseTotal) / incomeTotal) * 100).toFixed(1))
          : 0,
      transactionCount: rows.length,
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Year-end P&L PDF
app.get('/api/reports/pl-summary-pdf', apiRateLimiter, (req, res) => {
  try {
    const { year } = req.query;
    if (!year || !/^\d{4}$/.test(String(year))) {
      return res.status(400).json({ error: 'Valid year is required' });
    }

    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');

    const rows = db
      .prepare(
        `
      SELECT t.id, t.date, t.description, t.amount, t.currency, t.type, c.name as category_name
      FROM transactions t
      JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ?
      ORDER BY t.type, c.name, t.date
    `
      )
      .all(...pids, startStr, endStr);

    const incomeRows = rows.filter((r) => r.type === 'income');
    const expenseRows = rows.filter((r) => r.type === 'expense');

    const currency =
      db
        .prepare(
          `SELECT value FROM settings WHERE key='local_currency' AND profile_id IN (${inClause}) ORDER BY profile_id DESC LIMIT 1`
        )
        .get(...pids)?.value || 'USD';
    const symbols = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF ' };
    const fmt = (amt) =>
      (symbols[currency] || currency + ' ') + amt.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    const incomeTotal = incomeRows.reduce((s, r) => s + r.amount, 0);
    const expenseTotal = expenseRows.reduce((s, r) => s + r.amount, 0);
    const netSavings = incomeTotal - expenseTotal;
    const savingsRate = incomeTotal > 0 ? ((incomeTotal - expenseTotal) / incomeTotal) * 100 : 0;

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="pl-summary-${year}.pdf"`);
    doc.pipe(res);

    const titleColor = '#1e293b';
    const headerBg = '#f1f5f9';
    const borderColor = '#cbd5e1';
    const incomeColor = '#059669';
    const expenseColor = '#dc2626';
    const mutedColor = '#64748b';
    const netColor = netSavings >= 0 ? '#059669' : '#dc2626';

    // Header
    doc
      .fillColor(titleColor)
      .fontSize(20)
      .font('Helvetica-Bold')
      .text(`Year-End P&L Summary — ${year}`, 50, 50);
    doc.moveDown(0.5);
    doc
      .fillColor(mutedColor)
      .fontSize(10)
      .font('Helvetica')
      .text(`Generated by Finance Manager — ${new Date().toLocaleDateString()}`, 50, doc.y);
    doc.moveDown(2);

    // Summary box
    const colW = (doc.page.width - 100) / 3;
    const boxY = doc.y;
    doc
      .rect(50, boxY, doc.page.width - 100, 70)
      .fillColor(headerBg)
      .fill();
    doc
      .strokeColor(borderColor)
      .rect(50, boxY, doc.page.width - 100, 70)
      .stroke();

    doc
      .fillColor(incomeColor)
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('Total Income', 50, boxY + 8, { width: colW, align: 'center' });
    doc
      .fillColor(incomeColor)
      .fontSize(13)
      .font('Helvetica-Bold')
      .text(fmt(incomeTotal), 50, boxY + 28, { width: colW, align: 'center' });
    doc
      .fillColor(mutedColor)
      .fontSize(9)
      .font('Helvetica')
      .text(`${incomeRows.length} transactions`, 50, boxY + 50, { width: colW, align: 'center' });

    doc
      .fillColor(expenseColor)
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('Total Expenses', 50 + colW, boxY + 8, { width: colW, align: 'center' });
    doc
      .fillColor(expenseColor)
      .fontSize(13)
      .font('Helvetica-Bold')
      .text(fmt(expenseTotal), 50 + colW, boxY + 28, { width: colW, align: 'center' });
    doc
      .fillColor(mutedColor)
      .fontSize(9)
      .font('Helvetica')
      .text(`${expenseRows.length} transactions`, 50 + colW, boxY + 50, {
        width: colW,
        align: 'center',
      });

    doc
      .fillColor(netColor)
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('Net Savings', 50 + colW * 2, boxY + 8, { width: colW, align: 'center' });
    doc
      .fillColor(netColor)
      .fontSize(13)
      .font('Helvetica-Bold')
      .text(fmt(netSavings), 50 + colW * 2, boxY + 28, { width: colW, align: 'center' });
    doc
      .fillColor(mutedColor)
      .fontSize(9)
      .font('Helvetica')
      .text(`Savings rate: ${savingsRate.toFixed(1)}%`, 50 + colW * 2, boxY + 50, {
        width: colW,
        align: 'center',
      });

    doc.y = boxY + 85;
    doc.moveDown(1);

    // Helper: draw section
    const drawSection = (title, color, catRows, total) => {
      doc.fillColor(titleColor).fontSize(12).font('Helvetica-Bold').text(title);
      doc
        .moveTo(50, doc.y)
        .lineTo(doc.page.width - 50, doc.y)
        .strokeColor(borderColor)
        .stroke();
      doc.moveDown(0.3);

      if (catRows.length === 0) {
        doc.fillColor(mutedColor).fontSize(10).font('Helvetica').text('No transactions.');
        doc.moveDown(0.5);
        return;
      }

      const byCat = {};
      catRows.forEach((r) => {
        if (!byCat[r.category_name]) byCat[r.category_name] = { total: 0, count: 0 };
        byCat[r.category_name].total += r.amount;
        byCat[r.category_name].count++;
      });

      doc
        .fillColor(mutedColor)
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('Category', 50, doc.y, { width: 220 })
        .text('Transactions', 270, doc.y, { width: 100 })
        .text('Amount', 370, doc.y, { width: 120 })
        .text('% of Total', 470, doc.y, { width: 70 });
      doc.moveDown(0.4);
      doc
        .moveTo(50, doc.y)
        .lineTo(doc.page.width - 50, doc.y)
        .strokeColor(borderColor)
        .stroke();
      doc.moveDown(0.4);

      doc.fontSize(10).font('Helvetica');
      Object.entries(byCat)
        .sort((a, b) => b[1].total - a[1].total)
        .forEach(([cat, data]) => {
          const pct = total > 0 ? ((data.total / total) * 100).toFixed(1) : '0.0';
          doc
            .fillColor(titleColor)
            .text(cat, 50, doc.y, { width: 220 })
            .fillColor(mutedColor)
            .text(String(data.count), 270, doc.y, { width: 100 })
            .fillColor(color)
            .text(fmt(data.total), 370, doc.y, { width: 120 })
            .fillColor(mutedColor)
            .text(`${pct}%`, 470, doc.y, { width: 70 });
          doc.moveDown(0.3);
        });

      // Total row
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold');
      doc
        .fillColor(titleColor)
        .text('Total', 50, doc.y, { width: 220 })
        .fillColor(mutedColor)
        .text(String(Object.values(byCat).reduce((s, d) => s + d.count, 0)), 270, doc.y, {
          width: 100,
        })
        .fillColor(color)
        .text(fmt(total), 370, doc.y, { width: 120 })
        .fillColor(mutedColor)
        .text('100.0%', 470, doc.y, { width: 70 });
      doc.font('Helvetica');
      doc.moveDown(1);
    };

    drawSection('Income', incomeColor, incomeRows, incomeTotal);
    drawSection('Expenses', expenseColor, expenseRows, expenseTotal);

    // Footer
    doc.moveDown(2);
    doc
      .fillColor(mutedColor)
      .fontSize(9)
      .font('Helvetica')
      .text(
        `Total: ${rows.length} transactions | Net Savings: ${fmt(netSavings)} (${savingsRate.toFixed(1)}% savings rate)`,
        { align: 'center' }
      );

    doc.end();
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// CUSTOM REPORT
// =============
// Accepts custom report name - sanitized to prevent command injection
app.post('/api/reports/custom', apiRateLimiter, requireAuth, (req, res) => {
  try {
    const { name, type } = req.body;
    // Sanitize name to prevent command injection
    const sanitizedName = sanitizeInput(name || 'Custom Report');
    if (!sanitizedName || sanitizedName.trim().length < 1) {
      return res.status(400).json({ error: 'Invalid report name' });
    }
    res.json({
      reportId: Date.now(),
      name: sanitizedName,
      type: type || 'custom',
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// ANNUAL FINANCIAL REPORT PDF
// ============================
// Uses puppeteer to render charts via a dedicated export page, then embeds screenshot in PDF
app.get('/api/reports/annual-pdf', apiRateLimiter, async (req, res) => {
  try {
    const { year } = req.query;

    if (!year || !/^\d{4}$/.test(String(year))) {
      return res.status(400).json({ error: 'Valid year is required' });
    }

    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');

    // --- Fetch all data server-side ---
    const currencyRow = db
      .prepare(
        `SELECT value FROM settings WHERE key='local_currency' AND (profile_id IN (${inClause}) OR profile_id IS NULL) ORDER BY profile_id DESC LIMIT 1`
      )
      .get(...pids);
    const currency = currencyRow?.value || 'USD';

    // Category breakdown (for doughnut chart)
    const byCategory = db
      .prepare(
        `
      SELECT c.name, c.color, SUM(COALESCE(t.amount_local, t.amount)) as total
      FROM transactions t
      JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      WHERE t.profile_id IN (${inClause}) AND t.type = 'expense' AND t.date >= ? AND t.date <= ?
      GROUP BY c.id
      ORDER BY total DESC
    `
      )
      .all(...pids, `${year}-01-01`, `${year}-12-31`);

    // Monthly data for bar and line charts + breakdown table
    const monthly = db
      .prepare(
        `
      SELECT strftime('%m', date) as month_num,
             type, SUM(COALESCE(amount_local, amount)) as total
      FROM transactions
      WHERE profile_id IN (${inClause}) AND date >= ? AND date <= ? AND type IN ('income', 'expense')
      GROUP BY month_num, type
      ORDER BY month_num
    `
      )
      .all(...pids, `${year}-01-01`, `${year}-12-31`);

    const monthlyMap = {};
    for (let m = 1; m <= 12; m++) {
      monthlyMap[String(m).padStart(2, '0')] = { income: 0, expense: 0 };
    }
    for (const r of monthly) {
      if (r.type === 'income') monthlyMap[r.month_num].income = r.total;
      if (r.type === 'expense') monthlyMap[r.month_num].expense = r.total;
    }

    const monthlyArr = Object.entries(monthlyMap).map(([m, v]) => ({
      month: `${year}-${m}`,
      income: v.income,
      expense: v.expense,
    }));

    let totalIncome = 0,
      totalExpenses = 0;
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
      const puppeteer = require('puppeteer');

      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      try {
        const exportPage = await browser.newPage();
        await exportPage.setViewport({ width: 900, height: 1200, deviceScaleFactor: 2 });

        // Inject data into the page before it loads scripts
        await exportPage.evaluateOnNewDocument((data) => {
          window.__DATA__ = data;
        }, exportData);

        const baseUrl = `http://localhost:${PORT}`;
        await exportPage.goto(`${baseUrl}/export.html`, {
          waitUntil: 'networkidle0',
          timeout: 30000,
        });

        // Wait for the page to signal that charts have finished rendering
        await exportPage.waitForFunction(() => window.__RENDER_DONE__ === true, { timeout: 30000 });

        // Generate PDF directly from the rendered page (puppeteer returns Uint8Array, convert to Buffer)
        pdfBuffer = Buffer.from(
          await exportPage.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
          })
        );
      } finally {
        await browser.close();
      }
    } catch (puppeteerErr) {
      console.error('Puppeteer render failed:', puppeteerErr.message);
    }

    // --- Return the PDF directly ---
    if (pdfBuffer && pdfBuffer.length > 1000) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="annual-report-${year}.pdf"`);
      return res.send(pdfBuffer);
    }

    // Fallback: if puppeteer failed, generate text-only PDF
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="annual-report-${year}.pdf"`);
    doc.pipe(res);

    const titleColor = '#1e293b';
    const headerBg = '#f1f5f9';
    const borderColor = '#cbd5e1';
    const incomeColor = '#059669';
    const expenseColor = '#dc2626';
    const mutedColor = '#64748b';
    const netColor = netSavings >= 0 ? '#059669' : '#dc2626';
    const pageW = doc.page.width - 80;
    const symbols = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF ' };
    const fmt = (amt) =>
      (symbols[currency] || currency + ' ') + amt.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    // Header
    doc
      .fillColor(titleColor)
      .fontSize(22)
      .font('Helvetica-Bold')
      .text(`Annual Financial Report \u2014 ${year}`, 50, 50, { width: pageW, align: 'center' });
    doc.moveDown(0.3);
    doc
      .fillColor(mutedColor)
      .fontSize(11)
      .font('Helvetica')
      .text(`Finance Manager  |\u00a0 Generated: ${new Date().toLocaleDateString()}`, {
        align: 'center',
      });

    doc.moveDown(0.5);
    doc
      .moveTo(50, doc.y)
      .lineTo(doc.page.width - 50, doc.y)
      .strokeColor(borderColor)
      .stroke();

    // P&L Summary box
    const boxH = 65;
    const boxY = doc.y + 10;
    const colW = pageW / 3;

    doc.fillColor(headerBg).rect(50, boxY, pageW, boxH).fill();
    doc.strokeColor(borderColor).rect(50, boxY, pageW, boxH).stroke();

    doc.y = boxY + 10;
    doc
      .fillColor(titleColor)
      .fontSize(12)
      .font('Helvetica-Bold')
      .text(`${year} Annual Summary`, 50, doc.y, { width: pageW, align: 'center' });
    doc.y += 14;

    doc.fontSize(10).font('Helvetica');
    doc
      .fillColor(incomeColor)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('Total Income', 50 + 10, doc.y, { width: colW, align: 'center' });
    doc
      .fillColor(incomeColor)
      .fontSize(14)
      .text(fmt(totalIncome), 50 + 10, doc.y + 14, { width: colW, align: 'center' });

    doc
      .fillColor(expenseColor)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('Total Expenses', 50 + colW + 10, doc.y, { width: colW, align: 'center' });
    doc
      .fillColor(expenseColor)
      .fontSize(14)
      .text(fmt(totalExpenses), 50 + colW + 10, doc.y + 14, { width: colW, align: 'center' });

    doc
      .fillColor(netColor)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('Net Savings', 50 + colW * 2 + 10, doc.y, { width: colW, align: 'center' });
    doc
      .fillColor(netColor)
      .fontSize(14)
      .text(fmt(netSavings), 50 + colW * 2 + 10, doc.y + 14, { width: colW, align: 'center' });

    // Note about charts
    doc.moveDown(2);
    doc.addPage();
    doc
      .fillColor(mutedColor)
      .fontSize(12)
      .font('Helvetica')
      .text(
        'Note: Charts could not be rendered in this session. Please try again later.',
        50,
        doc.y,
        { width: pageW, align: 'center' }
      );

    // Monthly Breakdown Table — start on a fresh page
    doc.addPage();
    doc.y = 50;
    doc.moveDown(0.5);
    doc.fillColor(titleColor).fontSize(13).font('Helvetica-Bold').text('Monthly Breakdown');
    doc
      .moveTo(50, doc.y)
      .lineTo(doc.page.width - 50, doc.y)
      .strokeColor(borderColor)
      .stroke();
    doc.moveDown(0.3);

    const tableTop = doc.y;
    const tcol = { month: 90, income: 120, expense: 120, net: 110, balance: 110 };
    const rowH = 18;
    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];

    doc.fillColor(headerBg).rect(50, tableTop, pageW, rowH).fill();
    doc.strokeColor(borderColor).rect(50, tableTop, pageW, rowH).stroke();
    doc.fillColor(titleColor).fontSize(9).font('Helvetica-Bold');
    doc.text('Month', 54, tableTop + 5, { width: tcol.month, align: 'left' });
    doc.text('Income', 54 + tcol.month, tableTop + 5, { width: tcol.income, align: 'right' });
    doc.text('Expenses', 54 + tcol.month + tcol.income, tableTop + 5, {
      width: tcol.expense,
      align: 'right',
    });
    doc.text('Net', 54 + tcol.month + tcol.income + tcol.expense, tableTop + 5, {
      width: tcol.net,
      align: 'right',
    });
    doc.text('Balance', 54 + tcol.month + tcol.income + tcol.expense + tcol.net, tableTop + 5, {
      width: tcol.balance,
      align: 'right',
    });

    let runningBal = 0;
    for (let m = 1; m <= 12; m++) {
      const monthStr = String(m).padStart(2, '0');
      const inc = monthlyMap[monthStr].income;
      const exp = monthlyMap[monthStr].expense;
      const net = inc - exp;
      runningBal += net;

      const rowY = tableTop + rowH * m;
      const bg = m % 2 === 0 ? '#f8fafc' : '#ffffff';
      doc.fillColor(bg).rect(50, rowY, pageW, rowH).fill();
      doc.strokeColor(borderColor).rect(50, rowY, pageW, rowH).stroke();

      doc.fillColor(titleColor).fontSize(9).font('Helvetica');
      doc.text(monthNames[m - 1], 54, rowY + 4, { width: tcol.month, align: 'left' });
      doc
        .fillColor(incomeColor)
        .fontSize(9)
        .text(inc.toFixed(2), 54 + tcol.month, rowY + 4, { width: tcol.income, align: 'right' });
      doc
        .fillColor(expenseColor)
        .fontSize(9)
        .text(exp.toFixed(2), 54 + tcol.month + tcol.income, rowY + 4, {
          width: tcol.expense,
          align: 'right',
        });
      doc
        .fillColor(net >= 0 ? incomeColor : expenseColor)
        .fontSize(9)
        .text(net.toFixed(2), 54 + tcol.month + tcol.income + tcol.expense, rowY + 4, {
          width: tcol.net,
          align: 'right',
        });
      doc
        .fillColor(runningBal >= 0 ? incomeColor : expenseColor)
        .fontSize(9)
        .text(
          runningBal.toFixed(2),
          54 + tcol.month + tcol.income + tcol.expense + tcol.net,
          rowY + 4,
          { width: tcol.balance, align: 'right' }
        );
    }

    doc.y = Math.max(doc.y, tableTop + rowH * 13) + 20;
    doc
      .fillColor(mutedColor)
      .fontSize(9)
      .font('Helvetica')
      .text(`Generated by Finance Manager \u2014 ${new Date().toLocaleDateString()}`, {
        align: 'center',
      });

    doc.end();
  } catch (err) {
    console.error(err.message);
    logError('error', err);
    res.status(500).json({ error: err.message });
  }
});

// Global error handler middleware
// Sanitizes error messages before sending to client
app.use((err, req, res, next) => {
  console.error(err.message);
  logError('error', err);

  // Check if this is a known/safe error type
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }

  // Log unexpected errors but don't expose details to client
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    // Generic error message in production
    res.status(500).json({ error: 'An unexpected error occurred. Please try again later.' });
  } else {
    // More details in development for debugging
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Catch-all: serve index.html for SPA
// Test-only endpoint to reset rate limit store (used between test files)
if (process.env.NODE_ENV === 'test') {
  app.post('/api/test/reset-rate-limit', (req, res) => {
    if (global.__rateLimitStore) global.__rateLimitStore.clear();
    if (global.__authRateLimitStore) global.__authRateLimitStore.clear();
    res.json(toCamelCase({ ok: true }));
  });
}

// Serve index.html for client-side routes (SPA navigation) only
// Static files (JS, CSS) are served by the middleware above
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not Found' });
  }
  next();
});

app.get('*', (req, res) => {
  // For requests to /frontend/dist/... or /frontend/css/...:
  // These should be handled by Apache (Direct access to static files)
  // Return 404 for these paths since Apache should handle them
  if (req.path.startsWith('/frontend/dist/') || req.path.startsWith('/frontend/css/')) {
    return res.status(404).send('File not found');
  }

  // For all other paths, serve index.html for SPA routes
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Finance Manager running on port ${PORT}`);
});
