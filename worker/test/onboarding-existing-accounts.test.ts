/**
 * Migration 0035 marks every account already in use as having finished the setup wizard, so
 * moving the wizard's record to the account (user_state, 0034) shows it to nobody who uses the app.
 *
 * In use means an account, a transaction or a bill in any of its profiles, or a decision in any
 * profile's settings. An account with none of those keeps meeting the wizard, as it did before.
 * A record the app already wrote is kept.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';
import { onboardingFinished, readOnboardingRecord } from '../../shared/accountState';

const API = 'https://api.example.com';

/** Each account, the profile it has, and what is in it before the migration runs. */
const WITH_ACCOUNT = 9910;
const WITH_TRANSACTION = 9911;
const WITH_BILL = 9912;
const WITH_DECISION = 9913;
const NOTHING_YET = 9914;
const NO_PROFILE = 9915;
const MID_WIZARD = 9916;
const MINE = [
  WITH_ACCOUNT,
  WITH_TRANSACTION,
  WITH_BILL,
  WITH_DECISION,
  NOTHING_YET,
  NO_PROFILE,
  MID_WIZARD,
];

/** A record the app wrote for an account that started the wizard after 0034. */
const IN_PROGRESS = JSON.stringify({
  step: 'import',
  started_at: '2026-10-11 09:00:00',
  finished_at: null,
  outcome: null,
});

const run = (query: string, ...binds: unknown[]) =>
  env.DB.prepare(query)
    .bind(...binds)
    .run();

const stored = async (userId: number) =>
  (
    await env.DB.prepare("SELECT value FROM user_state WHERE user_id = ? AND key = 'onboarding'")
      .bind(userId)
      .first<{ value: string }>()
  )?.value ?? null;

beforeAll(async () => {
  for (const id of MINE) {
    await run(`DELETE FROM user_state WHERE user_id = ?`, id);
    await run(
      `INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, email_verified, token_version)
       VALUES (?, ?, 'pbkdf2$100000$x$y', 'password', 1, 1)`,
      id,
      `existing-${id}@example.com`
    );
  }
  // A profile each (two for the one whose decision is in its second), except NO_PROFILE.
  for (const id of MINE.filter((user) => user !== NO_PROFILE)) {
    await run(
      'INSERT OR IGNORE INTO profiles (id, user_id, name) VALUES (?, ?, ?)',
      id * 10,
      id,
      'Main'
    );
  }
  await run(
    'INSERT OR IGNORE INTO profiles (id, user_id, name) VALUES (?, ?, ?)',
    WITH_DECISION * 10 + 1,
    WITH_DECISION,
    'Household'
  );
  await run(
    "INSERT INTO accounts (name, type, balance, starting_balance, profile_id) VALUES ('Checking', 'giro', 10, 10, ?)",
    WITH_ACCOUNT * 10
  );
  await run(
    "INSERT INTO transactions (description, amount, date, type, profile_id) VALUES ('Coffee', 3.5, '2026-09-01', 'expense', ?)",
    WITH_TRANSACTION * 10
  );
  await run(
    "INSERT INTO bills (name, amount, due_date, profile_id) VALUES ('Rent', 700, '2026-10-01', ?)",
    WITH_BILL * 10
  );
  await run(
    "INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES ('onboarding', 'skipped', ?)",
    WITH_DECISION * 10 + 1
  );
  // A setting that is not a decision about the wizard.
  await run(
    "INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES ('currency', 'EUR', ?)",
    NOTHING_YET * 10
  );
  await run(
    "INSERT INTO accounts (name, type, balance, starting_balance, profile_id) VALUES ('Savings', 'savings', 5, 5, ?)",
    MID_WIZARD * 10
  );
  await run(
    "INSERT INTO user_state (user_id, key, value) VALUES (?, 'onboarding', ?)",
    MID_WIZARD,
    IN_PROGRESS
  );

  // The migration, run as the deploy runs it. It marks every account in use in this shared
  // database, so the rows it adds for other test files' accounts are taken out again.
  const before = new Set(
    (
      await env.DB.prepare("SELECT user_id FROM user_state WHERE key = 'onboarding'").all<{
        user_id: number;
      }>()
    ).results.map((row) => row.user_id)
  );
  const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0035_'));
  expect(migration, 'migration 0035').toBeDefined();
  for (const query of migration!.queries) await env.DB.prepare(query).run();
  const added = (
    await env.DB.prepare("SELECT user_id FROM user_state WHERE key = 'onboarding'").all<{
      user_id: number;
    }>()
  ).results.map((row) => row.user_id);
  for (const id of added) {
    if (!before.has(id) && !MINE.includes(id)) {
      await run("DELETE FROM user_state WHERE user_id = ? AND key = 'onboarding'", id);
    }
  }
});

describe('an account in use when migration 0035 runs', () => {
  it('is marked finished, as existing, with no step and no start', async () => {
    for (const id of [WITH_ACCOUNT, WITH_TRANSACTION, WITH_BILL, WITH_DECISION]) {
      const value = await stored(id);
      expect(value, `account ${id}`).not.toBeNull();
      const record = readOnboardingRecord(JSON.parse(value!));
      expect(record, `account ${id}`).toMatchObject({
        step: null,
        started_at: null,
        outcome: 'existing',
      });
      expect(record!.finished_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(onboardingFinished(record)).toBe(true);
    }
  });

  it('reads back through the route, and a later write leaves it as it is', async () => {
    const cookie = (await sessionCookie(WITH_ACCOUNT)).split(';')[0]!;
    const before = await stored(WITH_ACCOUNT);

    const read = await SELF.fetch(`${API}/api/account/state`, { headers: { Cookie: cookie } });
    expect(((await read.json()) as { onboarding: unknown }).onboarding).toEqual(
      JSON.parse(before!)
    );
    const write = await SELF.fetch(`${API}/api/account/state/onboarding`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'space', outcome: 'completed' }),
    });
    expect(write.status).toBe(200);

    // The same text, not just the same record: the migration writes the keys in the order the
    // Worker does, so a finished record is answered without being written again.
    expect(await stored(WITH_ACCOUNT)).toBe(before);
  });
});

describe('an account not in use when migration 0035 runs', () => {
  it('gets no record, so it still meets the wizard', async () => {
    expect(await stored(NOTHING_YET)).toBeNull();
    expect(await stored(NO_PROFILE)).toBeNull();
  });
});

describe('an account with a record already', () => {
  it('keeps the record the app wrote', async () => {
    expect(await stored(MID_WIZARD)).toBe(IN_PROGRESS);
  });
});
