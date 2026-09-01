/**
 * The support form is unauthenticated and sends TWO emails per accepted request: the relay to the
 * private inbox, and an acknowledgement to a caller-supplied, UNVERIFIED address. A per-IP cap
 * does not bound that — rotating IPs walk past it — and the cost lands on the sending domain's
 * reputation, which is exactly what gets recipients onto Resend's suppression list.
 *
 * So the captcha is what makes each attempt cost something, and it must be enforced server-side:
 * the client is the attacker's to modify.
 */
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';

const ORIGIN = 'https://dev.tokencircles.com';

function post(body: unknown, ip = '203.0.113.10') {
  return app.fetch(
    new Request(`${ORIGIN}/api/support/contact`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': ip,
        Origin: ORIGIN,
      },
      body: JSON.stringify(body),
    }),
    // RESEND_API_KEY must be set or sendMail short-circuits before ever calling out, which would
    // make the "sends no mail" assertion below pass whether or not the captcha is enforced.
    {
      ...env,
      TURNSTILE_SECRET: 'test-secret',
      APP_ENV: 'production',
      SUPPORT_EMAIL: 'x@y.tld',
      RESEND_API_KEY: 'test-key',
    }
  );
}

/** Cloudflare's siteverify, plus Resend so no test ever tries to send real mail. */
function stubFetch(captchaOk: boolean) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('challenges.cloudflare.com')) {
      return new Response(
        JSON.stringify({ success: captchaOk, 'error-codes': captchaOk ? [] : ['invalid-input'] }),
        { status: 200 }
      );
    }
    if (url.includes('api.resend.com')) {
      return new Response(JSON.stringify({ id: 'resend-id-1' }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('the support form is captcha-gated', () => {
  it('refuses a request that carries no captcha token', async () => {
    stubFetch(true);
    // A unique IP per test keeps the per-IP limiter from being the thing that rejects.
    const res = await post({ email: 'a@b.tld', message: 'hello there' }, '203.0.113.21');
    expect(res.status).not.toBe(200);
  });

  it('refuses a request whose token Cloudflare rejects', async () => {
    stubFetch(false);
    const res = await post(
      { email: 'a@b.tld', message: 'hello there', turnstileToken: 'forged' },
      '203.0.113.22'
    );
    expect(res.status).not.toBe(200);
  });

  it('accepts a request with a token Cloudflare accepts', async () => {
    stubFetch(true);
    const res = await post(
      { email: 'a@b.tld', message: 'hello there', turnstileToken: 'good' },
      '203.0.113.23'
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; ticketId?: string };
    expect(body.ok).toBe(true);
    expect(body.ticketId).toMatch(/^TC-/);
  });

  it('checks the captcha before doing any work, so a forged token sends no mail', async () => {
    const spy = stubFetch(false);
    await post(
      { email: 'a@b.tld', message: 'hello there', turnstileToken: 'forged' },
      '203.0.113.24'
    );
    const resendCalls = spy.mock.calls.filter(([input]) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      return url.includes('api.resend.com');
    });
    expect(resendCalls, 'a rejected captcha must not reach the mail provider').toHaveLength(0);
  });
});
