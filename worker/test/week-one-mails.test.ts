/**
 * The week-one mails (weekOne.ts): day 2 only while nothing is imported, day 7 only after an
 * import, each inside its window of days after the address was confirmed, neither twice, to every
 * confirmed account whatever its plan, and to none that stopped them or existed before them.
 *
 * Day 0 is the account's Welcome claim (reminder_dedup 'welcome'), seeded here with the sent_at
 * each case needs. The clock is a fixed instant years ahead, so no other test file's account,
 * whose claim carries the real time, ever falls in a window.
 */
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderWeekOneDay7 } from '../src/emailTemplates';
import { runWeekOneMails, WEEK_ONE, WEEK_ONE_CRON } from '../src/weekOne';

const NOW = new Date('2030-06-15T08:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FIRST_ID = 97100;

/** An instant as SQLite writes it. */
const sqlite = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

const realFetch = globalThis.fetch;
let mails: Mail[] = [];
/** How Resend answers: a status, or 'throw' for a network failure. */
let resend: number | 'throw' = 200;
/** Every request made to Resend for an account of this file, taken or not. */
let attempts = 0;
let nextId = FIRST_ID;
const mine: number[] = [];

async function removeAccounts(): Promise<void> {
  if (mine.length === 0) return;
  const ids = mine.join(', ');
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM transactions WHERE profile_id IN (${ids})`),
    env.DB.prepare(`DELETE FROM bills WHERE profile_id IN (${ids})`),
    env.DB.prepare(`DELETE FROM loans WHERE profile_id IN (${ids})`),
    env.DB.prepare(`DELETE FROM reminder_dedup WHERE user_id IN (${ids})`),
    env.DB.prepare(`DELETE FROM reminder_sends WHERE user_id IN (${ids})`),
    env.DB.prepare(`DELETE FROM profiles WHERE id IN (${ids})`),
    env.DB.prepare(`DELETE FROM users WHERE id IN (${ids})`),
  ]);
  mine.length = 0;
}

interface AccountOptions {
  /** How long before NOW the address was confirmed; null for no Welcome claim at all. */
  confirmedAgo?: number | null;
  plan?: string;
  provider?: 'password' | 'google';
  verified?: 0 | 1;
  unsubscribed?: 0 | 1;
  weekOne?: 0 | 1;
}

/** A new account with one profile of the same id, confirmed `confirmedAgo` before NOW. */
async function account(opts: AccountOptions = {}): Promise<{ id: number; email: string }> {
  const id = nextId++;
  mine.push(id);
  const email = `week-one-${id}@example.com`;
  const provider = opts.provider ?? 'password';
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, auth_provider, provider_id, email_verified,
                          token_version, plan, notifications_unsubscribed, week_one_mails)
       VALUES (?, ?, 'pbkdf2$100000$x$y', ?, ?, ?, 1, ?, ?, ?)`
    ).bind(
      id,
      email,
      provider,
      provider === 'google' ? `google-sub-${id}` : null,
      opts.verified ?? 1,
      opts.plan ?? 'free',
      opts.unsubscribed ?? 0,
      opts.weekOne ?? 1
    ),
    env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)').bind(
      id,
      id,
      `Week one ${id}`
    ),
  ]);
  const ago = opts.confirmedAgo === undefined ? 2 * DAY : opts.confirmedAgo;
  if (ago !== null) {
    await env.DB.prepare(
      "INSERT INTO reminder_dedup (user_id, dedup_key, sent_at) VALUES (?, 'welcome', ?)"
    )
      .bind(id, sqlite(NOW.getTime() - ago))
      .run();
  }
  return { id, email };
}

interface Tx {
  date: string;
  amount?: number;
  type?: string;
  imported?: boolean;
  categoryId?: number | null;
}

async function transactions(profileId: number, rows: Tx[]): Promise<void> {
  await env.DB.batch(
    rows.map((row) =>
      env.DB.prepare(
        `INSERT INTO transactions (description, amount, date, type, category_id, currency, profile_id, import_id)
         VALUES ('Sample entry', ?, ?, ?, ?, 'EUR', ?, ?)`
      ).bind(
        row.amount ?? 12.5,
        row.date,
        row.type ?? 'expense',
        row.categoryId === undefined ? 1 : row.categoryId,
        profileId,
        row.imported === false ? null : 'import-sample'
      )
    )
  );
}

const imported = (id: number) => transactions(id, [{ date: '2030-05-02' }]);

const run = (now = NOW, limit?: number) => runWeekOneMails(WEEK_ONE_CRON, env, now, limit);

const mailsTo = (email: string) => mails.filter((m) => m.to === email);

const claimed = async (id: number, key: string) =>
  (await env.DB.prepare('SELECT 1 FROM reminder_dedup WHERE user_id = ? AND dedup_key = ?')
    .bind(id, key)
    .first()) !== null;

beforeEach(async () => {
  await removeAccounts();
  (env as unknown as Record<string, string>).RESEND_API_KEY = 'rk_test';
  mails = [];
  resend = 200;
  attempts = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('api.resend.com')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as Mail;
      if (!String(body.to).startsWith('week-one-')) {
        return new Response('{"id":"re_other"}', {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      attempts += 1;
      if (resend === 'throw') throw new Error('network down');
      if (resend !== 200) return new Response('{"message":"no"}', { status: resend });
      mails.push(body);
      return new Response('{"id":"re_1"}', { headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete (env as unknown as Record<string, string>).RESEND_API_KEY;
  await removeAccounts();
});

describe('day 2', () => {
  it('goes to a confirmed Free account two days after it confirmed, with nothing imported', async () => {
    const a = await account({ plan: 'free', confirmedAgo: 2 * DAY });
    await run();

    const [mail, ...rest] = mailsTo(a.email);
    expect(rest).toHaveLength(0);
    expect(mail!.subject).toBe('How to get a year of statements out of your bank');
    expect(await claimed(a.id, WEEK_ONE.day2.key)).toBe(true);
    // Not a reminder: nothing counts against a plan's monthly reminders.
    const sends = await env.DB.prepare('SELECT 1 FROM reminder_sends WHERE user_id = ?')
      .bind(a.id)
      .first();
    expect(sends).toBeNull();
  });

  it('carries its own stop link, in the footer and as one-click headers', async () => {
    const a = await account();
    await run();

    const [mail] = mailsTo(a.email);
    const token = (await env.DB.prepare('SELECT unsubscribe_token FROM users WHERE id = ?')
      .bind(a.id)
      .first<{ unsubscribe_token: string }>())!.unsubscribe_token;
    const stop = `http://localhost:8787/api/notifications/unsubscribe?token=${token}&list=week-one`;
    expect(mail!.headers).toEqual({
      'List-Unsubscribe': `<${stop}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(mail!.text).toContain(`Stop first-week mails: ${stop}`);
    expect(mail!.html).toContain(stop.replace('&', '&amp;'));
  });

  it('goes to a paid account the same way', async () => {
    const a = await account({ plan: 'advanced' });
    await run();
    expect(mailsTo(a.email)).toHaveLength(1);
  });

  it('never goes once anything is imported, in any profile', async () => {
    const a = await account();
    await imported(a.id);
    const b = await account();
    await env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)')
      .bind(b.id + 50, b.id, `Second ${b.id}`)
      .run();
    mine.push(b.id + 50);
    await imported(b.id + 50);
    await run();

    expect(mailsTo(a.email)).toHaveLength(0);
    expect(mailsTo(b.email)).toHaveLength(0);
    expect(await claimed(a.id, WEEK_ONE.day2.key)).toBe(false);
  });

  it('still goes when the only entries were typed in by hand', async () => {
    const a = await account();
    await transactions(a.id, [{ date: '2030-06-01', imported: false }]);
    await run();
    expect(mailsTo(a.email)).toHaveLength(1);
  });

  it('waits a full two days, and gives up after five', async () => {
    const early = await account({ confirmedAgo: 2 * DAY - 60_000 });
    const late = await account({ confirmedAgo: 5 * DAY });
    const lastChance = await account({ confirmedAgo: 5 * DAY - 60_000 });
    await run();

    expect(mailsTo(early.email)).toHaveLength(0);
    expect(mailsTo(late.email)).toHaveLength(0);
    expect(mailsTo(lastChance.email)).toHaveLength(1);
  });
});

describe('day 7', () => {
  it('goes a week after confirming, once something is imported', async () => {
    const a = await account({ confirmedAgo: 7 * DAY });
    await imported(a.id);
    await run();

    const [mail, ...rest] = mailsTo(a.email);
    expect(rest).toHaveLength(0);
    expect(mail!.subject).toBe('Your first week in Token Circles');
    expect(mail!.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(await claimed(a.id, WEEK_ONE.day7.key)).toBe(true);
  });

  it('never goes without an import, and day 2 does not either by then', async () => {
    const a = await account({ confirmedAgo: 7 * DAY });
    await transactions(a.id, [{ date: '2030-06-01', imported: false }]);
    await run();
    expect(mailsTo(a.email)).toHaveLength(0);
  });

  it('waits the full week, and gives up after ten days', async () => {
    const early = await account({ confirmedAgo: 7 * DAY - 60_000 });
    const late = await account({ confirmedAgo: 10 * DAY });
    const lastChance = await account({ confirmedAgo: 10 * DAY - 60_000 });
    for (const a of [early, late, lastChance]) await imported(a.id);
    await run();

    expect(mailsTo(early.email)).toHaveLength(0);
    expect(mailsTo(late.email)).toHaveLength(0);
    expect(mailsTo(lastChance.email)).toHaveLength(1);
  });

  it('says what the week found in counts, from the imports, and never an amount', async () => {
    const a = await account({ confirmedAgo: 7 * DAY });
    await transactions(a.id, [
      { date: '2030-04-03', amount: 4321.98 },
      { date: '2030-04-09', amount: 8765.43 },
      { date: '2030-04-21', amount: 1234.56, categoryId: null },
      { date: '2030-05-02', amount: 2468.13 },
      { date: '2030-05-11', amount: 1357.91, type: 'income' },
      { date: '2030-05-19', amount: 9753.12, type: 'transfer', categoryId: null },
      { date: '2030-06-01', amount: 3141.59, imported: false },
    ]);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO bills (profile_id, name, amount, frequency, due_date, is_active, type) VALUES (?, 'Sample stream', 9876.54, 'monthly', '2030-06-20', 1, 'subscription')"
      ).bind(a.id),
      env.DB.prepare(
        "INSERT INTO bills (profile_id, name, amount, frequency, due_date, is_active, type) VALUES (?, 'Sample old', 11, 'monthly', '2030-06-20', 0, 'bill')"
      ).bind(a.id),
    ]);
    await run();

    const [mail] = mailsTo(a.email);
    // The stop link's token is random hex, which could hold any four digits.
    const token = (await env.DB.prepare('SELECT unsubscribe_token FROM users WHERE id = ?')
      .bind(a.id)
      .first<{ unsubscribe_token: string }>())!.unsubscribe_token;
    const parts = [mail!.subject, mail!.html, mail!.text].map((part) => part.replaceAll(token, ''));
    // Six came in by an import; April and May hold three each, June one.
    expect(mail!.text).toContain('Entries imported: 6');
    expect(mail!.text).toContain('Months tracked of the last 13: 2');
    expect(mail!.text).toContain('Subscriptions you track: 1');
    expect(mail!.text).not.toContain('Bills you track');
    // One of the six entries that take a category has none: the transfer does not count.
    expect(mail!.text).toContain('Entries without a category: 1');
    expect(mail!.text).toContain('Import the rest of your year');
    expect(mail!.text).toContain('2 of the last 13 months are tracked.');
    expect(mail!.text).toContain('Open Import: http://localhost:3800/#import');
    for (const part of parts) {
      for (const amount of ['4321', '4,321', '8765', '8,765', '1234', '1,234', '2468', '1357']) {
        expect(part).not.toContain(amount);
      }
      for (const amount of ['9753', '3141', '9876', '9,876']) expect(part).not.toContain(amount);
      expect(part).not.toMatch(/[€$£]|EUR/);
    }
  });

  it('reads the profile that holds the most imports', async () => {
    const a = await account({ confirmedAgo: 7 * DAY });
    const other = a.id + 50;
    await env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)')
      .bind(other, a.id, `Second ${a.id}`)
      .run();
    mine.push(other);
    await imported(a.id);
    await transactions(other, [
      { date: '2030-03-01' },
      { date: '2030-03-02' },
      { date: '2030-03-03' },
    ]);
    await run();
    expect(mailsTo(a.email)[0]!.text).toContain('Entries imported: 3');
  });
});

describe('neither twice', () => {
  it('sends each once, however often the job runs', async () => {
    const a = await account({ confirmedAgo: 2 * DAY });
    await run();
    await run();
    await run(new Date(NOW.getTime() + DAY));
    await Promise.all([
      run(new Date(NOW.getTime() + 2 * DAY)),
      run(new Date(NOW.getTime() + 2 * DAY)),
    ]);
    expect(mailsTo(a.email)).toHaveLength(1);
  });

  it('sends day 2 and then day 7 to an account that imports in between', async () => {
    const a = await account({ confirmedAgo: 2 * DAY });
    await run();
    await imported(a.id);
    await run(new Date(NOW.getTime() + 5 * DAY));
    await run(new Date(NOW.getTime() + 6 * DAY));
    expect(mailsTo(a.email).map((m) => m.subject)).toEqual([
      'How to get a year of statements out of your bank',
      'Your first week in Token Circles',
    ]);
  });

  it('only on the daily cron', async () => {
    const a = await account();
    await runWeekOneMails('0 9 * * 1', env, NOW);
    expect(mailsTo(a.email)).toHaveLength(0);
  });
});

describe('who gets none', () => {
  it('an account that unsubscribed from every mail', async () => {
    const a = await account({ unsubscribed: 1 });
    const b = await account({ unsubscribed: 1, confirmedAgo: 7 * DAY });
    await imported(b.id);
    await run();
    expect(mailsTo(a.email)).toHaveLength(0);
    expect(mailsTo(b.email)).toHaveLength(0);
  });

  it('an account that switched them off', async () => {
    const a = await account({ weekOne: 0 });
    const b = await account({ weekOne: 0, confirmedAgo: 7 * DAY });
    await imported(b.id);
    await run();
    expect(mailsTo(a.email)).toHaveLength(0);
    expect(mailsTo(b.email)).toHaveLength(0);
  });

  it('a password account still waiting for its confirm link', async () => {
    const a = await account({ verified: 0 });
    await run();
    expect(mailsTo(a.email)).toHaveLength(0);
  });

  it('an account with no Welcome claim, so no day it confirmed', async () => {
    const a = await account({ provider: 'google', verified: 0, confirmedAgo: null });
    await run();
    expect(mailsTo(a.email)).toHaveLength(0);
  });

  it('an account that existed before migration 0040', async () => {
    const before = await account({ confirmedAgo: 2 * DAY });
    const beforeImported = await account({ confirmedAgo: 7 * DAY });
    await imported(beforeImported.id);

    // The migration, run as the deploy runs it. It marks every account there is, so the rows it
    // adds for other test files' accounts are taken out again.
    const marked = async () =>
      new Set(
        (
          await env.DB.prepare(
            "SELECT user_id || ':' || dedup_key AS row FROM reminder_dedup WHERE dedup_key LIKE 'week-one:%'"
          ).all<{ row: string }>()
        ).results.map((r) => r.row)
      );
    const was = await marked();
    const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0040_'));
    expect(migration, 'migration 0040').toBeDefined();
    for (const query of migration!.queries) await env.DB.prepare(query).run();
    for (const row of await marked()) {
      const [id, ...key] = row.split(':');
      if (!was.has(row) && !mine.includes(Number(id))) {
        await env.DB.prepare('DELETE FROM reminder_dedup WHERE user_id = ? AND dedup_key = ?')
          .bind(Number(id), key.join(':'))
          .run();
      }
    }
    const after = await account({ confirmedAgo: 2 * DAY });

    await run();
    expect(mailsTo(before.email)).toHaveLength(0);
    expect(mailsTo(beforeImported.email)).toHaveLength(0);
    expect(mailsTo(after.email)).toHaveLength(1);
  });
});

describe('when Resend does not take a mail', () => {
  it('gives the claim back on a refusal, and stops the run on a 429', async () => {
    const first = await account({ confirmedAgo: 4 * DAY });
    const second = await account({ confirmedAgo: 3 * DAY });
    resend = 429;
    expect(await run()).toEqual({ day2: 0, day7: 0 });
    // The first refusal ends the run: the second account is not tried.
    expect(attempts).toBe(1);
    expect(await claimed(first.id, WEEK_ONE.day2.key)).toBe(false);
    expect(await claimed(second.id, WEEK_ONE.day2.key)).toBe(false);

    resend = 200;
    await run(new Date(NOW.getTime() + 12 * HOUR));
    expect(mailsTo(first.email)).toHaveLength(1);
    expect(mailsTo(second.email)).toHaveLength(1);
  });

  it('keeps the claim when the mail may have gone: a 5xx or a network failure', async () => {
    const a = await account({ confirmedAgo: 2 * DAY });
    const b = await account({ confirmedAgo: 2 * DAY });
    resend = 500;
    await run(NOW, 1);
    resend = 'throw';
    await run(NOW, 1);
    expect(await claimed(a.id, WEEK_ONE.day2.key)).toBe(true);
    expect(await claimed(b.id, WEEK_ONE.day2.key)).toBe(true);

    resend = 200;
    await run(new Date(NOW.getTime() + DAY));
    expect(mails).toHaveLength(0);
  });
});

describe('the batch', () => {
  it('sends at most the limit a run, oldest first, and the rest next time', async () => {
    const oldest = await account({ confirmedAgo: 4 * DAY });
    const middle = await account({ confirmedAgo: 3 * DAY });
    const newest = await account({ confirmedAgo: 2 * DAY });
    expect(await run(NOW, 2)).toEqual({ day2: 2, day7: 0 });
    expect(mails.map((m) => m.to)).toEqual([oldest.email, middle.email]);
    await run(new Date(NOW.getTime() + DAY), 2);
    expect(mailsTo(newest.email)).toHaveLength(1);
  });
});

describe('the day-7 mail itself', () => {
  const counts = {
    entriesImported: 1284,
    monthsTracked: 12,
    windowMonths: 13,
    subscriptions: 0,
    bills: 0,
    uncategorised: 0,
  };

  it('leaves out a count of nothing, and the step when none applies', () => {
    const { text } = renderWeekOneDay7({ counts, step: null });
    expect(text).toContain('Entries imported: 1,284');
    expect(text).toContain('Months tracked of the last 13: 12');
    expect(text).not.toMatch(/Subscriptions you track|Bills you track|without a category/);
    expect(text).not.toContain('One next step');
  });

  it('says what came in when no month is tracked yet', () => {
    const mail = renderWeekOneDay7({
      counts: { ...counts, monthsTracked: 0, entriesImported: 2 },
      step: null,
    });
    expect(mail.html).toContain('Your first import brought in 2 entries.');
  });
});
