import { Hono, type Context } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId } from '../profile';
import { HttpError } from '../http';
import * as db from '../db';
import { sendMail } from '../email';
import { pendingEmailChange, requestEmailChange } from '../email-change';
import { escapeHtml, renderTestBasic } from '../emailTemplates';
import {
  composeReminderPreview,
  sendBillsRemindersForUser,
  sendBudgetAlertsForUser,
  sendSpendingReportForUser,
} from '../reminders';
import type { UserRow } from '../reminders';
import { enforce } from '../ratelimit';
import { getUserPlan, requireFeature } from '../plan';
import { planHasFeature } from '../plans';
import { localNow } from '../local-date';

// Email/reminder preferences + test/trigger/unsubscribe. Per-type prefs live in `settings`
// (email_notifications, email_budget_alerts, email_spending_report) on the active profile;
// the email address lives on the user. Mirrors backend/routes/notifications.js.
export const notificationsRoutes = new Hono<AppEnv>();

// GET — current email, a new one waiting to be confirmed (or null), the toggles for the
// active profile (each flag defaults ON), and whether the account unsubscribed by the link in a
// reminder mail (`unsubscribed`), which stops every reminder whatever the toggles say.
notificationsRoutes.get('/api/notifications/settings', requireAuth, async (c) => {
  const userId = c.get('userId');
  const pid = await getProfileId(c);
  const user = await db.first<{ email: string | null; notifications_unsubscribed: number | null }>(
    c.env.DB,
    'SELECT email, notifications_unsubscribed FROM users WHERE id = ?',
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
    pendingEmail: await pendingEmailChange(c.env.DB, userId),
    emailNotifications: flag('email_notifications'),
    budgetAlerts: flag('email_budget_alerts'),
    spendingReport: flag('email_spending_report'),
    billsReminders: flag('email_bills_reminders'),
    unsubscribed: !!user?.notifications_unsubscribed,
  });
});

// PUT — the toggles, and a new email. A different address does not replace the account's here:
// it is stored as a change waiting for that address to open the link mailed to it
// (email-change.ts), and the answer names it as `pendingEmail`. An address another account has is
// a 409, and a refused address refuses the whole save.
//
// A save with a reminder on (the master switch and at least one kind) also clears the account's
// unsubscribe by link: turning a reminder on in Settings is asking for reminder mails again. A save
// with every reminder off leaves it as it is, and so does a plan without email reminders, whose
// Settings page cannot save here.
notificationsRoutes.put('/api/notifications/settings', requireAuth, async (c) => {
  const userId = c.get('userId');
  const pid = await getProfileId(c);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  let pendingEmail: string | null = null;
  if (typeof b.email === 'string' && b.email.trim()) {
    const email = b.email.trim().toLowerCase();
    const user = await db.first<{ email: string | null; email_verified: number | null }>(
      c.env.DB,
      'SELECT email, email_verified FROM users WHERE id = ?',
      userId
    );
    if (email !== (user?.email ?? '').toLowerCase()) {
      const limited = await requestEmailChange(c, userId, email, {
        email: user?.email ?? null,
        confirmed: !!user?.email_verified,
      });
      if (limited) return limited;
      pendingEmail = email;
    }
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
  if ('billsReminders' in b) await set('email_bills_reminders', b.billsReminders);
  const remindersOn =
    !!b.emailNotifications && (!!b.budgetAlerts || !!b.spendingReport || !!b.billsReminders);
  if (remindersOn && planHasFeature(await getUserPlan(c), 'emailReminders')) {
    await db.run(c.env.DB, 'UPDATE users SET notifications_unsubscribed = 0 WHERE id = ?', userId);
  }
  return c.json(pendingEmail ? { ok: true, pendingEmail } : { ok: true });
});

// POST — send a test email to the user's own address. Optional body { type }:
//   "basic" (default) — plain connectivity check
//   "spending"        — the REAL periodic spending-report email, composed from your data
//   "budget"          — the REAL budget-alert email (threshold 0 so it always has content)
//   "bills"           — the REAL upcoming-bills email (bills due within a week)
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
  let mail = renderTestBasic({
    assetOrigin: c.env.CORS_ORIGIN || c.env.APP_ORIGINS?.split(',')[0] || undefined,
  });
  if (type === 'spending' || type === 'budget' || type === 'bills') {
    const preview = await composeReminderPreview(c.env, c.get('userId'), type, localNow(c));
    if (!preview) {
      throw new HttpError(
        400,
        type === 'spending'
          ? 'No spending data to build a report from yet'
          : type === 'bills'
            ? 'No bills due within the next week'
            : 'No budgets with spending to build an alert from yet'
      );
    }
    mail = preview;
  } else if (type !== 'basic') {
    throw new HttpError(
      400,
      'Unknown test email type (use "basic", "spending", "budget" or "bills")'
    );
  }

  const r = await sendMail(c.env, user.email, mail.subject, mail.html, {
    text: mail.text,
    listUnsubscribe: mail.listUnsubscribe,
  });
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
  else if (type === 'bills') sent = await sendBillsRemindersForUser(c.env, u);
  else throw new HttpError(400, 'Unknown reminder type (use "budget", "spending" or "bills")');
  return c.json({ ok: true, sent });
});

// ── Unsubscribe (public, no auth) ─────────────────────────────────────────────────────────────
// The link in a reminder mail's footer, and the List-Unsubscribe header (email.ts), point here
// with the account's unsubscribe token in the query string.
//
// GET only shows a page with one button and changes nothing: link scanners and previewers fetch
// every link in a mail, and an unsubscribe that ran on GET turned people's reminders off without
// them pressing anything. The button POSTs to the same URL, and so does a mail app's own
// unsubscribe button (RFC 8058 one-click: a form-encoded `List-Unsubscribe=One-Click` body, no
// cookie, from the mail provider's servers). The POST needs no session, CSRF token or CORS grant:
// the token is the credential, and a cross-site form post or a server-side request never asks the
// browser's CORS check. It is idempotent: a token whose account is already unsubscribed answers 200.

type UnsubscribeContext = Context<AppEnv>;

function unsubscribePage(
  c: UnsubscribeContext,
  title: string,
  body: string,
  opts: { status?: 200 | 400; action?: string } = {}
) {
  const appUrl = c.env.CORS_ORIGIN || '';
  const button = opts.action
    ? `<form method="post" action="${escapeHtml(opts.action)}">
<button type="submit" style="font:inherit;font-size:14px;font-weight:600;background:#4f6ef7;color:#fff;border:0;border-radius:8px;padding:10px 20px;cursor:pointer">Unsubscribe</button>
</form>`
    : appUrl
      ? `<a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#4f6ef7;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px">Back to the app</a>`
      : '';
  return c.html(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | Token Circles</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0b1020;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px">
<div style="max-width:420px;width:100%;background:#131a2e;border:1px solid #26304d;border-radius:12px;padding:32px;text-align:center">
<div style="font-weight:700;font-size:18px;margin-bottom:16px">Token Circles</div>
<h1 style="font-size:20px;margin:0 0 12px">${title}</h1>
<p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 20px">${body}</p>
${button}
</div></body></html>`,
    opts.status ?? 200
  );
}

const STILL_ARRIVES = 'Sign-in codes, password resets and billing mail still arrive.';

const missingToken = (c: UnsubscribeContext) =>
  unsubscribePage(c, 'Invalid link', 'This unsubscribe link is missing its token.', {
    status: 400,
  });

const unknownToken = (c: UnsubscribeContext) =>
  unsubscribePage(
    c,
    'Link not recognized',
    'This unsubscribe link is invalid or was already replaced. If you keep receiving emails, disable reminders under Settings, Notifications.',
    { status: 400 }
  );

const unsubscribedPage = (c: UnsubscribeContext) =>
  unsubscribePage(
    c,
    'You are unsubscribed',
    `Token Circles will not send this address any more reminder mails: no budget alerts, spending reports or bill reminders. ${STILL_ARRIVES} To get reminders again, turn one on in Settings, Email reminders, and save.`
  );

notificationsRoutes.get('/api/notifications/unsubscribe', async (c) => {
  const token = c.req.query('token');
  if (!token) return missingToken(c);
  const user = await db.first<{ notifications_unsubscribed: number | null }>(
    c.env.DB,
    'SELECT notifications_unsubscribed FROM users WHERE unsubscribe_token = ?',
    token
  );
  if (!user) return unknownToken(c);
  if (user.notifications_unsubscribed) return unsubscribedPage(c);
  return unsubscribePage(
    c,
    'Stop reminder mails?',
    `Press Unsubscribe to stop budget alerts, spending reports and bill reminders to this address. ${STILL_ARRIVES}`,
    { action: `/api/notifications/unsubscribe?token=${encodeURIComponent(token)}` }
  );
});

notificationsRoutes.post('/api/notifications/unsubscribe', async (c) => {
  const token = c.req.query('token');
  if (!token) return missingToken(c);
  // SQLite counts a row the WHERE matched as changed even when the flag was already 1, so an
  // account that is already unsubscribed still answers with the done page.
  const res = await db.run(
    c.env.DB,
    'UPDATE users SET notifications_unsubscribed = 1 WHERE unsubscribe_token = ?',
    token
  );
  if (!res.meta.changes) return unknownToken(c);
  return unsubscribedPage(c);
});
