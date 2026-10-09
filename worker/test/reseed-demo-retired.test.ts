/**
 * POST /api/profiles/reseed-demo is retired on the Worker.
 *
 * The three example profiles are local-first's browser demo, and the Danger Zone has offered
 * "Reseed demo data" in local-first only since v5.10.0. The Worker kept the route for older pages,
 * where it did something else under the same name: it cleared the active profile and gave it the
 * default categories, so one route meant two things (the contract's `profile-reseed-demo`). It now
 * answers 410 Gone, says where to start a profile over, and changes nothing.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';

const USER = 6420;
const PROFILE = 64200;
let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM accounts WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM profiles WHERE user_id = ?').bind(USER),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'reseed@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Household')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare(
      "INSERT INTO accounts (profile_id, name, type, currency, balance) VALUES (?, 'Everyday', 'giro', 'EUR', 100)"
    ).bind(PROFILE),
  ]);
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0];
});

describe('POST /api/profiles/reseed-demo', () => {
  it('answers 410 Gone, says where to start a profile over, and clears nothing', async () => {
    const res = await SELF.fetch('https://example.com/api/profiles/reseed-demo', {
      method: 'POST',
      headers: { Cookie: cookie, 'X-Profile-Id': String(PROFILE) },
    });
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({
      error:
        'The example profiles are part of browser-only mode. To start this profile over, clear its data in Settings.',
    });
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM accounts WHERE profile_id = ?')
      .bind(PROFILE)
      .first<{ n: number }>();
    expect(left?.n).toBe(1);
  });
});
