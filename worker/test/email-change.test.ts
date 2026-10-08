/**
 * A new account email takes effect once the new address confirms it.
 *
 * Saving a different address in Settings (PUT /api/notifications/settings) stores a pending change
 * and mails the new address a link. The account keeps its address, and whether that address is
 * confirmed, until the link is opened; GET /api/auth/verify-email then moves it.
 *
 * RESEND_API_KEY is set and the call to Resend is caught here, as in forgot-password.test.ts, so
 * each test follows the link the Worker actually mails.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword, issueSessionCookie } from '../src/auth';
import { createLoginCode } from '../src/login-codes';
import { issueLoginCodeCookie } from '../src/routes/email-code';

const UID = 9500;
const OTHER = 9510;
const OLD = 'owner@example.com';
const NEW = 'new-home@example.com';
const TAKEN = 'someone-else@example.com';
const PASSWORD = 'the-account-password';
// wrangler.jsonc's CORS_ORIGIN: where the link sends the browser back to.
const APP = 'http://localhost:3800';

interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const realFetch = globalThis.fetch;
let sent: Mail[] = [];
let cookie = '';

function call(method: string, path: string, body?: unknown, withCookie = true) {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      ...(withCookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** What the Settings page sends when its address field is saved. */
const save = (email: string) => call('PUT', '/api/notifications/settings', { email });
const resend = (withCookie = true) =>
  call('POST', '/api/auth/email-change/resend', undefined, withCookie);
const cancel = (withCookie = true) =>
  call('DELETE', '/api/auth/email-change', undefined, withCookie);
const settings = async () =>
  (await (await call('GET', '/api/notifications/settings')).json()) as Record<string, unknown>;
const signIn = (email: string) => call('POST', '/api/auth/login', { email, password: PASSWORD });

const mailsTo = (address: string) => sent.filter((m) => m.to === address);

/** The link in a mail, as its plain-text twin carries it. */
function linkIn(mail: Mail | undefined): string {
  const found =
    /https:\/\/example\.com\/api\/auth\/verify-email\?token=[0-9a-f]+&returnTo=\S+/.exec(
      String(mail?.text)
    );
  expect(found, `a confirm link in ${JSON.stringify(mail?.text)}`).not.toBeNull();
  return found![0];
}

/** The newest link mailed to `address`. */
const latestLinkTo = (address: string) => linkIn(mailsTo(address).at(-1));

const open = (link: string) => SELF.fetch(link, { redirect: 'manual' });

/** The token in a password reset mail, read the way forgot-password.test.ts reads it. */
function resetTokenIn(mail: Mail | undefined): string {
  const found = /#reset-password\?token=([A-Za-z0-9_-]+)/.exec(String(mail?.text));
  expect(found, `a reset link in ${JSON.stringify(mail?.text)}`).not.toBeNull();
  return found![1];
}

const resetPassword = (token: string) =>
  call('POST', '/api/auth/reset-password', { token, password: 'picked-by-the-old-inbox' }, false);

/** A sign-in code for `email`, minted as /email-code/request mints one, with its ceremony cookie. */
async function codeFor(email: string): Promise<{ code: string; ceremony: string }> {
  const { code, id } = await createLoginCode(env, UID, email);
  return { code, ceremony: (await issueLoginCodeCookie(env, id, email)).split(';')[0] };
}

const signInWithCode = (email: string, { code, ceremony }: { code: string; ceremony: string }) =>
  SELF.fetch('https://example.com/api/auth/email-code/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: ceremony },
    body: JSON.stringify({ email, code }),
  });

const unusedResetsAndCodes = async () => {
  const count = async (table: string) =>
    (
      await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ? AND used_at IS NULL`
      )
        .bind(UID)
        .first<{ n: number }>()
    )?.n;
  return { resets: await count('password_resets'), codes: await count('login_codes') };
};

const account = async (id = UID) =>
  env.DB.prepare('SELECT email, email_verified FROM users WHERE id = ?')
    .bind(id)
    .first<{ email: string | null; email_verified: number }>();

const unusedLinks = async () =>
  (
    await env.DB.prepare(
      'SELECT email, purpose, token_hash, expires_at FROM email_verifications WHERE user_id = ? AND used_at IS NULL ORDER BY id'
    )
      .bind(UID)
      .all<{ email: string; purpose: string; token_hash: string; expires_at: string }>()
  ).results;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function seed(verified = 1): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, auth_provider, email_verified, token_version) VALUES (?, ?, ?, 'password', ?, 1)"
    ).bind(UID, OLD, await hashPassword(PASSWORD), verified),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, email_verified, token_version) VALUES (?, ?, 'password', 1, 1)"
    ).bind(OTHER, TAKEN),
  ]);
  cookie = (await issueSessionCookie(UID, 'password', env)).split(';')[0];
}

beforeEach(async () => {
  for (const table of [
    'email_verifications',
    'password_resets',
    'login_codes',
    'rate_limits',
    'settings',
    'auth_sessions',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  (env as unknown as Record<string, string>).RESEND_API_KEY = 'rk_test';
  sent = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('api.resend.com')) {
      sent.push(JSON.parse(String(init?.body ?? '{}')) as Mail);
      return new Response('{"id":"re_1"}', { headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete (env as unknown as Record<string, string>).RESEND_API_KEY;
});

describe('saving a new address', () => {
  it('stores a pending change and leaves the address, and whether it is confirmed, alone', async () => {
    await seed(1);

    const res = await save('  New-Home@Example.com ');

    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pendingEmail: NEW });
    expect(await account()).toEqual({ email: OLD, email_verified: 1 });
    expect(await settings()).toMatchObject({ email: OLD, pendingEmail: NEW });

    // One link, stored as a hash of the token the mail carries, good for 24 hours.
    const token = new URL(latestLinkTo(NEW)).searchParams.get('token')!;
    const links = await unusedLinks();
    expect(links.map(({ email, purpose, token_hash }) => ({ email, purpose, token_hash }))).toEqual(
      [{ email: NEW, purpose: 'change', token_hash: await sha256(token) }]
    );
    const left = Date.parse(links[0].expires_at) - Date.now();
    expect(left).toBeGreaterThan(23.9 * 3_600_000);
    expect(left).toBeLessThanOrEqual(24 * 3_600_000);
  });

  it('leaves an unconfirmed address unconfirmed', async () => {
    await seed(0);

    expect((await save(NEW)).status).toBe(200);

    expect(await account()).toEqual({ email: OLD, email_verified: 0 });
  });

  it('mails the new address a link that moves the account to it and marks it confirmed', async () => {
    await seed(0);
    await save(NEW);

    expect(mailsTo(NEW)).toHaveLength(1);
    expect(mailsTo(NEW)[0].subject).toMatch(/confirm/i);
    const res = await open(latestLinkTo(NEW));

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${APP}/#everified=1&change=1`);
    expect(await account()).toEqual({ email: NEW, email_verified: 1 });
    expect(await settings()).toMatchObject({ email: NEW, pendingEmail: null });
  });

  it('keeps the old address signing in until the link is opened', async () => {
    await seed(1);
    await save(NEW);

    expect((await signIn(OLD)).status).toBe(200);
    expect((await signIn(NEW)).status).toBe(401);

    await open(latestLinkTo(NEW));

    expect((await signIn(NEW)).status).toBe(200);
    expect((await signIn(OLD)).status).toBe(401);
  });

  it('does not hold the address against someone else signing up with it', async () => {
    await seed(1);
    await save(NEW);

    const signup = await call(
      'POST',
      '/api/auth/register',
      { email: NEW, password: 'their-own-password' },
      false
    );

    expect(signup.status).toBe(200);
    const theirs = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(NEW)
      .first<{ id: number }>();
    expect(theirs).not.toBeNull();
    expect(theirs!.id).not.toBe(UID);
    // A welcome, not the "you already have an account" notice.
    expect(mailsTo(NEW).at(-1)!.subject).toMatch(/welcome/i);
  });

  it('replaces a change still waiting, so only the newest link works', async () => {
    await seed(1);
    await save(NEW);
    const first = latestLinkTo(NEW);
    await save('another-home@example.com');

    expect((await open(first)).headers.get('Location')).toBe(
      `${APP}/#everified_error=invalid_or_used`
    );
    expect(await account()).toEqual({ email: OLD, email_verified: 1 });

    await open(latestLinkTo('another-home@example.com'));
    expect((await account())!.email).toBe('another-home@example.com');
  });

  it('refuses an address another account has, mails nobody and stores nothing', async () => {
    await seed(1);

    const res = await save('Someone-Else@example.com');

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'That email is already in use' });
    expect(sent).toEqual([]);
    expect(await unusedLinks()).toEqual([]);
    expect(await account()).toEqual({ email: OLD, email_verified: 1 });
  });

  it('counts asking for an address another account has against the same limits', async () => {
    await seed(1);
    for (let i = 0; i < 3; i++) expect((await save(TAKEN)).status).toBe(409);

    expect((await save(TAKEN)).status).toBe(429);
  });

  it('refuses something that is not an address', async () => {
    await seed(1);

    const res = await save('owner-at-example');

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'A valid email is required' });
    expect(sent).toEqual([]);
    expect(await unusedLinks()).toEqual([]);
  });

  it('treats the address the account already has as no change', async () => {
    await seed(1);

    const res = await save(' Owner@Example.com ');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sent).toEqual([]);
    expect(await unusedLinks()).toEqual([]);
  });

  it('mails one address at most three links an hour', async () => {
    await seed(1);
    for (let i = 0; i < 3; i++) expect((await save(NEW)).status).toBe(200);

    const fourth = await save(NEW);

    expect(fourth.status).toBe(429);
    expect(mailsTo(NEW)).toHaveLength(3);
  });

  it('lets one account ask for at most five changes an hour', async () => {
    await seed(1);
    for (let i = 1; i <= 5; i++) expect((await save(`home-${i}@example.com`)).status).toBe(200);

    const sixth = await save('home-6@example.com');

    expect(sixth.status).toBe(429);
    expect(mailsTo('home-6@example.com')).toEqual([]);
  });

  it('lets one account ask for at most ten changes a day', async () => {
    await seed(1);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const start = Date.now();
      for (let i = 1; i <= 10; i++) {
        // Five an hour is the hourly cap, so the second five come an hour later.
        if (i === 6) vi.setSystemTime(start + 61 * 60_000);
        expect((await save(`day-${i}@example.com`)).status).toBe(200);
      }
      vi.setSystemTime(start + 122 * 60_000);

      const eleventh = await save('day-11@example.com');

      expect(eleventh.status).toBe(429);
      expect(mailsTo('day-11@example.com')).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the link that confirms the current address working', async () => {
    await seed(0);
    expect((await call('POST', '/api/auth/resend-verification')).status).toBe(200);
    const confirmCurrent = latestLinkTo(OLD);

    await save(NEW);

    expect((await open(confirmCurrent)).headers.get('Location')).toBe(`${APP}/#everified=1`);
    expect(await account()).toEqual({ email: OLD, email_verified: 1 });
  });

  it('keeps a change waiting when the confirm link for the current address is sent again', async () => {
    await seed(0);
    await save(NEW);

    expect((await call('POST', '/api/auth/resend-verification')).status).toBe(200);

    expect((await open(latestLinkTo(NEW))).headers.get('Location')).toBe(
      `${APP}/#everified=1&change=1`
    );
    expect(await account()).toEqual({ email: NEW, email_verified: 1 });
  });
});

describe('the link, when it should not work', () => {
  it('refuses a second use, and changes nothing', async () => {
    await seed(1);
    await save(NEW);
    const link = latestLinkTo(NEW);
    await open(link);
    // Back where it started, so the second attempt cannot be judged by what the first left.
    await env.DB.prepare('UPDATE users SET email = ?, email_verified = 0 WHERE id = ?')
      .bind(OLD, UID)
      .run();

    const res = await open(link);

    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=invalid_or_used`);
    expect(await account()).toEqual({ email: OLD, email_verified: 0 });
  });

  it('refuses an expired link, and changes nothing', async () => {
    await seed(0);
    await save(NEW);
    await env.DB.prepare('UPDATE email_verifications SET expires_at = ? WHERE user_id = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), UID)
      .run();

    // An expired change is not waiting any more.
    expect((await settings()).pendingEmail).toBeNull();
    const res = await open(latestLinkTo(NEW));

    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=expired&change=1`);
    expect(await account()).toEqual({ email: OLD, email_verified: 0 });
  });

  it('refuses a wrong token, changes nothing, and spends nothing', async () => {
    await seed(1);
    await save(NEW);
    const real = new URL(latestLinkTo(NEW));
    const wrong = new URL(real);
    wrong.searchParams.set('token', 'f'.repeat(64));

    const res = await open(wrong.toString());

    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=invalid_or_used`);
    expect(await account()).toEqual({ email: OLD, email_verified: 1 });
    expect((await settings()).pendingEmail).toBe(NEW);
    expect((await open(real.toString())).headers.get('Location')).toBe(
      `${APP}/#everified=1&change=1`
    );
  });

  it('says so when another account has taken the address since, and changes nothing', async () => {
    // Unconfirmed, so a refused link that marked the address it leaves as confirmed would show.
    await seed(0);
    await save(NEW);
    // Before the sign-up, whose welcome mail to the same address carries a link of its own.
    const link = latestLinkTo(NEW);
    expect(
      (await call('POST', '/api/auth/register', { email: NEW, password: 'theirs-now' }, false))
        .status
    ).toBe(200);

    const res = await open(link);

    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=email_taken&change=1`);
    expect(await account()).toEqual({ email: OLD, email_verified: 0 });
    const holders = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(NEW).all();
    expect(holders.results).toHaveLength(1);
  });
});

describe('the link, for an account that is gone', () => {
  it('refuses it rather than reporting a change', async () => {
    await seed(0);
    await save(NEW);
    const link = latestLinkTo(NEW);
    // Profiles first, as account deletion does: they point at the user row.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM profiles WHERE user_id = ?').bind(UID),
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(UID),
    ]);

    const res = await open(link);

    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=invalid_or_used`);
    expect(await account()).toBeNull();
    const holders = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(NEW).all();
    expect(holders.results).toEqual([]);
  });
});

describe('opening the link', () => {
  it('ends every other link the account has out', async () => {
    await seed(0);
    await call('POST', '/api/auth/resend-verification');
    await save(NEW);
    expect(await unusedLinks()).toHaveLength(2);

    await open(latestLinkTo(NEW));

    expect(await unusedLinks()).toEqual([]);
  });

  it('ends the password reset links the old address was sent', async () => {
    await seed(1);
    expect((await call('POST', '/api/auth/forgot-password', { email: OLD }, false)).status).toBe(
      200
    );
    const token = resetTokenIn(mailsTo(OLD).at(-1));
    await save(NEW);

    await open(latestLinkTo(NEW));

    expect((await resetPassword(token)).status).toBe(400);
    // The password the account had still signs it in, now at the new address.
    expect((await signIn(NEW)).status).toBe(200);
  });

  it('ends the sign-in codes the old address was sent', async () => {
    await seed(1);
    const sentToOld = await codeFor(OLD);
    await save(NEW);

    await open(latestLinkTo(NEW));

    expect((await signInWithCode(OLD, sentToOld)).status).toBe(401);
  });

  it('ends no reset link or sign-in code when the move is refused', async () => {
    await seed(1);
    await call('POST', '/api/auth/forgot-password', { email: OLD }, false);
    await codeFor(OLD);
    await save(NEW);
    const link = latestLinkTo(NEW);
    await call('POST', '/api/auth/register', { email: NEW, password: 'theirs-now' }, false);

    expect((await open(link)).headers.get('Location')).toBe(
      `${APP}/#everified_error=email_taken&change=1`
    );

    expect(await unusedResetsAndCodes()).toEqual({ resets: 1, codes: 1 });
  });
});

describe('the current address', () => {
  it('hears that a change was asked for, to which address, and that nothing changes until then', async () => {
    await seed(1);

    await save(NEW);

    const notices = mailsTo(OLD);
    expect(notices).toHaveLength(1);
    expect(notices[0].html).toContain(NEW);
    expect(notices[0].text).toContain(NEW);
    expect(notices[0].text).toMatch(/nothing changes unless that address confirms it/i);
    // The notice can only tell; the link that makes the change goes to the new address alone.
    expect(notices[0].text).not.toContain('verify-email');
    expect(notices[0].html).not.toContain('verify-email');
  });

  it('hears nothing about a request that was refused', async () => {
    await seed(1);

    expect((await save(TAKEN)).status).toBe(409);
    expect((await save('owner-at-example')).status).toBe(400);

    expect(mailsTo(OLD)).toEqual([]);
  });

  it('gets the new address as text, never as markup', async () => {
    await seed(1);
    const odd = '<b>new</b>@example.com';

    expect((await save(odd)).status).toBe(200);

    const html = mailsTo(OLD)[0].html;
    expect(html).toContain('&lt;b&gt;new&lt;/b&gt;@example.com');
    expect(html).not.toContain(odd);
  });

  it('is skipped when the account has no address, and the link still goes', async () => {
    // A Google account whose address Google had not confirmed is created without one.
    await env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, provider_id, email_verified, token_version) VALUES (?, NULL, 'google', 'google-sub-9500', 0, 1)"
    )
      .bind(UID)
      .run();
    cookie = (await issueSessionCookie(UID, 'google', env)).split(';')[0];

    expect((await save(NEW)).status).toBe(200);

    expect(sent.map((m) => m.to)).toEqual([NEW]);
    await open(latestLinkTo(NEW));
    expect(await account()).toEqual({ email: NEW, email_verified: 1 });
  });
});

describe('sending the link again', () => {
  it('mails a fresh link to the waiting address and retires the earlier one', async () => {
    await seed(1);
    await save(NEW);
    const first = latestLinkTo(NEW);

    const res = await resend();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pendingEmail: NEW });
    expect(mailsTo(NEW)).toHaveLength(2);
    // The link only: the current address heard about this change when it was asked for.
    expect(mailsTo(OLD)).toHaveLength(1);
    expect((await open(first)).headers.get('Location')).toBe(
      `${APP}/#everified_error=invalid_or_used`
    );
    expect((await open(latestLinkTo(NEW))).headers.get('Location')).toBe(
      `${APP}/#everified=1&change=1`
    );
    expect(await account()).toEqual({ email: NEW, email_verified: 1 });
  });

  it('shares the three-an-hour limit with the request', async () => {
    await seed(1);
    await save(NEW);
    expect((await resend()).status).toBe(200);
    expect((await resend()).status).toBe(200);

    const fourth = await resend();

    expect(fourth.status).toBe(429);
    expect(mailsTo(NEW)).toHaveLength(3);
  });

  it('says so when no change is waiting', async () => {
    await seed(1);

    const res = await resend();

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'No email change is waiting to be confirmed' });
    expect(sent).toEqual([]);
  });

  it('sends nothing once another account has the address', async () => {
    await seed(1);
    await save(NEW);
    await call('POST', '/api/auth/register', { email: NEW, password: 'theirs-now' }, false);
    const before = mailsTo(NEW).length;

    const res = await resend();

    expect(res.status).toBe(409);
    expect(mailsTo(NEW)).toHaveLength(before);
  });

  it('needs a session', async () => {
    expect((await resend(false)).status).toBe(401);
  });
});

describe('cancelling', () => {
  it('ends the waiting change: its link stops working and the address stays', async () => {
    await seed(1);
    await save(NEW);
    const link = latestLinkTo(NEW);

    const res = await cancel();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await settings()).pendingEmail).toBeNull();
    expect((await open(link)).headers.get('Location')).toBe(
      `${APP}/#everified_error=invalid_or_used`
    );
    expect(await account()).toEqual({ email: OLD, email_verified: 1 });
  });

  it('leaves the link that confirms the current address working', async () => {
    await seed(0);
    await call('POST', '/api/auth/resend-verification');
    const confirmCurrent = latestLinkTo(OLD);
    await save(NEW);

    await cancel();

    expect((await open(confirmCurrent)).headers.get('Location')).toBe(`${APP}/#everified=1`);
    expect(await account()).toEqual({ email: OLD, email_verified: 1 });
  });

  it('is fine with nothing to cancel', async () => {
    await seed(1);

    const res = await cancel();

    expect(res.status).toBe(200);
    expect(await account()).toEqual({ email: OLD, email_verified: 1 });
  });

  it('needs a session', async () => {
    expect((await cancel(false)).status).toBe(401);
  });
});
