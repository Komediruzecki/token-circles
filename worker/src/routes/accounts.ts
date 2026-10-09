import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId, getProfileIds } from '../profile';
import { accept, HttpError } from '../http';
import * as db from '../db';
import { resolveProfileBaseCurrency } from '../base-currency';
import { recomputeBalancesForAccounts } from '../recompute-balances';
import { normalizedTransactionAmountSql } from '../transaction-amount';
import { checkAccountCreate, checkAccountEdit } from '../../../shared/accountSchema';
import { calendarDateIn } from '../../../shared/calendarDate';
import { netWorthTimeline, snapshotDay } from '../../../shared/netWorthTimeline';
import { requestTimeZone } from '../local-date';

// Port of backend/routes/accounts.js + backend/repositories/accountsRepo.js.
// Accounts are profile-scoped; balance history is keyed by account_id and only
// reachable after the parent account is verified to belong to the active profile.
export const accountsRoutes = new Hono<AppEnv>();

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

// The body is checked by shared/accountSchema.ts, the rules local-first runs too: a refusal is a
// 400 naming each field. A new account opens at its starting balance; it has no transactions yet.
accountsRoutes.post('/api/accounts', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const b = (await c.req.json()) as Record<string, unknown>;
  const account = accept(checkAccountCreate(b));
  const baseCurrency = await resolveProfileBaseCurrency(c.env.DB, pid, account.currency, true);
  const res = await db.insert(c.env.DB, 'accounts', {
    ...account,
    currency: baseCurrency,
    profile_id: pid,
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
//
// Snapshots are filed under the day they were taken on the caller's calendar (X-Time-Zone, UTC
// without one). One recorded through the app holds an instant, and SQLite's date() of it is the
// UTC day: at 08:30 in Tokyo that is yesterday. One an import made holds a bare date, which is
// already the day. `date` is that day, YYYY-MM-DD, as local-first answers. A day's figure is each
// account's latest balance on or before it (shared/netWorthTimeline.ts).
accountsRoutes.get('/api/accounts/history/timeline', requireAuth, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const rows = await db.all<{
    id: number;
    account_id: number;
    recorded_at: string;
    balance: number;
  }>(
    c.env.DB,
    `SELECT abh.id, abh.account_id, abh.recorded_at, abh.balance
     FROM account_balance_history abh
     JOIN accounts a ON abh.account_id = a.id
     WHERE a.profile_id IN (${inClause})`,
    ...pids
  );
  const zone = requestTimeZone(c);
  return c.json(
    netWorthTimeline(
      rows.map((row) => ({
        account: row.account_id,
        day: snapshotDay(row.recorded_at, (instant) => calendarDateIn(zone, instant)),
        id: row.id,
        balance: row.balance,
      }))
    )
  );
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

// Partial update: only the fields the body changes are checked and written (shared/
// accountSchema.ts, decision 2), so a row stored under older rules can still be edited, and
// editing account info never wipes notes or the currency. `balance` is starting_balance + the
// ledger (see recompute-balances.ts), so a durable balance correction shifts starting_balance by
// the same delta: the frontend sends both the new starting_balance and the matching balance.
accountsRoutes.put('/api/accounts/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const b = (await c.req.json()) as Record<string, unknown>;
  const existing = await db.first<Record<string, any>>(
    c.env.DB,
    'SELECT * FROM accounts WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!existing) throw new HttpError(404, 'Account not found');
  const data: Record<string, unknown> = { ...accept(checkAccountEdit(b, existing)) };
  // A currency the edit changes has to be the base currency: another one is the 409.
  if (typeof data.currency === 'string') {
    data.currency = await resolveProfileBaseCurrency(c.env.DB, pid, data.currency);
    if (data.currency === existing.currency) delete data.currency;
  }
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

// Reconciliation summary for one account: the transactions drawn on it (account_id), as
// local-first counts them. The Express port counted every transaction of the profile here,
// from before transactions named their account, so each account reported the whole ledger.
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
  const amountSql = normalizedTransactionAmountSql();
  const unreconciled = await db.first<{ count: number; total: number }>(
    c.env.DB,
    `SELECT COUNT(*) as count, COALESCE(SUM(${amountSql}), 0) as total
     FROM transactions
     WHERE profile_id = ? AND account_id = ? AND (reconciled = 0 OR reconciled IS NULL)`,
    pid,
    account.id
  );
  const reconciled = await db.first<{ count: number }>(
    c.env.DB,
    `SELECT COUNT(*) as count FROM transactions
     WHERE profile_id = ? AND account_id = ? AND reconciled = 1`,
    pid,
    account.id
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
