import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileIds } from '../profile';
import { enforce } from '../ratelimit';
import { exportBackup, restoreBackup } from '../backup';
import { HttpError } from '../http';
import { getUserPlan } from '../plan';
import { planLimit } from '../plans';
import * as db from '../db';
import { clearProfileData } from '../profileData';

// Data export, versioned restore, and wipe.
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
  return c.json(await exportBackup(c.env, c.get('userId'), pids));
});

// POST /api/import — restore a complete v3 backup for the signed-in user.
// restoreBackup validates and stages the full graph first; existing profiles are
// replaced only by the final atomic D1 cutover batch.
exportRoutes.post('/api/import', requireAuth, async (c) => {
  const rl = await enforce(c, `restore:${c.get('userId')}`, 3, 3600);
  if (rl) return rl;
  const contentLength = Number(c.req.header('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > 128 * 1024 * 1024) {
    throw new HttpError(413, 'Backup is too large (maximum request size is 128 MB)');
  }
  const contentType = c.req.header('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'Backup restore requires application/json');
  }
  const payload = await c.req.json().catch(() => {
    throw new HttpError(400, 'Invalid backup JSON');
  });
  const profileLimit = planLimit(await getUserPlan(c), 'profiles');
  const profileCount =
    payload &&
    typeof payload === 'object' &&
    Array.isArray((payload as Record<string, unknown>).profiles)
      ? ((payload as Record<string, unknown>).profiles as unknown[]).length
      : 0;
  if (profileLimit !== null && profileCount > profileLimit) {
    throw new HttpError(
      403,
      `Your plan allows up to ${profileLimit} profile${profileLimit === 1 ? '' : 's'}`
    );
  }
  return c.json(await restoreBackup(c.env, c.get('userId'), payload));
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
