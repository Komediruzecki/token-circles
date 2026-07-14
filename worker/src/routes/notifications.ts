import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId } from '../profile';
import { HttpError } from '../http';
import * as db from '../db';
import { sendMail } from '../email';
import {
  composeReminderPreview,
  sendBudgetAlertsForUser,
  sendSpendingReportForUser,
} from '../reminders';
import type { UserRow } from '../reminders';
import { enforce } from '../ratelimit';
import { requireFeature } from '../plan';

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

// POST — send a test email to the user's own address. Optional body { type }:
//   "basic" (default) — plain connectivity check
//   "spending"        — the REAL periodic spending-report email, composed from your data
//   "budget"          — the REAL budget-alert email (threshold 0 so it always has content)
// Report/budget previews bypass prefs/quota/period-dedup so they never block (or get
// blocked by) the scheduled sends — this exists to preview the layouts on demand.
notificationsRoutes.post('/api/notifications/test-email', requireAuth, async (c) => {
  // Email alerts are a paid feature (plans.ts emailReminders); the scheduled sender
  // gates on this via canReceive(), but the manual test/preview path bypassed it.
  await requireFeature(
    c,
    'emailReminders',
    'Email alerts are a premium feature. Upgrade to send or preview them.'
  );
  const rl = await enforce(c, `testmail:${c.get('userId')}`, 6, 3600);
  if (rl) return rl;
  const user = await db.first<{ email: string | null }>(
    c.env.DB,
    'SELECT email FROM users WHERE id = ?',
    c.get('userId')
  );
  if (!user?.email) throw new HttpError(400, 'No email on your account');

  const type = ((await c.req.json().catch(() => ({}))) as { type?: string }).type ?? 'basic';
  let subject = 'Test email — Token Circles';
  let html = '<p>This is a test email from Token Circles. Your notifications are working.</p>';
  if (type === 'spending' || type === 'budget') {
    const preview = await composeReminderPreview(c.env, c.get('userId'), type);
    if (!preview) {
      throw new HttpError(
        400,
        type === 'spending'
          ? 'No spending data to build a report from yet'
          : 'No budgets with spending to build an alert from yet'
      );
    }
    subject = preview.subject;
    html = preview.html;
  } else if (type !== 'basic') {
    throw new HttpError(400, 'Unknown test email type (use "basic", "spending" or "budget")');
  }

  const r = await sendMail(c.env, user.email, subject, html);
  return c.json({ ok: true, type, ...r });
});

// POST — manually run a reminder for yourself (smoke-test without waiting for cron).
notificationsRoutes.post('/api/notifications/trigger', requireAuth, async (c) => {
  await requireFeature(
    c,
    'emailReminders',
    'Email alerts are a premium feature. Upgrade to send or preview them.'
  );
  const rl = await enforce(c, `trigger:${c.get('userId')}`, 5, 3600);
  if (rl) return rl;
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
  const appUrl = c.env.CORS_ORIGIN || '';
  const page = (title: string, body: string, status: 200 | 400 = 200) =>
    c.html(
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Token Circles</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0b1020;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px">
<div style="max-width:420px;width:100%;background:#131a2e;border:1px solid #26304d;border-radius:12px;padding:32px;text-align:center">
<div style="font-weight:700;font-size:18px;margin-bottom:16px">Token Circles</div>
<h1 style="font-size:20px;margin:0 0 12px">${title}</h1>
<p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 20px">${body}</p>
${appUrl ? `<a href="${appUrl}" style="display:inline-block;background:#4f6ef7;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px">Back to the app</a>` : ''}
</div></body></html>`,
      status
    );

  const token = c.req.query('token');
  if (!token) return page('Invalid link', 'This unsubscribe link is missing its token.', 400);
  const res = await db.run(
    c.env.DB,
    'UPDATE users SET notifications_unsubscribed = 1 WHERE unsubscribe_token = ?',
    token
  );
  if (!res.meta.changes) {
    return page(
      'Link not recognized',
      'This unsubscribe link is invalid or was already replaced. If you keep receiving emails, disable reminders under Settings, Notifications.',
      400
    );
  }
  return page(
    'You are unsubscribed',
    'You will no longer receive reminder emails (spending reports and budget alerts). You can turn them back on any time under Settings, Notifications in the app.'
  );
});
