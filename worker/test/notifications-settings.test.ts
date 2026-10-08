/**
 * Email settings, as the Settings page reads and saves them (features/Settings.tsx,
 * loadNotifications and saveNotifications): GET, then PUT of the whole object back. Each switch
 * belongs to the active profile; the address belongs to the account, and a new one waits for the
 * new address to confirm it (email-change.test.ts follows the link).
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

const UID = 9400;
const MAIN = 9401;
const SIDE = 9402;
let cookie = '';

function send(method: 'GET' | 'PUT', profile: number, body?: unknown) {
  return SELF.fetch('https://example.com/api/notifications/settings', {
    method,
    headers: {
      Cookie: cookie,
      'X-Profile-Id': String(profile),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function read(profile = MAIN): Promise<Record<string, unknown>> {
  const res = await send('GET', profile);
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

const email = async (id = UID) =>
  (await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(id).first<{ email: string }>())
    ?.email;

beforeEach(async () => {
  for (const table of ['settings', 'email_verifications', 'rate_limits', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (9400, 'me@example.com', 'password', 1, 'advanced')"
    ),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (9410, 'taken@example.com', 'password', 1, 'basic')"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (9401, 9400, 'Main')"),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (9402, 9400, 'Side')"),
  ]);
  cookie = (await issueSessionCookie(UID, 'password', env)).split(';')[0];
});

describe('PUT /api/notifications/settings', () => {
  it('stores the switches the page saves, for the active profile only', async () => {
    const before = await read();
    expect(before).toEqual({
      email: 'me@example.com',
      pendingEmail: null,
      emailNotifications: true,
      budgetAlerts: true,
      spendingReport: true,
      billsReminders: true,
    });

    const saved = await send('PUT', MAIN, {
      ...before,
      budgetAlerts: false,
      billsReminders: false,
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ ok: true });
    expect(await read()).toEqual({ ...before, budgetAlerts: false, billsReminders: false });
    // The other profile's switches are its own.
    expect(await read(SIDE)).toEqual(before);

    // A switch left out of the body keeps its value; one sent is set either way.
    expect((await send('PUT', MAIN, { budgetAlerts: true })).status).toBe(200);
    expect(await read()).toEqual({ ...before, billsReminders: false });
  });

  it('keeps the address until a new one is confirmed, and refuses one another account has', async () => {
    const changed = await send('PUT', MAIN, { ...(await read()), email: ' New@Example.com ' });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({ ok: true, pendingEmail: 'new@example.com' });
    // Saved as a change waiting for the new address, not as the address.
    expect(await email()).toBe('me@example.com');
    expect(await read()).toMatchObject({
      email: 'me@example.com',
      pendingEmail: 'new@example.com',
    });
    // The address is the account's, so every profile reads the same change.
    expect((await read(SIDE)).pendingEmail).toBe('new@example.com');

    const taken = await send('PUT', MAIN, {
      ...(await read()),
      email: 'Taken@example.com',
      spendingReport: false,
    });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ error: 'That email is already in use' });
    expect(await email()).toBe('me@example.com');
    expect(await email(9410)).toBe('taken@example.com');
    // Refused whole: the switch sent with it is not stored, and the change waiting stays.
    expect(await read()).toMatchObject({ spendingReport: true, pendingEmail: 'new@example.com' });
  });
});
