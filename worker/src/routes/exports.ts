import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileIds } from '../profile';
import { enforce } from '../ratelimit';
import * as db from '../db';
import { clearProfileData } from '../profileData';

// Data export + wipe — port of backend/routes/exportRoutes.js (the GET routes + clear-all).
// POST /api/import is intentionally not ported: its only caller (SettingsDialog) is dead code.
export const exportRoutes = new Hono<AppEnv>();

// CSV serialization with a formula-injection guard, mirroring the Express backend.
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown): string => {
    let val = v == null ? '' : String(v);
    // Formula-injection guard for spreadsheet apps. Plain numbers (incl. negatives) are
    // data, not formulas — quoting them turned every negative balance into text like
    // "'-2392.21" and corrupted numeric columns.
    const isPlainNumber = typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(val);
    if (!isPlainNumber && /^[=+\-@\t\r]/.test(val)) val = "'" + val;
    return /[",\n]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join(
    '\n'
  );
}

// GET /api/export/:type — one resource as CSV (or JSON), across the selected profiles.
exportRoutes.get('/api/export/:type', requireAuth, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const type = c.req.param('type');
  const format = c.req.query('format') || 'csv';

  let rows: Record<string, unknown>[];
  let filename: string;
  switch (type) {
    case 'transactions':
      rows = await db.all(
        c.env.DB,
        `SELECT t.date, t.description, t.amount, t.type, t.currency, t.means_of_payment, t.beneficiary, t.payor, t.notes, c.name as category
         FROM transactions t LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
         WHERE t.profile_id IN (${inClause}) ORDER BY t.date DESC`,
        ...pids
      );
      filename = 'transactions';
      break;
    case 'categories':
      rows = await db.all(
        c.env.DB,
        `SELECT name, color, icon, type, parent_id FROM categories WHERE profile_id IN (${inClause})`,
        ...pids
      );
      filename = 'categories';
      break;
    case 'accounts':
      rows = await db.all(
        c.env.DB,
        `SELECT name, type, currency, balance, notes FROM accounts WHERE profile_id IN (${inClause})`,
        ...pids
      );
      filename = 'accounts';
      break;
    case 'budgets':
      rows = await db.all(
        c.env.DB,
        `SELECT b.*, c.name as category_name FROM budgets b
         JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
         WHERE b.profile_id IN (${inClause})`,
        ...pids
      );
      filename = 'budgets';
      break;
    case 'loans':
      rows = await db.all(
        c.env.DB,
        `SELECT l.name, l.principal, l.interest_rate, l.start_date, l.term_months,
           (SELECT SUM(amount) FROM loan_prepayments WHERE loan_id = l.id) as total_prepaid
         FROM loans l WHERE l.profile_id IN (${inClause})`,
        ...pids
      );
      filename = 'loans';
      break;
    case 'recurring':
      rows = await db.all(
        c.env.DB,
        `SELECT description, amount, type, frequency, day_of_month, next_date, notes, active
         FROM recurring_transactions WHERE profile_id IN (${inClause})`,
        ...pids
      );
      filename = 'recurring_transactions';
      break;
    default:
      return c.json({ error: 'Invalid export type' }, 400);
  }

  if (format === 'json') {
    c.header('Content-Disposition', `attachment; filename="${filename}.json"`);
    return c.json(rows);
  }
  return new Response(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}.csv"`,
    },
  });
});

// GET /api/export — full JSON backup across the selected profiles.
exportRoutes.get('/api/export', requireAuth, async (c) => {
  const rl = await enforce(c, `export:${c.get('userId')}`, 10, 300);
  if (rl) return rl;
  const pids = await getProfileIds(c);
  const userId = c.get('userId');
  const inClause = pids.map(() => '?').join(',');
  const scoped = (table: string, order = '') =>
    db.all(c.env.DB, `SELECT * FROM ${table} WHERE profile_id IN (${inClause}) ${order}`, ...pids);

  const transactions = await scoped('transactions', 'ORDER BY date DESC');
  const categories = await scoped('categories');
  const accounts = await scoped('accounts');
  const budgets = await scoped('budgets');
  const loans = await scoped('loans');
  const goals = await scoped('savings_goals');
  const retirementGoals = await scoped('retirement_goals');
  const portfolioHoldings = await scoped('portfolio_holdings');
  const profiles = await db.all(
    c.env.DB,
    'SELECT id, name, user_id, created_at FROM profiles WHERE user_id = ?',
    userId
  );
  const balanceHistory = await db.all(
    c.env.DB,
    `SELECT abh.* FROM account_balance_history abh
     JOIN accounts a ON a.id = abh.account_id WHERE a.profile_id IN (${inClause})`,
    ...pids
  );
  const settingsRows = await db.all<{ key: string; value: string }>(
    c.env.DB,
    `SELECT key, value FROM settings WHERE profile_id IN (${inClause})`,
    ...pids
  );
  const settings: Record<string, string> = {};
  for (const s of settingsRows) settings[s.key] = s.value;

  return c.json({
    version: '2.0',
    export_date: new Date().toISOString(),
    storage_mode: 'self-hosted',
    profiles,
    categories,
    transactions,
    accounts,
    budgets,
    goals,
    retirementGoals,
    portfolioHoldings,
    loans,
    balanceHistory,
    settings,
  });
});

// DELETE /api/clear-all — wipe data for every profile owned by the signed-in user.
exportRoutes.delete('/api/clear-all', requireAuth, async (c) => {
  const rl = await enforce(c, `destroy:${c.get('userId')}`, 10, 3600);
  if (rl) return rl;
  const profiles = await db.all<{ id: number }>(
    c.env.DB,
    'SELECT id FROM profiles WHERE user_id = ? ORDER BY id',
    c.get('userId')
  );
  await clearProfileData(
    c.env,
    profiles.map((profile) => profile.id),
    { includeSettings: true }
  );
  return c.json({ ok: true, message: 'All data cleared' });
});
