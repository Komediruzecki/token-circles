/**
 * One budget of confirm links mailed to an address, shared by the three ways of sending one
 * again: Send the link again while signed out (POST /api/auth/verify-email/resend), signing up
 * again with the address (POST /api/auth/register), and the Confirm your email screen, signed in
 * (POST /api/auth/resend-verification). Each keeps its own limit on requests.
 *
 * Once the address has had its links for the hour, the two signed-out ways answer as they always
 * do and mail nothing, and the link the account has keeps working. The signed-in way answers 429,
 * which only the account's own session reads.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIRM_LINKS_PER_HOUR } from '../src/email-verification';
import { fetchSettled } from './helpers/after-answer';
import { unconfirmedSessionCookie } from './helpers/session';

const BASE = 'https://api.example.com';
const UID = 7740;
/** A password account waiting for its confirm link. */
const WAITING = 'budget-waiting@example.com';

let ip = 0;

/** A JSON request from a network address of its own, so only the limits on the address fill. */
function sending(body: unknown, cookie?: string): RequestInit {
  ip += 1;
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': `10.74.${ip >> 8}.${ip & 255}`,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  };
}

/** Every header of an answer but Date, sorted, with its status and body. */
async function read(res: Response) {
  const headers: string[] = [];
  res.headers.forEach((value, name) => {
    if (name !== 'date') headers.push(`${name}: ${value}`);
  });
  return { status: res.status, headers: headers.sort(), body: await res.text() };
}

/** The three ways of asking for the link again, each answered once its work is done. */
const ways = {
  signedOut: () =>
    fetchSettled(`${BASE}/api/auth/verify-email/resend`, sending({ email: WAITING })),
  signUpAgain: () =>
    fetchSettled(
      `${BASE}/api/auth/register`,
      sending({ email: WAITING, password: 'a-password-for-again' })
    ),
  signedIn: async () =>
    SELF.fetch(
      `${BASE}/api/auth/resend-verification`,
      sending({}, (await unconfirmedSessionCookie(UID)).split(';')[0])
    ),
};

const realFetch = globalThis.fetch;
/** The addresses the Worker mailed, in the order the mail service took them. */
let mailed: string[] = [];

async function removeAccount(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(UID),
    env.DB.prepare('DELETE FROM email_verifications WHERE user_id = ?').bind(UID),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(UID),
  ]);
}

beforeEach(async () => {
  await removeAccount();
  await env.DB.prepare('DELETE FROM rate_limits').run();
  await env.DB.prepare(
    "INSERT INTO users (id, email, password_hash, email_verified, auth_provider, token_version) VALUES (?, ?, 'pbkdf2$100000$x$y', 0, 'password', 1)"
  )
    .bind(UID, WAITING)
    .run();
  (env as unknown as Record<string, string>).RESEND_API_KEY = 'rk_test';
  mailed = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('api.resend.com')) {
      mailed.push((JSON.parse(String(init?.body ?? '{}')) as { to: string }).to);
      return new Response('{"id":"re_1"}', { headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
});

afterEach(async () => {
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
  delete (env as unknown as Record<string, string>).RESEND_API_KEY;
  await removeAccount();
});

/** The unused confirm links of the account, by token hash. */
async function unusedLinks(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'SELECT token_hash FROM email_verifications WHERE user_id = ? AND used_at IS NULL'
  )
    .bind(UID)
    .all<{ token_hash: string }>();
  return results.map((row) => row.token_hash);
}

describe('the confirm links mailed to one address in an hour', () => {
  it('are three, asked for whichever way, and the signed-in way is then answered 429', async () => {
    expect(CONFIRM_LINKS_PER_HOUR).toBe(3);
    await ways.signedOut();
    await ways.signUpAgain();
    await ways.signedOut();
    expect(mailed).toEqual([WAITING, WAITING, WAITING]);

    const afterwards = [
      (await ways.signedOut()).status,
      (await ways.signUpAgain()).status,
      (await ways.signedIn()).status,
    ];

    expect(afterwards).toEqual([200, 200, 429]);
    expect(mailed).toHaveLength(3);
  });

  it('count the Confirm your email screen too, and then the signed-out ways mail nothing', async () => {
    await ways.signedIn();
    await ways.signedIn();
    await ways.signedOut();
    expect(mailed).toHaveLength(3);

    await ways.signedOut();
    await ways.signUpAgain();

    expect(mailed).toHaveLength(3);
  });

  it('leave the link the account has working once the signed-out ways mail nothing', async () => {
    for (let i = 0; i < 3; i += 1) await ways.signUpAgain();
    const kept = await unusedLinks();
    expect(kept).toHaveLength(1);

    await ways.signedOut();

    expect(await unusedLinks()).toEqual(kept);
  });

  it('change nothing in the answer of a signed-out way once they are spent', async () => {
    const first = await read(await ways.signedOut());
    await ways.signUpAgain();
    await ways.signUpAgain();
    const spent = await read(await ways.signedOut());

    expect(mailed).toHaveLength(3);
    expect(spent).toEqual(first);
  });
});
