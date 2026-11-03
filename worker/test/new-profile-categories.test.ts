/**
 * A profile starts with the default categories (profileData.ts), on every path that makes one:
 * sign-up, a first Google sign-in, a new profile from the profile menu or setup, and the profile an
 * account without one is given on its first request. Before, only "Clear data" and "Reset to
 * defaults" wrote them, so a new space had none and quick add "coffee 4.50" had nowhere to go.
 *
 * What it leaves alone: a profile made before keeps what it has, empty or not; a profile the plan
 * refuses adds no categories anywhere; a restore brings the backup's categories and no others; an
 * import reuses a default by its name, in any case, instead of adding a second one.
 *
 * The local-first twin: frontend/src/core/storage/__tests__/newProfileCategories.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveGoogleUser } from '../src/auth';
import { DEFAULT_CATEGORIES, defaultCategoryInserts } from '../src/profileData';
import { sessionCookie } from './helpers/session';
import { signUpConfirmed } from './helpers/sign-up';

const BASE = 'https://example.com';
const PASSWORD = 'correct horse battery staple';
const SIGN_UP = 'new-space@example.test';
const GOOGLE = 'new-space-google@example.test';
const OLD_USER = 8810;
const OLD_EMPTY = 88100;
const OLD_OWN = 88101;
const NO_PROFILE_USER = 8811;

const DEFAULT_NAMES = DEFAULT_CATEGORIES.map((c) => c.name).sort();

interface Row {
  name: string;
  type: string;
  kind: string | null;
  icon: string;
}

async function categoriesOf(profileId: number): Promise<Row[]> {
  const { results } = await env.DB.prepare(
    'SELECT name, type, kind, icon FROM categories WHERE profile_id = ? ORDER BY name'
  )
    .bind(profileId)
    .all<Row>();
  return results ?? [];
}

async function profilesOf(userId: number): Promise<{ id: number; name: string }[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, name FROM profiles WHERE user_id = ? ORDER BY id'
  )
    .bind(userId)
    .all<{ id: number; name: string }>();
  return results ?? [];
}

async function userIdOf(email: string): Promise<number> {
  const row = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number }>();
  if (!row) throw new Error(`no account for ${email}`);
  return row.id;
}

/** Everything this file wrote: its accounts, their profiles and the categories in them. */
async function forgetAccounts(): Promise<void> {
  const { results } = await env.DB.prepare(
    'SELECT id FROM users WHERE email IN (?, ?) OR id IN (?, ?)'
  )
    .bind(SIGN_UP, GOOGLE, OLD_USER, NO_PROFILE_USER)
    .all<{ id: number }>();
  for (const { id } of results ?? []) {
    await env.DB.batch([
      env.DB.prepare(
        'DELETE FROM transactions WHERE profile_id IN (SELECT id FROM profiles WHERE user_id = ?)'
      ).bind(id),
      env.DB.prepare(
        'DELETE FROM categories WHERE profile_id IN (SELECT id FROM profiles WHERE user_id = ?)'
      ).bind(id),
      env.DB.prepare(
        'DELETE FROM settings WHERE profile_id IN (SELECT id FROM profiles WHERE user_id = ?)'
      ).bind(id),
      env.DB.prepare('DELETE FROM profiles WHERE user_id = ?').bind(id),
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
    ]);
  }
  await env.DB.prepare('DELETE FROM categories WHERE profile_id IN (?, ?)')
    .bind(OLD_EMPTY, OLD_OWN)
    .run();
  // Every test here signs up, more often than the sign-up limit allows one address.
  await env.DB.prepare('DELETE FROM rate_limits').run();
}

async function signedInAs(userId: number): Promise<string> {
  return (await sessionCookie(userId)).split(';')[0]!;
}

function call(
  cookie: string,
  path: string,
  init: RequestInit & { profile?: number } = {}
): Promise<Response> {
  const { profile, ...rest } = init;
  return SELF.fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      ...(profile ? { 'X-Profile-Id': String(profile) } : {}),
      ...(rest.headers ?? {}),
    },
  });
}

beforeEach(forgetAccounts);

describe('a new profile starts with the default categories', () => {
  it('after sign-up, with Groceries and Eating out and their kinds', async () => {
    await signUpConfirmed(BASE, SIGN_UP, PASSWORD);
    const [profile] = await profilesOf(await userIdOf(SIGN_UP));
    const rows = await categoriesOf(profile!.id);
    expect(rows.map((r) => r.name)).toEqual(DEFAULT_NAMES);
    expect(rows.find((r) => r.name === 'Eating out')).toMatchObject({
      type: 'expense',
      kind: 'eating_out',
      icon: 'utensils',
    });
    expect(rows.find((r) => r.name === 'Groceries')).toMatchObject({ kind: 'groceries' });
    expect(rows.find((r) => r.name === 'Salary')).toMatchObject({ type: 'income', kind: null });
  });

  it('after a first Google sign-in, and only once on a repeat sign-in', async () => {
    const claims = {
      sub: 'google-new-space',
      email: GOOGLE,
      email_verified: 'true',
    } as Parameters<typeof resolveGoogleUser>[1];
    const first = await resolveGoogleUser(env.DB, claims);
    expect(first.created).toBe(true);
    await resolveGoogleUser(env.DB, claims);
    const [profile] = await profilesOf(first.userId);
    expect((await categoriesOf(profile!.id)).map((r) => r.name)).toEqual(DEFAULT_NAMES);
  });

  it('when a profile is added, and the profiles already there keep theirs', async () => {
    await signUpConfirmed(BASE, SIGN_UP, PASSWORD);
    const userId = await userIdOf(SIGN_UP);
    const cookie = await signedInAs(userId);
    const [personal] = await profilesOf(userId);
    await env.DB.prepare(
      "INSERT INTO categories (name, type, color, icon, profile_id) VALUES ('Pets', 'expense', '#888888', 'tag', ?)"
    )
      .bind(personal!.id)
      .run();

    const res = await call(cookie, '/api/profiles', {
      method: 'POST',
      body: JSON.stringify({ name: 'Household' }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };
    expect((await categoriesOf(id)).map((r) => r.name)).toEqual(DEFAULT_NAMES);
    expect((await categoriesOf(personal!.id)).map((r) => r.name)).toEqual(
      [...DEFAULT_NAMES, 'Pets'].sort()
    );

    // The new profile's own list answers them too, as the app reads it.
    const listed = await call(cookie, '/api/categories', { profile: id });
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { name: string }[]).map((c) => c.name).sort()).toEqual(
      DEFAULT_NAMES
    );
  });

  it('adds none when the plan refuses the profile', async () => {
    await signUpConfirmed(BASE, SIGN_UP, PASSWORD);
    const userId = await userIdOf(SIGN_UP);
    const cookie = await signedInAs(userId);
    // The free plan holds two profiles: the second is made, the third refused.
    const second = await call(cookie, '/api/profiles', {
      method: 'POST',
      body: JSON.stringify({ name: 'Household' }),
    });
    expect(second.status).toBe(201);
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM categories').first<{
      n: number;
    }>();
    const third = await call(cookie, '/api/profiles', {
      method: 'POST',
      body: JSON.stringify({ name: 'Side business' }),
    });
    expect(third.status).toBe(403);
    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM categories').first<{
      n: number;
    }>();
    expect(after?.n).toBe(before?.n);
    expect((await profilesOf(userId)).map((p) => p.name)).toEqual([
      'Personal Profile',
      'Household',
    ]);
  });

  it('for an account that has no profile yet, once, however many requests ask', async () => {
    await env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'no-profile@example.test', 'password', 1)"
    )
      .bind(NO_PROFILE_USER)
      .run();
    const cookie = await signedInAs(NO_PROFILE_USER);
    const answers = await Promise.all([
      call(cookie, '/api/profiles'),
      call(cookie, '/api/categories'),
      call(cookie, '/api/profiles'),
    ]);
    expect(answers.map((r) => r.status)).toEqual([200, 200, 200]);
    const profiles = await profilesOf(NO_PROFILE_USER);
    expect(profiles.map((p) => p.name)).toEqual(['Personal Profile']);
    expect((await categoriesOf(profiles[0]!.id)).map((r) => r.name)).toEqual(DEFAULT_NAMES);
  });
});

describe('what keeps its own categories', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'old-space@example.test', 'password', 1, 'advanced')"
      ).bind(OLD_USER),
      env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Before')").bind(
        OLD_EMPTY,
        OLD_USER
      ),
      env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Own set')").bind(
        OLD_OWN,
        OLD_USER
      ),
      env.DB.prepare(
        "INSERT INTO categories (name, type, color, icon, profile_id) VALUES ('Food', 'expense', '#888888', 'tag', ?)"
      ).bind(OLD_OWN),
    ]);
  });

  it('a profile made empty before stays empty, and one with its own set keeps only that', async () => {
    const cookie = await signedInAs(OLD_USER);
    for (const profile of [OLD_EMPTY, OLD_OWN]) {
      expect((await call(cookie, '/api/categories', { profile })).status).toBe(200);
      expect((await call(cookie, '/api/profiles', { profile })).status).toBe(200);
    }
    expect(await categoriesOf(OLD_EMPTY)).toEqual([]);
    expect((await categoriesOf(OLD_OWN)).map((r) => r.name)).toEqual(['Food']);
  });

  it('the seeding adds only the names a profile lacks, compared without case, however often it runs', async () => {
    await env.DB.prepare(
      "INSERT INTO categories (name, type, color, icon, profile_id) VALUES ('groceries', 'expense', '#888888', 'tag', ?)"
    )
      .bind(OLD_OWN)
      .run();
    const seed = () => defaultCategoryInserts(env.DB, 'SELECT ?', OLD_OWN);
    await env.DB.batch(seed());
    await env.DB.batch(seed());
    const names = (await categoriesOf(OLD_OWN)).map((r) => r.name);
    expect(names.filter((n) => n.toLowerCase() === 'groceries')).toEqual(['groceries']);
    expect(names).toHaveLength(DEFAULT_NAMES.length + 1); // and Food, which was there
  });

  it('an import reuses a default by its name, in any case, and adds no second one', async () => {
    await signUpConfirmed(BASE, SIGN_UP, PASSWORD);
    const userId = await userIdOf(SIGN_UP);
    const cookie = await signedInAs(userId);
    const [profile] = await profilesOf(userId);
    const res = await call(cookie, '/api/import/execute', {
      method: 'POST',
      profile: profile!.id,
      body: JSON.stringify({
        rows: [
          ['2026-07-01', 'Market', '-10', 'groceries'],
          ['2026-07-02', 'Noodle bar', '-15', 'EATING OUT'],
          ['2026-07-03', 'Vet', '-40', 'Pets'],
        ],
        mapping: { date: 0, description: 1, amount: 2, category: 3 },
      }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { categories_created: number }).categories_created).toBe(1);
    const names = (await categoriesOf(profile!.id)).map((r) => r.name.toLowerCase());
    expect(names.filter((n) => n === 'groceries')).toHaveLength(1);
    expect(names.filter((n) => n === 'eating out')).toHaveLength(1);
    expect(names).toHaveLength(DEFAULT_NAMES.length + 1);
  });

  it('a restore brings the backup categories and no defaults beside them', async () => {
    await signUpConfirmed(BASE, SIGN_UP, PASSWORD);
    const userId = await userIdOf(SIGN_UP);
    const cookie = await signedInAs(userId);
    const res = await call(cookie, '/api/import', {
      method: 'POST',
      body: JSON.stringify({
        version: '3.0.0',
        export_date: '2026-07-23T00:00:00.000Z',
        storage_mode: 'serverless',
        profiles: [{ id: 1, name: 'Browser', created_at: '2026-01-01' }],
        categories: [
          { id: 1, profile_id: 1, name: 'Food', type: 'expense', color: '#ff0000' },
          { id: 2, profile_id: 1, name: 'Groceries', type: 'expense', color: '#00ff00' },
        ],
        accounts: [],
        transactions: [],
        budgets: [],
        goals: [],
        loans: [],
        tags: [],
        settings: { currency: 'EUR' },
      }),
    });
    expect(res.status).toBe(200);
    const profiles = await profilesOf(userId);
    expect(profiles.map((p) => p.name)).toEqual(['Browser']);
    expect((await categoriesOf(profiles[0]!.id)).map((r) => r.name)).toEqual(['Food', 'Groceries']);
  });
});
