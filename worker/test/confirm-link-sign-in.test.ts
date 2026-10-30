/**
 * The confirm link signs in the browser that signed up (signup-marker.ts, routes/auth.ts).
 *
 * A password sign-up leaves its browser a marker, sent only to the confirm link's route. Opened
 * there while the marker lasts, the account's confirm link confirms the address and signs in, with
 * no password asked, through a session of its own. Every other opening spends nothing and asks for
 * the password where the link was opened, as it always has: a browser with no marker (a mail
 * scanner's request among them), a marker for another address or another password, one that ran
 * out or that this deployment did not sign, a link that is not an unspent confirm link of a waiting
 * account, and an account that asks for a second factor.
 *
 * A sign-up answers the same for every address, marker and all. GET /api/auth/email-link tells the
 * page that finishes a sign-up elsewhere which address the link it opened waits for.
 */
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIRM_LINK_SIGN_IN } from '../../shared/confirmLinkSignIn';
import { b64urlEncode, hashPassword, hmacKey, verifyPassword } from '../src/auth';
import { derivedHmacKey } from '../src/derived-key';
import { VERIFY_TOKEN_TTL_HOURS } from '../src/email-verification';
import {
  SIGNUP_MARKER_COOKIE,
  SIGNUP_MARKER_PATH,
  SIGNUP_MARKER_SECONDS,
  signupMarker,
  signupMarkerBytes,
} from '../src/signup-marker';
import { removeAccounts } from './helpers/account-access';
import { fetchSettled } from './helpers/after-answer';
import { bumpTokenVersion, dbWithStep, realDb, withDb } from './helpers/racing-db';
import { sessionCookie } from './helpers/session';
import type { Env } from '../src/index';

const BASE = 'https://api.example.com';
/** Where the Worker sends the browser back to: CORS_ORIGIN, in the tests' wrangler.jsonc. */
const APP = 'http://localhost:3800';
const SIGNED_IN = `${APP}/#everified=1&signed_in=1`;
const ASKS_FOR_PASSWORD = `${APP}/#everified_error=signin_required`;
const PASSWORD = 'the-password-it-signed-up-with';
const OTHER_PASSWORD = 'a-different-password';
/** The label the Worker derives the marker key with. */
const KEY_LABEL = 'token-circles signup-marker v1';
const PREFIX = 'confirm-sign-in-';
const at = (name: string) => `${PREFIX}${name}@example.com`;
const MINE = `SELECT id FROM users WHERE email LIKE '${PREFIX}%'`;

const vars = env as unknown as Record<string, string | undefined>;
const realFetch = globalThis.fetch;
/** The mails the Worker sent, in the order the mail service took them. */
let mailed: Array<{ to: string; subject: string; text: string }> = [];
let ip = 0;

beforeEach(async () => {
  await removeAccounts(MINE);
  vars.RESEND_API_KEY = 'rk_test';
  mailed = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('api.resend.com')) {
      mailed.push(JSON.parse(String(init?.body ?? '{}')) as (typeof mailed)[number]);
      return new Response('{"id":"re_1"}', { headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete vars.RESEND_API_KEY;
  delete vars.TURNSTILE_SECRET;
  vars.APP_ENV = 'development';
  CONFIRM_LINK_SIGN_IN.sameBrowser = true;
  vi.useRealTimers();
  await removeAccounts(MINE);
});

/** Each request from a network address of its own, so no limit on one address is reached. */
function newAddress(): Record<string, string> {
  ip += 1;
  return { 'CF-Connecting-IP': `10.77.${ip >> 8}.${ip & 255}` };
}

/** Sign up, and come back once the account the sign-up writes after its answer is there. */
function signUp(email: string, password = PASSWORD): Promise<Response> {
  return fetchSettled(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...newAddress() },
    body: JSON.stringify({ email, password }),
  });
}

/** The Set-Cookie line that names the marker, or null. */
function markerLine(res: Response): string | null {
  return (
    res.headers.getSetCookie().find((line) => line.startsWith(`${SIGNUP_MARKER_COOKIE}=`)) ?? null
  );
}

/** The marker as the browser sends it back, `fm_signup=<value>`. */
function markerOf(res: Response): string {
  const line = markerLine(res);
  expect(line, 'a sign-up marker').not.toBeNull();
  return line!.split(';')[0]!;
}

/** The token of the newest confirm link mailed to `email`. */
function newestLinkTo(email: string): string {
  const mail = [...mailed].reverse().find((m) => m.to === email && m.text.includes('verify-email'));
  const token = mail ? /verify-email\?token=([0-9a-f]+)/.exec(mail.text)?.[1] : undefined;
  expect(token, `a confirm link mailed to ${email}`).toBeDefined();
  return token!;
}

/** A sign-up at `email`: the marker it left and the confirm link it mailed. */
async function signedUp(email: string, password = PASSWORD) {
  const res = await signUp(email, password);
  expect(res.status).toBe(200);
  return { marker: markerOf(res), token: newestLinkTo(email) };
}

/** Open the confirm link as a browser does, with the cookies it holds. */
function open(token: string, cookie?: string): Promise<Response> {
  return fetchSettled(`${BASE}/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
    headers: { ...newAddress(), ...(cookie ? { Cookie: cookie } : {}) },
  });
}

/** The `name=value` pair a response sets for `name`; null when it sets none or clears it. */
function cookieSet(res: Response, name: string): string | null {
  const line = res.headers.getSetCookie().find((l) => l.startsWith(`${name}=`));
  const pair = line?.split(';')[0];
  return pair && pair.length > name.length + 1 ? pair : null;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function accountAt(email: string) {
  const row = await realDb
    .prepare(
      'SELECT id, email, email_verified, password_hash, token_version FROM users WHERE email = ?'
    )
    .bind(email)
    .first<{
      id: number;
      email: string;
      email_verified: number;
      password_hash: string;
      token_version: number;
    }>();
  expect(row, `an account at ${email}`).not.toBeNull();
  return row!;
}

async function linkSpent(token: string): Promise<boolean> {
  const row = await realDb
    .prepare('SELECT used_at FROM email_verifications WHERE token_hash = ?')
    .bind(await sha256(token))
    .first<{ used_at: string | null }>();
  expect(row, 'the link').not.toBeNull();
  return row!.used_at !== null;
}

async function sessionsOf(userId: number): Promise<number> {
  const row = await realDb
    .prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>();
  return row!.n;
}

/** The link asked for the password: nothing signed in, nothing confirmed, nothing spent. */
async function askedForPassword(res: Response, email: string, token: string): Promise<void> {
  expect(res.status).toBe(302);
  expect(res.headers.get('Location')).toBe(ASKS_FOR_PASSWORD);
  expect(cookieSet(res, 'fm_session')).toBeNull();
  // The browser keeps the link's own marker, for a password sign-in there to finish it.
  expect(cookieSet(res, 'fm_email_link')).not.toBeNull();
  const account = await accountAt(email);
  expect(account.email_verified).toBe(0);
  expect(await sessionsOf(account.id)).toBe(0);
  expect(await linkSpent(token)).toBe(false);
}

/** The key the Worker signs markers with on the deployment `appEnv` names. */
const markerKey = (appEnv = vars.APP_ENV) => derivedHmacKey(vars.JWT_SECRET!, KEY_LABEL, appEnv);

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A marker for `address` and `passwordHash`, made the way the Worker makes one unless told. */
async function madeMarker(opts: {
  address: string;
  passwordHash: string;
  key?: CryptoKey;
  exp?: number;
  /** How the value writes `exp`, when not as the number. */
  expAs?: string;
  id?: string;
  format?: string;
}): Promise<string> {
  const exp = opts.exp ?? nowSeconds() + 600;
  const id = opts.id ?? b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const key = opts.key ?? (await markerKey());
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    signupMarkerBytes(exp, id, opts.address, opts.passwordHash)
  );
  return `${SIGNUP_MARKER_COOKIE}=${opts.format ?? 'v1'}.${opts.expAs ?? exp}.${id}.${b64urlEncode(mac)}`;
}

/** Every header of an answer but Date, sorted, with the marker's value written as V. */
async function sameness(res: Response) {
  const headers: string[] = [];
  res.headers.forEach((value, name) => {
    if (name !== 'date' && name !== 'set-cookie') headers.push(`${name}: ${value}`);
  });
  for (const line of res.headers.getSetCookie()) {
    headers.push(`set-cookie: ${line.replace(/^fm_signup=[^;]*/, 'fm_signup=V')}`);
  }
  return { status: res.status, headers: headers.sort(), body: await res.text() };
}

describe('a sign-up', () => {
  it('answers every address the same, with a marker that differs only in its value', async () => {
    const hash = await hashPassword(OTHER_PASSWORD);
    await realDb.batch([
      realDb
        .prepare(
          "INSERT INTO users (email, password_hash, email_verified, auth_provider) VALUES (?, ?, 0, 'password')"
        )
        .bind(at('waits'), hash),
      realDb
        .prepare(
          "INSERT INTO users (email, password_hash, email_verified, auth_provider) VALUES (?, ?, 1, 'password')"
        )
        .bind(at('confirmed'), hash),
      realDb
        .prepare(
          "INSERT INTO users (email, password_hash, email_verified, auth_provider, provider_id) VALUES (?, NULL, 1, 'google', ?)"
        )
        .bind(at('google'), `${PREFIX}google-sub`),
    ]);

    const answers = [];
    const values = [];
    for (const email of [at('nobody'), at('waits'), at('confirmed'), at('google')]) {
      const res = await signUp(email);
      values.push(markerOf(res).slice(`${SIGNUP_MARKER_COOKIE}=`.length));
      answers.push(await sameness(res));
    }

    expect(answers[0]!.status).toBe(200);
    expect(answers[0]!.body).toBe('{"ok":true}');
    expect(answers[0]!.headers).toContain(
      `set-cookie: fm_signup=V; Path=${SIGNUP_MARKER_PATH}; HttpOnly; SameSite=Lax; Max-Age=${SIGNUP_MARKER_SECONDS}`
    );
    for (const answer of answers.slice(1)) expect(answer).toEqual(answers[0]);
    for (const value of values) {
      expect(value).toMatch(/^v1\.[0-9]{10}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    }
    expect(new Set(values).size).toBe(values.length);
  });

  it('leaves a marker only for the confirm link, for an hour, and Secure outside development', async () => {
    const line = await signupMarker(
      { ...(env as unknown as Env), APP_ENV: 'production' },
      at('anyone'),
      'a-hash'
    );

    expect(SIGNUP_MARKER_PATH).toBe('/api/auth/verify-email');
    expect(SIGNUP_MARKER_SECONDS).toBe(3600);
    expect(line).toMatch(
      /^fm_signup=v1\.[^;]+; Path=\/api\/auth\/verify-email; HttpOnly; SameSite=Lax; Max-Age=3600; Secure$/
    );
  });

  it('leaves no marker when it is not taken', async () => {
    const refused: Response[] = [];
    refused.push(await signUp('not-an-address'));
    refused.push(await signUp(at('short'), 'short'));
    for (let i = 0; i < 4; i += 1) refused.push(await signUp(at('limited')));
    vars.TURNSTILE_SECRET = 'test-turnstile-secret';
    refused.push(await signUp(at('captcha')));

    expect(refused.map((res) => res.status)).toEqual([400, 400, 200, 200, 200, 429, 403]);
    expect(markerLine(refused[0]!)).toBeNull();
    expect(markerLine(refused[1]!)).toBeNull();
    expect(markerLine(refused[5]!)).toBeNull();
    expect(markerLine(refused[6]!)).toBeNull();
  });

  it('leaves no marker while the confirm link signs in nowhere by itself, and one from before signs in nothing', async () => {
    const before = await signedUp(at('rule-off'));
    CONFIRM_LINK_SIGN_IN.sameBrowser = false;

    const res = await signUp(at('rule-off-after'));
    const opened = await open(before.token, before.marker);

    expect(res.status).toBe(200);
    expect(markerLine(res)).toBeNull();
    await askedForPassword(opened, at('rule-off'), before.token);
  });
});

describe('the confirm link, opened in the browser that signed up', () => {
  it('confirms the address and signs in, with no password asked', async () => {
    const { marker, token } = await signedUp(at('same-browser'));

    const res = await open(token, marker);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(SIGNED_IN);
    const session = cookieSet(res, 'fm_session');
    expect(session).not.toBeNull();
    expect(markerLine(res)).toMatch(/^fm_signup=; Path=\/api\/auth\/verify-email;.*Max-Age=0/);
    const account = await accountAt(at('same-browser'));
    expect(account.email_verified).toBe(1);
    expect(await linkSpent(token)).toBe(true);
    expect(await sessionsOf(account.id)).toBe(1);
    const me = await fetchSettled(`${BASE}/api/auth/me`, { headers: { Cookie: session! } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { email: string }).email).toBe(at('same-browser'));
  });

  it('still signs in after the link was opened first with no cookies at all, as a mail scanner opens it', async () => {
    const { marker, token } = await signedUp(at('scanned'));

    // The scanner's request spends nothing and confirms nothing.
    await askedForPassword(await open(token), at('scanned'), token);
    const res = await open(token, marker);

    expect(res.headers.get('Location')).toBe(SIGNED_IN);
    expect(cookieSet(res, 'fm_session')).not.toBeNull();
    expect((await accountAt(at('scanned'))).email_verified).toBe(1);
    expect(await linkSpent(token)).toBe(true);
  });

  it('issues a session of its own, in a browser signed in to another account too', async () => {
    await signedUp(at('other-session'));
    const other = await accountAt(at('other-session'));
    const otherSession = (await sessionCookie(other.id)).split(';')[0]!;
    const { marker, token } = await signedUp(at('fresh-session'));
    const account = await accountAt(at('fresh-session'));

    const res = await open(token, `${otherSession}; ${marker}`);

    expect(res.headers.get('Location')).toBe(SIGNED_IN);
    const session = cookieSet(res, 'fm_session');
    expect(session).not.toBeNull();
    expect(session).not.toBe(otherSession);
    expect(await sessionsOf(account.id)).toBe(1);
    const me = await fetchSettled(`${BASE}/api/auth/me`, { headers: { Cookie: session! } });
    expect(((await me.json()) as { email: string }).email).toBe(at('fresh-session'));
  });

  it('signs in with a marker made the way the Worker makes one', async () => {
    const { token } = await signedUp(at('made-right'));
    const account = await accountAt(at('made-right'));

    const res = await open(
      token,
      await madeMarker({ address: at('made-right'), passwordHash: account.password_hash })
    );

    expect(res.headers.get('Location')).toBe(SIGNED_IN);
    expect(cookieSet(res, 'fm_session')).not.toBeNull();
  });

  it('confirms the address and signs nobody in when the account signed out everywhere meanwhile', async () => {
    const { marker, token } = await signedUp(at('signed-out'));
    const account = await accountAt(at('signed-out'));
    const step = dbWithStep(realDb, /UPDATE users SET email_verified = 1/, () =>
      bumpTokenVersion(account.id)
    );

    const res = await withDb(step.db, () => open(token, marker));

    expect(step.ran()).toBe(true);
    expect(res.headers.get('Location')).toBe(`${APP}/#everified=1`);
    expect(cookieSet(res, 'fm_session')).toBeNull();
    expect(markerLine(res)).toMatch(/^fm_signup=;.*Max-Age=0/);
    expect((await accountAt(at('signed-out'))).email_verified).toBe(1);
    expect(await sessionsOf(account.id)).toBe(0);
  });

  it('signs in nothing when another tab spent the link meanwhile', async () => {
    const { marker, token } = await signedUp(at('raced'));
    const account = await accountAt(at('raced'));
    const step = dbWithStep(
      realDb,
      /SELECT email, password_hash, token_version, email_verified, auth_provider FROM users/,
      async () =>
        realDb
          .prepare("UPDATE email_verifications SET used_at = datetime('now') WHERE token_hash = ?")
          .bind(await sha256(token))
          .run()
    );

    const res = await withDb(step.db, () => open(token, marker));

    expect(step.ran()).toBe(true);
    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=invalid_or_used`);
    expect(cookieSet(res, 'fm_session')).toBeNull();
    expect(await sessionsOf(account.id)).toBe(0);
  });

  it('signs in once: a confirm link left for the account after that asks for the password', async () => {
    const { marker, token } = await signedUp(at('once'));
    expect((await open(token, marker)).headers.get('Location')).toBe(SIGNED_IN);
    const account = await accountAt(at('once'));
    const later = `later-${crypto.randomUUID()}`;
    await realDb
      .prepare(
        "INSERT INTO email_verifications (user_id, email, token_hash, expires_at, purpose) VALUES (?, ?, ?, datetime('now', '+1 day'), 'confirm')"
      )
      .bind(account.id, at('once'), await sha256(later))
      .run();

    const res = await open(later, marker);

    expect(res.headers.get('Location')).toBe(ASKS_FOR_PASSWORD);
    expect(cookieSet(res, 'fm_session')).toBeNull();
    expect(await sessionsOf(account.id)).toBe(1);
    expect(await linkSpent(later)).toBe(false);
  });
});

describe('the confirm link asks for the password', () => {
  it('in a browser that did not sign up', async () => {
    const { token } = await signedUp(at('elsewhere'));

    await askedForPassword(await open(token), at('elsewhere'), token);
  });

  it('with the marker of a sign-up at another address', async () => {
    const mine = await signedUp(at('mine'));
    const theirs = await signedUp(at('theirs'));

    await askedForPassword(await open(mine.token, theirs.marker), at('mine'), mine.token);
  });

  it('with a marker for the address and another password', async () => {
    const { token } = await signedUp(at('other-hash'));

    const marker = await madeMarker({
      address: at('other-hash'),
      passwordHash: await hashPassword(PASSWORD),
    });

    await askedForPassword(await open(token, marker), at('other-hash'), token);
  });

  it("with a marker for the account's password and another address", async () => {
    const { token } = await signedUp(at('other-address'));
    const account = await accountAt(at('other-address'));

    const marker = await madeMarker({
      address: at('someone-else'),
      passwordHash: account.password_hash,
    });

    await askedForPassword(await open(token, marker), at('other-address'), token);
  });

  it('after a sign-up at the address with another password, which keeps the first password', async () => {
    const first = await signedUp(at('twice'), PASSWORD);
    const second = await signedUp(at('twice'), OTHER_PASSWORD);

    await askedForPassword(await open(second.token, second.marker), at('twice'), second.token);
    expect(await verifyPassword(PASSWORD, (await accountAt(at('twice'))).password_hash)).toBe(true);
    // The browser that set the password still signs in with the newest link.
    expect((await open(second.token, first.marker)).headers.get('Location')).toBe(SIGNED_IN);
  });

  it('when the password changed since the sign-up', async () => {
    const { marker, token } = await signedUp(at('changed'));
    await realDb
      .prepare('UPDATE users SET password_hash = ? WHERE email = ?')
      .bind(await hashPassword(OTHER_PASSWORD), at('changed'))
      .run();

    await askedForPassword(await open(token, marker), at('changed'), token);
  });

  it('once the marker has run out', async () => {
    const { marker, token } = await signedUp(at('ran-out'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + (SIGNUP_MARKER_SECONDS + 1) * 1000);

    await askedForPassword(await open(token, marker), at('ran-out'), token);
  });

  it('with a marker that ran out or says it lasts longer than any marker does', async () => {
    const { token } = await signedUp(at('exp'));
    const { password_hash } = await accountAt(at('exp'));
    const now = nowSeconds();

    for (const exp of [now - 1, now, now + SIGNUP_MARKER_SECONDS + 60]) {
      const marker = await madeMarker({ address: at('exp'), passwordHash: password_hash, exp });
      await askedForPassword(await open(token, marker), at('exp'), token);
    }
  });

  it('with a marker signed under another key', async () => {
    const { token } = await signedUp(at('other-key'));
    const { password_hash } = await accountAt(at('other-key'));
    const keys = [
      // The session key.
      await hmacKey(vars.JWT_SECRET!),
      // The login check's key.
      await derivedHmacKey(vars.JWT_SECRET!, 'token-circles login-check v1', vars.APP_ENV),
      // This key on another deployment, given the same JWT_SECRET.
      await markerKey('production'),
      // Another secret.
      await derivedHmacKey('another-secret', KEY_LABEL, vars.APP_ENV),
    ];

    for (const key of keys) {
      const marker = await madeMarker({
        address: at('other-key'),
        passwordHash: password_hash,
        key,
      });
      await askedForPassword(await open(token, marker), at('other-key'), token);
    }
  });

  it('with a marker that cannot be read', async () => {
    const { token } = await signedUp(at('unreadable'));
    const { password_hash } = await accountAt(at('unreadable'));
    const good = { address: at('unreadable'), passwordHash: password_hash };
    const right = await madeMarker(good);
    const exp = nowSeconds() + 600;
    const markers = [
      `${SIGNUP_MARKER_COOKIE}=x`,
      `${SIGNUP_MARKER_COOKIE}=v1...`,
      // Another format, with a MAC that is right for v1.
      await madeMarker({ ...good, format: 'v2' }),
      // A part too many.
      `${right}.more`,
      // The time written in a way Number() reads but the format does not.
      await madeMarker({ ...good, exp, expAs: `+${exp}` }),
      await madeMarker({ ...good, exp, expAs: `0x${exp.toString(16)}` }),
      // An id of the wrong shape, signed as it is.
      await madeMarker({ ...good, id: 'not-an-id' }),
      // A MAC that is not base64url, and one changed by a character.
      `${right.slice(0, right.lastIndexOf('.'))}.%%%`,
      `${right.slice(0, -2)}${right.endsWith('AA') ? 'BB' : 'AA'}`,
      `${SIGNUP_MARKER_COOKIE}=${'a'.repeat(4000)}`,
    ];

    for (const marker of markers) {
      await askedForPassword(await open(token, marker), at('unreadable'), token);
    }
  });

  it('when the right marker comes after more markers than are read', async () => {
    const { token } = await signedUp(at('crowded'));
    const { password_hash } = await accountAt(at('crowded'));
    const right = await madeMarker({ address: at('crowded'), passwordHash: password_hash });
    const wrong = (n: number) => `${SIGNUP_MARKER_COOKIE}=v1.${nowSeconds() + n}.x.y`;

    const fourth = await open(token, [wrong(1), wrong(2), wrong(3), right].join('; '));
    await askedForPassword(fourth, at('crowded'), token);

    const third = await open(token, [wrong(1), wrong(2), right].join('; '));
    expect(third.headers.get('Location')).toBe(SIGNED_IN);
  });

  it('when the account asks for a second factor', async () => {
    const { marker, token } = await signedUp(at('totp'));
    await realDb
      .prepare(
        "INSERT INTO totp_credentials (user_id, secret_enc, confirmed_at) SELECT id, 'x', datetime('now') FROM users WHERE email = ?"
      )
      .bind(at('totp'))
      .run();

    await askedForPassword(await open(token, marker), at('totp'), token);
  });

  it("when the account's address is no longer the one the link was mailed to", async () => {
    const { marker, token } = await signedUp(at('moved'));
    await realDb
      .prepare('UPDATE users SET email = ? WHERE email = ?')
      .bind(at('moved-on'), at('moved'))
      .run();

    const res = await open(token, marker);

    expect(res.headers.get('Location')).toBe(ASKS_FOR_PASSWORD);
    expect(cookieSet(res, 'fm_session')).toBeNull();
    expect(await linkSpent(token)).toBe(false);
  });

  it('when the account is removed while the link opens', async () => {
    const { marker, token } = await signedUp(at('removed'));
    const account = await accountAt(at('removed'));
    const step = dbWithStep(realDb, /SELECT 1 AS found FROM users/, () =>
      realDb.batch([
        realDb.prepare('DELETE FROM email_verifications WHERE user_id = ?').bind(account.id),
        realDb.prepare('DELETE FROM profiles WHERE user_id = ?').bind(account.id),
        realDb.prepare('DELETE FROM users WHERE id = ?').bind(account.id),
      ])
    );

    const res = await withDb(step.db, () => open(token, marker));

    expect(step.ran()).toBe(true);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(ASKS_FOR_PASSWORD);
    expect(cookieSet(res, 'fm_session')).toBeNull();
  });
});

describe('a link that is not an unspent confirm link signs in nothing', () => {
  /** A link the test knows the token of, for the account at `email`. */
  async function plant(email: string, purpose: 'confirm' | 'change', expiresAt: string) {
    const account = await accountAt(email);
    const token = `planted-${purpose}-${crypto.randomUUID()}`;
    await realDb
      .prepare(
        'INSERT INTO email_verifications (user_id, email, token_hash, expires_at, purpose) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(account.id, email, await sha256(token), expiresAt, purpose)
      .run();
    return token;
  }

  const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

  it('a change link, to the address the account has or to a new one, whatever marker comes with it', async () => {
    const { marker } = await signedUp(at('change'));
    const account = await accountAt(at('change'));
    const toSameAddress = await plant(at('change'), 'change', tomorrow());
    const toNewAddress = `planted-change-${crypto.randomUUID()}`;
    await realDb
      .prepare(
        "INSERT INTO email_verifications (user_id, email, token_hash, expires_at, purpose) VALUES (?, ?, ?, ?, 'change')"
      )
      .bind(account.id, at('change-new'), await sha256(toNewAddress), tomorrow())
      .run();
    const forNewAddress = await madeMarker({
      address: at('change-new'),
      passwordHash: account.password_hash,
    });

    for (const [token, cookie] of [
      [toSameAddress, marker],
      [toNewAddress, marker],
      [toNewAddress, forNewAddress],
    ] as const) {
      const res = await open(token, cookie);
      expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=signin_required&change=1`);
      expect(cookieSet(res, 'fm_session')).toBeNull();
      expect(await linkSpent(token)).toBe(false);
    }
    expect((await accountAt(at('change'))).email_verified).toBe(0);
    expect(await sessionsOf(account.id)).toBe(0);
  });

  it('a confirm link that ran out', async () => {
    const { marker } = await signedUp(at('expired'));
    const token = await plant(at('expired'), 'confirm', new Date(Date.now() - 1000).toISOString());

    const res = await open(token, marker);

    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=expired`);
    expect(cookieSet(res, 'fm_session')).toBeNull();
    expect((await accountAt(at('expired'))).email_verified).toBe(0);
  });

  it('a confirm link already spent', async () => {
    const { marker, token } = await signedUp(at('spent'));
    await realDb
      .prepare("UPDATE email_verifications SET used_at = datetime('now') WHERE token_hash = ?")
      .bind(await sha256(token))
      .run();

    const res = await open(token, marker);

    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=invalid_or_used`);
    expect(cookieSet(res, 'fm_session')).toBeNull();
    expect((await accountAt(at('spent'))).email_verified).toBe(0);
  });

  it('a confirm link of an account whose address is confirmed already', async () => {
    const { marker } = await signedUp(at('confirmed-already'));
    await realDb
      .prepare('UPDATE users SET email_verified = 1 WHERE email = ?')
      .bind(at('confirmed-already'))
      .run();
    const token = await plant(at('confirmed-already'), 'confirm', tomorrow());

    const res = await open(token, marker);

    expect(res.headers.get('Location')).toBe(ASKS_FOR_PASSWORD);
    expect(cookieSet(res, 'fm_session')).toBeNull();
    expect(await linkSpent(token)).toBe(false);
  });

  it('a confirm link of an account with no password', async () => {
    const { token } = await signedUp(at('no-password'));
    // What a marker would be for an account with no password stored.
    const marker = await madeMarker({
      address: at('no-password'),
      passwordHash: null as unknown as string,
    });
    await realDb
      .prepare('UPDATE users SET password_hash = NULL WHERE email = ?')
      .bind(at('no-password'))
      .run();

    const res = await open(token, marker);

    expect(res.headers.get('Location')).toBe(ASKS_FOR_PASSWORD);
    expect(cookieSet(res, 'fm_session')).toBeNull();
    expect(await linkSpent(token)).toBe(false);
  });
});

describe('a sign-up again at a waiting address with the same password', () => {
  it('stores that password as this sign-up hashed it, so its browser is the one the link signs in', async () => {
    const first = await signedUp(at('again'), PASSWORD);
    const before = (await accountAt(at('again'))).password_hash;
    const second = await signedUp(at('again'), PASSWORD);

    const after = (await accountAt(at('again'))).password_hash;
    expect(after).not.toBe(before);
    expect(await verifyPassword(PASSWORD, after)).toBe(true);
    await askedForPassword(await open(second.token, first.marker), at('again'), second.token);
    expect((await open(second.token, second.marker)).headers.get('Location')).toBe(SIGNED_IN);
  });
});

describe('GET /api/auth/email-link', () => {
  const read = (cookie?: string) =>
    fetchSettled(`${BASE}/api/auth/email-link`, {
      headers: { ...newAddress(), ...(cookie ? { Cookie: cookie } : {}) },
    });

  async function waiting(cookie?: string): Promise<unknown> {
    const res = await read(cookie);
    expect(res.status).toBe(200);
    return res.json();
  }

  /** The link's own marker, as a browser keeps it after opening the link signed out. */
  async function openedElsewhere(email: string): Promise<{ cookie: string; token: string }> {
    const { token } = await signedUp(email);
    const res = await open(token);
    expect(res.headers.get('Location')).toBe(ASKS_FOR_PASSWORD);
    return { cookie: cookieSet(res, 'fm_email_link')!, token };
  }

  it('names the address the confirm link this browser opened waits for', async () => {
    const { cookie } = await openedElsewhere(at('read'));

    expect(await waiting(cookie)).toEqual({ waiting: 'confirm', email: at('read') });
  });

  it('says nothing waits with no link opened, or one that cannot be read', async () => {
    expect(await waiting()).toEqual({ waiting: null });
    expect(await waiting('fm_email_link=v1.1.2.3')).toEqual({ waiting: null });
  });

  it('says nothing waits once the link is spent or has run out, or its account is confirmed or has moved', async () => {
    const spent = await openedElsewhere(at('read-spent'));
    await realDb
      .prepare("UPDATE email_verifications SET used_at = datetime('now') WHERE token_hash = ?")
      .bind(await sha256(spent.token))
      .run();
    const ranOut = await openedElsewhere(at('read-ran-out'));
    await realDb
      .prepare(
        "UPDATE email_verifications SET expires_at = datetime('now', '-1 minute') WHERE token_hash = ?"
      )
      .bind(await sha256(ranOut.token))
      .run();
    const confirmed = await openedElsewhere(at('read-confirmed'));
    await realDb
      .prepare('UPDATE users SET email_verified = 1 WHERE email = ?')
      .bind(at('read-confirmed'))
      .run();
    const moved = await openedElsewhere(at('read-moved'));
    await realDb
      .prepare('UPDATE users SET email = ? WHERE email = ?')
      .bind(at('read-moved-on'), at('read-moved'))
      .run();

    for (const { cookie } of [spent, ranOut, confirmed, moved]) {
      expect(await waiting(cookie)).toEqual({ waiting: null });
    }
  });

  it('says nothing waits for a change link', async () => {
    await signedUp(at('read-change'));
    const account = await accountAt(at('read-change'));
    const token = `planted-change-${crypto.randomUUID()}`;
    await realDb
      .prepare(
        "INSERT INTO email_verifications (user_id, email, token_hash, expires_at, purpose) VALUES (?, ?, ?, datetime('now', '+1 day'), 'change')"
      )
      .bind(account.id, at('read-change-new'), await sha256(token))
      .run();
    const res = await open(token);
    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=signin_required&change=1`);

    expect(await waiting(cookieSet(res, 'fm_email_link')!)).toEqual({ waiting: null });
  });

  it('answers 30 reads a minute from one network address', async () => {
    const from = { 'CF-Connecting-IP': '10.78.0.1' };
    await realDb
      .prepare("DELETE FROM rate_limits WHERE bucket = 'email-link-read:10.78.0.1'")
      .run();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) {
      statuses.push((await fetchSettled(`${BASE}/api/auth/email-link`, { headers: from })).status);
    }

    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

describe('the rule the marker follows', () => {
  it('lasts as long as shared/confirmLinkSignIn.ts says, and no longer than the link', () => {
    expect(SIGNUP_MARKER_SECONDS).toBe(CONFIRM_LINK_SIGN_IN.seconds);
    expect(SIGNUP_MARKER_SECONDS).toBeLessThanOrEqual(VERIFY_TOKEN_TTL_HOURS * 3600);
  });
});
