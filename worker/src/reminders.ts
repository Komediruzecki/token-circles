import type { Env } from './index';
import * as db from './db';
import { sendMail } from './email';
import { planHasFeature, planLimit } from './plans';
import {
  BRAND,
  renderBillsReminder,
  renderBudgetAlert,
  renderSpendingReport,
} from './emailTemplates';
import type { RenderedEmail, UpcomingBillRow } from './emailTemplates';

// Reminder emails (budget alerts + spending reports + upcoming bills), ported from
// backend/services/reminderService.js to async D1. The data queries stay faithful to the
// originals; the HTML now comes from the shared branded renderers (emailTemplates.ts).
// Gating requires the user's PLAN to include emailReminders (plans.ts). Per-type
// preferences live in `settings` (email_notifications + email_budget_alerts /
// email_spending_report / email_bills_reminders) on the user's primary profile.

// The unsubscribe endpoint lives on the API worker, NOT the SPA host — a link to
// the app origin lands on the static-asset fallback and never unsubscribes anyone.
// The app origin of THIS deployment — mail assets (logo, orbit GIF) load from
// here so a dev-sent mail never depends on a prod release shipping the asset.
function appOrigin(env: Env): string {
  return env.CORS_ORIGIN || env.APP_ORIGINS?.split(',')[0] || 'https://tokencircles.com';
}

function unsubscribeUrl(unsubToken: string | null, env: Env): string | null {
  const apiBase = env.API_PUBLIC_ORIGIN || env.CORS_ORIGIN || env.APP_ORIGINS?.split(',')[0] || '';
  return unsubToken && apiBase
    ? `${apiBase}/api/notifications/unsubscribe?token=${unsubToken}`
    : null;
}

// Reminder amounts render in the profile's display currency (settings.currency,
// written by the app's Settings page); EUR is the app-wide default.
async function profileCurrency(env: Env, profileId: number): Promise<string> {
  const row = await db.first<{ value: string }>(
    env.DB,
    "SELECT value FROM settings WHERE key = 'currency' AND profile_id = ?",
    profileId
  );
  return row?.value && /^[A-Za-z]{3}$/.test(row.value) ? row.value.toUpperCase() : 'EUR';
}

async function notifEnabled(env: Env, profileId: number, key: string): Promise<boolean> {
  const row = await db.first<{ value: string }>(
    env.DB,
    'SELECT value FROM settings WHERE key = ? AND profile_id = ?',
    key,
    profileId
  );
  return row?.value === 'true';
}
async function profileIdsForUser(env: Env, userId: number): Promise<number[]> {
  const rows = await db.all<{ id: number }>(
    env.DB,
    'SELECT id FROM profiles WHERE user_id = ? ORDER BY id',
    userId
  );
  return rows.map((r) => r.id);
}

export interface UserRow {
  id: number;
  email: string;
  plan: string | null;
  notifications_unsubscribed: number | null;
  unsubscribe_token: string | null;
}

// Lazily mint a per-user unsubscribe token (used in email footers) and persist it.
async function ensureUnsubToken(env: Env, u: UserRow): Promise<string> {
  if (u.unsubscribe_token) return u.unsubscribe_token;
  const token = crypto.randomUUID();
  await db.run(env.DB, 'UPDATE users SET unsubscribe_token = ? WHERE id = ?', token, u.id);
  u.unsubscribe_token = token;
  return token;
}

// ── Budget alerts ────────────────────────────────────────────────────────────
interface BudgetAlert {
  categoryName: string;
  categoryColor: string;
  budgetAmount: number;
  spent: number;
  percentage: number;
  status: 'over' | 'warning';
}

async function getBudgetAlerts(
  env: Env,
  profileId: number,
  threshold = 80,
  asOf?: Date
): Promise<BudgetAlert[]> {
  const now = asOf ?? new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().split('T')[0];
  const budgets = await db.all<{
    category_id: number | null;
    amount: number;
    category_name: string | null;
    category_color: string | null;
  }>(
    env.DB,
    `SELECT b.category_id, b.amount, c.name as category_name, c.color as category_color
     FROM budgets b LEFT JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
     WHERE b.profile_id = ? AND (b.end_date IS NULL OR b.end_date >= ?)`,
    profileId,
    monthStart
  );
  const spentRows = await db.all<{ category_id: number | null; total: number }>(
    env.DB,
    `SELECT category_id, SUM(COALESCE(amount_local, amount)) as total FROM transactions
     WHERE profile_id = ? AND type = 'expense' AND date >= ? AND date < ? GROUP BY category_id`,
    profileId,
    monthStart,
    monthEnd
  );
  const spentMap = new Map<number | null, number>();
  for (const r of spentRows) spentMap.set(r.category_id, Math.abs(r.total));

  const alerts: BudgetAlert[] = [];
  for (const b of budgets) {
    const spent = spentMap.get(b.category_id) || 0;
    const percentage = b.amount > 0 ? Math.round((spent / b.amount) * 100) : 0;
    if (percentage >= threshold) {
      alerts.push({
        categoryName: b.category_name || 'Uncategorized',
        categoryColor: b.category_color || '#6b7280',
        budgetAmount: b.amount,
        spent,
        percentage,
        status: percentage > 100 ? 'over' : 'warning',
      });
    }
  }
  return alerts.sort((a, b) => b.percentage - a.percentage);
}

// ── Spending report ──────────────────────────────────────────────────────────
async function getSpendingReport(env: Env, profileId: number, asOf?: Date) {
  const now = asOf ?? new Date();
  const endDate = now.toISOString().split('T')[0];
  const lastDayOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  const day = Math.min(now.getDate(), lastDayOfPrevMonth);
  const startDate = new Date(now.getFullYear(), now.getMonth() - 1, day)
    .toISOString()
    .split('T')[0];

  const income =
    (
      await db.first<{ total: number }>(
        env.DB,
        `SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE profile_id = ? AND type='income' AND date >= ? AND date <= ?`,
        profileId,
        startDate,
        endDate
      )
    )?.total || 0;
  const expenses =
    (
      await db.first<{ total: number }>(
        env.DB,
        `SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE profile_id = ? AND type='expense' AND date >= ? AND date <= ?`,
        profileId,
        startDate,
        endDate
      )
    )?.total || 0;
  const categoryBreakdown = await db.all<{
    name: string | null;
    color: string | null;
    total: number;
  }>(
    env.DB,
    `SELECT c.name, c.color, SUM(t.amount) as total FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
     WHERE t.profile_id = ? AND t.type='expense' AND t.date >= ? AND t.date <= ?
     GROUP BY c.id ORDER BY total DESC LIMIT 5`,
    profileId,
    startDate,
    endDate
  );
  const txCount =
    (
      await db.first<{ c: number }>(
        env.DB,
        `SELECT COUNT(*) as c FROM transactions WHERE profile_id = ? AND date >= ? AND date <= ?`,
        profileId,
        startDate,
        endDate
      )
    )?.c || 0;
  return {
    totalIncome: income,
    totalExpenses: expenses,
    netBalance: income - expenses,
    categoryBreakdown,
    transactionCount: txCount,
    startDate,
    endDate,
  };
}

// ── Per-user senders (plan + preference gated) ───────────────────────────────
function eligible(u: UserRow): boolean {
  return !!u.email && !u.notifications_unsubscribed && planHasFeature(u.plan, 'emailReminders');
}

// Monthly outbound-email quota (plans.ts remindersPerMonth; null = unlimited), tracked per
// user/month in reminder_sends. Check before sending, record on success.
async function withinQuota(env: Env, u: UserRow): Promise<boolean> {
  const limit = planLimit(u.plan, 'remindersPerMonth');
  if (limit === null) return true; // unlimited
  if (limit <= 0) return false;
  const ym = new Date().toISOString().slice(0, 7);
  const row = await db.first<{ count: number }>(
    env.DB,
    'SELECT count FROM reminder_sends WHERE user_id = ? AND year_month = ?',
    u.id,
    ym
  );
  return (row?.count ?? 0) < limit;
}
async function recordSend(env: Env, userId: number): Promise<void> {
  const ym = new Date().toISOString().slice(0, 7);
  await db.run(
    env.DB,
    'INSERT INTO reminder_sends (user_id, year_month, count) VALUES (?, ?, 1) ON CONFLICT(user_id, year_month) DO UPDATE SET count = count + 1',
    userId,
    ym
  );
}

// Atomically claim a one-time send slot for (user, key). Returns true only on the FIRST claim;
// a re-fired cron (or an over-matching schedule) gets false and skips the send, so the same
// report is never emailed twice for the same period. See migration 0007 (reminder_dedup).
async function claimReminderSlot(env: Env, userId: number, key: string): Promise<boolean> {
  const res = await db.run(
    env.DB,
    'INSERT INTO reminder_dedup (user_id, dedup_key) VALUES (?, ?) ON CONFLICT(user_id, dedup_key) DO NOTHING',
    userId,
    key
  );
  return (res.meta.changes ?? 0) > 0;
}

// Half-month period key for the spending report (fires on the 1st and 15th → H1 / H2).
function reportPeriodKey(): string {
  const now = new Date();
  return `report:${now.toISOString().slice(0, 7)}-H${now.getUTCDate() < 15 ? 1 : 2}`;
}

// Roll back a previously-claimed dedup slot (used when the send fails, so a transient error doesn't
// suppress that period's email until the next period).
async function releaseReminderSlot(env: Env, userId: number, key: string): Promise<void> {
  await db.run(
    env.DB,
    'DELETE FROM reminder_dedup WHERE user_id = ? AND dedup_key = ?',
    userId,
    key
  );
}

// Send an already-claimed reminder. Returns true only if it actually went out; on any failure (a
// Resend error or a thrown network error) it releases the dedup slot so the next cron fire retries
// instead of permanently skipping this period. Claim-before-send still prevents double-sends.
async function sendClaimed(
  env: Env,
  userId: number,
  dedupKey: string,
  to: string,
  mail: RenderedEmail
): Promise<boolean> {
  let sent = false;
  try {
    sent = (await sendMail(env, to, mail.subject, mail.html, { text: mail.text })).sent;
  } catch {
    sent = false;
  }
  if (!sent) await releaseReminderSlot(env, userId, dedupKey);
  return sent;
}

export async function sendBudgetAlertsForUser(env: Env, u: UserRow): Promise<boolean> {
  if (!eligible(u)) return false;
  const pids = await profileIdsForUser(env, u.id);
  if (pids.length === 0) return false;
  if (!(await notifEnabled(env, pids[0], 'email_notifications'))) return false;
  if (!(await notifEnabled(env, pids[0], 'email_budget_alerts'))) return false;

  const all: BudgetAlert[] = [];
  for (const pid of pids) all.push(...(await getBudgetAlerts(env, pid)));
  const seen = new Set<string>();
  const deduped = all
    .sort((a, b) => b.percentage - a.percentage)
    .filter((a) => (seen.has(a.categoryName) ? false : seen.add(a.categoryName) && true));
  const mail = renderBudgetAlert({
    alerts: deduped,
    currency: await profileCurrency(env, pids[0]),
    unsubUrl: unsubscribeUrl(await ensureUnsubToken(env, u), env),
    assetOrigin: appOrigin(env),
  });
  if (!mail) return false;
  if (!(await withinQuota(env, u))) return false;
  // Idempotent per calendar day so a same-day cron re-fire can't double-send. sendClaimed rolls the
  // claim back if the send fails, so a transient error doesn't suppress today's alert.
  const dedupKey = `budget:${new Date().toISOString().slice(0, 10)}`;
  if (!(await claimReminderSlot(env, u.id, dedupKey))) return false;
  if (!(await sendClaimed(env, u.id, dedupKey, u.email, mail))) return false;
  await recordSend(env, u.id);
  return true;
}

export async function sendSpendingReportForUser(env: Env, u: UserRow): Promise<boolean> {
  if (!eligible(u)) return false;
  const pids = await profileIdsForUser(env, u.id);
  if (pids.length === 0) return false;
  if (!(await notifEnabled(env, pids[0], 'email_notifications'))) return false;
  if (!(await notifEnabled(env, pids[0], 'email_spending_report'))) return false;

  const unsubUrl = unsubscribeUrl(await ensureUnsubToken(env, u), env);
  const periodKey = reportPeriodKey();
  for (const pid of pids) {
    const report = await getSpendingReport(env, pid);
    const mail = renderSpendingReport({
      report,
      currency: await profileCurrency(env, pid),
      unsubUrl,
      assetOrigin: appOrigin(env),
    });
    if (mail) {
      if (!(await withinQuota(env, u))) return false;
      // Idempotent per half-month period so a re-fired cron can't email the same report twice.
      if (!(await claimReminderSlot(env, u.id, periodKey))) return false;
      if (!(await sendClaimed(env, u.id, periodKey, u.email, mail))) return false;
      await recordSend(env, u.id);
      return true;
    }
  }
  return false;
}

// ── Upcoming bills (ported from the legacy bills reminder that never made it to the worker) ──
async function getUpcomingBills(
  env: Env,
  profileId: number,
  asOf?: Date
): Promise<UpcomingBillRow[]> {
  const bills = await db.all<{ name: string; amount: number; due_date: string | null }>(
    env.DB,
    "SELECT name, amount, due_date FROM bills WHERE profile_id = ? AND is_active = 1 AND type = 'bill'",
    profileId
  );
  const today = asOf ?? new Date();
  const upcoming: UpcomingBillRow[] = [];
  for (const bill of bills) {
    if (!bill.due_date) continue;
    const dueDate = new Date(bill.due_date);
    if (isNaN(dueDate.getTime())) continue;
    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) {
      upcoming.push({ ...bill, daysUntilDue: diffDays, overdue: true });
    } else if (diffDays <= 7) {
      upcoming.push({ ...bill, daysUntilDue: diffDays, overdue: false });
    }
  }
  return upcoming.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

export async function sendBillsRemindersForUser(env: Env, u: UserRow): Promise<boolean> {
  if (!eligible(u)) return false;
  const pids = await profileIdsForUser(env, u.id);
  if (pids.length === 0) return false;
  if (!(await notifEnabled(env, pids[0], 'email_notifications'))) return false;
  if (!(await notifEnabled(env, pids[0], 'email_bills_reminders'))) return false;

  const all: UpcomingBillRow[] = [];
  for (const pid of pids) all.push(...(await getUpcomingBills(env, pid)));
  const mail = renderBillsReminder({
    bills: all.sort((a, b) => a.daysUntilDue - b.daysUntilDue),
    currency: await profileCurrency(env, pids[0]),
    unsubUrl: unsubscribeUrl(await ensureUnsubToken(env, u), env),
    assetOrigin: appOrigin(env),
  });
  if (!mail) return false;
  if (!(await withinQuota(env, u))) return false;
  // Idempotent per calendar day: the daily cron re-firing can't double-send.
  const dedupKey = `bills:${new Date().toISOString().slice(0, 10)}`;
  if (!(await claimReminderSlot(env, u.id, dedupKey))) return false;
  if (!(await sendClaimed(env, u.id, dedupKey, u.email, mail))) return false;
  await recordSend(env, u.id);
  return true;
}

/**
 * Compose the REAL reminder email for a user without any of the sending guards
 * (prefs, quota, per-period dedup slots) — used by the test-email endpoint so the
 * actual layouts can be previewed on demand from Settings. Budget alerts use a
 * threshold of 0 here so the preview has content even when nothing is over 80%.
 * Returns null when the user's data produces no content at all.
 */
export async function composeReminderPreview(
  env: Env,
  userId: number,
  type: 'budget' | 'spending' | 'bills'
): Promise<RenderedEmail | null> {
  const u = await db.first<UserRow>(
    env.DB,
    'SELECT id, email, plan, notifications_unsubscribed, unsubscribe_token FROM users WHERE id = ?',
    userId
  );
  if (!u?.email) return null;
  const pids = await profileIdsForUser(env, u.id);
  if (pids.length === 0) return null;
  const unsubUrl = unsubscribeUrl(await ensureUnsubToken(env, u), env);
  const currency = await profileCurrency(env, pids[0]);

  // Anchor the preview to the user's LATEST transaction date (clamped to today). The
  // scheduled sends always use "now", but previews are usually fired against imported
  // history — computing the current calendar month would yield an empty report / an
  // all-0% alert when the data ends months earlier. (Bills are forward-looking, so the
  // bills preview always uses the real "now".)
  const inClause = pids.map(() => '?').join(',');
  const latest = await db.first<{ d: string | null }>(
    env.DB,
    `SELECT MAX(date) AS d FROM transactions WHERE profile_id IN (${inClause})`,
    ...pids
  );
  const now = new Date();
  let asOf = now;
  if (latest?.d) {
    const latestDate = new Date(latest.d);
    if (!isNaN(latestDate.getTime()) && latestDate < now) asOf = latestDate;
  }
  const periodLabel = asOf.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  if (type === 'spending') {
    for (const pid of pids) {
      const report = await getSpendingReport(env, pid, asOf);
      const mail = renderSpendingReport({
        report,
        currency,
        unsubUrl,
        periodLabel,
        test: true,
        assetOrigin: appOrigin(env),
      });
      if (mail) return mail;
    }
    return null;
  }

  if (type === 'bills') {
    const all: UpcomingBillRow[] = [];
    for (const pid of pids) all.push(...(await getUpcomingBills(env, pid)));
    return renderBillsReminder({
      bills: all.sort((a, b) => a.daysUntilDue - b.daysUntilDue),
      currency,
      unsubUrl,
      test: true,
      assetOrigin: appOrigin(env),
    });
  }

  const all: BudgetAlert[] = [];
  for (const pid of pids) all.push(...(await getBudgetAlerts(env, pid, 0, asOf)));
  const seen = new Set<string>();
  const deduped = all
    .sort((a, b) => b.percentage - a.percentage)
    .filter((a) => (seen.has(a.categoryName) ? false : seen.add(a.categoryName) && true));
  return renderBudgetAlert({
    alerts: deduped,
    currency,
    unsubUrl,
    periodLabel,
    test: true,
    assetOrigin: appOrigin(env),
  });
}

// ── Cron dispatch (scheduled handler) ────────────────────────────────────────
async function usersWithEmail(env: Env): Promise<UserRow[]> {
  return db.all<UserRow>(
    env.DB,
    `SELECT id, email, plan, notifications_unsubscribed, unsubscribe_token
     FROM users WHERE email IS NOT NULL AND email != ''`
  );
}

/** Dispatched by the cron expression that fired (see wrangler.jsonc triggers.crons). */
export async function runScheduledReminders(cron: string, env: Env): Promise<void> {
  const users = await usersWithEmail(env);
  const isBudget = cron === '0 9 * * 1';
  const isReport = cron === '0 10 1,15 * *';
  const isBills = cron === '0 8 * * *';
  for (const u of users) {
    try {
      if (isBudget) await sendBudgetAlertsForUser(env, u);
      else if (isReport) await sendSpendingReportForUser(env, u);
      else if (isBills) await sendBillsRemindersForUser(env, u);
    } catch (e) {
      console.error(`[reminder] failed for user ${u.id}:`, (e as Error).message);
    }
  }
}

// Each plan's `remindersPerMonth` (plans.ts) bounds outbound reminders; withinQuota/recordSend
// enforce it via the reminder_sends counter (null = unlimited). Free is 0 → never sends.
export const REMINDER_LIMIT = (plan: string | null) => planLimit(plan, 'remindersPerMonth');
