/**
 * worker/scripts/first-week-counts.ts, the command that prints the first-week counts, and the SQL
 * it runs (worker/scripts/first-week.ts). The SQL runs here against the test D1, on accounts made
 * in 2001 so that no other test's accounts fall in the window. Every address is fake and every
 * row is deleted afterwards. The command runs with a stub wrangler, so nothing here reaches a
 * remote database.
 */
import { env } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  countsFromRow,
  firstWeekSql,
  formatCounts,
  readOnlyRefusal,
  type FirstWeekCounts,
} from '../scripts/first-week';
import { main, parseArgs, runReadOnly, wranglerArgs } from '../scripts/first-week-counts';

const DAY = 86_400;
const WEEK = 7 * DAY;
const MAIL = '@first-week.example.invalid';

/** 'YYYY-MM-DD HH:MM:SS' for `base` plus `seconds`, as SQLite's datetime() writes it. */
function at(base: string, seconds = 0): string {
  const ms = Date.parse(`${base.replace(' ', 'T')}Z`) + seconds * 1000;
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

const T = '2001-03-10 12:00:00';
const FIRST = '2001-03-01 00:00:00';
const LAST = '2001-03-28 23:59:59';

const userIds: number[] = [];
const profileIds: number[] = [];

async function user(name: string, provider: 'password' | 'google', createdAt: string) {
  const row = await env.DB.prepare(
    'INSERT INTO users (email, email_verified, auth_provider, created_at) VALUES (?, 1, ?, ?) RETURNING id'
  )
    .bind(`${name}${MAIL}`, provider, createdAt)
    .first<{ id: number }>();
  userIds.push(row!.id);
  return row!.id;
}

async function profile(userId: number, name = 'Personal Profile') {
  const row = await env.DB.prepare(
    'INSERT INTO profiles (name, user_id) VALUES (?, ?) RETURNING id'
  )
    .bind(name, userId)
    .first<{ id: number }>();
  profileIds.push(row!.id);
  return row!.id;
}

const welcome = (userId: number, sentAt: string) =>
  env.DB.prepare(
    "INSERT INTO reminder_dedup (user_id, dedup_key, sent_at) VALUES (?, 'welcome', ?)"
  )
    .bind(userId, sentAt)
    .run();

const importLog = (profileId: number, createdAt: string, createdAccounts: string[] = []) =>
  env.DB.prepare(
    "INSERT INTO import_logs (profile_id, source, imported, details, created_at) VALUES (?, 'csv', 10, ?, ?)"
  )
    .bind(profileId, JSON.stringify({ mode: 'all', created_accounts: createdAccounts }), createdAt)
    .run();

const account = (profileId: number, name: string, createdAt: string) =>
  env.DB.prepare('INSERT INTO accounts (name, profile_id, created_at) VALUES (?, ?, ?)')
    .bind(name, profileId, createdAt)
    .run();

const budget = (profileId: number, createdAt: string) =>
  env.DB.prepare(
    "INSERT INTO budgets (category_id, amount, start_date, profile_id, created_at) VALUES (1, 100, '2001-03-01', ?, ?)"
  )
    .bind(profileId, createdAt)
    .run();

/** D1 holds budgets_zero_based to its foreign keys, so the budget's category is a real row. */
async function zeroBasedBudget(profileId: number, createdAt: string) {
  const category = await env.DB.prepare(
    "INSERT INTO categories (name, profile_id) VALUES ('Groceries', ?) RETURNING id"
  )
    .bind(profileId)
    .first<{ id: number }>();
  await env.DB.prepare(
    "INSERT INTO budgets_zero_based (profile_id, category_id, amount, month, created_at) VALUES (?, ?, 100, '2001-03', ?)"
  )
    .bind(profileId, category!.id, createdAt)
    .run();
}

const goal = (profileId: number, createdAt: string) =>
  env.DB.prepare(
    "INSERT INTO savings_goals (name, target_amount, profile_id, created_at) VALUES ('Cushion', 1000, ?, ?)"
  )
    .bind(profileId, createdAt)
    .run();

const bill = (profileId: number, createdAt: string) =>
  env.DB.prepare(
    "INSERT INTO bills (profile_id, name, amount, due_date, created_at) VALUES (?, 'Rent', 500, '2001-04-01', ?)"
  )
    .bind(profileId, createdAt)
    .run();

const entry = (
  profileId: number,
  categoryId: number | null,
  createdAt: string,
  updatedAt: string
) =>
  env.DB.prepare(
    "INSERT INTO transactions (amount, date, category_id, profile_id, created_at, updated_at) VALUES (-5, '2001-03-01', ?, ?, ?, ?)"
  )
    .bind(categoryId, profileId, createdAt, updatedAt)
    .run();

/** The window every count below is read over, with every first week over by `now`. */
const WINDOW = { from: '2001-03-01', to: '2001-03-28', now: '2001-04-10 00:00:00' };

async function countsAt(window: { from: string; to: string; now: string }) {
  const row = await env.DB.prepare(firstWeekSql(window)).first<Record<string, unknown>>();
  return countsFromRow(row!);
}

beforeAll(async () => {
  // Confirmed exactly 24 h after signing up, imported exactly 24 h after, a budget exactly 7 days
  // after, a goal one second too late, and an account the import made.
  const u1 = await user('one', 'password', T);
  const p1 = await profile(u1);
  await welcome(u1, at(T, DAY));
  await importLog(p1, at(T, DAY), ['Checking']);
  await account(p1, 'Checking', at(T, DAY));
  await budget(p1, at(T, WEEK));
  await goal(p1, at(T, WEEK + 1));

  // Confirmed and imported one second past a day; a bill and an account added by hand inside the
  // week, and an account an import made, under the name its log gives in another case.
  const u2 = await user('two', 'password', T);
  const p2 = await profile(u2);
  await welcome(u2, at(T, DAY + 1));
  await importLog(p2, at(T, DAY + 1), [' savings ']);
  await bill(p2, at(T, 3600));
  await account(p2, 'Wallet', at(T, 60));
  await account(p2, 'Savings', at(T, DAY + 1));

  // A Google sign-up on the window's first second, confirmed at once. Imported exactly 7 days
  // after, a zero-based budget in a second profile, and an entry given a category after it was
  // entered. Another entry came in with its category and was never edited.
  const u3 = await user('three', 'google', FIRST);
  const p3 = await profile(u3);
  const p3b = await profile(u3, 'Second');
  await welcome(u3, FIRST);
  await importLog(p3, at(FIRST, WEEK));
  await zeroBasedBudget(p3b, at(FIRST, 100));
  await entry(p3, 7, at(FIRST, 10), at(FIRST, 100));
  await entry(p3, 7, at(FIRST, 20), at(FIRST, 20));

  // Signed up on the window's last second, never confirmed. Imported one second past a week; an
  // entry edited inside the week that still has no category; a goal restored from a backup with
  // the date it was made, before this account existed.
  const u4 = await user('four', 'password', LAST);
  const p4 = await profile(u4);
  await importLog(p4, at(LAST, WEEK + 1));
  await entry(p4, null, at(LAST, 10), at(LAST, 100));
  await goal(p4, at(LAST, -10 * DAY));

  // Imported ten seconds after signing up, with each entry's category from the import, and did
  // nothing else: no entry was edited.
  const u5 = await user('five', 'password', T);
  const p5 = await profile(u5);
  await importLog(p5, at(T, 10));
  await entry(p5, 7, at(T, 10), at(T, 10));

  // One second either side of the window: neither is a sign-up in it, whatever they did.
  for (const [name, createdAt] of [
    ['before', at(FIRST, -1)],
    ['after', at(LAST, 1)],
  ] as const) {
    const u = await user(name, 'google', createdAt);
    const p = await profile(u);
    await welcome(u, createdAt);
    await importLog(p, createdAt);
    await budget(p, createdAt);
    await goal(p, createdAt);
    await bill(p, createdAt);
    await account(p, 'Cash', createdAt);
  }
});

afterAll(async () => {
  const profiles = profileIds.join(', ');
  const users = userIds.join(', ');
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM import_logs WHERE profile_id IN (${profiles})`),
    env.DB.prepare(`DELETE FROM accounts WHERE profile_id IN (${profiles})`),
    env.DB.prepare(`DELETE FROM budgets WHERE profile_id IN (${profiles})`),
    env.DB.prepare(`DELETE FROM budgets_zero_based WHERE profile_id IN (${profiles})`),
    env.DB.prepare(`DELETE FROM savings_goals WHERE profile_id IN (${profiles})`),
    env.DB.prepare(`DELETE FROM bills WHERE profile_id IN (${profiles})`),
    env.DB.prepare(`DELETE FROM transactions WHERE profile_id IN (${profiles})`),
    env.DB.prepare(`DELETE FROM categories WHERE profile_id IN (${profiles})`),
    env.DB.prepare(`DELETE FROM profiles WHERE id IN (${profiles})`),
    env.DB.prepare(`DELETE FROM reminder_dedup WHERE user_id IN (${users})`),
    env.DB.prepare(`DELETE FROM users WHERE id IN (${users})`),
  ]);
});

const EXPECTED: FirstWeekCounts = {
  signups: 5,
  signupsPassword: 4,
  signupsGoogle: 1,
  confirmedInDay: 2,
  importedInDay: 2,
  importedInWeek: 4,
  insideFirstDay: 0,
  insideFirstWeek: 0,
  billInWeek: 1,
  sortInWeek: 1,
  budgetInWeek: 2,
  goalInWeek: 0,
  accountInWeek: 1,
  anyStepInWeek: 4,
};

describe('first-week counts', () => {
  it('counts the sign-ups in the window, each first day and week to the second', async () => {
    expect(await countsAt(WINDOW)).toEqual(EXPECTED);
  });

  it('counts the accounts whose first day or week is still open at the time it runs', async () => {
    // One second after the last sign-up: its day and its week are both open.
    expect(await countsAt({ ...WINDOW, now: at(LAST, 1) })).toMatchObject({
      insideFirstDay: 1,
      insideFirstWeek: 1,
    });
    // Exactly a day after it: the day is over, the week is not.
    expect(await countsAt({ ...WINDOW, now: at(LAST, DAY) })).toMatchObject({
      insideFirstDay: 0,
      insideFirstWeek: 1,
    });
  });

  it('reads one day as a window of its own, edges included', async () => {
    expect(await countsAt({ from: '2001-03-01', to: '2001-03-01', now: WINDOW.now })).toEqual({
      ...EXPECTED,
      signups: 1,
      signupsPassword: 0,
      signupsGoogle: 1,
      confirmedInDay: 1,
      importedInDay: 0,
      importedInWeek: 1,
      billInWeek: 0,
      budgetInWeek: 1,
      accountInWeek: 0,
      anyStepInWeek: 1,
    });
  });

  it('answers zeros, not nulls, for a window nobody signed up in', async () => {
    const counts = await countsAt({ from: '2001-01-01', to: '2001-01-02', now: WINDOW.now });
    for (const value of Object.values(counts)) expect(value).toBe(0);
  });

  it('prints counts and shares only: no address, no name, no id', async () => {
    const text = formatCounts(await countsAt(WINDOW), { ...WINDOW, source: 'local D1' });
    expect(text).toContain('2001-03-01 to 2001-03-28');
    expect(text).toMatch(/Sign-ups\s+5\b/);
    expect(text).toMatch(/Confirmed the address within a day\s+2\s+40%/);
    expect(text).toMatch(/Imported within a day\s+2\s+40%/);
    expect(text).toMatch(/Imported within a week\s+4\s+80%/);
    expect(text).toMatch(/Set a budget\s+2\s+40%/);
    expect(text).toMatch(/Prints pressed\s+not recorded/);
    expect(text).toContain('Cloud accounts only');
    expect(text).toContain('86,400');
    expect(text).toContain('604,800');
    expect(text).not.toContain(MAIL);
    for (const name of ['Checking', 'Wallet', 'Savings', 'Cushion', 'Rent', 'Groceries']) {
      expect(text).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});

describe('the read-only guard', () => {
  it('lets the counts query and plain reads through', () => {
    expect(readOnlyRefusal(firstWeekSql(WINDOW))).toBeNull();
    expect(readOnlyRefusal('SELECT COUNT(*) FROM users')).toBeNull();
    expect(readOnlyRefusal('  with x AS (SELECT 1 AS n) SELECT n FROM x;')).toBeNull();
  });

  it.each([
    ['an UPDATE', "UPDATE users SET plan = 'pro'"],
    ['a DELETE', 'DELETE FROM users'],
    ['an INSERT', "INSERT INTO users (email) VALUES ('x@example.invalid')"],
    ['a DROP', 'DROP TABLE users'],
    ['two statements', 'SELECT 1; DELETE FROM users'],
    ['a write after a read with no space', 'SELECT 1;DROP TABLE users'],
    ['a line comment hiding a write', '-- just counting\nDELETE FROM users'],
    ['a block comment hiding a write', '/* SELECT */ DELETE FROM users'],
    ['a comment after a read', 'SELECT 1 -- ; DELETE FROM users'],
    ['a CTE that deletes', 'WITH x AS (SELECT 1) DELETE FROM users WHERE id IN (SELECT * FROM x)'],
    ['two reads', 'SELECT 1; SELECT 2'],
    ['a read with a comment', 'SELECT 1 -- how many'],
    ['a read with a block comment', 'SELECT /* how many */ 1'],
    ['a PRAGMA', 'PRAGMA writable_schema = 1'],
    ['an ATTACH', "ATTACH DATABASE 'x' AS y"],
    ['a statement that is not a SELECT or a WITH', 'VALUES (1)'],
    ['an EXPLAIN', 'EXPLAIN SELECT 1'],
    ['nothing', '   '],
  ])('refuses %s', (_, sql) => {
    expect(readOnlyRefusal(sql)).not.toBeNull();
  });

  it('refuses before wrangler is called', async () => {
    const calls: string[][] = [];
    const run = async (args: string[]) => {
      calls.push(args);
      return '[]';
    };
    await expect(runReadOnly('DELETE FROM users', 'dev', run)).rejects.toThrow(/read-only/i);
    await expect(runReadOnly('SELECT 1; DROP TABLE users', 'prod', run)).rejects.toThrow(
      /read-only/i
    );
    expect(calls).toEqual([]);
  });
});

describe('the command', () => {
  const TODAY = '2026-10-31';

  it('reads the last 28 days, today included, by default', () => {
    expect(parseArgs(['--env', 'dev'], TODAY)).toEqual({
      env: 'dev',
      from: '2026-10-04',
      to: '2026-10-31',
      persistTo: null,
    });
  });

  it('takes a window, and the -- that pnpm passes through', () => {
    expect(
      parseArgs(['--', '--env', 'prod', '--from', '2026-09-01', '--to', '2026-09-30'], TODAY)
    ).toEqual({ env: 'prod', from: '2026-09-01', to: '2026-09-30', persistTo: null });
    expect(parseArgs(['--env', 'local', '--persist-to', '/x/state'], TODAY)).toMatchObject({
      env: 'local',
      persistTo: '/x/state',
    });
  });

  it.each([
    [[], '--env is required'],
    [['--env', 'staging'], '--env takes dev, prod or local'],
    [['--env', 'dev', '--from', '2026-02-30'], 'is not a date'],
    [['--env', 'dev', '--from', "2026-10-01' OR 1=1"], 'is not a date'],
    [['--env', 'dev', '--from', '2026-10-10', '--to', '2026-10-01'], 'after --to'],
    [['--env', 'dev', '--persist-to', '/x'], '--persist-to is for --env local'],
    [['--env', 'dev', '--remote'], 'Unknown option --remote'],
    [['--env'], '--env needs a value'],
  ])('refuses %j', (argv, reason) => {
    expect(parseArgs(argv as string[], TODAY)).toEqual({
      error: expect.stringContaining(reason),
    });
  });

  it('names the database of each environment with its --env, and --remote for both', () => {
    expect(wranglerArgs('dev', null)).toEqual([
      'd1',
      'execute',
      'finance-manager-dev',
      '--remote',
      '--env',
      'dev',
      '--json',
    ]);
    expect(wranglerArgs('prod', null)).toEqual([
      'd1',
      'execute',
      'finance-manager',
      '--remote',
      '--env',
      'prod',
      '--json',
    ]);
    expect(wranglerArgs('local', '/x/state')).toEqual([
      'd1',
      'execute',
      'finance-manager',
      '--local',
      '--persist-to',
      '/x/state',
      '--json',
    ]);
  });

  it('prints the table from what wrangler answers', async () => {
    const row = await env.DB.prepare(firstWeekSql(WINDOW)).first<Record<string, unknown>>();
    const out: string[] = [];
    const calls: string[][] = [];
    const code = await main({
      argv: ['--env', 'dev', '--from', WINDOW.from, '--to', WINDOW.to],
      today: TODAY,
      now: WINDOW.now,
      out: (line) => out.push(line),
      err: (line) => out.push(`err: ${line}`),
      run: async (args) => {
        calls.push(args);
        return JSON.stringify([{ results: [row], success: true, meta: {} }]);
      },
    });
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.slice(0, 7)).toEqual(wranglerArgs('dev', null));
    expect(calls[0]!.slice(7)).toEqual(['--command', firstWeekSql(WINDOW)]);
    expect(out.join('')).toMatch(/Sign-ups\s+5\b/);
    expect(out.join('')).toContain('dev');
  });

  it('says what went wrong when wrangler fails, and exits 1', async () => {
    const out: string[] = [];
    const code = await main({
      argv: ['--env', 'dev'],
      today: TODAY,
      now: '2026-10-31 10:00:00',
      out: (line) => out.push(line),
      err: (line) => out.push(`err: ${line}`),
      run: async () => {
        throw new Error('Authentication error');
      },
    });
    expect(code).toBe(1);
    expect(out.join('')).toContain('err: ');
    expect(out.join('')).toContain('Authentication error');
  });
});
