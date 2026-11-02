/**
 * The first-week counts: what the accounts that signed up in a window did in their first day and
 * their first week, read from tables the Worker already has. Counts only, never an address, a name
 * or an id. first-week-counts.ts runs the query through wrangler and prints the table;
 * test/first-week-counts.test.ts runs it against a real D1.
 *
 * Only cloud accounts are counted: local-first keeps everything in the browser and never reaches
 * the server.
 *
 * The clock
 * ---------
 * Day 0 is users.created_at, the sign-up instant, in UTC like every timestamp the Worker writes.
 * "Within a day" is from that instant to 24 hours (86,400 s) after it, both ends included;
 * "within a week" is the same up to 7 days (604,800 s). A row dated before the sign-up, such as
 * one restored from a backup with the date it was first made, is not counted. Timestamps are
 * compared with unixepoch(), which reads both forms the tables hold: SQLite's 'YYYY-MM-DD HH:MM:SS'
 * and an ISO string ending in Z.
 *
 * The cohort is every account whose created_at falls on a day from --from to --to, both included.
 *
 * What each count reads
 * ---------------------
 * - Sign-ups: users, by created_at; with a password or with Google by auth_provider.
 * - Confirmed the address within a day: reminder_dedup (user_id, 'welcome').sent_at. The Welcome
 *   claim is the one record of when an address was confirmed: every way of confirming writes it in
 *   the same batch, and a Google sign-up writes it at once (worker/src/welcome.ts, and weekOne.ts,
 *   which counts its day 0 from the same row). Migration 0033 dated the claim of every account
 *   that existed when it ran to that moment, so for an account older than 0033 the claim says when
 *   0033 ran, not when it confirmed. This count, and its share, are therefore only of the accounts
 *   made after 0033 ran, which is d1_migrations.applied_at for '0033_welcome_once.sql':
 *   `wrangler d1 migrations apply` writes that row in the same request as the migration, as the
 *   test pool's applyD1Migrations does. A database with no such row counts no account here. An
 *   account made after 0033 but before the code that writes the claim was deployed (minutes, on a
 *   deploy) has a claim only if it confirmed after that deploy.
 * - Imported within a day / a week: import_logs.created_at, through profiles.user_id. The client
 *   writes one log after each import that went through.
 *
 * The next steps are not stored: Getting started (shared/orientation.ts, `nextSteps`) and Your
 * next step (shared/guidance/nextStep.ts, `nextStepOf`) derive them from the data each time. A
 * step counts as taken when the row it asks for appears within the week, in any of the account's
 * profiles:
 *
 * | Step ids                                                  | Read from                         |
 * | --------------------------------------------------------- | --------------------------------- |
 * | import-year, year-on-file                                 | import_logs.created_at            |
 * | review-subscriptions                                      | bills.created_at                  |
 * | sort-uncategorised, sorted                                | transactions.updated_at (1)       |
 * | budget-top-category, own-income                           | budgets.created_at, and           |
 * |                                                           | budgets_zero_based.created_at     |
 * | cushion, first-cushion, yearly-bills (set aside),         | savings_goals.created_at          |
 * | solid-cushion, full-cushion, two-years                    |                                   |
 * | first-cushion's "add the accounts your money is in", and  | accounts.created_at (2)           |
 * | no-expensive-debt's "add the rate" (both on Accounts)     |                                   |
 * | heavy-month (look at the month on Transactions)           | not recorded: a page view         |
 * | loan-payoff, no-expensive-debt (compare on Loans)         | not recorded: a page view         |
 * | the questions: card, yearly-bills, free-money, enough     | not recorded (3)                  |
 * | work-optional (the withdrawal rate on Retirement)         | not recorded (3)                  |
 *
 * (1) An entry that has a category and was edited after it was entered: updated_at later than
 *     created_at, inside the week. Any edit of such an entry counts, not only its category, and an
 *     entry edited again after the week keeps only that later date, so this is a close reading,
 *     not an exact one.
 * (2) Added by hand: an account an import made is left out, by its name among the
 *     details.created_accounts of the profile's import logs. The setup wizard's accounts count.
 * (3) Answers and the rate live in the profile's settings, which keep no date.
 *
 * Budgets an import fills in when the person ticks that option count as budgets set.
 *
 * Prints pressed: nothing records a print, so the line says "not recorded".
 */

export const DAY_SECONDS = 86_400;
export const WEEK_SECONDS = 7 * DAY_SECONDS;
/** The window read when none is given: the last 28 days, today included. */
export const DEFAULT_WINDOW_DAYS = 28;

/** The window: sign-up days from `from` to `to` (YYYY-MM-DD, UTC, both included), read at `now`. */
export interface FirstWeekWindow {
  from: string;
  to: string;
  /** 'YYYY-MM-DD HH:MM:SS', UTC: the instant the counts are read, for the weeks still open. */
  now: string;
}

export interface FirstWeekCounts {
  signups: number;
  signupsPassword: number;
  signupsGoogle: number;
  /** Made after migration 0033 ran: the accounts whose Welcome claim means they confirmed. */
  signupsAfter0033: number;
  /** Of signupsAfter0033 only. */
  confirmedInDay: number;
  importedInDay: number;
  importedInWeek: number;
  /** Signed up less than a day before `now`: their first day is still open. */
  insideFirstDay: number;
  /** Signed up less than a week before `now`: their first week is still open. */
  insideFirstWeek: number;
  billInWeek: number;
  sortInWeek: number;
  budgetInWeek: number;
  goalInWeek: number;
  accountInWeek: number;
  /** Took at least one of the steps above, an import included, within the week. */
  anyStepInWeek: number;
}

/** Each count and the column the query names it by. */
const COLUMNS: Record<keyof FirstWeekCounts, string> = {
  signups: 'signups',
  signupsPassword: 'signups_password',
  signupsGoogle: 'signups_google',
  signupsAfter0033: 'signups_after_0033',
  confirmedInDay: 'confirmed_in_day',
  importedInDay: 'imported_in_day',
  importedInWeek: 'imported_in_week',
  insideFirstDay: 'inside_first_day',
  insideFirstWeek: 'inside_first_week',
  billInWeek: 'bill_in_week',
  sortInWeek: 'sort_in_week',
  budgetInWeek: 'budget_in_week',
  goalInWeek: 'goal_in_week',
  accountInWeek: 'account_in_week',
  anyStepInWeek: 'any_step_in_week',
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** Whether `date` is a real calendar day written YYYY-MM-DD. */
export function isDate(date: string): boolean {
  if (!DATE.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/** `ts` (a column) between the sign-up and `seconds` after it, both ends included. */
const within = (ts: string, seconds: number): string =>
  `unixepoch(${ts}) BETWEEN c.t0 AND c.t0 + ${seconds}`;

/** Whether any of the account's profiles has a row in `table` matching `where`. */
const inProfiles = (table: string, where: string): string =>
  `EXISTS (SELECT 1 FROM profiles p JOIN ${table} x ON x.profile_id = p.id ` +
  `WHERE p.user_id = c.id AND ${where})`;

/** The migration that dated every existing account's Welcome claim to the moment it ran. */
export const WELCOME_MIGRATION = '0033_welcome_once.sql';

/** The import logs' details as JSON, or an empty object where a log has none that parses. */
const LOG_DETAILS = `CASE WHEN json_valid(il.details) THEN il.details ELSE '{}' END`;

/**
 * The query: one row of counts. The window's dates are checked and written into it as literals,
 * because `wrangler d1 execute --command` takes no bound parameters.
 */
export function firstWeekSql({ from, to, now }: FirstWeekWindow): string {
  if (!isDate(from) || !isDate(to)) throw new Error(`Not a window: ${from} to ${to}`);
  if (!INSTANT.test(now)) throw new Error(`Not an instant: ${now}`);
  const accountByHand =
    `${within('x.created_at', WEEK_SECONDS)} AND NOT EXISTS (` +
    `SELECT 1 FROM import_logs il, json_each(${LOG_DETAILS}, '$.created_accounts') made ` +
    `WHERE il.profile_id = x.profile_id AND lower(trim(made.value)) = lower(trim(x.name)))`;
  const flags = [
    'c.after_0033',
    `(c.after_0033 AND EXISTS (SELECT 1 FROM reminder_dedup r WHERE r.user_id = c.id ` +
      `AND r.dedup_key = 'welcome' AND ${within('r.sent_at', DAY_SECONDS)})) AS confirmed_in_day`,
    `${inProfiles('import_logs', within('x.created_at', DAY_SECONDS))} AS imported_in_day`,
    `${inProfiles('import_logs', within('x.created_at', WEEK_SECONDS))} AS imported_in_week`,
    `${inProfiles('bills', within('x.created_at', WEEK_SECONDS))} AS bill_in_week`,
    `${inProfiles(
      'transactions',
      `x.category_id IS NOT NULL AND unixepoch(x.updated_at) > unixepoch(x.created_at) AND ` +
        within('x.updated_at', WEEK_SECONDS)
    )} AS sort_in_week`,
    `(${inProfiles('budgets', within('x.created_at', WEEK_SECONDS))} OR ` +
      `${inProfiles('budgets_zero_based', within('x.created_at', WEEK_SECONDS))}) AS budget_in_week`,
    `${inProfiles('savings_goals', within('x.created_at', WEEK_SECONDS))} AS goal_in_week`,
    `${inProfiles('accounts', accountByHand)} AS account_in_week`,
  ];
  const sum = (expression: string, column: string) =>
    `COALESCE(SUM(${expression}), 0) AS ${column}`;
  return [
    'WITH cohort AS (',
    `SELECT id, auth_provider, unixepoch(created_at) AS t0, IFNULL(unixepoch(created_at) > (` +
      `SELECT unixepoch(applied_at) FROM d1_migrations WHERE name = '${WELCOME_MIGRATION}'), 0) ` +
      `AS after_0033 FROM users`,
    `WHERE unixepoch(created_at) BETWEEN unixepoch('${from}') AND unixepoch('${to}', '+1 day') - 1`,
    '), flags AS (',
    `SELECT c.id, c.auth_provider, c.t0, ${flags.join(', ')} FROM cohort c`,
    ')',
    'SELECT COUNT(*) AS signups,',
    [
      sum(`auth_provider = 'password'`, 'signups_password'),
      sum(`auth_provider = 'google'`, 'signups_google'),
      sum('after_0033', 'signups_after_0033'),
      sum('confirmed_in_day', 'confirmed_in_day'),
      sum('imported_in_day', 'imported_in_day'),
      sum('imported_in_week', 'imported_in_week'),
      sum(`t0 + ${DAY_SECONDS} > unixepoch('${now}')`, 'inside_first_day'),
      sum(`t0 + ${WEEK_SECONDS} > unixepoch('${now}')`, 'inside_first_week'),
      sum('bill_in_week', 'bill_in_week'),
      sum('sort_in_week', 'sort_in_week'),
      sum('budget_in_week', 'budget_in_week'),
      sum('goal_in_week', 'goal_in_week'),
      sum('account_in_week', 'account_in_week'),
      sum(
        'imported_in_week OR bill_in_week OR sort_in_week OR budget_in_week OR goal_in_week ' +
          'OR account_in_week',
        'any_step_in_week'
      ),
    ].join(', '),
    'FROM flags',
  ].join('\n');
}

/** The counts in the query's one row. */
export function countsFromRow(row: Record<string, unknown>): FirstWeekCounts {
  const counts = {} as FirstWeekCounts;
  for (const [key, column] of Object.entries(COLUMNS) as [keyof FirstWeekCounts, string][]) {
    const value = Number(row[column]);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`The query answered ${String(row[column])} for ${column}`);
    }
    counts[key] = value;
  }
  return counts;
}

/**
 * Words that change something, or reach outside the one database. A read never needs them, so
 * one anywhere in the text, even inside a string, refuses it.
 */
const WRITES =
  /\b(INSERT|UPDATE|DELETE|REPLACE|UPSERT|DROP|ALTER|CREATE|TRUNCATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|ANALYZE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

/**
 * Why `sql` is not one plain read, or null when it is: a single statement that starts with SELECT
 * or WITH, with no comment anywhere and none of the words in WRITES. Run before wrangler is called,
 * on every query the command sends.
 */
export function readOnlyRefusal(sql: string): string | null {
  const text = sql.trim().replace(/;\s*$/, '');
  if (text === '') return 'it is empty';
  if (text.includes('--') || text.includes('/*')) return 'it holds a comment';
  if (text.includes(';')) return 'it holds more than one statement';
  if (!/^(SELECT|WITH)\b/i.test(text)) return 'it does not start with SELECT or WITH';
  const write = WRITES.exec(text);
  if (write) return `it holds ${write[1]!.toUpperCase()}`;
  return null;
}

/** "40%" of `total`, or "-" with nobody to take a share of. */
const share = (n: number, total: number): string =>
  total > 0 ? `${Math.round((n * 100) / total)}%` : '-';

const LABEL_WIDTH = 36;

function line(label: string, value: string, percent = ''): string {
  return `${label.padEnd(LABEL_WIDTH)}${value.padStart(6)}${percent.padStart(7)}`.trimEnd();
}

/** The table, for a person reading it in a terminal. */
export function formatCounts(
  counts: FirstWeekCounts,
  { from, to, now, source }: FirstWeekWindow & { source: string }
): string {
  const n = counts.signups;
  const row = (label: string, value: number) => line(label, String(value), share(value, n));
  const notRecorded = (label: string) => `${label.padEnd(LABEL_WIDTH)}  not recorded`;
  return [
    `First week of the accounts that signed up ${from} to ${to} (UTC), from ${source}.`,
    `Read at ${now} UTC.`,
    '',
    line('', 'count', 'share'),
    line('Sign-ups', String(n)),
    line('  with a password', String(counts.signupsPassword)),
    line('  with Google', String(counts.signupsGoogle)),
    line('  after migration 0033 ran', String(counts.signupsAfter0033)),
    line(
      'Confirmed the address within a day',
      String(counts.confirmedInDay),
      share(counts.confirmedInDay, counts.signupsAfter0033)
    ),
    row('Imported within a day', counts.importedInDay),
    row('Imported within a week', counts.importedInWeek),
    notRecorded('Prints pressed'),
    '',
    'Next steps taken within a week',
    row('Imported a statement', counts.importedInWeek),
    row('Added a bill or subscription', counts.billInWeek),
    row('Gave an entry a category', counts.sortInWeek),
    row('Set a budget', counts.budgetInWeek),
    row('Started a goal', counts.goalInWeek),
    row('Added an account by hand', counts.accountInWeek),
    row('Took at least one of these', counts.anyStepInWeek),
    notRecorded('Looked into a month in the red'),
    notRecorded('Compared paying a loan off'),
    notRecorded('Answered a question'),
    '',
    `Still inside their first day: ${counts.insideFirstDay}. ` +
      `Still inside their first week: ${counts.insideFirstWeek}. Their counts can still grow.`,
    'Cloud accounts only: local-first data stays in the browser and never reaches the server.',
    'Within a day: from the sign-up instant (users.created_at, UTC) to 86,400 s (24 h) after it,',
    'both ends included. Within a week: the same, to 604,800 s (7 days) after it.',
    'Shares are of sign-ups, except Confirmed. Confirmed reads the Welcome claim (reminder_dedup,',
    'welcome), which every way of confirming an address writes; a Google sign-up writes it at once.',
    'Confirmed counts only the accounts made after migration 0033 ran (d1_migrations), and its share',
    'is of those: 0033 dated the claim of every older account to the moment it ran.',
  ].join('\n');
}
