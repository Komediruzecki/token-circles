/**
 * A mail call has a time limit: sendMail asks for 10 seconds, and when Resend does not answer in
 * that time it gives up the way it does when the network fails, by throwing. A route that mails
 * after its answer then logs the failure.
 *
 * Resend here never answers: its call ends only when the request's signal aborts it. The limit is
 * shortened for the test, so nothing waits 10 seconds.
 */
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMail } from '../src/email';
import type { Env } from '../src/index';
import { fetchUnsettled } from './helpers/after-answer';

const UID = 9760;
const EMAIL = 'slow-mail@example.com';
/** The limit the test gives a mail call in place of the 10 seconds sendMail asks for. */
const TEST_LIMIT_MS = 50;
/** How long the test waits for an outcome before it calls the call stuck. */
const STUCK_AFTER_MS = 3_000;

const realFetch = globalThis.fetch;
const realTimeout = AbortSignal.timeout.bind(AbortSignal);
/** The limits mail calls asked for. */
let limits: number[];
let resendCalls: number;

/** Resend, when it does not answer: the call ends only when its signal aborts it. */
function resendThatNeverAnswers(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.includes('api.resend.com')) return realFetch(input as RequestInfo, init);
  resendCalls += 1;
  return new Promise<Response>((_, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) reject(signal.reason);
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

/** `value`, after `ms`. */
const after = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

beforeEach(async () => {
  limits = [];
  resendCalls = 0;
  (env as unknown as Record<string, string>).RESEND_API_KEY = 'rk_test';
  globalThis.fetch = resendThatNeverAnswers as typeof fetch;
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
    limits.push(ms);
    return realTimeout(TEST_LIMIT_MS);
  });
  await env.DB.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'forgot-%'").run();
  await env.DB.prepare(
    "INSERT INTO users (id, email, password_hash, auth_provider, email_verified, token_version) VALUES (?, ?, 'x', 'password', 1, 1)"
  )
    .bind(UID, EMAIL)
    .run();
});

afterEach(async () => {
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
  delete (env as unknown as Record<string, string>).RESEND_API_KEY;
  await env.DB.prepare('DELETE FROM password_resets WHERE user_id = ?').bind(UID).run();
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(UID).run();
  await env.DB.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'forgot-%'").run();
});

describe('a mail call Resend does not answer', () => {
  it('sendMail gives up at its limit of 10 seconds, by throwing', async () => {
    const outcome = await Promise.race([
      sendMail(env as unknown as Env, EMAIL, 'A subject', '<p>A body</p>').then(
        () => 'answered',
        (e: unknown) => `gave up: ${(e as Error).name}`
      ),
      after(STUCK_AFTER_MS, 'still waiting'),
    ]);

    expect(outcome).toBe('gave up: TimeoutError');
    expect(limits).toEqual([10_000]);
    expect(resendCalls).toBe(1);
  });

  it('a reset link mailed after the answer gives up and is logged, and the answer is ok', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const request = fetchUnsettled('https://example.com/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL }),
    });

    const answer = await request.answer;
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ ok: true });
    const settled = await Promise.race([
      request.settled().then(() => 'settled'),
      after(STUCK_AFTER_MS, 'still waiting'),
    ]);

    expect(settled).toBe('settled');
    expect(resendCalls).toBe(1);
    expect(
      logged.mock.calls.map(([message, error]) => `${message} ${(error as Error)?.name}`)
    ).toContain('Password reset link could not be sent: TimeoutError');
  });
});
