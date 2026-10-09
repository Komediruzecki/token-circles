import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth, clearedSessionCookie } from '../auth';
import { HttpError } from '../http';
import * as db from '../db';
import { profileRowDeletes } from '../profileData';
import { STRIPE_API_VERSION } from '../stripe';

// Account-level operations (distinct from profile CRUD). Today: permanent account deletion.
export const accountRoutes = new Hono<AppEnv>();

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
      // Pinned like every other call, even though this one sends no params and reads no response,
      // so that "no call rides the account's default version" holds without case-by-case reasoning
      // about which calls happen to be version-insensitive today.
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Stripe-Version': STRIPE_API_VERSION,
      },
    });
  } catch (err) {
    /* Continue with local deletion — GDPR requires it. Log the error so the
       operator can manually clean up the Stripe customer record if needed. */
    console.error('Stripe customer deletion failed:', err);
  }
}

// DELETE /api/account — permanently delete the signed-in user's account and ALL of their data.
// Confirm by sending { confirm } equal to the account email (case-insensitive) or the word "delete".
// The typed confirmation is the final guard; this route must work in production so a user can
// exercise their right to delete their account and financial data.
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
      await bucket.delete(keys.slice(i, i + 1000));
    }
  }

  // Delete everything in one atomic D1 batch: the profiles' rows (the same deletes that clear a
  // profile), then user-scoped tables, then the profiles and the user row.
  const stmts = profileRowDeletes(c.env.DB, pids, { includeSettings: true });
  const P = (sql: string, ...args: unknown[]) => stmts.push(c.env.DB.prepare(sql).bind(...args));
  P('DELETE FROM reminder_sends WHERE user_id = ?', userId);
  P('DELETE FROM reminder_dedup WHERE user_id = ?', userId);
  P('DELETE FROM password_resets WHERE user_id = ?', userId);
  P('DELETE FROM email_verifications WHERE user_id = ?', userId);
  P('DELETE FROM totp_credentials WHERE user_id = ?', userId);
  P('DELETE FROM recovery_codes WHERE user_id = ?', userId);
  P('DELETE FROM login_codes WHERE user_id = ?', userId);
  P('DELETE FROM webauthn_credentials WHERE user_id = ?', userId);
  P('DELETE FROM api_tokens WHERE user_id = ?', userId);
  // Every device's session row, with the device and the address it signed in from, goes with
  // the account.
  P('DELETE FROM auth_sessions WHERE user_id = ?', userId);
  // Its sign-in history goes too: the rows with its id, and the attempts at its address (a wrong
  // password, a bad code), which carry the address and no id. authlog.ts stores that address
  // trimmed and lower case.
  const address = user.email?.trim().toLowerCase();
  if (address) {
    P(
      'DELETE FROM auth_logs WHERE user_id = ? OR (user_id IS NULL AND email = ?)',
      userId,
      address
    );
  } else {
    P('DELETE FROM auth_logs WHERE user_id = ?', userId);
  }
  P('DELETE FROM custom_reports WHERE user_id = ?', userId);
  P('DELETE FROM error_logs WHERE user_id = ?', userId);
  P('DELETE FROM profiles WHERE user_id = ?', userId);
  P('DELETE FROM users WHERE id = ?', userId);
  await c.env.DB.batch(stmts);

  // Drop the session so the client is signed out immediately.
  c.header('Set-Cookie', clearedSessionCookie(c.env));
  return c.json({ ok: true });
});
