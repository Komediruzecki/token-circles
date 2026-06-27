import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { requireAdvancedReports } from '../plan';
import { getProfileId, getProfileIds } from '../profile';
import { buildReportPdf } from '../pdf';
import * as db from '../db';

// Port of backend/routes/reports.js. The JSON/data endpoints (tax-summary,
// pl-summary, overview, compare, saved/save) and the custom-report CRUD are
// ported faithfully. The PDF export endpoints (monthly-pdf, tax-summary-pdf,
// pl-summary-pdf, annual-pdf) depend on pdfService / pdfRenderService (PDFKit +
// Puppeteer) and the spreadsheet service — none of which run on Workers — so they
// return 501. See each handler's TODO.
export const reportsRoutes = new Hono<AppEnv>();

// In-memory store for "custom reports", matching the Express Map(). NOTE: on
// Workers this lives only for the lifetime of a single isolate and is not shared
// across isolates/requests — same volatile semantics the Express version had
// per-process, but more aggressively ephemeral. A durable store would need D1/KV.
const customReports = new Map<number, Record<string, any>>();

// Ported verbatim from backend/routes/reports.js — strips command-injection,
// XSS and dangerous-SQL patterns from a user-supplied report name.
function sanitizeInput(input: unknown): string {
  if (typeof input !== 'string') return input as string;
  const commandInjectionPatterns = [
    /[;|&]/,
    /`/,
    /\$\(/,
    /\$\{/,
    /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
    />\s*(\||>>|>|<|&)/,
    /~\//,
    /etc\/(?:passwd|shadow|group)/,
    /home\/(?:root|admin)/,
    /\/(dev|proc|sys)\//,
    /sudo/,
    /ping\s+-/,
  ];
  for (const pattern of commandInjectionPatterns) {
    if (pattern.test(input)) {
      return '';
    }
  }
  let sanitized = input.replace(/['";\\]/g, '');
  sanitized = sanitized.replace(/<script[^>]*>.*?<\/script>/gi, '');
  sanitized = sanitized.replace(/javascript:/gi, '');
  sanitized = sanitized.replace(/on\w+\s*=/gi, '');
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
      return '';
    }
  }
  return sanitized.trim();
}

// Number formatting + a PDF Response wrapper, shared by the PDF endpoints below.
const money = (n: number) =>
  (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function pdfResponse(bytes: Uint8Array, filename: string): Response {
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

// ── Monthly report (PDF) ─────────────────────────────────────────────
// Worker-native PDF via pdf-lib (no Puppeteer/PDFKit). `month` = YYYY-MM (default current).
reportsRoutes.get('/api/reports/monthly-pdf', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);
  const start = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const end = new Date(y, m, 0).toISOString().slice(0, 10);

  const income =
    (
      await db.first<{ t: number }>(
        c.env.DB,
        `SELECT COALESCE(SUM(amount),0) t FROM transactions WHERE profile_id = ? AND type='income' AND date >= ? AND date <= ?`,
        pid,
        start,
        end
      )
    )?.t || 0;
  const expenses =
    (
      await db.first<{ t: number }>(
        c.env.DB,
        `SELECT COALESCE(SUM(amount),0) t FROM transactions WHERE profile_id = ? AND type='expense' AND date >= ? AND date <= ?`,
        pid,
        start,
        end
      )
    )?.t || 0;
  const byCat = await db.all<{ name: string; total: number }>(
    c.env.DB,
    `SELECT COALESCE(c.name,'Uncategorized') name, SUM(t.amount) total FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
       WHERE t.profile_id = ? AND t.type='expense' AND t.date >= ? AND t.date <= ?
       GROUP BY c.id ORDER BY total DESC`,
    pid,
    start,
    end
  );

  const pdf = await buildReportPdf({
    title: 'Monthly Report',
    subtitle: month,
    sections: [
      {
        heading: 'Summary',
        rows: [
          ['Income', money(income)],
          ['Expenses', money(expenses)],
          ['Net', money(income - expenses)],
        ],
      },
      { heading: 'Expenses by category', rows: byCat.map((r) => [r.name, money(r.total)]) },
    ],
  });
  return pdfResponse(pdf, `monthly-${month}.pdf`);
});

// ── Year-End Tax Summary (JSON) ──────────────────────────────────────
reportsRoutes.get('/api/reports/tax-summary', requireAuth, requireAdvancedReports, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const year = c.req.query('year');
  if (!year) return c.json({ error: 'year is required' }, 400);

  const startStr = `${year}-01-01`;
  const endStr = `${year}-12-31`;

  const rows = await db.all<{
    id: number;
    date: string;
    description: string;
    amount: number;
    currency: string;
    category_name: string;
    tax_deductible: number;
  }>(
    c.env.DB,
    `SELECT t.id, t.date, t.description, t.amount, t.currency, c.name as category_name, c.tax_deductible
       FROM transactions t
       JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
       WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ? AND t.type = 'expense'
       ORDER BY c.tax_deductible DESC, c.name, t.date`,
    ...pids,
    startStr,
    endStr
  );

  const taxDeductible = rows.filter((r) => r.tax_deductible);
  const nonDeductible = rows.filter((r) => !r.tax_deductible);

  const byCategory = (rs: typeof rows) => {
    const map: Record<string, { total: number; transactions: any[] }> = {};
    rs.forEach((r) => {
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

  return c.json({
    year: parseInt(year),
    taxDeductibleTotal: taxDeductible.reduce((s, r) => s + r.amount, 0),
    nonDeductibleTotal: nonDeductible.reduce((s, r) => s + r.amount, 0),
    totalExpenses: rows.reduce((s, r) => s + r.amount, 0),
    taxDeductibleCategories: byCategory(taxDeductible),
    nonDeductibleCategories: byCategory(nonDeductible),
    transactionCount: rows.length,
  });
});

// ── Year-End Tax Summary (PDF) ───────────────────────────────────────
reportsRoutes.get(
  '/api/reports/tax-summary-pdf',
  requireAuth,
  requireAdvancedReports,
  async (c) => {
    const pids = await getProfileIds(c);
    const inClause = pids.map(() => '?').join(',');
    const year = c.req.query('year');
    if (!year) return c.json({ error: 'year is required' }, 400);
    const rows = await db.all<{ amount: number; category_name: string; tax_deductible: number }>(
      c.env.DB,
      `SELECT t.amount, c.name as category_name, c.tax_deductible FROM transactions t
       JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
       WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ? AND t.type = 'expense'`,
      ...pids,
      `${year}-01-01`,
      `${year}-12-31`
    );
    const byCat = (rs: typeof rows) => {
      const m: Record<string, number> = {};
      for (const r of rs) m[r.category_name] = (m[r.category_name] || 0) + r.amount;
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    };
    const ded = rows.filter((r) => r.tax_deductible);
    const non = rows.filter((r) => !r.tax_deductible);
    const pdf = await buildReportPdf({
      title: 'Year-End Tax Summary',
      subtitle: `Tax year ${year}`,
      sections: [
        {
          heading: 'Summary',
          rows: [
            ['Tax-deductible expenses', money(ded.reduce((s, r) => s + r.amount, 0))],
            ['Non-deductible expenses', money(non.reduce((s, r) => s + r.amount, 0))],
            ['Total expenses', money(rows.reduce((s, r) => s + r.amount, 0))],
            ['Transactions', String(rows.length)],
          ],
        },
        { heading: 'Tax-deductible by category', rows: byCat(ded).map(([n, t]) => [n, money(t)]) },
        { heading: 'Non-deductible by category', rows: byCat(non).map(([n, t]) => [n, money(t)]) },
      ],
    });
    return pdfResponse(pdf, `tax-summary-${year}.pdf`);
  }
);

// ── Year-End P&L Summary (JSON) ──────────────────────────────────────
reportsRoutes.get('/api/reports/pl-summary', requireAuth, requireAdvancedReports, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const year = c.req.query('year');
  if (!year) return c.json({ error: 'year is required' }, 400);

  const startStr = `${year}-01-01`;
  const endStr = `${year}-12-31`;

  const rows = await db.all<{
    id: number;
    date: string;
    description: string;
    amount: number;
    currency: string;
    type: string;
    category_name: string;
  }>(
    c.env.DB,
    `SELECT t.id, t.date, t.description, t.amount, t.currency, t.type, c.name as category_name
       FROM transactions t
       JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
       WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ?
       ORDER BY t.type, c.name, t.date`,
    ...pids,
    startStr,
    endStr
  );

  const income = rows.filter((r) => r.type === 'income');
  const expenses = rows.filter((r) => r.type === 'expense');

  const byCategory = (txs: typeof rows) => {
    const map: Record<string, { total: number; count: number }> = {};
    txs.forEach((r) => {
      if (!map[r.category_name]) map[r.category_name] = { total: 0, count: 0 };
      map[r.category_name].total += r.amount;
      map[r.category_name].count++;
    });
    return map;
  };

  const incomeTotal = income.reduce((s, r) => s + r.amount, 0);
  const expenseTotal = expenses.reduce((s, r) => s + r.amount, 0);

  return c.json({
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
});

// ── Year-End P&L Summary (PDF) ───────────────────────────────────────
reportsRoutes.get('/api/reports/pl-summary-pdf', requireAuth, requireAdvancedReports, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const year = c.req.query('year');
  if (!year) return c.json({ error: 'year is required' }, 400);
  const rows = await db.all<{ amount: number; type: string; category_name: string }>(
    c.env.DB,
    `SELECT t.amount, t.type, c.name as category_name FROM transactions t
       JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
       WHERE t.profile_id IN (${inClause}) AND t.date >= ? AND t.date <= ?`,
    ...pids,
    `${year}-01-01`,
    `${year}-12-31`
  );
  const cat = (type: string) => {
    const m: Record<string, number> = {};
    for (const r of rows)
      if (r.type === type) m[r.category_name] = (m[r.category_name] || 0) + r.amount;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const incomeTotal = rows.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const expenseTotal = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  const pdf = await buildReportPdf({
    title: 'Year-End P&L Summary',
    subtitle: `Year ${year}`,
    sections: [
      { heading: 'Income by category', rows: cat('income').map(([n, t]) => [n, money(t)]) },
      { heading: 'Expenses by category', rows: cat('expense').map(([n, t]) => [n, money(t)]) },
      {
        heading: 'Totals',
        rows: [
          ['Total income', money(incomeTotal)],
          ['Total expenses', money(expenseTotal)],
          ['Net savings', money(incomeTotal - expenseTotal)],
          [
            'Savings rate',
            incomeTotal > 0
              ? `${(((incomeTotal - expenseTotal) / incomeTotal) * 100).toFixed(1)}%`
              : '0%',
          ],
        ],
      },
    ],
  });
  return pdfResponse(pdf, `pl-summary-${year}.pdf`);
});

// ── Custom Report (create) ───────────────────────────────────────────
// Accepts a custom report name — sanitized to prevent command injection.
reportsRoutes.post('/api/reports/custom', requireAuth, async (c) => {
  const b = (await c.req.json()) as Record<string, any>;
  const sanitizedName = sanitizeInput(b.name || 'Custom Report');
  if (!sanitizedName || sanitizedName.trim().length < 1) {
    return c.json({ error: 'Invalid report name' }, 400);
  }
  const id = Date.now();
  const report = {
    id,
    reportId: id,
    name: sanitizedName,
    type: b.type || 'custom',
    createdAt: new Date().toISOString(),
  };
  customReports.set(id, report);
  return c.json(report);
});

// ── Annual Financial Report (PDF) ────────────────────────────────────
reportsRoutes.get('/api/reports/annual-pdf', requireAuth, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const year = c.req.query('year') || String(new Date().getFullYear());
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const sum = async (type: string) =>
    (
      await db.first<{ t: number }>(
        c.env.DB,
        `SELECT COALESCE(SUM(amount),0) t FROM transactions WHERE profile_id IN (${inClause}) AND type=? AND date >= ? AND date <= ?`,
        ...pids,
        type,
        start,
        end
      )
    )?.t || 0;
  const income = await sum('income');
  const expenses = await sum('expense');

  const monthlyRows = await db.all<{ ym: string; type: string; total: number }>(
    c.env.DB,
    `SELECT substr(date,1,7) ym, type, SUM(amount) total FROM transactions
       WHERE profile_id IN (${inClause}) AND date >= ? AND date <= ? AND type IN ('income','expense')
       GROUP BY ym, type ORDER BY ym`,
    ...pids,
    start,
    end
  );
  const months: Record<string, { income: number; expense: number }> = {};
  for (const r of monthlyRows) {
    months[r.ym] = months[r.ym] || { income: 0, expense: 0 };
    if (r.type === 'income') months[r.ym].income = r.total;
    else months[r.ym].expense = r.total;
  }
  const byCat = await db.all<{ name: string; total: number }>(
    c.env.DB,
    `SELECT COALESCE(c.name,'Uncategorized') name, SUM(t.amount) total FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
       WHERE t.profile_id IN (${inClause}) AND t.type='expense' AND t.date >= ? AND t.date <= ?
       GROUP BY c.id ORDER BY total DESC LIMIT 15`,
    ...pids,
    start,
    end
  );

  const pdf = await buildReportPdf({
    title: 'Annual Financial Report',
    subtitle: `Year ${year}`,
    sections: [
      {
        heading: 'Summary',
        rows: [
          ['Total income', money(income)],
          ['Total expenses', money(expenses)],
          ['Net savings', money(income - expenses)],
          [
            'Savings rate',
            income > 0 ? `${(((income - expenses) / income) * 100).toFixed(1)}%` : '0%',
          ],
        ],
      },
      {
        heading: 'Net by month',
        rows: Object.entries(months).map(([ym, v]) => [ym, money(v.income - v.expense)]),
      },
      { heading: 'Top expense categories', rows: byCat.map((r) => [r.name, money(r.total)]) },
    ],
  });
  return pdfResponse(pdf, `annual-${year}.pdf`);
});

// ── Overview Report ──────────────────────────────────────────────────
reportsRoutes.get('/api/reports/overview', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const type = c.req.query('type');
  const includeCategories = c.req.query('includeCategories');

  let incomeWhere = `profile_id = ? AND type = 'income'`;
  let expenseWhere = `profile_id = ? AND type = 'expense'`;
  const incomeParams: unknown[] = [pid];
  const expenseParams: unknown[] = [pid];

  if (startDate) {
    incomeWhere += ` AND date >= ?`;
    expenseWhere += ` AND date >= ?`;
    incomeParams.push(startDate);
    expenseParams.push(startDate);
  }
  if (endDate) {
    incomeWhere += ` AND date <= ?`;
    expenseWhere += ` AND date <= ?`;
    incomeParams.push(endDate);
    expenseParams.push(endDate);
  }

  const totalIncome =
    (
      await db.first<{ total: number }>(
        c.env.DB,
        `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE ${incomeWhere}`,
        ...incomeParams
      )
    )?.total || 0;
  const totalExpenses =
    (
      await db.first<{ total: number }>(
        c.env.DB,
        `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE ${expenseWhere}`,
        ...expenseParams
      )
    )?.total || 0;

  const countParams: unknown[] = type
    ? [pid, type, ...(startDate ? [startDate] : []), ...(endDate ? [endDate] : [])]
    : [pid];

  let countQuery = `SELECT COUNT(*) as count FROM transactions WHERE profile_id = ?`;
  if (type) countQuery += ` AND type = ?`;
  if (startDate) countQuery += ` AND date >= ?`;
  if (endDate) countQuery += ` AND date <= ?`;

  const transactionCount =
    (await db.first<{ count: number }>(c.env.DB, countQuery, ...countParams))?.count || 0;

  const response: Record<string, unknown> = {
    totalIncome,
    totalExpenses,
    netBalance: totalIncome - totalExpenses,
    transactionCount,
  };

  if (includeCategories === 'true') {
    response.categoryBreakdown = await db.all(
      c.env.DB,
      `SELECT c.name, c.id, SUM(t.amount) as total
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
         WHERE t.profile_id = ?
         GROUP BY c.id
         ORDER BY total DESC`,
      pid
    );
  }

  return c.json(response);
});

// ── Custom Report CRUD ───────────────────────────────────────────────
reportsRoutes.get('/api/reports/custom/:id', requireAuth, async (c) => {
  const id = parseInt(c.req.param('id'));
  const report = customReports.get(id);
  if (!report) return c.json({ error: 'Report not found' }, 404);
  return c.json(report);
});

reportsRoutes.put('/api/reports/custom/:id', requireAuth, async (c) => {
  const id = parseInt(c.req.param('id'));
  const report = customReports.get(id);
  if (!report) return c.json({ error: 'Report not found' }, 404);
  const b = (await c.req.json()) as Record<string, any>;
  const updated = { ...report, ...b, id, updatedAt: new Date().toISOString() };
  customReports.set(id, updated);
  return c.json(updated);
});

reportsRoutes.delete('/api/reports/custom/:id', requireAuth, async (c) => {
  const id = parseInt(c.req.param('id'));
  if (!customReports.has(id)) return c.json({ error: 'Report not found' }, 404);
  customReports.delete(id);
  return c.json({ ok: true });
});

// ── Report Comparison ────────────────────────────────────────────────
reportsRoutes.get('/api/reports/compare', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const comparison: Array<{ month: string; income: number; expenses: number; net: number }> = [];
  const now = new Date();
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const startDate = d.toISOString().split('T')[0];
    const endDate = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
    const income =
      (
        await db.first<{ total: number }>(
          c.env.DB,
          `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
           WHERE profile_id = ? AND type = 'income' AND date >= ? AND date <= ?`,
          pid,
          startDate,
          endDate
        )
      )?.total || 0;
    const expenses =
      (
        await db.first<{ total: number }>(
          c.env.DB,
          `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
           WHERE profile_id = ? AND type = 'expense' AND date >= ? AND date <= ?`,
          pid,
          startDate,
          endDate
        )
      )?.total || 0;
    comparison.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      income,
      expenses,
      net: income - expenses,
    });
  }
  return c.json({ comparison });
});

// ── Saved Reports ────────────────────────────────────────────────────
reportsRoutes.get('/api/reports/saved', requireAuth, async (c) => {
  return c.json({ reports: [] });
});

reportsRoutes.post('/api/reports/save', requireAuth, async (c) => {
  const b = (await c.req.json()) as Record<string, any>;
  if (!b.name) return c.json({ error: 'Report name is required' }, 400);
  const id = Date.now();
  customReports.set(id, {
    id,
    name: b.name,
    type: b.type || 'custom',
    params: b.params || {},
    createdAt: new Date().toISOString(),
  });
  return c.json({ id, name: b.name, ok: true });
});
