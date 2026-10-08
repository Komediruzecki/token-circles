/**
 * Forgot password, sent for real: the route mints a reset link, mails it, and the mailed link sets
 * a new password. The app's own tests mock this request, and the reset half of the flow is tested
 * elsewhere (concurrent-writes.test.ts) from a link the test plants itself, so nothing else follows
 * a link from the mail the Worker actually sends.
 *
 * RESEND_API_KEY is set and the call to Resend is caught here, so the mail can be read.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth';

const UID = 9300;
const EMAIL = 'forgetful@example.com';

const realFetch = globalThis.fetch;
let sent: Array<Record<string, unknown>>;

function post(path: string, body: unknown) {
  return SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The reset token in a sent mail's link. */
function tokenIn(mail: Record<string, unknown>): string {
  const found = /#reset-password\?token=([A-Za-z0-9_-]+)/.exec(String(mail.text));
  expect(found, `a reset link in ${JSON.stringify(mail.text)}`).not.toBeNull();
  return found![1];
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function unusedLinks(): Promise<Array<{ token_hash: string; expires_at: string }>> {
  const { results } = await env.DB.prepare(
    'SELECT token_hash, expires_at FROM password_resets WHERE user_id = ? AND used_at IS NULL'
  )
    .bind(UID)
    .all<{ token_hash: string; expires_at: string }>();
  return results;
}

beforeEach(async () => {
  for (const table of ['password_resets', 'rate_limits', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare(
    "INSERT INTO users (id, email, password_hash, auth_provider, email_verified, token_version) VALUES (?, ?, ?, 'password', 1, 1)"
  )
    .bind(UID, EMAIL, await hashPassword('the-old-password'))
    .run();

  (env as unknown as Record<string, string>).RESEND_API_KEY = 'rk_test';
  sent = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('api.resend.com')) {
      sent.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response('{"id":"re_1"}', { headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete (env as unknown as Record<string, string>).RESEND_API_KEY;
});

describe('POST /api/auth/forgot-password', () => {
  it('mails a link to the address, and the link sets a new password', async () => {
    const asked = await post('/api/auth/forgot-password', { email: '  Forgetful@Example.com ' });
    expect(asked.status).toBe(200);
    expect(await asked.json()).toEqual({ ok: true });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(EMAIL);
    const token = tokenIn(sent[0]);
    const links = await unusedLinks();
    expect(links.map((l) => l.token_hash)).toEqual([await sha256(token)]);
    // Good for two hours.
    const left = Date.parse(links[0].expires_at) - Date.now();
    expect(left).toBeGreaterThan(119 * 60_000);
    expect(left).toBeLessThanOrEqual(120 * 60_000);

    const reset = await post('/api/auth/reset-password', { token, password: 'a-new-password' });
    expect(reset.status, await reset.clone().text()).toBe(200);
    expect(await unusedLinks()).toEqual([]);
    const signIn = await post('/api/auth/login', { email: EMAIL, password: 'a-new-password' });
    expect(signIn.status, await signIn.clone().text()).toBe(200);
    const old = await post('/api/auth/login', { email: EMAIL, password: 'the-old-password' });
    expect(old.status).toBe(401);
  });

  it('a second request replaces the first link', async () => {
    await post('/api/auth/forgot-password', { email: EMAIL });
    await post('/api/auth/forgot-password', { email: EMAIL });
    expect(sent).toHaveLength(2);
    const [first, second] = sent.map(tokenIn);

    expect((await unusedLinks()).map((l) => l.token_hash)).toEqual([await sha256(second)]);
    const stale = await post('/api/auth/reset-password', {
      token: first,
      password: 'a-new-password',
    });
    expect(stale.status).toBe(400);
  });

  it('answers an address with no account the same, and mails nothing', async () => {
    const asked = await post('/api/auth/forgot-password', { email: 'nobody@example.com' });
    expect(asked.status).toBe(200);
    expect(await asked.json()).toEqual({ ok: true });
    expect(sent).toEqual([]);
    const { results } = await env.DB.prepare('SELECT id FROM password_resets').all();
    expect(results).toEqual([]);
  });

  it('refuses something that is not an address', async () => {
    const asked = await post('/api/auth/forgot-password', { email: 'forgetful' });
    expect(asked.status).toBe(400);
    expect(sent).toEqual([]);
    expect(await unusedLinks()).toEqual([]);
  });
});
