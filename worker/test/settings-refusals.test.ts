/**
 * What `PUT /api/settings` refuses, and how it says it, on a real D1 with older rows in place
 * (shared/settingsSchema.ts). The twin of the local-first test,
 * frontend/src/core/storage/__tests__/settingsRefusals.test.ts.
 *
 * Before, the route stored any key as `String(v)`:
 *
 * - `retirement_settings`, the retirement plan, so a plan the plan rules refuse
 *   (`PUT /api/retirement/settings`, checkRetirementPlan) went in through here; and the email
 *   settings, which belong to `PUT /api/notifications/settings`.
 * - An object as "[object Object]", and an array or a string body as keys "0", "1" and so on.
 * - An empty currency as the base currency, since the check only ran on a value that was there.
 *
 * It refused a lowercase currency code with 422, which local-first stored in capitals, and its
 * refusals named no field. Now each refusal is a 400 at the setting it is about, a locked base
 * currency is a 409 at the currency, and a refused write stores none of the body.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_MESSAGES as M } from '../../shared/settingsSchema';
import { issueSessionCookie } from '../src/auth';

const USER_ID = 6420;
const PROFILE = 64200;
const PLAN = JSON.stringify({ birthMonth: '1986-04', retirementAge: 67 });
let cookie = '';

beforeEach(async () => {
  for (const t of ['accounts', 'settings', 'rate_limits', 'profiles']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER_ID).run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'settings-refusals@example.com', 'password', 1, 'free')"
    ).bind(USER_ID),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Household')").bind(
      PROFILE,
      USER_ID
    ),
    // What the profile already holds: a base currency, a retirement plan and an email setting.
    env.DB.prepare(
      "INSERT INTO settings (key, value, profile_id) VALUES ('currency', 'EUR', ?), ('retirement_settings', ?, ?), ('email_notifications', 'true', ?)"
    ).bind(PROFILE, PLAN, PROFILE, PROFILE),
  ]);
  cookie = (await issueSessionCookie(USER_ID, 'password', env)).split(';')[0];
});

function send(method: string, path: string, payload?: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(PROFILE),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

async function answer(res: Response): Promise<{ status: number; body: unknown }> {
  return { status: res.status, body: await res.json() };
}

async function stored(): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare(
    'SELECT key, value FROM settings WHERE profile_id = ? ORDER BY key'
  )
    .bind(PROFILE)
    .all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

const BEFORE = { currency: 'EUR', email_notifications: 'true', retirement_settings: PLAN };

const refusal = (fields: Record<string, string>) => ({
  status: 400,
  body: { error: Object.values(fields).join(' '), fields },
});

describe('PUT /api/settings', () => {
  it('refuses the retirement plan, which its own route checks, and keeps the stored one', async () => {
    const res = await send('PUT', '/api/settings', {
      retirement_settings: JSON.stringify({ retirementAge: 30 }),
    });
    expect(await answer(res)).toEqual(refusal({ retirement_settings: M.retirementPlan }));
    expect(await stored()).toEqual(BEFORE);
  });

  it('refuses the email settings, which belong to the notifications route', async () => {
    const res = await send('PUT', '/api/settings', { email_notifications: 'false' });
    expect(await answer(res)).toEqual(refusal({ email_notifications: M.emailSettings }));
    expect(await stored()).toEqual(BEFORE);
  });

  it('stores none of a write that has a refused setting in it', async () => {
    const res = await send('PUT', '/api/settings', {
      onboarding: 'completed',
      retirement_settings: '{}',
    });
    expect(res.status).toBe(400);
    expect(await stored()).toEqual(BEFORE);
  });

  it('refuses a currency that is not one, an empty one too, at the currency', async () => {
    for (const currency of ['', 'EURO', 12]) {
      const res = await send('PUT', '/api/settings', { currency });
      expect(await answer(res)).toEqual(refusal({ currency: M.currency }));
    }
    expect(await stored()).toEqual(BEFORE);
  });

  it('takes a lowercase currency code, and stores it in capitals', async () => {
    expect(await answer(await send('PUT', '/api/settings', { currency: 'usd' }))).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect((await stored()).currency).toBe('USD');
  });

  it('refuses a value that is not text, a number, or true or false', async () => {
    const res = await send('PUT', '/api/settings', { preferences: { theme: 'dark' } });
    expect(await answer(res)).toEqual(refusal({ preferences: M.value }));
    expect(await stored()).toEqual(BEFORE);
  });

  it('refuses a body that is not names and values', async () => {
    for (const body of [['USD'], 'USD']) {
      expect(await answer(await send('PUT', '/api/settings', body))).toEqual(
        refusal({ settings: M.settings })
      );
    }
    expect(await stored()).toEqual(BEFORE);
  });

  it('says why a locked base currency stays, at the currency', async () => {
    await env.DB.prepare(
      "INSERT INTO accounts (profile_id, name, type, currency) VALUES (?, 'Everyday', 'giro', 'EUR')"
    )
      .bind(PROFILE)
      .run();
    const words = 'The base currency stays EUR once you have accounts or transactions.';
    expect(await answer(await send('PUT', '/api/settings', { currency: 'USD' }))).toEqual({
      status: 409,
      body: { error: words, fields: { currency: words } },
    });
    expect(await stored()).toEqual(BEFORE);
  });

  it('still stores what the app sends', async () => {
    const badges = JSON.stringify({ v: 1, unlocks: [], dismissedAdvice: [] });
    const res = await send('PUT', '/api/settings', {
      onboarding: 'skipped',
      achievements: badges,
    });
    expect(await answer(res)).toEqual({ status: 200, body: { ok: true } });
    expect(await stored()).toEqual({ ...BEFORE, onboarding: 'skipped', achievements: badges });
  });
});
