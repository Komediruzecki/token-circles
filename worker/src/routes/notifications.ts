import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId } from '../profile';
import { HttpError } from '../http';
import * as db from '../db';
import { sendMail } from '../email';
import { sendBudgetAlertsForUser, sendSpendingReportForUser } from '../reminders';
import type { UserRow } from '../reminders';

// Email/reminder preferences + test/trigger/unsubscribe. Per-type prefs live in `settings`
// (email_notifications, email_budget_alerts, email_spending_report) on the active profile;
// the email address lives on the user. Mirrors backend/routes/notifications.js.
export const notificationsRoutes = new Hono<AppEnv>();

// GET — current email + toggles for the active profile (each flag defaults ON).
notificationsRoutes.get('/api/notifications/settings', requireAuth, async (c) => {
  const userId = c.get('userId');
  const pid = await getProfileId(c);
  const user = await db.first<{ email: string | null }>(
    c.env.DB,
    'SELECT email FROM users WHERE id = ?',
    userId
  );
  const rows = await db.all<{ key: string; value: string }>(
    c.env.DB,
    "SELECT key, value FROM settings WHERE profile_id = ? AND key LIKE 'email_%'",
    pid
  );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const flag = (k: string) => map.get(k) !== 'false';
  return c.json({
    email: user?.email ?? '',
    emailNotifications: flag('email_notifications'),
    budgetAlerts: flag('email_budget_alerts'),
    spendingReport: flag('email_spending_report'),
  });
});

// PUT — update the email (UNIQUE-checked) and toggles.
notificationsRoutes.put('/api/notifications/settings', requireAuth, async (c) => {
  const userId = c.get('userId');
  const pid = await getProfileId(c);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.email === 'string' && b.email.trim()) {
    const email = b.email.trim().toLowerCase();
    const taken = await db.first(
      c.env.DB,
      'SELECT id FROM users WHERE email = ? AND id != ?',
      email,
      userId
    );
    if (taken) throw new HttpError(409, 'That email is already in use');
    await db.run(c.env.DB, 'UPDATE users SET email = ? WHERE id = ?', email, userId);
  }
  const set = (key: string, on: unknown) =>
    db.run(
      c.env.DB,
      'INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES (?, ?, ?)',
      key,
      on ? 'true' : 'false',
      pid
    );
  if ('emailNotifications' in b) await set('email_notifications', b.emailNotifications);
  if ('budgetAlerts' in b) await set('email_budget_alerts', b.budgetAlerts);
  if ('spendingReport' in b) await set('email_spending_report', b.spendingReport);
  return c.json({ ok: true });
});

// POST — send a test email to the user's own address.
notificationsRoutes.post('/api/notifications/test-email', requireAuth, async (c) => {
  const user = await db.first<{ email: string | null }>(
    c.env.DB,
    'SELECT email FROM users WHERE id = ?',
    c.get('userId')
  );
  if (!user?.email) throw new HttpError(400, 'No email on your account');
  const r = await sendMail(
    c.env,
    user.email,
    'Test email — Token Circles',
    '<p>This is a test email from Token Circles. Your notifications are working.</p>'
  );
  return c.json({ ok: true, ...r });
});

// POST — manually run a reminder for yourself (smoke-test without waiting for cron).
notificationsRoutes.post('/api/notifications/trigger', requireAuth, async (c) => {
  const u = await db.first<UserRow>(
    c.env.DB,
    'SELECT id, email, plan, notifications_unsubscribed, unsubscribe_token FROM users WHERE id = ?',
    c.get('userId')
  );
  if (!u) throw new HttpError(404, 'User not found');
  const type = ((await c.req.json().catch(() => ({}))) as { type?: string }).type;
  let sent = false;
  if (type === 'budget') sent = await sendBudgetAlertsForUser(c.env, u);
  else if (type === 'spending') sent = await sendSpendingReportForUser(c.env, u);
  else throw new HttpError(400, 'Unknown reminder type (use "budget" or "spending")');
  return c.json({ ok: true, sent });
});

// GET — public one-click unsubscribe (clicked from an email footer; no auth).
notificationsRoutes.get('/api/notifications/unsubscribe', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.text('Invalid unsubscribe link.', 400);
  await db.run(
    c.env.DB,
    'UPDATE users SET notifications_unsubscribed = 1 WHERE unsubscribe_token = ?',
    token
  );
  return c.html(
    '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>Unsubscribed</h2><p>You will no longer receive Token Circles reminder emails.</p></body></html>'
  );
});
