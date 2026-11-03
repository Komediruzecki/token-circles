/**
 * worker/scripts/time-machine.ts, the arithmetic and SQL that move an account to "day N" of its
 * first week, run against the D1 the migrations build. The frame is data back: the account's own
 * instants move into the past, every clock stays the real one. Each test here fails on one way that
 * goes wrong:
 *
 * - a time column a migration adds and no list names, so it would stay on the other clock;
 * - a moved value that moves by other than day 0's seconds, or changes its form;
 * - a session, a link, a chosen date or another account that moves at all;
 * - a move that lands twice (the same batch twice, or "day 2" asked twice);
 * - a move the daily job does not read as that day.
 */
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/index';
import { WELCOME_KEY } from '../src/welcome';
import { WEEK_ONE, WEEK_ONE_CRON, runWeekOneMails, weekOneAhead } from '../src/weekOne';
import {
  CHOSEN,
  DAILY_CRON,
  DAY_SECONDS,
  DAY_ZERO_KEY,
  KEPT,
  MAILS,
  MOVED,
  ageSeconds,
  describeWeek,
  moveBy,
  moveStatements,
  targetSeconds,
  weekRowSql,
  type WeekRow,
} from '../scripts/time-machine';

type Row = Record<string, unknown>;

const E = env as unknown as Env;
const A = 97600;
const B = 97601;
/** Each account's rows carry ids of their own: A's from 97610, B's from 97710. */
const BASE: Record<number, number> = { [A]: 97610, [B]: 97710 };
const DAY_ZERO = '2026-10-30 09:16:00';

async function run(statements: string[]): Promise<void> {
  if (statements.length) await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
}

async function all(sql: string): Promise<Row[]> {
  return (await env.DB.prepare(sql).all<Row>()).results;
}

/** Every table the app has, without SQLite's, D1's and the migration runner's own. */
async function tables(): Promise<string[]> {
  return (
    await all(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' " +
        "AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name != 'd1_migrations' ORDER BY name"
    )
  ).map((r) => String(r.name));
}

async function columnsOf(table: string): Promise<{ name: string; dflt: string | null }[]> {
  return (
    await env.DB.prepare('SELECT name, dflt_value FROM pragma_table_info(?)').bind(table).all<{
      name: string;
      dflt_value: string | null;
    }>()
  ).results.map((c) => ({ name: c.name, dflt: c.dflt_value }));
}

/**
 * One account's rows in every table MOVED names, each moved column holding an instant in one of
 * the forms the app writes (SQLite's datetime, a Worker's toISOString, a bare date) or a value
 * that is no instant, plus rows KEPT and CHOSEN name. Fixed values, so every expectation is exact.
 */
function fixture(user: number): string[] {
  const b = BASE[user];
  const email = `time-machine-${user}@example.test`;
  return [
    `INSERT INTO users (id, email, auth_provider, email_verified, token_version, plan, created_at, plan_renews_at, stripe_event_at)
     VALUES (${user}, '${email}', 'password', 1, 1, 'free', '2026-10-30 09:15:00', '2026-11-30T00:00:00.000Z', 1730000000)`,
    `INSERT INTO profiles (id, user_id, name, created_at) VALUES (${b}, ${user}, 'Time machine', '2026-10-30 09:15:01')`,
    `INSERT INTO user_state (user_id, key, value, updated_at) VALUES (${user}, 'time-machine', '{}', '2026-10-30T09:16:30.250Z')`,
    `INSERT INTO custom_reports (id, user_id, name, created_at, updated_at) VALUES (${b}, ${user}, 'Report', '2026-10-30 09:20:00', '2026-10-31T10:00:00.000Z')`,
    `INSERT INTO accounts (id, profile_id, name, starting_date, created_at) VALUES (${b}, ${b}, 'Main', '2026-10-01', '2026-10-30 09:17:00')`,
    `INSERT INTO account_balance_history (id, account_id, balance, recorded_at) VALUES (${b}, ${b}, 100, '2026-10-30 09:17:00')`,
    `INSERT INTO categories (id, profile_id, name, created_at) VALUES (${b}, ${b}, 'Food', '2026-10-30 09:15:02')`,
    `INSERT INTO transactions (id, profile_id, account_id, amount, date, created_at, updated_at, reconciled_at, import_id)
     VALUES (${b}, ${b}, ${b}, -12.5, '2026-10-29', '2026-10-30 09:18:00', '2026-10-31T08:00:00.123Z', '2026-10-31 08:00:00', 'import-${user}')`,
    `INSERT INTO transactions (id, profile_id, account_id, amount, date, created_at, updated_at, reconciled_at)
     VALUES (${b + 1}, ${b}, ${b}, -3, '2026-10-30', '2026-10-30 09:18:00', '2026-10-30 09:18:00', NULL)`,
    `INSERT INTO budgets (id, profile_id, category_id, amount, start_date, end_date, created_at)
     VALUES (${b}, ${b}, ${b}, 300, '2026-10-01', '2026-10-31', '2026-10-30 09:19:00')`,
    `INSERT INTO budgets_zero_based (id, profile_id, category_id, amount, month, created_at)
     VALUES (${b}, ${b}, ${b}, 200, '2026-10', '2026-10-30 09:19:30')`,
    `INSERT INTO savings_goals (id, profile_id, name, target_amount, deadline, tracking_start_date, created_at)
     VALUES (${b}, ${b}, 'Cushion', 1000, '2027-06-30', '2026-10-30', '2026-10-30 09:21:00')`,
    `INSERT INTO retirement_goals (id, profile_id, name, target_amount, deadline, created_at)
     VALUES (${b}, ${b}, 'Later', 100000, '2050-01-01', '2026-10-30 09:22:00')`,
    `INSERT INTO loans (id, profile_id, name, principal, start_date, term_months, created_at)
     VALUES (${b}, ${b}, 'Car', 9000, '2025-01-01', 60, '2026-10-30 09:23:00')`,
    `INSERT INTO recurring_transactions (id, profile_id, amount, day_of_month, next_date, created_at)
     VALUES (${b}, ${b}, -9.99, 5, '2026-11-05', '2026-10-30 09:24:00')`,
    `INSERT INTO bills (id, profile_id, name, amount, day_of_month, due_date, next_due_date, last_paid_date, created_at)
     VALUES (${b}, ${b}, 'Phone', 20, 12, '2026-11-12', '2026-11-12', '2026-10-12', '2026-10-30 09:25:00')`,
    `INSERT INTO housings (id, profile_id, name, monthly_amount, due_date, created_at) VALUES (${b}, ${b}, 'Rent', 700, '1', '2026-10-30 09:26:00')`,
    `INSERT INTO tags (id, profile_id, name, created_at) VALUES (${b}, ${b}, 'trip', '2026-10-30 09:27:00')`,
    `INSERT INTO tags (id, profile_id, name, created_at) VALUES (${b + 1}, ${b}, 'odd', 'not a time')`,
    `INSERT INTO tags (id, profile_id, name, created_at) VALUES (${b + 2}, ${b}, 'dated', '2026-10-30')`,
    `INSERT INTO tag_rules (id, profile_id, tag_id, created_at) VALUES (${b}, ${b}, ${b}, '2026-10-30 09:27:30')`,
    `INSERT INTO category_mappings (id, profile_id, pattern, category_id, confidence, created_at)
     VALUES (${b}, ${b}, 'SHOP', ${b}, 0.9, '2026-10-30 09:28:00')`,
    `INSERT INTO receipts (id, profile_id, transaction_id, filename, original_name, file_type, file_size, storage_path, uploaded_at)
     VALUES (${b}, ${b}, ${b}, 'r.jpg', 'r.jpg', 'image/jpeg', 10, 'receipts/r.jpg', '2026-10-30 09:29:00')`,
    `INSERT INTO portfolio_holdings (id, profile_id, ticker, shares, purchase_price, purchase_date, created_at, updated_at)
     VALUES (${b}, ${b}, 'VWCE', 1, 100, '2026-10-15', '2026-10-30 09:30:00', '2026-10-31T09:30:00.000Z')`,
    `INSERT INTO import_logs (id, profile_id, created_at) VALUES (${b}, ${b}, '2026-10-30 09:31:00')`,
    `INSERT INTO import_sources (id, profile_id, created_at, updated_at, last_synced_at)
     VALUES (${b}, ${b}, '2026-10-30 09:32:00', '2026-10-31T09:32:00.000Z', '2026-10-31T09:32:00.000Z')`,
    `INSERT INTO reminder_dedup (user_id, dedup_key, sent_at) VALUES (${user}, '${DAY_ZERO_KEY}', '${DAY_ZERO}')`,
    `INSERT INTO reminder_dedup (user_id, dedup_key, sent_at) VALUES (${user}, 'bills:2026-10-31', '2026-10-31 08:00:02')`,
    // KEPT: a session and a confirm link keep their real time.
    `INSERT INTO auth_sessions (id, user_id, created_at, last_seen_at) VALUES ('time-machine-${user}', ${user}, '2026-10-30 09:16:00', '2026-11-03 07:00:00')`,
    `INSERT INTO email_verifications (id, user_id, email, token_hash, expires_at, created_at)
     VALUES (${b}, ${user}, '${email}', 'time-machine-hash-${user}', '2026-10-31T09:15:00.000Z', '2026-10-30 09:15:00')`,
  ];
}

function removal(user: number): string[] {
  const b = BASE[user];
  const p = `profile_id = ${b}`;
  return [
    `DELETE FROM tag_rules WHERE ${p}`,
    `DELETE FROM receipts WHERE ${p}`,
    `DELETE FROM account_balance_history WHERE account_id = ${b}`,
    `DELETE FROM category_mappings WHERE ${p}`,
    `DELETE FROM budgets_zero_based WHERE ${p}`,
    ...[
      'transactions',
      'budgets',
      'savings_goals',
      'retirement_goals',
      'loans',
      'recurring_transactions',
      'bills',
      'housings',
      'tags',
      'portfolio_holdings',
      'import_logs',
      'import_sources',
      'accounts',
      'categories',
    ].map((t) => `DELETE FROM ${t} WHERE ${p}`),
    ...[
      'user_state',
      'custom_reports',
      'reminder_dedup',
      'auth_sessions',
      'email_verifications',
      'profiles',
    ].map((t) => `DELETE FROM ${t} WHERE user_id = ${user}`),
    `DELETE FROM users WHERE id = ${user}`,
  ];
}

/** Every row of every table, by rowid. */
async function snapshot(): Promise<Map<string, Map<number, Row>>> {
  const out = new Map<string, Map<number, Row>>();
  for (const t of await tables()) {
    const rows = await all(`SELECT rowid AS __rowid, * FROM "${t}"`);
    out.set(t, new Map(rows.map((r) => [Number(r.__rowid), r])));
  }
  return out;
}

/** Whether a row of `table` is `user`'s, by the ids the fixture gave it. */
function owns(user: number, table: string, row: Row): boolean {
  if (table === 'users') return row.id === user;
  if ('user_id' in row) return row.user_id === user;
  if ('profile_id' in row) return row.profile_id === BASE[user];
  if ('account_id' in row) return row.account_id === BASE[user];
  return false;
}

/** `value` moved `seconds` back in the form it came in, computed in JavaScript, not in SQL. */
function movedBack(value: unknown, seconds: number): unknown {
  if (typeof value !== 'string' || seconds === 0) return value;
  const ms = seconds * 1000;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value))) {
    return new Date(Date.parse(value) - ms).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(Date.parse(`${value.replace(' ', 'T')}Z`) - ms)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(Date.parse(`${value}T00:00:00Z`) - ms).toISOString().slice(0, 10);
  }
  return value;
}

const MOVED_COLUMNS = new Map(MOVED.map((m) => [m.table, new Set(m.columns)]));

/**
 * The whole database after `user` moved `seconds` back, as it must be: that account's MOVED
 * columns moved, every other value as it was.
 */
function expectMoved(
  before: Map<string, Map<number, Row>>,
  after: Map<string, Map<number, Row>>,
  user: number,
  seconds: number
): void {
  expect([...after.keys()]).toEqual([...before.keys()]);
  for (const [table, rows] of before) {
    const now = after.get(table)!;
    expect([...now.keys()], `${table}: no row added or removed`).toEqual([...rows.keys()]);
    for (const [rowid, row] of rows) {
      const moved = owns(user, table, row) ? MOVED_COLUMNS.get(table) : undefined;
      const want = Object.fromEntries(
        Object.entries(row).map(([c, v]) => [c, moved?.has(c) ? movedBack(v, seconds) : v])
      );
      expect(now.get(rowid), `${table} row ${rowid}`).toEqual(want);
    }
  }
}

async function dayZeroOf(user: number): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT sent_at FROM reminder_dedup WHERE user_id = ? AND dedup_key = '${DAY_ZERO_KEY}'`
  )
    .bind(user)
    .first<{ sent_at: string }>();
  return row!.sent_at;
}

/** What the harness does for "day N": read day 0, work out the move from it, send one batch. */
async function moveTo(user: number, day: number, at?: string): Promise<number> {
  const dayZero = await dayZeroOf(user);
  const seconds = moveBy(ageSeconds(dayZero, Date.now()), targetSeconds(dayZero, day, at));
  if (seconds > 0) await run(moveStatements(user, seconds, dayZero));
  return seconds;
}

describe('what the time machine knows about the app', () => {
  it('has day 0, the daily job and the mails as the Worker has them', () => {
    expect(DAY_ZERO_KEY).toBe(WELCOME_KEY);
    expect(DAILY_CRON).toBe(WEEK_ONE_CRON);
    expect(MAILS).toEqual(WEEK_ONE);
  });

  it('names every time column in the schema once, as moved, kept or chosen', async () => {
    const named = new Map<string, string>();
    const name = (table: string, column: string, list: string) => {
      const key = `${table}.${column}`;
      expect(named.get(key), `${key} is in ${named.get(key)} and ${list}`).toBeUndefined();
      named.set(key, list);
    };
    for (const { table, columns } of MOVED) for (const c of columns) name(table, c, 'MOVED');
    for (const [table, { columns }] of Object.entries(KEPT))
      for (const c of columns) name(table, c, 'KEPT');
    for (const [table, columns] of Object.entries(CHOSEN))
      for (const c of columns) name(table, c, 'CHOSEN');

    // A time column: its name says so, or its default is a clock.
    const timeName = /(_at$)|((^|_)(date|month|expire|expires|deadline)(_|$))|(^last_paid$)/;
    const clockDefault =
      /datetime|date\(|strftime|julianday|unixepoch|CURRENT_(TIMESTAMP|DATE|TIME)/i;
    const found = new Set<string>();
    const unnamed: string[] = [];
    for (const table of await tables()) {
      for (const { name: column, dflt } of await columnsOf(table)) {
        const key = `${table}.${column}`;
        found.add(key);
        if ((timeName.test(column) || clockDefault.test(dflt ?? '')) && !named.has(key)) {
          unnamed.push(key);
        }
      }
    }
    expect(unnamed, 'time columns that MOVED, KEPT or CHOSEN must name').toEqual([]);
    expect(
      [...named.keys()].filter((k) => !found.has(k)),
      'named columns that do not exist'
    ).toEqual([]);
  });

  it('moves day 0 in the last statement, as every statement checks it', () => {
    expect(MOVED.at(-1)?.table).toBe('reminder_dedup');
  });
});

describe('moving an account back', () => {
  beforeEach(async () => {
    await run([...removal(A), ...removal(B)]);
    await run([...fixture(A), ...fixture(B)]);
  });
  afterEach(async () => {
    await run([...removal(A), ...removal(B)]);
  });

  it('moves every instant of its own use by day 0 seconds, each in its own form', async () => {
    const before = await snapshot();
    const seconds = 2 * DAY_SECONDS + 3 * 3600 + 7;
    await run(moveStatements(A, seconds, DAY_ZERO));
    const after = await snapshot();
    expectMoved(before, after, A, seconds);

    // Each moved column held an instant in the fixture, so each one was seen to move.
    for (const { table, columns } of MOVED) {
      for (const column of columns) {
        const changed = [...before.get(table)!].some(
          ([rowid, row]) =>
            owns(A, table, row) && after.get(table)!.get(rowid)![column] !== row[column]
        );
        expect(changed, `${table}.${column} moved`).toBe(true);
      }
    }
    // Spot checks, written out: day 0, a Worker's ISO stamp, a bare date, a value that is no time.
    expect(await dayZeroOf(A)).toBe('2026-10-28 06:15:53');
    expect(await dayZeroOf(B)).toBe(DAY_ZERO);
    const tx = await all(
      `SELECT updated_at, reconciled_at, date FROM transactions WHERE profile_id = ${BASE[A]} ORDER BY id`
    );
    expect(tx).toEqual([
      {
        updated_at: '2026-10-29T04:59:53.123Z',
        reconciled_at: '2026-10-29 04:59:53',
        date: '2026-10-29',
      },
      { updated_at: '2026-10-28 06:17:53', reconciled_at: null, date: '2026-10-30' },
    ]);
    const tags = await all(`SELECT created_at FROM tags WHERE profile_id = ${BASE[A]} ORDER BY id`);
    expect(tags.map((t) => t.created_at)).toEqual([
      '2026-10-28 06:26:53',
      'not a time',
      '2026-10-27',
    ]);
    const session = await all(
      `SELECT created_at, last_seen_at FROM auth_sessions WHERE user_id = ${A}`
    );
    expect(session).toEqual([
      { created_at: '2026-10-30 09:16:00', last_seen_at: '2026-11-03 07:00:00' },
    ]);
  });

  it('moves once when the same batch runs twice', async () => {
    const statements = moveStatements(A, 2 * DAY_SECONDS, DAY_ZERO);
    const before = await snapshot();
    await run(statements);
    await run(statements);
    expectMoved(before, await snapshot(), A, 2 * DAY_SECONDS);
  });

  it('moves nothing when day 0 is no longer what the move was worked out from', async () => {
    const before = await snapshot();
    await run(moveStatements(A, DAY_SECONDS, '2026-10-30 09:15:59'));
    expectMoved(before, await snapshot(), A, 0);
  });

  it('lands on day 2 once when day 2 is asked for twice', async () => {
    // Day 0 of the fixture is days ago, so it starts past day 2: start it over at the real now.
    await run([
      `UPDATE reminder_dedup SET sent_at = datetime('now') WHERE user_id = ${A} AND dedup_key = '${DAY_ZERO_KEY}'`,
    ]);
    expect(await moveTo(A, 2)).toBeGreaterThan(2 * DAY_SECONDS - 60);
    const first = await snapshot();
    expect(await moveTo(A, 2)).toBe(0);
    expectMoved(first, await snapshot(), A, 0);
    const age = ageSeconds(await dayZeroOf(A), Date.now());
    expect(age).toBeGreaterThanOrEqual(2 * DAY_SECONDS);
    expect(age).toBeLessThan(2 * DAY_SECONDS + 60);
  });
});

describe('the arithmetic', () => {
  it('counts day N from day 0, at its time of day or at a time given', () => {
    expect(targetSeconds('2026-11-03 14:20:00', 2)).toBe(2 * DAY_SECONDS);
    expect(targetSeconds('2026-11-03 14:20:00', 2.5)).toBe(2.5 * DAY_SECONDS);
    // Day 2 at 08:30 UTC: the daily job's second morning, short of two whole days.
    expect(targetSeconds('2026-11-03 14:20:00', 2, '08:30')).toBe(
      DAY_SECONDS + 18 * 3600 + 10 * 60
    );
    expect(targetSeconds('2026-11-03 06:00:00', 0, '08:30')).toBe(2.5 * 3600);
    expect(() => targetSeconds('2026-11-03 14:20:00', 0, '08:30')).toThrow(/before day 0/);
    expect(() => targetSeconds('2026-11-03 14:20:00', 1.5, '08:30')).toThrow(/whole day/);
    expect(() => targetSeconds('2026-11-03 14:20:00', 2, '8:30')).toThrow(/HH:MM/);
    expect(() => targetSeconds('2026-11-03 14:20:00', -1)).toThrow(/0 or more/);
    expect(() => targetSeconds('2026-11-03T14:20:00Z', 1)).toThrow(/not an instant/);
  });

  it('moves forward only', () => {
    expect(moveBy(100, 2 * DAY_SECONDS)).toBe(2 * DAY_SECONDS - 100);
    // Time went by since the account got to day 2: it is still day 2.
    expect(moveBy(2 * DAY_SECONDS + 3600, 2 * DAY_SECONDS)).toBe(0);
    expect(() => moveBy(3 * DAY_SECONDS, 2 * DAY_SECONDS)).toThrow(/only moves forward/);
  });

  it('builds SQL only from values it checked', () => {
    expect(() => moveStatements(0, 60, DAY_ZERO)).toThrow(/account id/);
    expect(() => moveStatements(Number('1 OR 1=1'), 60, DAY_ZERO)).toThrow(/account id/);
    expect(() => moveStatements(A, 0, DAY_ZERO)).toThrow(/not a move/);
    expect(() => moveStatements(A, 1.5, DAY_ZERO)).toThrow(/not a move/);
    expect(() => moveStatements(A, 60, "2026-10-30 09:16:00' OR '1'='1")).toThrow(/not an instant/);
    expect(() => weekRowSql("x' OR 1=1 --@example.test")).toThrow(/not an address/);
  });
});

describe('the daily job on a moved account', () => {
  const C = 97620;
  const EMAIL = `time-machine-${C}@example.test`;
  const realFetch = globalThis.fetch;
  let mailed: string[] = [];

  const clear = () =>
    run([
      `DELETE FROM import_logs WHERE profile_id = ${C}`,
      `DELETE FROM transactions WHERE profile_id = ${C}`,
      `DELETE FROM reminder_dedup WHERE user_id = ${C}`,
      `DELETE FROM profiles WHERE id = ${C}`,
      `DELETE FROM users WHERE id = ${C}`,
    ]);

  beforeEach(async () => {
    await clear();
    // Confirmed at the real now, as the confirm link writes day 0 (welcome.ts).
    await run([
      `INSERT INTO users (id, email, auth_provider, email_verified, token_version, plan) VALUES (${C}, '${EMAIL}', 'password', 1, 1, 'free')`,
      `INSERT INTO profiles (id, user_id, name) VALUES (${C}, ${C}, 'Week')`,
      `INSERT INTO reminder_dedup (user_id, dedup_key) VALUES (${C}, '${DAY_ZERO_KEY}')`,
    ]);
    (env as unknown as Record<string, string>).RESEND_API_KEY = 'rk_test';
    mailed = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('api.resend.com')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { to: string; subject: string };
        if (body.to === EMAIL) mailed.push(body.subject);
        return new Response('{"id":"re_tm"}', { headers: { 'Content-Type': 'application/json' } });
      }
      return realFetch(input as RequestInfo, init);
    }) as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    delete (env as unknown as Record<string, string>).RESEND_API_KEY;
    await clear();
  });

  const state = async () => {
    const row = await env.DB.prepare(weekRowSql(EMAIL)).first<WeekRow>();
    return describeWeek(row!, Date.now());
  };
  /** The daily job, at the real now: the account moved, the clock did not. */
  const daily = () => runWeekOneMails(WEEK_ONE_CRON, E, new Date());

  it('reads each day as that day: nothing on day 1, day 2 once, day 7 after an import', async () => {
    await moveTo(C, 1);
    expect((await state()).mails.day2).toBe('not yet: due from day 2');
    expect(await daily()).toEqual({ day2: 0, day7: 0 });

    await moveTo(C, 2);
    expect((await state()).mails.day2).toBe('due: the next daily job sends it');
    expect(await daily()).toEqual({ day2: 1, day7: 0 });
    expect(await daily()).toEqual({ day2: 0, day7: 0 });
    expect(mailed).toEqual(['How to get a year of statements out of your bank']);
    expect(await weekOneAhead(E, C)).toBe(true);

    // An import on day 2, written at the real now like everything the app writes.
    await run([
      `INSERT INTO import_logs (profile_id) VALUES (${C})`,
      `INSERT INTO transactions (profile_id, amount, date, import_id) VALUES (${C}, -4, date('now'), 'time-machine-import')`,
    ]);
    expect((await state()).mails.day7).toBe('not yet: due from day 7');

    await moveTo(C, 7);
    const s = await state();
    expect(s.day).toBeGreaterThanOrEqual(7);
    expect(s.mails.day7).toBe('due: the next daily job sends it');
    expect(s.settingsSwitch).toBe(true);
    expect(await daily()).toEqual({ day2: 0, day7: 1 });
    expect(mailed).toHaveLength(2);
    expect(await weekOneAhead(E, C)).toBe(false);
    expect((await state()).settingsSwitch).toBe(false);
    expect((await state()).mails.day7).toMatch(/^went at .* UTC, day 7\.\d\d$/);
  });

  it('says why a mail will not come', async () => {
    await run([
      `INSERT INTO transactions (profile_id, amount, date, import_id) VALUES (${C}, -4, date('now'), 'tm')`,
    ]);
    await moveTo(C, 2);
    expect((await state()).mails.day2).toBe('not due: the account has an import');
    await run([`UPDATE users SET week_one_mails = 0 WHERE id = ${C}`]);
    expect((await state()).mails.day7).toBe('stopped: first-week mails are off');
    await moveTo(C, 11);
    await run([`UPDATE users SET week_one_mails = 1 WHERE id = ${C}`]);
    expect((await state()).mails).toEqual({
      day2: 'never: its window closed on day 5',
      day7: 'never: its window closed on day 10',
    });
    expect(await daily()).toEqual({ day2: 0, day7: 0 });
  });
});
