import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

// Email alerts (manual test/preview + trigger) are a paid feature (plans.ts emailReminders).
// The scheduled sender gates on canReceive(); these manual endpoints must gate too — otherwise
// a free user can send themselves budget/spending emails despite emailReminders:false.

let freeCookie: string;
let paidCookie: string;

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM users').run();
  await env.DB.prepare(
    "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (81, 'free@example.com', 'password', 1, 'free')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (82, 'paid@example.com', 'password', 1, 'advanced')"
  ).run();
  freeCookie = (await issueSessionCookie(81, 'password', env)).split(';')[0];
  paidCookie = (await issueSessionCookie(82, 'password', env)).split(';')[0];
});

function post(path: string, cookie: string, body: unknown) {
  return SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('manual email endpoints are plan-gated (emailReminders)', () => {
  it('free plan gets 402 from /api/notifications/test-email', async () => {
    const res = await post('/api/notifications/test-email', freeCookie, { type: 'basic' });
    expect(res.status).toBe(402);
  });

  it('free plan gets 402 from /api/notifications/trigger', async () => {
    const res = await post('/api/notifications/trigger', freeCookie, { type: 'budget' });
    expect(res.status).toBe(402);
  });

  it('a paid plan passes the gate on /api/notifications/test-email', async () => {
    const res = await post('/api/notifications/test-email', paidCookie, { type: 'basic' });
    expect(res.status).toBe(200);
  });
});
