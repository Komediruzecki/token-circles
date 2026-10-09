/**
 * What a restore does with the settings that belong to one profile.
 *
 * A retirement plan and a badge record belong to one profile. The Worker keeps them per row, under
 * the plain key (`retirement_settings`, `achievements`). Local-first keeps one row per key for the
 * whole browser, so it names the profile in the key (`retirement_settings:<id>`), and a move from
 * local-first to cloud restores its file here. A row in that form is restored under the profile
 * its key names, in the Worker's form; one of a profile the file does not carry is left out.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';

const USER_ID = 6530;
const CURRENT = 65300;
const PLAN_ME = { birthMonth: '1986-04', lifeExpectancyAge: 92 };
const PLAN_PARTNER = { birthMonth: '1990-11', lifeExpectancyAge: 88 };
const BADGES_ME = '{"v":1,"unlocks":[],"held":"Me"}';
const BADGES_PARTNER = '{"v":1,"unlocks":[],"held":"Partner"}';
let cookie = '';

beforeEach(async () => {
  for (const t of ['settings', 'accounts', 'rate_limits', 'profiles']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER_ID).run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'profile-settings-backup@example.com', 'password', 1, 'advanced')"
    ).bind(USER_ID),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Current')").bind(
      CURRENT,
      USER_ID
    ),
  ]);
  cookie = (await sessionCookie(USER_ID, 'password', env)).split(';')[0];
});

function send(method: string, path: string, payload?: unknown, profile = CURRENT) {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(profile),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

const row = (profile: number, key: string, value: unknown) => ({
  key,
  value: typeof value === 'string' ? value : JSON.stringify(value),
  profile_id: profile,
});

/** A whole backup as local-first writes it. */
function localFile(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: '3.0.0',
    storage_mode: 'serverless',
    profiles: [
      { id: 1, name: 'Me', created_at: '2026-01-01' },
      { id: 2, name: 'Partner', created_at: '2026-01-01' },
    ],
    settings: {
      currency: 'EUR',
      'retirement_settings:1': PLAN_ME,
      'retirement_settings:2': PLAN_PARTNER,
      'achievements:1': BADGES_ME,
      'achievements:2': BADGES_PARTNER,
    },
    settingsRows: [
      row(1, 'currency', 'EUR'),
      row(1, 'retirement_settings:1', PLAN_ME),
      row(1, 'achievements:1', BADGES_ME),
      row(2, 'currency', 'EUR'),
      row(2, 'retirement_settings:2', PLAN_PARTNER),
      row(2, 'achievements:2', BADGES_PARTNER),
    ],
    ...over,
  };
}

async function profileIds(): Promise<Record<string, number>> {
  const { results } = await env.DB.prepare('SELECT id, name FROM profiles WHERE user_id = ?')
    .bind(USER_ID)
    .all<{ id: number; name: string }>();
  return Object.fromEntries(results.map((p) => [p.name, p.id]));
}

async function settingsOf(profile: number): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare(
    'SELECT key, value FROM settings WHERE profile_id = ? ORDER BY key'
  )
    .bind(profile)
    .all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((s) => [s.key, s.value]));
}

describe("a local-first backup's plans and badges", () => {
  it('are restored under their profiles, as the Worker keeps them', async () => {
    const res = await send('POST', '/api/import', localFile());
    expect(res.status).toBe(200);
    const id = await profileIds();
    expect(await settingsOf(id.Me!)).toEqual({
      achievements: BADGES_ME,
      currency: 'EUR',
      retirement_settings: JSON.stringify(PLAN_ME),
    });
    expect(await settingsOf(id.Partner!)).toEqual({
      achievements: BADGES_PARTNER,
      currency: 'EUR',
      retirement_settings: JSON.stringify(PLAN_PARTNER),
    });

    const plan = await send('GET', '/api/retirement/settings', undefined, id.Partner);
    expect(plan.status).toBe(200);
    const body = (await plan.json()) as {
      settings: { birthMonth: string; lifeExpectancyAge: number };
    };
    expect(body.settings).toMatchObject(PLAN_PARTNER);
  });

  it('are read from an older file that has only the settings, each for its profile', async () => {
    const res = await send('POST', '/api/import', localFile({ settingsRows: undefined }));
    expect(res.status).toBe(200);
    const id = await profileIds();
    expect((await settingsOf(id.Partner!)).retirement_settings).toBe(JSON.stringify(PLAN_PARTNER));
    expect((await settingsOf(id.Partner!)).achievements).toBe(BADGES_PARTNER);
    expect((await settingsOf(id.Me!)).retirement_settings).toBe(JSON.stringify(PLAN_ME));
  });

  it('are left out for a profile the file does not carry', async () => {
    const file = localFile();
    file.settingsRows = [
      ...(file.settingsRows as unknown[]),
      row(9, 'retirement_settings:9', PLAN_PARTNER),
      row(1, 'achievements:9', BADGES_PARTNER),
    ];
    const res = await send('POST', '/api/import', file);
    expect(res.status).toBe(200);
    const id = await profileIds();
    expect((await settingsOf(id.Me!)).achievements).toBe(BADGES_ME);
    const { results } = await env.DB.prepare("SELECT key FROM settings WHERE key LIKE '%:%'").all();
    expect(results).toEqual([]);
  });

  it("stand in for a profile's plain row in the same file", async () => {
    const file = localFile();
    file.settingsRows = [
      row(1, 'retirement_settings', { birthMonth: '1950-01', lifeExpectancyAge: 80 }),
      ...(file.settingsRows as unknown[]),
    ];
    const res = await send('POST', '/api/import', file);
    expect(res.status).toBe(200);
    const id = await profileIds();
    expect((await settingsOf(id.Me!)).retirement_settings).toBe(JSON.stringify(PLAN_ME));
  });
});
