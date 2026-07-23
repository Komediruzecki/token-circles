import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId, getProfileIds } from '../profile';
import { HttpError } from '../http';
import * as db from '../db';
import { normalizeCurrencyCode } from '../currency';
import { recomputeBalancesForAccounts } from '../recompute-balances';

// Port of backend/routes/accounts.js + backend/repositories/accountsRepo.js.
// Accounts are profile-scoped; balance history is keyed by account_id and only
// reachable after the parent account is verified to belong to the active profile.
export const accountsRoutes = new Hono<AppEnv>();

const VALID_TYPES = ['giro', 'ib', 'savings', 'cash'];

// accountsRepo.list — current_balance is the latest balance-history entry,
// falling back to starting_balance, then 0 (correlated subquery replicated).
accountsRoutes.get('/api/accounts', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const rows = await db.all(
    c.env.DB,
    `SELECT a.*, COALESCE((SELECT balance FROM account_balance_history bh WHERE bh.account_id = a.id ORDER BY bh.recorded_at DESC LIMIT 1), a.starting_balance, 0) as current_balance FROM accounts a WHERE a.profile_id = ? ORDER BY a.name`,
    pid
  );
  return c.json(rows);
});

accountsRoutes.post('/api/accounts', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const b = (await c.req.json()) as Record<string, any>;
  if (!b.name) throw new HttpError(400, 'Name is required');
  const accountType = VALID_TYPES.includes(b.type) ? b.type : 'giro';
  const startBalanceRaw =
    b.starting_balance !== undefined ? parseFloat(b.starting_balance) : parseFloat(b.balance);
  const startBalance = Number.isFinite(startBalanceRaw) ? startBalanceRaw : 0;
  const startDate = b.starting_date || null;
  const res = await db.insert(c.env.DB, 'accounts', {
    name: String(b.name).trim(),
    bank_name: b.bank_name || '',
    type: accountType,
    currency: normalizeCurrencyCode(b.currency, 'EUR'),
    balance: startBalance,
    notes: b.notes || '',
    profile_id: pid,
    starting_balance: startBalance,
    starting_date: startDate,
  });
  return c.json({ id: res.meta.last_row_id, message: 'Account created' });
});

// Recompute/repair stored balances for the active profile (audit A1/D3): balance =
// starting_balance + the account's ledger, via the shared recompute routine (reused by the
// import execute path). Registered before /:id so the literal path is matched first.
accountsRoutes.post('/api/accounts/recompute-balances', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const rows = await db.all<{ id: number }>(
    c.env.DB,
    'SELECT id FROM accounts WHERE profile_id = ?',
    pid
  );
  const ids = rows.map((r) => r.id);
  await recomputeBalancesForAccounts(c.env.DB, ids);
  return c.json({ ok: true, recomputed: ids.length });
});

// Net worth timeline from balance history (aggregating read -> getProfileIds).
// Registered before /:id so the literal path is matched first.
accountsRoutes.get('/api/accounts/history/timeline', requireAuth, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const rows = await db.all(
    c.env.DB,
    `SELECT abh.recorded_at as date, SUM(abh.balance) as net_worth
     FROM account_balance_history abh
     JOIN accounts a ON abh.account_id = a.id
     WHERE a.profile_id IN (${inClause})
     GROUP BY date(abh.recorded_at)
     ORDER BY date ASC`,
    ...pids
  );
  return c.json(rows);
});

accountsRoutes.get('/api/accounts/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const account = await db.first(
    c.env.DB,
    'SELECT * FROM accounts WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  if (!account) throw new HttpError(404, 'Account not found');
  return c.json(account);
});

// Partial update: only the fields the client actually sends are written; everything else
// is preserved. Editing account info must never silently wipe notes/currency or clobber the
// derived balance. `balance` is starting_balance + the ledger (see recompute-balances.ts), so
// a durable balance correction shifts starting_balance by the same delta — the frontend sends
// both the new starting_balance and the matching balance together.
accountsRoutes.put('/api/accounts/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const b = (await c.req.json()) as Record<string, any>;
  const existing = await db.first<Record<string, any>>(
    c.env.DB,
    'SELECT * FROM accounts WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!existing) throw new HttpError(404, 'Account not found');
  const data: Record<string, any> = {};
  if (typeof b.name === 'string' && b.name.trim()) data.name = b.name.trim();
  if (b.bank_name !== undefined) data.bank_name = b.bank_name ?? '';
  if (b.type !== undefined) data.type = VALID_TYPES.includes(b.type) ? b.type : existing.type;
  if (b.currency !== undefined && b.currency) data.currency = b.currency;
  if (b.notes !== undefined) data.notes = b.notes ?? '';
  if (b.balance !== undefined) {
    const v = parseFloat(b.balance);
    if (Number.isFinite(v)) data.balance = v;
  }
  if (b.starting_balance !== undefined) {
    const v = parseFloat(b.starting_balance);
    if (Number.isFinite(v)) data.starting_balance = v;
  }
  if (b.starting_date !== undefined) data.starting_date = b.starting_date || null;
  if (Object.keys(data).length === 0) return c.json({ message: 'No changes' });

  await db.update(c.env.DB, 'accounts', data, 'id = ? AND profile_id = ?', id, pid);
  return c.json({ message: 'Account updated' });
});

accountsRoutes.delete('/api/accounts/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const existing = await db.first(
    c.env.DB,
    'SELECT id FROM accounts WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!existing) throw new HttpError(404, 'Account not found');
  // Block deletion while a transaction still references the account as its source (account_id)
  // or transfer destination (transfer_account_id) — deleting it would strand those rows (audit
  // A6). Caller must reassign/delete them first. The account's own balance-history snapshots are
  // owned by it and are removed with it (cascade).
  const txRef = await db.first(
    c.env.DB,
    'SELECT id FROM transactions WHERE profile_id = ? AND (account_id = ? OR transfer_account_id = ?) LIMIT 1',
    pid,
    id,
    id
  );
  if (txRef) {
    throw new HttpError(409, 'Account has transactions — reassign or delete them first.');
  }
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM account_balance_history WHERE account_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM accounts WHERE id = ? AND profile_id = ?').bind(id, pid),
  ]);
  return c.json({ message: 'Account deleted' });
});

// ── Account balance history ───────────────────────────────────────────────────
accountsRoutes.get('/api/accounts/:id/history', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const account = await db.first(
    c.env.DB,
    'SELECT id FROM accounts WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!account) throw new HttpError(404, 'Account not found');
  const history = await db.all(
    c.env.DB,
    'SELECT * FROM account_balance_history WHERE account_id = ? ORDER BY recorded_at DESC',
    id
  );
  return c.json(history);
});

accountsRoutes.post('/api/accounts/:id/history', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const account = await db.first<{ balance: number }>(
    c.env.DB,
    'SELECT balance FROM accounts WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!account) throw new HttpError(404, 'Account not found');
  const b = (await c.req.json()) as Record<string, any>;
  const balance = parseFloat(b.balance ?? account.balance);
  if (isNaN(balance)) throw new HttpError(400, 'Invalid balance value');
  const recordedAt = new Date().toISOString();
  const res = await db.insert(c.env.DB, 'account_balance_history', {
    account_id: id,
    balance,
    recorded_at: recordedAt,
  });
  return c.json({ id: res.meta.last_row_id, balance, recorded_at: recordedAt });
});

accountsRoutes.delete('/api/accounts/:id/history', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const account = await db.first(
    c.env.DB,
    'SELECT id FROM accounts WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!account) throw new HttpError(404, 'Account not found');
  await db.del(c.env.DB, 'account_balance_history', 'account_id = ?', id);
  return c.json({ message: 'Balance history deleted' });
});

// Reconciliation summary — accounts don't directly link to transactions, so the
// counts span all profile transactions (matches the Express implementation).
accountsRoutes.get('/api/accounts/:id/reconciliation-summary', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const account = await db.first<{ id: number; name: string }>(
    c.env.DB,
    'SELECT id, name FROM accounts WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!account) throw new HttpError(404, 'Account not found');
  const unreconciled = await db.first<{ count: number; total: number }>(
    c.env.DB,
    `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
     FROM transactions
     WHERE profile_id = ? AND (reconciled = 0 OR reconciled IS NULL)`,
    pid
  );
  const reconciled = await db.first<{ count: number }>(
    c.env.DB,
    `SELECT COUNT(*) as count FROM transactions WHERE profile_id = ? AND reconciled = 1`,
    pid
  );
  const unreconciledCount = unreconciled?.count ?? 0;
  const reconciledCount = reconciled?.count ?? 0;
  return c.json({
    account_id: account.id,
    account_name: account.name,
    unreconciled_count: unreconciledCount,
    unreconciled_total: unreconciled?.total ?? 0,
    reconciled_count: reconciledCount,
    total_transactions: unreconciledCount + reconciledCount,
  });
});
