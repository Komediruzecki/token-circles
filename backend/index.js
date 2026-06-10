const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const db = require('./database');
const mime = require('mime-types');
const { reposMiddleware } = require('./repositories');
const { toCamelCase } = require('./utils');
const spreadsheetService = require('./services/spreadsheetService');
const pdfService = require('./services/pdfService');
const pdfRenderService = require('./services/pdfRenderService');
const yahooFinanceService = require('./services/yahooFinanceService');

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
      secure: false, // Allow cookies over HTTP for dev/localhost
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

// Repository middleware — attaches req.repos to every request
app.use(reposMiddleware(db));

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
    await fs.promises.writeFile(
      LOGS_FILE,
      JSON.stringify({ version: '1.0', max_entries: 500, entries: [] })
    );
    res.json(toCamelCase({ ok: true }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Static files - serve built files from dist if available, otherwise serve source files
const distPath = path.join(__dirname, '..', 'frontend', 'dist');
const serveDist = fs.existsSync(distPath) && fs.statSync(distPath).isDirectory();

if (serveDist) {
  // Serve production build from dist folder
  app.use(
    express.static(distPath, {
      setHeaders: (res, filepath) => {
        const ext = path.extname(filepath).toLowerCase();
        // Use correct MIME types for static assets
        const mimeType = mime.lookup(ext);
        if (mimeType) {
          res.setHeader('Content-Type', mimeType);
        }
      },
    })
  );
} else {
  // In dev mode, serve source files from frontend folder
  app.use(
    express.static(path.join(__dirname, '..', 'frontend'), {
      setHeaders: (res, filepath) => {
        const ext = path.extname(filepath).toLowerCase();
        // TypeScript and JSX files should be served as JavaScript
        if (ext === '.tsx' || ext === '.ts') {
          res.setHeader('Content-Type', 'application/javascript');
        }
      },
    })
  );
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

// ========================
// AUTH
// ========================
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Route dependencies ──────────────────────────────────────────────────────────
const routeDeps = {
  db,
  apiRateLimiter,
  authRateLimiter,
  requireAuth,
  logError,
  uploadReceipt,
  uploadImport,
};
// ── Mount extracted route modules ────────────────────────────────────────────────
app.use(require('./routes/appInfo')());
app.use(require('./routes/auth')(routeDeps));
app.use(require('./routes/profiles')({ db, apiRateLimiter, logError }));
app.use(require('./routes/settings')({ db, apiRateLimiter, logError }));
app.use(require('./routes/loans')({ db, apiRateLimiter, logError }));
app.use(require('./routes/recurring')({ db, apiRateLimiter, logError }));
app.use(require('./routes/counterparties')({ db, apiRateLimiter, logError }));
app.use(require('./routes/housing')({ db, apiRateLimiter, logError }));
app.use(require('./routes/retirement')({ db, apiRateLimiter, logError }));
app.use(require('./routes/receipts')({ db, apiRateLimiter, logError, uploadReceipt }));
app.use(require('./routes/storageMode')({ db, apiRateLimiter }));
app.use(require('./routes/accounts')({ db, apiRateLimiter, logError, requireAuth }));
app.use(require('./routes/bills')({ db, apiRateLimiter, logError }));
app.use(require('./routes/savingsGoals')({ db, apiRateLimiter, logError }));
app.use(require('./routes/tags')({ db, apiRateLimiter, logError }));
app.use(require('./routes/transactions')({ db, apiRateLimiter, logError, requireAuth }));
app.use(require('./routes/calculators')({ db, apiRateLimiter, logError }));
app.use(require('./routes/tax')({ db, apiRateLimiter, logError, requireAuth }));
app.use(require('./routes/analytics')({ db, apiRateLimiter, logError }));
app.use(require('./routes/notifications')({ db, apiRateLimiter, logError, requireAuth }));
app.use(require('./routes/categories')({ db, apiRateLimiter, logError, requireAuth }));
app.use(require('./routes/budgets')({ db, apiRateLimiter, logError }));
app.use(require('./routes/dashboard')({ db, apiRateLimiter, logError }));
app.use(require('./routes/exportRoutes')({ db, apiRateLimiter, logError }));
app.use(
  require('./routes/importRoutes')({
    db,
    apiRateLimiter,
    logError,
    uploadImport,
    spreadsheetService,
  })
);
app.use(require('./routes/portfolio')({ db, apiRateLimiter, logError, yahooFinanceService }));
app.use(
  require('./routes/reports')({
    db,
    apiRateLimiter,
    logError,
    spreadsheetService,
    pdfService,
    pdfRenderService,
    requireAuth,
  })
);
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

  app.post('/api/test/reset-password', (req, res) => {
    try {
      const bcrypt = require('bcrypt');
      const hash = bcrypt.hashSync('add2', 10);
      db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, 'maff');
      res.json(toCamelCase({ ok: true }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
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

  // ── Email Reminder Scheduler ─────────────────────────────────────────
  try {
    const cron = require('node-cron');
    const reminderService = require('./services/reminderService');

    // Budget alerts: Monday 9 AM
    cron.schedule('0 9 * * 1', () => {
      console.log('[cron] Running scheduled budget alerts...');
      reminderService
        .sendBudgetAlerts()
        .catch((e) => console.error('[cron] Budget alert error:', e.message));
    });

    // Spending report: every other Thursday 10 AM (1st-7th and 15th-21st of month)
    cron.schedule('0 10 1-7,15-21 * 4', () => {
      console.log('[cron] Running scheduled spending report...');
      reminderService
        .sendSpendingReports()
        .catch((e) => console.error('[cron] Spending report error:', e.message));
    });

    // Bills reminder: daily 8 AM
    cron.schedule('0 8 * * *', () => {
      console.log('[cron] Running scheduled bills reminder...');
      reminderService
        .sendBillsReminders()
        .catch((e) => console.error('[cron] Bills reminder error:', e.message));
    });

    console.log('[cron] Email reminder scheduler started');
  } catch (e) {
    console.warn('[cron] Scheduler not started (node-cron may not be installed):', e.message);
  }
});
