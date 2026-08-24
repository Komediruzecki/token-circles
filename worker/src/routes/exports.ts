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

/**
 * GET /api/export — the full JSON backup. Always the whole account, never a selection.
 *
 * It used to export whatever `X-Profile-Ids` asked for, which made the file's coverage a property
 * of the caller. `POST /api/import` deletes EVERY profile the user owns before restoring, so a
 * backup taken with two of three profiles selected — a stale header, a household mid-switch, a
 * script — silently destroyed the third on the way back in. The two halves have to agree on what
 * "the backup" means, and the only safe answer is the same thing restore replaces.
 *
 * Per-resource CSV exports above are still selection-scoped: those are extracts, not backups, and
 * nothing restores from them.
 */
exportRoutes.get('/api/export', requireAuth, async (c) => {
  const rl = await enforce(c, `export:${c.get('userId')}`, 10, 300);
  if (rl) return rl;
  const userId = c.get('userId');
  const owned = await db.all<{ id: number }>(
    c.env.DB,
    'SELECT id FROM profiles WHERE user_id = ? ORDER BY id',
    userId
  );
  const pids = owned.map((profile) => profile.id);
  if (pids.length === 0) throw new HttpError(404, 'There is nothing to back up yet');
  const backup = await exportBackup(c.env, userId, pids);
  // Surfaced in a header as well as the payload: the browser downloads the file without ever
  // parsing it, so the UI needs somewhere to read "this backup is missing two receipt images"
  // that does not involve opening a hundred megabytes of JSON.
  if (backup.skippedReceipts?.length) {
    c.header('X-Backup-Skipped-Receipts', String(backup.skippedReceipts.length));
  }
  return c.json(backup);
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
  if (profileLimit !== null) {
    // The cap is on how many profiles you may KEEP, and a restore does not create new ones — it
    // puts back the ones you had. Judging it against the plan limit alone made your own backup
    // unrestorable the moment your account held more profiles than your current plan allows: a
    // downgrade, a plan change, or simply profiles created before the cap existed. So the ceiling
    // is the higher of the two. Going beyond what you already have is still capped.
    const owned = await db.first<{ count: number }>(
      c.env.DB,
      'SELECT COUNT(*) AS count FROM profiles WHERE user_id = ?',
      c.get('userId')
    );
    const ceiling = Math.max(profileLimit, Number(owned?.count ?? 0));
    if (profileCount > ceiling) {
      throw new HttpError(
        403,
        `Your plan allows up to ${profileLimit} profile${profileLimit === 1 ? '' : 's'}`
      );
    }
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
