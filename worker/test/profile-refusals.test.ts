/**
 * What the profile routes refuse, and how they say it.
 *
 * A refused name answers 400 `{ error, fields }` (shared/refusal.ts), by the rules in
 * shared/profileSchema.ts, which local-first and the profile forms run too. Before:
 *
 * - A blank name was "Name is required" with no field; a name of any length was stored.
 * - A duplicate was compared exactly, so "Household" and "household" were two profiles, and was
 *   "A profile with this name already exists" with no field.
 * - A rename to another profile's name in another case was stored, and one to another profile's
 *   exact name was refused in those words, with no field.
 * - A rename without a name changed nothing and answered 200, and one over 100 characters was
 *   stored.
 * - Deleting the last profile said "Cannot delete your only profile".
 *
 * A rename that sends the stored name back, or only re-cases it, is not checked against the length
 * or the other names, so a profile saved under older rules can still be tidied. The local-first
 * twin: frontend/src/core/storage/__tests__/profileRefusals.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import { PROFILE_MESSAGES as M } from '../../shared/profileSchema';

const USER = 6402;
const OTHER_USER = 6403;
const HOUSEHOLD = 64020;
const SIDE = 64021;
const OLD = 64022; // a name over 100 characters, stored before the cap
const TWIN = 64023; // "household ", which differs from Household only in case and space
const ELSEWHERE = 64030;
const LONG = 'Weekend house by the lake '.repeat(5).trim();

let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM accounts WHERE profile_id IN (?, ?, ?, ?, ?)').bind(
      HOUSEHOLD,
      SIDE,
      OLD,
      TWIN,
      ELSEWHERE
    ),
    env.DB.prepare('DELETE FROM profiles WHERE user_id IN (?, ?)').bind(USER, OTHER_USER),
    env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(USER, OTHER_USER),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'profile-refusals@example.com', 'password', 1, 'advanced')"
    ).bind(USER),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'profile-elsewhere@example.com', 'password', 1)"
    ).bind(OTHER_USER),
    env.DB.prepare(
      "INSERT INTO profiles (id, user_id, name, created_at) VALUES (?, ?, 'Household', '2026-01-02 09:00:00')"
    ).bind(HOUSEHOLD, USER),
    env.DB.prepare(
      "INSERT INTO profiles (id, user_id, name, created_at) VALUES (?, ?, 'Side business', '2026-01-03 09:00:00')"
    ).bind(SIDE, USER),
    env.DB.prepare(
      "INSERT INTO profiles (id, user_id, name, created_at) VALUES (?, ?, ?, '2026-01-04 09:00:00')"
    ).bind(OLD, USER, LONG),
    env.DB.prepare(
      "INSERT INTO profiles (id, user_id, name, created_at) VALUES (?, ?, 'household ', '2026-01-05 09:00:00')"
    ).bind(TWIN, USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Travel')").bind(
      ELSEWHERE,
      OTHER_USER
    ),
  ]);
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0];
});

function send(path: string, method: string, body?: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(HOUSEHOLD),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function names(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'SELECT name FROM profiles WHERE user_id = ? ORDER BY id'
  )
    .bind(USER)
    .all<{ name: string }>();
  return results.map((r) => r.name);
}

const STORED = ['Household', 'Side business', LONG, 'household '];
const taken = (name: string) => ({
  error: `You already have a profile called "${name}". Choose another name.`,
  fields: { name: `You already have a profile called "${name}". Choose another name.` },
});

describe('POST /api/profiles', () => {
  it('refuses a blank name at the field', async () => {
    for (const body of [{}, { name: '' }, { name: '   ' }, { name: 7 }]) {
      const res = await send('/api/profiles', 'POST', body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: M.name, fields: { name: M.name } });
    }
    expect(await names()).toEqual(STORED);
  });

  it('refuses a name over 100 characters', async () => {
    const res = await send('/api/profiles', 'POST', { name: 'x'.repeat(101) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: M.nameLength, fields: { name: M.nameLength } });
    expect(await names()).toEqual(STORED);
  });

  it('refuses a name another profile has in another case, quoting it', async () => {
    const res = await send('/api/profiles', 'POST', { name: ' SIDE BUSINESS ' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(taken('Side business'));
    expect(await names()).toEqual(STORED);
  });

  it("allows a name only another person's profile has", async () => {
    const res = await send('/api/profiles', 'POST', { name: 'Travel' });
    expect(res.status).toBe(201);
  });

  it("refuses one past the plan's cap, in the words the dialog offers an upgrade for", async () => {
    await env.DB.prepare("UPDATE users SET plan = 'free' WHERE id = ?").bind(USER).run();
    const res = await send('/api/profiles', 'POST', { name: 'Holiday house' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'Your plan allows up to 2 profiles. Upgrade for more.',
    });
    expect(await names()).toEqual(STORED);
  });

  it('answers 201 with the new profile and its empty counts', async () => {
    const res = await send('/api/profiles', 'POST', { name: '  Holiday house ' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      id: expect.any(Number),
      name: 'Holiday house',
      created_at: expect.any(String),
      transaction_count: 0,
      account_count: 0,
      budget_count: 0,
    });
    expect(await names()).toEqual([...STORED, 'Holiday house']);
  });
});

describe('renaming a profile', () => {
  for (const method of ['PUT', 'PATCH']) {
    it(`${method} refuses a blank name, and a body without one`, async () => {
      for (const body of [{ name: ' ' }, {}]) {
        const res = await send(`/api/profiles/${SIDE}`, method, body);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: M.name, fields: { name: M.name } });
      }
      expect(await names()).toEqual(STORED);
    });

    it(`${method} refuses another profile's name in another case`, async () => {
      const res = await send(`/api/profiles/${SIDE}`, method, { name: 'HOUSEHOLD' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(taken('Household'));
      expect(await names()).toEqual(STORED);
    });
  }

  it('answers the renamed profile', async () => {
    const res = await send(`/api/profiles/${SIDE}`, 'PUT', { name: ' Freelance ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: SIDE,
      name: 'Freelance',
      created_at: '2026-01-03 09:00:00',
    });
    expect(await names()).toEqual(['Household', 'Freelance', LONG, 'household ']);
  });

  it('saves a re-cased name of its own', async () => {
    const res = await send(`/api/profiles/${SIDE}`, 'PUT', { name: 'SIDE Business' });
    expect(res.status).toBe(200);
    expect(await names()).toEqual(['Household', 'SIDE Business', LONG, 'household ']);
  });

  it('saves an older name over 100 characters sent back, and refuses a change to it', async () => {
    const same = await send(`/api/profiles/${OLD}`, 'PUT', { name: LONG });
    expect(same.status).toBe(200);
    const changed = await send(`/api/profiles/${OLD}`, 'PUT', { name: `${LONG}!` });
    expect(changed.status).toBe(400);
    expect(await changed.json()).toEqual({ error: M.nameLength, fields: { name: M.nameLength } });
    expect(await names()).toEqual(STORED);
  });

  it("refuses re-casing a twin onto the other twin's exact name", async () => {
    const res = await send(`/api/profiles/${TWIN}`, 'PUT', { name: 'Household' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(taken('Household'));
    // Its own case and space can still be tidied to anything no other profile has exactly.
    const tidied = await send(`/api/profiles/${TWIN}`, 'PUT', { name: 'HOUSEHOLD' });
    expect(tidied.status).toBe(200);
    expect(await names()).toEqual(['Household', 'Side business', LONG, 'HOUSEHOLD']);
  });

  it("answers 404 for another person's profile, and changes nothing", async () => {
    const res = await send(`/api/profiles/${ELSEWHERE}`, 'PUT', { name: 'Mine now' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: M.notFound });
    const row = await env.DB.prepare('SELECT name FROM profiles WHERE id = ?')
      .bind(ELSEWHERE)
      .first<{ name: string }>();
    expect(row?.name).toBe('Travel');
  });
});

describe('deleting a profile', () => {
  it('refuses the last one, in words that say how to get past it', async () => {
    for (const id of [SIDE, OLD, TWIN]) {
      expect((await send(`/api/profiles/${id}`, 'DELETE')).status).toBe(200);
    }
    const res = await send(`/api/profiles/${HOUSEHOLD}`, 'DELETE');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: M.onlyProfile });
    expect(await names()).toEqual(['Household']);
  });

  it("answers 404 for another person's profile", async () => {
    const res = await send(`/api/profiles/${ELSEWHERE}`, 'DELETE');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: M.notFound });
  });
});
