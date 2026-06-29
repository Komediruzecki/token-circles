import type { Env } from './index';
import * as db from './db';
import { sendMail } from './email';
import { planHasFeature, planLimit } from './plans';

// Reminder emails (budget alerts + spending report), ported from
// backend/services/reminderService.js to async D1. Queries + HTML are faithful to the
// originals; gating now also requires the user's PLAN to include emailReminders (plans.ts).
// Per-type preferences live in `settings` (email_notifications + email_budget_alerts /
// email_spending_report) on the user's primary profile, exactly as before.

const BRAND = 'Token Circles';

function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function sanitizeColor(color: unknown): string {
  return /^#[0-9a-fA-F]{6}$/.test(String(color ?? '')) ? String(color) : '#6b7280';
}

function footer(label: string, unsubToken: string | null, env: Env): string {
  const base = env.CORS_ORIGIN || env.APP_ORIGINS?.split(',')[0] || '';
  const unsub =
    unsubToken && base
      ? ` · <a href="${base}/api/notifications/unsubscribe?token=${unsubToken}" style="color:#6b7280">unsubscribe</a>`
      : '';
  return `<p style="color:#6b7280;margin-top:24px;font-size:12px">${escapeHtml(BRAND)} — ${escapeHtml(label)}${unsub}</p>`;
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
  threshold = 80
): Promise<BudgetAlert[]> {
  const now = new Date();
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

function budgetAlertHtml(
  alerts: BudgetAlert[],
  unsubToken: string | null,
  env: Env
): string | null {
  if (alerts.length === 0) return null;
  const rows = alerts
    .map(
      (a) => `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee">
        <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${sanitizeColor(a.categoryColor)};margin-right:8px"></span>
        ${escapeHtml(a.categoryName)}
      </td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">$${(a.budgetAmount || 0).toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">$${(a.spent || 0).toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;color:${a.status === 'over' ? '#ef4444' : '#f59e0b'}">${a.status === 'over' ? 'OVER' : a.percentage + '%'}</td>
    </tr>`
    )
    .join('');
  const desc = alerts.some((a) => a.status === 'over')
    ? 'The following budgets have exceeded their limit:'
    : 'The following budgets are approaching their limit (80%+ used):';
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
    <h2 style="color:#1f2937">Budget Alert</h2>
    <p>${desc}</p>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f3f4f6">
        <th style="padding:8px;text-align:left">Category</th>
        <th style="padding:8px;text-align:right">Budget</th>
        <th style="padding:8px;text-align:right">Spent</th>
        <th style="padding:8px;text-align:right">Status</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${footer('Budget Alerts', unsubToken, env)}
  </body></html>`;
}

// ── Spending report ──────────────────────────────────────────────────────────
async function getSpendingReport(env: Env, profileId: number) {
  const now = new Date();
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

function spendingReportHtml(
  report: Awaited<ReturnType<typeof getSpendingReport>>,
  unsubToken: string | null,
  env: Env
): string | null {
  if (report.transactionCount === 0) return null;
  const categories = report.categoryBreakdown
    .map(
      (c) => `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee">
        <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${sanitizeColor(c.color || '#6b7280')};margin-right:8px"></span>
        ${escapeHtml(c.name || 'Uncategorized')}
      </td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">$${(c.total || 0).toFixed(2)}</td>
    </tr>`
    )
    .join('');
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
    <h2 style="color:#1f2937">Spending Report</h2>
    <p>${escapeHtml(report.startDate)} to ${escapeHtml(report.endDate)}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <tr><td style="padding:8px">Total Income</td><td style="padding:8px;text-align:right;color:#10b981">$${(report.totalIncome || 0).toFixed(2)}</td></tr>
      <tr><td style="padding:8px">Total Expenses</td><td style="padding:8px;text-align:right;color:#ef4444">$${(report.totalExpenses || 0).toFixed(2)}</td></tr>
      <tr style="font-weight:bold"><td style="padding:8px;border-top:2px solid #1f2937">Net</td><td style="padding:8px;text-align:right;border-top:2px solid #1f2937">$${(report.netBalance || 0).toFixed(2)}</td></tr>
    </table>
    <h3>Top Spending Categories</h3>
    <table style="width:100%;border-collapse:collapse"><tbody>${categories || '<tr><td>No spending data</td></tr>'}</tbody></table>
    <p style="color:#6b7280;margin-top:8px">${report.transactionCount} transactions</p>
    ${footer('Spending Report', unsubToken, env)}
  </body></html>`;
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
  subject: string,
  html: string
): Promise<boolean> {
  let sent = false;
  try {
    sent = (await sendMail(env, to, subject, html)).sent;
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
  const html = budgetAlertHtml(deduped, await ensureUnsubToken(env, u), env);
  if (!html) return false;
  if (!(await withinQuota(env, u))) return false;
  // Idempotent per calendar day so a same-day cron re-fire can't double-send. sendClaimed rolls the
  // claim back if the send fails, so a transient error doesn't suppress today's alert.
  const dedupKey = `budget:${new Date().toISOString().slice(0, 10)}`;
  if (!(await claimReminderSlot(env, u.id, dedupKey))) return false;
  if (!(await sendClaimed(env, u.id, dedupKey, u.email, `Budget alert — ${BRAND}`, html)))
    return false;
  await recordSend(env, u.id);
  return true;
}

export async function sendSpendingReportForUser(env: Env, u: UserRow): Promise<boolean> {
  if (!eligible(u)) return false;
  const pids = await profileIdsForUser(env, u.id);
  if (pids.length === 0) return false;
  if (!(await notifEnabled(env, pids[0], 'email_notifications'))) return false;
  if (!(await notifEnabled(env, pids[0], 'email_spending_report'))) return false;

  const token = await ensureUnsubToken(env, u);
  const periodKey = reportPeriodKey();
  for (const pid of pids) {
    const report = await getSpendingReport(env, pid);
    const html = spendingReportHtml(report, token, env);
    if (html) {
      if (!(await withinQuota(env, u))) return false;
      // Idempotent per half-month period so a re-fired cron can't email the same report twice.
      if (!(await claimReminderSlot(env, u.id, periodKey))) return false;
      if (
        !(await sendClaimed(env, u.id, periodKey, u.email, `Your spending report — ${BRAND}`, html))
      )
        return false;
      await recordSend(env, u.id);
      return true;
    }
  }
  return false;
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
  for (const u of users) {
    try {
      if (isBudget) await sendBudgetAlertsForUser(env, u);
      else if (isReport) await sendSpendingReportForUser(env, u);
    } catch (e) {
      console.error(`[reminder] failed for user ${u.id}:`, (e as Error).message);
    }
  }
}

// Each plan's `remindersPerMonth` (plans.ts) bounds outbound reminders; withinQuota/recordSend
// enforce it via the reminder_sends counter (null = unlimited). Free is 0 → never sends.
export const REMINDER_LIMIT = (plan: string | null) => planLimit(plan, 'remindersPerMonth');
