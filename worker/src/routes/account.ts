import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth, clearedSessionCookie } from '../auth';
import { HttpError } from '../http';
import * as db from '../db';

// Account-level operations (distinct from profile CRUD). Today: permanent account deletion.
export const accountRoutes = new Hono<AppEnv>();

// Tables scoped by profile_id — every row for the user's profiles is removed.
const PROFILE_TABLES = [
  'transactions',
  'accounts',
  'categories',
  'budgets',
  'budgets_zero_based',
  'savings_goals',
  'retirement_goals',
  'emergency_fund_config',
  'loans',
  'settings',
  'recurring_transactions',
  'bills',
  'housings',
  'tags',
  'category_mappings',
  'receipts',
  'portfolio_holdings',
];

// Best-effort: delete the Stripe customer (which also cancels their subscriptions). No-op unless
// billing is configured and the user has a customer id. Failures are swallowed — account deletion
// must not block on Stripe being reachable.
async function deleteStripeCustomer(
  env: AppEnv['Bindings'],
  customerId: string | null
): Promise<void> {
  if (!env.STRIPE_SECRET_KEY || !customerId) return;
  try {
    await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
  } catch {
    /* best-effort */
  }
}

// DELETE /api/account — permanently delete the signed-in user's account and ALL of their data.
// Confirm by sending { confirm } equal to the account email (case-insensitive) or the word "delete".
// Dev = hard delete (immediate). Prod will use a soft delete (deactivate now, purge later) — until
// that exists we refuse to hard-delete in production so data can't be destroyed there by accident.
accountRoutes.delete('/api/account', requireAuth, async (c) => {
  const userId = c.get('userId');
  const body = (await c.req.json().catch(() => ({}))) as { confirm?: string };
  const confirm = (body.confirm ?? '').trim();

  const user = await db.first<{ email: string | null; stripe_customer_id: string | null }>(
    c.env.DB,
    'SELECT email, stripe_customer_id FROM users WHERE id = ?',
    userId
  );
  if (!user) throw new HttpError(404, 'Account not found');

  const matches =
    confirm.toLowerCase() === 'delete' ||
    (!!user.email && confirm.toLowerCase() === user.email.toLowerCase());
  if (!matches) {
    throw new HttpError(400, 'Confirmation does not match. Type your account email or "delete".');
  }

  if (c.env.APP_ENV === 'production') {
    throw new HttpError(501, 'Account deletion is not enabled in production yet');
  }

  // Cancel/remove billing first (outside the DB batch; best-effort, never blocks).
  await deleteStripeCustomer(c.env, user.stripe_customer_id);

  const profs = await db.all<{ id: number }>(
    c.env.DB,
    'SELECT id FROM profiles WHERE user_id = ?',
    userId
  );
  const pids = profs.map((p) => p.id);

  // Remove R2 receipt objects for those profiles (gather the keys before the rows are deleted).
  if (c.env.RECEIPTS && pids.length) {
    const ph = pids.map(() => '?').join(',');
    const receipts = await db.all<{ storage_path: string }>(
      c.env.DB,
      `SELECT storage_path FROM receipts WHERE profile_id IN (${ph})`,
      ...pids
    );
    const keys = receipts.map((r) => r.storage_path).filter(Boolean);
    const bucket = c.env.RECEIPTS;
    for (let i = 0; i < keys.length; i += 1000) {
      await bucket.delete(keys.slice(i, i + 1000)).catch((e: unknown) => {
        console.error('R2 receipt batch delete during account deletion failed:', e);
      });
    }
  }

  // Delete everything in one atomic D1 batch: child tables first (FK cascade isn't relied on — D1
  // has it off by default), then profile-scoped tables, then user-scoped tables, then the user row.
  const stmts: D1PreparedStatement[] = [];
  const P = (sql: string, ...args: unknown[]) => stmts.push(c.env.DB.prepare(sql).bind(...args));
  if (pids.length) {
    const ph = pids.map(() => '?').join(',');
    P(
      `DELETE FROM account_balance_history WHERE account_id IN (SELECT id FROM accounts WHERE profile_id IN (${ph}))`,
      ...pids
    );
    P(
      `DELETE FROM transaction_tags WHERE transaction_id IN (SELECT id FROM transactions WHERE profile_id IN (${ph}))`,
      ...pids
    );
    P(
      `DELETE FROM loan_rate_periods WHERE loan_id IN (SELECT id FROM loans WHERE profile_id IN (${ph}))`,
      ...pids
    );
    P(
      `DELETE FROM loan_prepayments WHERE loan_id IN (SELECT id FROM loans WHERE profile_id IN (${ph}))`,
      ...pids
    );
    for (const t of PROFILE_TABLES) P(`DELETE FROM ${t} WHERE profile_id IN (${ph})`, ...pids);
  }
  P('DELETE FROM reminder_sends WHERE user_id = ?', userId);
  P('DELETE FROM reminder_dedup WHERE user_id = ?', userId);
  P('DELETE FROM password_resets WHERE user_id = ?', userId);
  P('DELETE FROM profiles WHERE user_id = ?', userId);
  P('DELETE FROM users WHERE id = ?', userId);
  await c.env.DB.batch(stmts);

  // Drop the session so the client is signed out immediately.
  c.header('Set-Cookie', clearedSessionCookie(c.env));
  return c.json({ ok: true });
});
