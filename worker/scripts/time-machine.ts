/**
 * The time machine: a new account's first week, lived in minutes on a local stack. This file is
 * its arithmetic and its SQL, with no I/O. frontend/tests/time-machine/harness.ts runs the SQL
 * through `wrangler d1 execute --local` for the E2E journey spec and the CLI an agent drives by
 * hand; test/time-machine.test.ts runs it against a real D1 built from the migrations.
 *
 * The frame: data back
 * --------------------
 * Every clock on a cloud account's first-week path stays the real one: the browser's, the Worker's
 * at request time, SQLite's datetime('now'), and the daily job's, which the harness fires at the
 * real now. What moves is the account. "Day N" moves every instant its own use wrote back, by one
 * and the same number of seconds, so that day 0 (the Welcome claim in reminder_dedup, the confirm
 * instant) lies N days before now. Every reader then compares two values on one clock: the week-one
 * windows (weekOne.ts candidates), Settings' switch (weekOneAhead), the badges' months (import
 * logs, budgets, goals), the first-week counts.
 *
 * The move is computed from day 0 as stored, never added up, so asking for day 2 twice moves the
 * account once. It goes forward only. It is one D1 batch, which is atomic, and every statement in
 * it checks that day 0 still holds the value the move was computed from: a move computed from a
 * stale read, or sent twice, changes nothing.
 *
 * What is not moved
 * -----------------
 * - KEPT: the instants that are not the account's use of the app: its sessions, tokens, links,
 *   sign-in codes, passkeys, rate limits and logs, and Stripe's dates. They keep their real time,
 *   so a moved account stays signed in and its limits stay as they are.
 * - CHOSEN: the dates a person or their bank chose: a transaction's date, a budget's month, a
 *   bill's due day. They are not instants of use, and a date cannot be re-keyed: a budget made "for
 *   this month" on day 0 stays on that month. So the calendar does not turn: on day 7 the app's
 *   today and the day-7 mail's today are the real today. A week that crosses a month end is not
 *   simulated in the cloud; local-first can, with Playwright's page.clock.
 *
 * test/time-machine.test.ts fails when a migration adds a time column that none of the three lists
 * names, so a new one cannot be left on the other clock by default.
 */

export const DAY_SECONDS = 86_400;

/** The reminder_dedup key whose sent_at is an account's day 0 (worker/src/welcome.ts). */
export const DAY_ZERO_KEY = 'welcome';

/** The daily job's cron, which runs the week-one mails (worker/src/weekOne.ts WEEK_ONE_CRON). */
export const DAILY_CRON = '30 8 * * *';

/**
 * The week-one mails as worker/src/weekOne.ts WEEK_ONE has them: each one's claim key and its
 * window in days after day 0 (from inclusive, to exclusive). test/time-machine.test.ts pins the
 * two together; this copy exists because that module cannot load under plain Node.
 */
export const MAILS = {
  day2: { key: 'week-one:day2', fromDays: 2, toDays: 5, imported: false },
  day7: { key: 'week-one:day7', fromDays: 7, toDays: 10, imported: true },
} as const;

export type Mail = keyof typeof MAILS;

/** How a table's rows belong to an account. */
type Owner = 'self' | 'user' | 'profile' | 'account';

/**
 * The instants an account's own use writes, every one moved by the same seconds. reminder_dedup
 * comes last: it holds day 0, which every statement checks before it moves anything.
 */
export const MOVED: ReadonlyArray<{ table: string; owner: Owner; columns: readonly string[] }> = [
  { table: 'users', owner: 'self', columns: ['created_at'] },
  { table: 'profiles', owner: 'user', columns: ['created_at'] },
  { table: 'user_state', owner: 'user', columns: ['updated_at'] },
  { table: 'custom_reports', owner: 'user', columns: ['created_at', 'updated_at'] },
  { table: 'accounts', owner: 'profile', columns: ['created_at'] },
  { table: 'account_balance_history', owner: 'account', columns: ['recorded_at'] },
  { table: 'bills', owner: 'profile', columns: ['created_at'] },
  { table: 'budgets', owner: 'profile', columns: ['created_at'] },
  { table: 'budgets_zero_based', owner: 'profile', columns: ['created_at'] },
  { table: 'categories', owner: 'profile', columns: ['created_at'] },
  { table: 'category_mappings', owner: 'profile', columns: ['created_at'] },
  { table: 'housings', owner: 'profile', columns: ['created_at'] },
  { table: 'import_logs', owner: 'profile', columns: ['created_at'] },
  {
    table: 'import_sources',
    owner: 'profile',
    columns: ['created_at', 'updated_at', 'last_synced_at'],
  },
  { table: 'loans', owner: 'profile', columns: ['created_at'] },
  { table: 'portfolio_holdings', owner: 'profile', columns: ['created_at', 'updated_at'] },
  { table: 'receipts', owner: 'profile', columns: ['uploaded_at'] },
  { table: 'recurring_transactions', owner: 'profile', columns: ['created_at'] },
  { table: 'retirement_goals', owner: 'profile', columns: ['created_at'] },
  { table: 'savings_goals', owner: 'profile', columns: ['created_at'] },
  { table: 'tag_rules', owner: 'profile', columns: ['created_at'] },
  { table: 'tags', owner: 'profile', columns: ['created_at'] },
  {
    table: 'transactions',
    owner: 'profile',
    columns: ['created_at', 'updated_at', 'reconciled_at'],
  },
  { table: 'reminder_dedup', owner: 'user', columns: ['sent_at'] },
];

/** Instants that keep their real time when an account moves, by table, and why. */
export const KEPT: Readonly<Record<string, { columns: readonly string[]; why: string }>> = {
  auth_sessions: { columns: ['created_at', 'last_seen_at'], why: 'a session' },
  api_tokens: {
    columns: ['created_at', 'last_used_at', 'expires_at', 'revoked_at'],
    why: 'a way in',
  },
  webauthn_credentials: { columns: ['created_at', 'last_used_at'], why: 'a passkey' },
  totp_credentials: { columns: ['created_at', 'confirmed_at'], why: 'two-step sign-in' },
  recovery_codes: { columns: ['created_at', 'used_at'], why: 'two-step sign-in' },
  email_verifications: { columns: ['created_at', 'expires_at', 'used_at'], why: 'a mailed link' },
  password_resets: { columns: ['created_at', 'expires_at', 'used_at'], why: 'a mailed link' },
  login_codes: { columns: ['created_at', 'expires_at', 'used_at'], why: 'a sign-in code' },
  rate_limits: { columns: ['reset_at'], why: 'a limit' },
  auth_logs: { columns: ['created_at'], why: 'the sign-in log, swept by age' },
  error_logs: { columns: ['created_at'], why: 'a log' },
  stripe_events: { columns: ['processed_at'], why: "Stripe's record, not the account's" },
  users: { columns: ['plan_renews_at', 'stripe_event_at'], why: "Stripe's dates" },
  sessions: { columns: ['expire'], why: 'the retired server table, which nothing reads' },
};

/** Dates a person or their bank chose. Never moved: a date cannot be re-keyed. */
export const CHOSEN: Readonly<Record<string, readonly string[]>> = {
  transactions: ['date'],
  accounts: ['starting_date'],
  bills: ['day_of_month', 'due_date', 'next_due_date', 'last_paid', 'last_paid_date'],
  budgets: ['start_date', 'end_date'],
  budgets_zero_based: ['month'],
  housings: ['due_date'],
  loans: ['start_date'],
  loan_prepayments: ['month'],
  loan_rate_periods: ['start_month', 'end_month'],
  portfolio_holdings: ['purchase_date'],
  recurring_transactions: ['day_of_month', 'next_date'],
  retirement_goals: ['deadline'],
  savings_goals: ['deadline', 'tracking_start_date'],
  // A reminder quota's month: a period, as a budget's month is.
  reminder_sends: ['year_month'],
};

/** An instant as SQLite's datetime('now') writes it, as day 0 is stored. */
const SQLITE_INSTANT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** Day 0 as stored, to milliseconds since the epoch. */
export function instantMs(stored: string): number {
  if (!SQLITE_INSTANT.test(stored)) throw new Error(`not an instant as D1 stores one: ${stored}`);
  return Date.parse(`${stored.replace(' ', 'T')}Z`);
}

/** How old an account whose day 0 is `dayZero` is at `nowMs`, in whole seconds. */
export function ageSeconds(dayZero: string, nowMs: number): number {
  return Math.floor((nowMs - instantMs(dayZero)) / 1000);
}

/**
 * The age "day N" names, in seconds. Without `at`, N whole days after day 0, at day 0's own time
 * of day. With `at` ('HH:MM', UTC), that time on the Nth calendar day (UTC) after day 0's: `day 2
 * at 08:30` is where the 08:30 daily job finds the account on its second morning, which for an
 * address confirmed in the afternoon is still short of two whole days.
 */
export function targetSeconds(dayZero: string, day: number, at?: string): number {
  const zero = instantMs(dayZero);
  if (!Number.isFinite(day) || day < 0) throw new Error(`day must be 0 or more: ${day}`);
  if (at === undefined) return Math.round(day * DAY_SECONDS);
  const time = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(at);
  if (!time) throw new Error(`at must be HH:MM, UTC: ${at}`);
  if (!Number.isInteger(day)) throw new Error('a day with a time of day must be a whole day');
  const midnight = Date.UTC(
    new Date(zero).getUTCFullYear(),
    new Date(zero).getUTCMonth(),
    new Date(zero).getUTCDate()
  );
  const target =
    midnight + day * DAY_SECONDS * 1000 + (Number(time[1]) * 60 + Number(time[2])) * 60_000;
  const seconds = Math.round((target - zero) / 1000);
  if (seconds < 0) throw new Error(`day ${day} at ${at} UTC is before day 0 (${dayZero} UTC)`);
  return seconds;
}

/**
 * How many seconds to move an account `age` seconds old so that it is `target` old. Zero when it
 * is there already, or a little past it (time went by since the last move). Refused when getting
 * there would mean going back a day or more: the week only moves forward, as days do, so a fresh
 * account is the way to live it again.
 */
export function moveBy(age: number, target: number): number {
  if (target >= age) return target - age;
  if (age - target < DAY_SECONDS) return 0;
  throw new Error(
    `the account is on day ${(age / DAY_SECONDS).toFixed(2)}, past day ` +
      `${(target / DAY_SECONDS).toFixed(2)}: the week only moves forward. Sign up a new account to start again.`
  );
}

const ownedBy = (owner: Owner, userId: number): string => {
  switch (owner) {
    case 'self':
      return `id = ${userId}`;
    case 'user':
      return `user_id = ${userId}`;
    case 'profile':
      return `profile_id IN (SELECT id FROM profiles WHERE user_id = ${userId})`;
    case 'account':
      return `account_id IN (SELECT a.id FROM accounts a JOIN profiles p ON p.id = a.profile_id WHERE p.user_id = ${userId})`;
  }
};

/**
 * `column` moved `seconds` earlier, in the form it is stored in: an ISO string (what a Worker's
 * toISOString() writes) stays one, SQLite's 'YYYY-MM-DD HH:MM:SS' stays that, a bare date stays a
 * date, and a value that is no instant at all, NULL included, stays exactly as it is.
 */
const movedBack = (column: string, seconds: number): string =>
  `CASE WHEN ${column} IS NULL OR datetime(${column}) IS NULL THEN ${column} ` +
  `WHEN ${column} LIKE '____-__-__T%' THEN strftime('%Y-%m-%dT%H:%M:%fZ', ${column}, '-${seconds} seconds') ` +
  `WHEN length(${column}) = 10 THEN date(${column}, '-${seconds} seconds') ` +
  `ELSE datetime(${column}, '-${seconds} seconds') END`;

/**
 * The statements that move account `userId` `seconds` back, computed from day 0 read as `dayZero`.
 * Run them as one batch. Each changes nothing unless day 0 still reads `dayZero`, and day 0 itself
 * moves in the last one (reminder_dedup is last in MOVED), so a batch that runs twice, or one
 * computed from a stale read, moves nothing.
 */
export function moveStatements(userId: number, seconds: number, dayZero: string): string[] {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error(`not an account id: ${userId}`);
  if (!Number.isInteger(seconds) || seconds <= 0) throw new Error(`not a move: ${seconds}`);
  instantMs(dayZero);
  const stillThere =
    `EXISTS (SELECT 1 FROM reminder_dedup z WHERE z.user_id = ${userId} ` +
    `AND z.dedup_key = '${DAY_ZERO_KEY}' AND z.sent_at = '${dayZero}')`;
  return MOVED.map(({ table, owner, columns }) => {
    const set = columns.map((c) => `${c} = ${movedBack(c, seconds)}`).join(', ');
    return `UPDATE ${table} SET ${set} WHERE ${ownedBy(owner, userId)} AND ${stillThere}`;
  });
}

/** An address as an SQL literal, for addresses an E2E run or a person typed. */
function addressLiteral(email: string): string {
  if (!/^[^\s'"\\;]+@[^\s'"\\;]+$/.test(email)) throw new Error(`not an address: ${email}`);
  return `'${email.toLowerCase()}'`;
}

/** What weekRow reads. */
export interface WeekRow {
  id: number;
  email: string;
  auth_provider: string;
  email_verified: number;
  week_one_mails: number;
  notifications_unsubscribed: number;
  created_at: string;
  day_zero: string | null;
  day2_sent: string | null;
  day7_sent: string | null;
  imported: number;
}

/** The account at `email` and everything its first week turns on, as one row. */
export function weekRowSql(email: string): string {
  const sent = (key: string) =>
    `(SELECT sent_at FROM reminder_dedup WHERE user_id = u.id AND dedup_key = '${key}')`;
  return (
    'SELECT u.id, u.email, u.auth_provider, u.email_verified, u.week_one_mails, ' +
    'u.notifications_unsubscribed, u.created_at, ' +
    `${sent(DAY_ZERO_KEY)} AS day_zero, ${sent(MAILS.day2.key)} AS day2_sent, ` +
    `${sent(MAILS.day7.key)} AS day7_sent, ` +
    'EXISTS (SELECT 1 FROM profiles p JOIN transactions t ON t.profile_id = p.id ' +
    'WHERE p.user_id = u.id AND t.import_id IS NOT NULL) AS imported ' +
    `FROM users u WHERE lower(u.email) = ${addressLiteral(email)}`
  );
}

/** Where an account is in its first week, in words a person reads, and as values a spec checks. */
export interface WeekState {
  email: string;
  /** Day 0 as stored (UTC), or null before the address is confirmed. */
  dayZero: string | null;
  /** Days since day 0, or null without one. */
  day: number | null;
  /** Whether Settings shows the first-week switch (weekOne.ts weekOneAhead). */
  settingsSwitch: boolean;
  mails: Record<Mail, string>;
}

/** What the next daily job would do for each mail, and what already happened, at `nowMs`. */
export function describeWeek(row: WeekRow, nowMs: number): WeekState {
  const waiting = row.auth_provider === 'password' && !row.email_verified;
  const age = row.day_zero === null ? null : ageSeconds(row.day_zero, nowMs);
  const mail = (name: Mail): string => {
    const { fromDays, toDays, imported } = MAILS[name];
    const sent = name === 'day2' ? row.day2_sent : row.day7_sent;
    if (sent) {
      const on =
        age === null
          ? ''
          : `, day ${((instantMs(sent) - instantMs(row.day_zero!)) / 86_400_000).toFixed(2)}`;
      return `went at ${sent} UTC${on}`;
    }
    if (age === null) return 'no day 0 yet: the address is not confirmed';
    if (waiting) return 'waits for the confirm link';
    if (row.notifications_unsubscribed) return 'stopped: unsubscribed from reminder mails';
    if (!row.week_one_mails) return 'stopped: first-week mails are off';
    if (age < fromDays * DAY_SECONDS) return `not yet: due from day ${fromDays}`;
    if (age >= toDays * DAY_SECONDS) return `never: its window closed on day ${toDays}`;
    if (imported && !row.imported) return 'not due: it waits for an import';
    if (!imported && row.imported) return 'not due: the account has an import';
    return 'due: the next daily job sends it';
  };
  return {
    email: row.email,
    dayZero: row.day_zero,
    day: age === null ? null : Math.floor((age / DAY_SECONDS) * 100) / 100,
    settingsSwitch: age !== null && age < MAILS.day7.toDays * DAY_SECONDS && row.day7_sent === null,
    mails: { day2: mail('day2'), day7: mail('day7') },
  };
}
