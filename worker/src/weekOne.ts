/**
 * The week-one mails: at most two in a new account's first week, each only while its condition
 * holds, neither twice.
 *
 * - Day 2, only while nothing is imported: how to get a year of statements out of the bank.
 * - Day 7, only after an import: what the first week found, in counts. Never an amount.
 *
 * Who gets them: every account with a confirmed address, Free included. Local-first has no account
 * on the server and gets none. They are not reminders: no plan gates them and they do not count
 * against a plan's remindersPerMonth. They stop on the account's own switch (users.week_one_mails,
 * migration 0039, in Settings and behind each mail's stop link) and on the general unsubscribe
 * (users.notifications_unsubscribed).
 *
 * Day 0 is the instant the address was confirmed. Nothing else records it: the Welcome claim does,
 * the reminder_dedup row (user_id, 'welcome') that every way of confirming an address writes in the
 * same batch as the confirmation, and a Google sign-up at once (welcome.ts). Its sent_at is UTC,
 * and so is the window: the account stores no time zone, and the daily job at 08:00 UTC is morning
 * in Europe. An account with no Welcome claim, such as a Google account stored with no confirmed
 * address, has no day 0 and gets nothing.
 *
 * Each mail has a window of days rather than a day, so a run that was missed or failed is caught
 * up by the next one. The record that a mail went is a reminder_dedup row claimed before the send,
 * with the mail's condition in the same statement; the primary key makes a re-fired job find it
 * and skip. Migration 0040 claimed both for every account that existed before these mails, since
 * 0033 gave each of them a Welcome claim dated the day it ran.
 *
 * A duplicate is worse than a mail that never came (welcome.ts follows the same rule), so a claim
 * is given back only when Resend certainly refused the mail: a 4xx answer. Then the next run
 * retries it inside the window. A timeout, a network failure or a 5xx may have sent it, and the
 * claim stays. A 429 also ends this run; the rest go tomorrow, oldest first.
 */
import type { Env } from './index';
import { notWaitingForConfirmLinkSql } from './auth';
import * as db from './db';
import { oneClickUnsubscribeHeaders, sendMail } from './email';
import { renderWeekOneDay2, renderWeekOneDay7 } from './emailTemplates';
import type { RenderedEmail, WeekOneCounts, WeekOneStep } from './emailTemplates';
import { appOrigin, ensureUnsubToken, unsubscribeUrl } from './reminders';
import { WELCOME_KEY } from './welcome';
import { nextSteps } from '../../shared/orientation';
import {
  isTrackedMonth,
  trackedMonthsInYearWindow,
  YEAR_WINDOW_MONTHS,
} from '../../shared/trackedMonths';

/** The daily cron the mails go out on (wrangler.jsonc triggers.crons). */
export const WEEK_ONE_CRON = '0 8 * * *';

/** The `list` the stop link names, so the unsubscribe route stops these mails only. */
export const WEEK_ONE_LIST = 'week-one';

export type WeekOneMail = 'day2' | 'day7';

/**
 * Each mail: its reminder_dedup key, its window in whole days after day 0 (from inclusive, to
 * exclusive), and whether it needs an import (day 7) or the absence of one (day 2).
 */
export const WEEK_ONE: Record<
  WeekOneMail,
  { key: string; fromDays: number; toDays: number; imported: boolean }
> = {
  day2: { key: 'week-one:day2', fromDays: 2, toDays: 5, imported: false },
  day7: { key: 'week-one:day7', fromDays: 7, toDays: 10, imported: true },
};

/** The most mails of each kind one run sends. The rest wait for the next run, oldest first. */
export const WEEK_ONE_BATCH = 50;

/** An instant as SQLite's datetime('now') writes it: 'YYYY-MM-DD HH:MM:SS', UTC. */
const sqliteInstant = (date: Date) => date.toISOString().slice(0, 19).replace('T', ' ');

/** Whether account `userId` (an SQL expression) has a transaction that came in by an import. */
const importedSql = (userId: string) =>
  `EXISTS (SELECT 1 FROM profiles ip JOIN transactions it ON it.profile_id = ip.id
            WHERE ip.user_id = ${userId} AND it.import_id IS NOT NULL)`;

/** The condition a mail goes on, apart from its window and its record. */
const conditionSql = (mail: WeekOneMail, userId: string) =>
  `${WEEK_ONE[mail].imported ? '' : 'NOT '}${importedSql(userId)}`;

/** The stop link of the week-one mails: the unsubscribe route, for this list only. */
export function weekOneStopUrl(unsubToken: string | null, env: Env): string | null {
  const url = unsubscribeUrl(unsubToken, env);
  return url ? `${url}&list=${WEEK_ONE_LIST}` : null;
}

interface Candidate {
  id: number;
  email: string;
  unsubscribe_token: string | null;
}

/** The accounts `mail` is due to, at `now`: oldest day 0 first, at most `limit`. */
async function candidates(
  env: Env,
  mail: WeekOneMail,
  now: string,
  limit: number
): Promise<Candidate[]> {
  const { key, fromDays, toDays } = WEEK_ONE[mail];
  return db.all<Candidate>(
    env.DB,
    `SELECT u.id, u.email, u.unsubscribe_token
       FROM reminder_dedup w JOIN users u ON u.id = w.user_id
      WHERE w.dedup_key = '${WELCOME_KEY}'
        AND w.sent_at <= datetime(?, ?) AND w.sent_at > datetime(?, ?)
        AND u.email IS NOT NULL AND u.email != ''
        AND ${notWaitingForConfirmLinkSql('u')}
        AND u.notifications_unsubscribed = 0 AND u.week_one_mails = 1
        AND NOT EXISTS (SELECT 1 FROM reminder_dedup d WHERE d.user_id = u.id AND d.dedup_key = ?)
        AND ${conditionSql(mail, 'u.id')}
      ORDER BY w.sent_at, u.id
      LIMIT ?`,
    now,
    `-${fromDays} days`,
    now,
    `-${toDays} days`,
    key,
    limit
  );
}

/**
 * Claims `mail` for `userId` while the account still takes it: its switch on, not unsubscribed,
 * and the mail's condition true. One statement, so an import or a stop that lands between the
 * query and the send is seen. True only for the claim that wrote the row.
 */
async function claim(env: Env, mail: WeekOneMail, userId: number): Promise<boolean> {
  const res = await db.run(
    env.DB,
    `INSERT OR IGNORE INTO reminder_dedup (user_id, dedup_key)
     SELECT u.id, ? FROM users u
      WHERE u.id = ? AND u.week_one_mails = 1 AND u.notifications_unsubscribed = 0
        AND ${conditionSql(mail, 'u.id')}`,
    WEEK_ONE[mail].key,
    userId
  );
  return (res.meta.changes ?? 0) > 0;
}

async function release(env: Env, mail: WeekOneMail, userId: number): Promise<void> {
  await db.run(
    env.DB,
    'DELETE FROM reminder_dedup WHERE user_id = ? AND dedup_key = ?',
    userId,
    WEEK_ONE[mail].key
  );
}

/**
 * The day-7 mail's counts and next step, from the account's profile with the most imported
 * transactions (in week one nearly always its only one), so each count is what that profile's
 * Progress and Getting started show. Null when no profile holds an import.
 */
export async function weekOneDay7Content(
  env: Env,
  userId: number,
  today: string
): Promise<{ counts: WeekOneCounts; step: WeekOneStep | null } | null> {
  const profile = await db.first<{ id: number }>(
    env.DB,
    `SELECT t.profile_id AS id FROM transactions t JOIN profiles p ON p.id = t.profile_id
      WHERE p.user_id = ? AND t.import_id IS NOT NULL
      GROUP BY t.profile_id ORDER BY COUNT(*) DESC, t.profile_id LIMIT 1`,
    userId
  );
  if (!profile) return null;
  const pid = profile.id;
  const tx = await db.first<{ imported: number; entries: number; uncategorised: number }>(
    env.DB,
    `SELECT COALESCE(SUM(import_id IS NOT NULL), 0) AS imported,
            COALESCE(SUM(type != 'transfer'), 0) AS entries,
            COALESCE(SUM(type != 'transfer' AND category_id IS NULL), 0) AS uncategorised
       FROM transactions WHERE profile_id = ?`,
    pid
  );
  // A tracked month as shared/trackedMonths.ts defines one: enough transactions dated in it.
  const months = await db.all<{ month: string; n: number }>(
    env.DB,
    'SELECT substr(date, 1, 7) AS month, COUNT(*) AS n FROM transactions WHERE profile_id = ? GROUP BY month',
    pid
  );
  const tracked = months
    .filter((m) => /^\d{4}-\d{2}$/.test(m.month) && isTrackedMonth(m.n))
    .map((m) => m.month);
  const bills = await db.all<{ type: string; n: number }>(
    env.DB,
    'SELECT type, COUNT(*) AS n FROM bills WHERE profile_id = ? AND is_active = 1 GROUP BY type',
    pid
  );
  const loans = await db.first<{ n: number }>(
    env.DB,
    'SELECT COUNT(*) AS n FROM loans WHERE profile_id = ?',
    pid
  );
  const monthsTracked = trackedMonthsInYearWindow(tracked, today);
  const entries = tx?.entries ?? 0;
  const uncategorised = tx?.uncategorised ?? 0;
  // Getting started's rules, with what the Worker can count. The subscription scan, the month in
  // the red, the top category without a budget and the cushion are the app's own reads and do not
  // apply here, so the step is the first of the rest: in week one nearly always the year.
  const [first] = nextSteps({
    today,
    trackedMonthsInYear: monthsTracked,
    subscriptionsSpotted: 0,
    billsSpotted: 0,
    entries,
    uncategorised,
    topUnbudgeted: null,
    heavyMonth: null,
    loans: loans?.n ?? 0,
    cushionMonths: null,
    cushionAgainst: 'spending',
  });
  return {
    counts: {
      entriesImported: tx?.imported ?? 0,
      monthsTracked,
      windowMonths: YEAR_WINDOW_MONTHS,
      subscriptions: bills.find((b) => b.type === 'subscription')?.n ?? 0,
      bills: bills.find((b) => b.type === 'bill')?.n ?? 0,
      uncategorised,
    },
    step: first
      ? { title: first.title, reason: first.reason, hash: first.link.hash, label: first.link.label }
      : null,
  };
}

type Outcome = 'sent' | 'kept' | 'released' | 'stop';

/** Sends a claimed mail, and gives the claim back only when Resend certainly refused it. */
async function sendClaimedOnce(
  env: Env,
  mail: WeekOneMail,
  userId: number,
  to: string,
  rendered: RenderedEmail,
  stopUrl: string | null
): Promise<Outcome> {
  let result: Awaited<ReturnType<typeof sendMail>>;
  try {
    result = await sendMail(env, to, rendered.subject, rendered.html, {
      text: rendered.text,
      headers: stopUrl ? oneClickUnsubscribeHeaders(stopUrl) : undefined,
    });
  } catch (e) {
    // Timed out or the network failed: Resend may have taken it. Keep the claim.
    console.error(`[week-one] ${mail} for user ${userId} may not have gone:`, (e as Error).message);
    return 'kept';
  }
  if (result.sent) return 'sent';
  const refused = result.status !== undefined && result.status >= 400 && result.status < 500;
  if (result.skipped || refused) {
    await release(env, mail, userId);
    return result.status === 429 ? 'stop' : 'released';
  }
  console.error(`[week-one] ${mail} for user ${userId}: ${result.error ?? 'not sent'}, kept`);
  return 'kept';
}

/** Sends `mail` to the accounts it is due to. Returns how many went. Stops early on a 429. */
async function sendDue(
  env: Env,
  mail: WeekOneMail,
  now: Date,
  limit: number
): Promise<{ sent: number; stopped: boolean }> {
  const due = await candidates(env, mail, sqliteInstant(now), limit);
  const appUrl = appOrigin(env);
  const today = now.toISOString().slice(0, 10);
  let sent = 0;
  for (const account of due) {
    try {
      let rendered: RenderedEmail;
      const stopUrl = weekOneStopUrl(await ensureUnsubToken(env, account), env);
      if (mail === 'day2') {
        rendered = renderWeekOneDay2({ appUrl, unsubUrl: stopUrl });
      } else {
        const content = await weekOneDay7Content(env, account.id, today);
        if (!content) continue;
        rendered = renderWeekOneDay7({ ...content, appUrl, unsubUrl: stopUrl });
      }
      if (!(await claim(env, mail, account.id))) continue;
      const outcome = await sendClaimedOnce(
        env,
        mail,
        account.id,
        account.email,
        rendered,
        stopUrl
      );
      if (outcome === 'sent') sent += 1;
      if (outcome === 'stop') return { sent, stopped: true };
    } catch (e) {
      console.error(`[week-one] ${mail} failed for user ${account.id}:`, (e as Error).message);
    }
  }
  return { sent, stopped: false };
}

/**
 * The scheduled run: day 2 then day 7, on the daily cron only. Never throws. `now` and `limit`
 * are for tests.
 */
export async function runWeekOneMails(
  cron: string,
  env: Env,
  now: Date = new Date(),
  limit: number = WEEK_ONE_BATCH
): Promise<{ day2: number; day7: number }> {
  const sent = { day2: 0, day7: 0 };
  if (cron !== WEEK_ONE_CRON) return sent;
  try {
    const day2 = await sendDue(env, 'day2', now, limit);
    sent.day2 = day2.sent;
    if (day2.stopped) return sent;
    sent.day7 = (await sendDue(env, 'day7', now, limit)).sent;
  } catch (e) {
    console.error('[week-one] run failed:', (e as Error).message);
  }
  return sent;
}
