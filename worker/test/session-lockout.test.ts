/**
 * The three ways a correct password still did not get you into your account.
 *
 * All three were found in one evening on the dev deploy, and none of them left a trace on the
 * server — which is why the fourth part of this file is about the logging.
 *
 *   1. A second `fm_session` cookie from a neighbouring deployment. Cookie identity is
 *      (name, Domain, Path), so prod's cookie on `.tokencircles.com` is also sent to
 *      `api.dev.tokencircles.com`. The reader took the FIRST match, RFC 6265 sorts equal-Path
 *      cookies oldest-first, and the oldest one was the wrong one — permanently.
 *   2. Ten successful logins in a quarter of an hour spent the budget that exists to stop people
 *      GUESSING passwords, and locked out the one person who knew it.
 *   3. "Logout" bumped `token_version`, which revoked every session on every device.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, issueSessionCookie } from '../src/auth';
import { humanWait } from '../src/ratelimit';

const EMAIL = 'locked@example.com';
const PASSWORD = 'correct horse battery staple';
const UID = 9100;
const OTHER_UID = 9101;

/** Just the `name=value` part, which is what a browser echoes back. */
const cookiePair = (setCookie: string): string => setCookie.split(';')[0]!;

const login = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  SELF.fetch('https://api.example.com/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const me = (cookie: string) =>
  SELF.fetch('https://api.example.com/api/auth/me', { headers: { Cookie: cookie } });

beforeEach(async () => {
  for (const t of [
    'auth_sessions',
    'auth_logs',
    'rate_limits',
    'transactions',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  const hash = await hashPassword(PASSWORD);
  await env.DB.prepare(
    "INSERT INTO users (id, email, password_hash, auth_provider, email_verified, token_version) VALUES (?, ?, ?, 'password', 1, 1)"
  )
    .bind(UID, EMAIL, hash)
    .run();
  await env.DB.prepare(
    "INSERT INTO users (id, email, password_hash, auth_provider, email_verified, token_version) VALUES (?, 'other@example.com', ?, 'password', 1, 1)"
  )
    .bind(OTHER_UID, hash)
    .run();
  await env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)')
    .bind(91000, UID, 'Main')
    .run();
});

// ── 1. the duplicate cookie ────────────────────────────────────────────────────────────────────

describe('a request carrying more than one session cookie', () => {
  it('is authenticated by the valid one even when a stale one comes first', async () => {
    // A browser signed into both prod and dev sends both, oldest first — and the oldest is the
    // one that does not work here.
    const stale = 'fm_session=not.a.valid.jwt';
    const good = cookiePair(await issueSessionCookie(UID, 'password', env));

    const res = await me(`${stale}; cf_clearance=x; ${good}`);

    expect(res.status).toBe(200);
    expect((await res.json<{ id: number }>()).id).toBe(UID);
  });

  it('is authenticated whichever order they arrive in', async () => {
    const good = cookiePair(await issueSessionCookie(UID, 'password', env));

    expect((await me(`${good}; fm_session=not.a.valid.jwt`)).status).toBe(200);
  });

  it('is not fooled by a cookie for an account whose sessions were revoked', async () => {
    // The exact production shape: a well-formed JWT, signed by us, for a real user, at a
    // token_version the account has since moved past — what "sign out everywhere" leaves behind.
    const revoked = cookiePair(await issueSessionCookie(UID, 'password', env));
    await env.DB.prepare('UPDATE users SET token_version = 22 WHERE id = ?').bind(UID).run();
    const good = cookiePair(await issueSessionCookie(UID, 'password', env));

    // Revoked first, current second — the losing order under the old reader.
    const res = await me(`${revoked}; ${good}`);

    expect(res.status).toBe(200);
  });

  it('still refuses when every cookie is bad', async () => {
    const res = await me('fm_session=nope; fm_session=also.not.valid');

    expect(res.status).toBe(401);
  });

  it('never signs in as somebody else because their cookie came along', async () => {
    const mine = cookiePair(await issueSessionCookie(UID, 'password', env));
    const theirs = cookiePair(await issueSessionCookie(OTHER_UID, 'password', env));

    // Whoever is first wins, but it must be one of the two real sessions and nothing invented.
    expect((await me(`${theirs}; ${mine}`)).status).toBe(200);
    expect((await (await me(`${theirs}; ${mine}`)).json<{ id: number }>()).id).toBe(OTHER_UID);
  });
});

// ── 2. the rate limit ──────────────────────────────────────────────────────────────────────────

describe('signing in repeatedly', () => {
  it('does not lock out an account whose password is right', async () => {
    // Three devices, a few sign-outs, a couple of retries: over the old limit of ten within the
    // window, and every one of them correct.
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const res = await login({ email: EMAIL, password: PASSWORD });
      expect(res.status, `attempt ${attempt + 1}`).toBe(200);
    }
  });

  it('still refuses a run of wrong passwords', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await login({ email: EMAIL, password: 'wrong' });
    }

    const res = await login({ email: EMAIL, password: 'wrong' });

    expect(res.status).toBe(429);
  });

  it('lets the real owner back in once they get it right', async () => {
    // Nine failures is under the cap; the success must clear it rather than leave the account one
    // typo away from being locked.
    for (let attempt = 0; attempt < 9; attempt += 1) {
      await login({ email: EMAIL, password: 'wrong' });
    }
    expect((await login({ email: EMAIL, password: PASSWORD })).status).toBe(200);

    for (let attempt = 0; attempt < 9; attempt += 1) {
      await login({ email: EMAIL, password: 'wrong' });
    }
    expect((await login({ email: EMAIL, password: PASSWORD })).status).toBe(200);
  });

  it('says how long the wait is, instead of "a bit"', async () => {
    for (let attempt = 0; attempt < 11; attempt += 1) {
      await login({ email: EMAIL, password: 'wrong' });
    }

    const res = await login({ email: EMAIL, password: 'wrong' });
    const body = await res.json<{ error: string }>();

    expect(res.status).toBe(429);
    expect(body.error).toMatch(/try again in/i);
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });
});

describe('humanWait', () => {
  it('reads as something a person would say', () => {
    expect(humanWait(30)).toBe('in 30 seconds');
    expect(humanWait(60)).toBe('in 60 seconds');
    expect(humanWait(120)).toBe('in about 2 minutes');
    expect(humanWait(900)).toBe('in about 15 minutes');
    // Never "in 0 seconds", which reads as "now" and is not.
    expect(humanWait(0)).toBe('in 1 seconds');
  });
});

// ── 3. logging out ─────────────────────────────────────────────────────────────────────────────

describe('signing out', () => {
  it('ends this session and leaves the other devices alone', async () => {
    const phone = cookiePair(await issueSessionCookie(UID, 'password', env));
    const laptop = cookiePair(await issueSessionCookie(UID, 'password', env));

    const res = await SELF.fetch('https://api.example.com/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: laptop },
    });

    expect(res.status).toBe(200);
    // The cookie is cleared for the browser that asked...
    expect(res.headers.get('Set-Cookie')).toContain('fm_session=;');
    // ...and the phone, which asked for nothing, is still signed in.
    expect((await me(phone)).status).toBe(200);
  });

  it('ends every session when that is what was asked for', async () => {
    const phone = cookiePair(await issueSessionCookie(UID, 'password', env));
    const laptop = cookiePair(await issueSessionCookie(UID, 'password', env));

    await SELF.fetch('https://api.example.com/api/auth/logout-all', {
      method: 'POST',
      headers: { Cookie: laptop },
    });

    expect((await me(phone)).status).toBe(401);
  });
});

// ── 4. the trace all of this lacked ────────────────────────────────────────────────────────────

const authLogs = () =>
  env.DB.prepare('SELECT * FROM auth_logs ORDER BY id').all<Record<string, unknown>>();

describe('the auth audit trail', () => {
  it('records a successful sign-in with who it was', async () => {
    await login({ email: EMAIL, password: PASSWORD });

    const rows = (await authLogs()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event: 'login', outcome: 'ok', user_id: UID, email: EMAIL });
  });

  it('records a wrong password against the address that was tried', async () => {
    // For a failed login the attempted address is the only identifier there is — and it is the
    // one thing worth having when someone asks why they cannot get in.
    await login({ email: EMAIL, password: 'wrong' });

    const rows = (await authLogs()).results;
    expect(rows[0]).toMatchObject({ event: 'login', outcome: 'denied', reason: 'bad_credentials' });
    expect(rows[0]!.email).toBe(EMAIL);
  });

  it('records an attempt on an address with no account', async () => {
    // Not a foreign key for exactly this reason. The response stays identical (anti-enumeration);
    // only the log knows.
    await login({ email: 'nobody@example.com', password: 'wrong' });

    expect((await authLogs()).results[0]).toMatchObject({ email: 'nobody@example.com' });
  });

  it('records a refused session together with how many cookies came in', async () => {
    // The column that would have ended the investigation in seconds.
    await me('fm_session=stale.one.here; fm_session=stale.two.here');

    const rows = (await authLogs()).results;
    expect(rows[0]).toMatchObject({ event: 'session', outcome: 'denied', cookie_count: 2 });
  });

  it('says which kind of bad the token was', async () => {
    const revoked = cookiePair(await issueSessionCookie(UID, 'password', env));
    await env.DB.prepare('UPDATE users SET token_version = 9 WHERE id = ?').bind(UID).run();

    await me(revoked);

    expect((await authLogs()).results[0]).toMatchObject({ reason: 'revoked' });
  });

  it('does not write a row for every signed-out page load', async () => {
    // A signed-out browser polls /api/auth/me on every load. One row per denial would be a write
    // per page view and a free amplification vector.
    await me('');
    await SELF.fetch('https://api.example.com/api/auth/me');

    expect((await authLogs()).results).toHaveLength(0);
  });

  it('records the rate-limit refusal, so a lockout is visible from the server', async () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await login({ email: EMAIL, password: 'wrong' });
    }

    const reasons = (await authLogs()).results.map((r) => r.reason);
    expect(reasons).toContain('rate_limited_email');
  });
});

// ── 5. the device list ─────────────────────────────────────────────────────────────────────────

/**
 * What "log out" should have been all along: one row per device, each endable on its own.
 *
 * `token_version` could only ever revoke everything at once, so the product had to pick one
 * meaning for a button labelled "Logout" and picked the surprising one. A session id in the token
 * makes the other meaning possible — and makes it possible to show someone where they are signed
 * in, which is the part no counter can do.
 */
const sessions = (cookie: string) =>
  SELF.fetch('https://api.example.com/api/auth/sessions', { headers: { Cookie: cookie } });

const signIn = async (ua: string): Promise<string> => {
  const res = await login({ email: EMAIL, password: PASSWORD }, { 'User-Agent': ua });
  return cookiePair(res.headers.get('Set-Cookie') ?? '');
};

const CHROME_LINUX =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

describe('the list of signed-in devices', () => {
  it('has one entry per device, labelled so a person can tell them apart', async () => {
    const laptop = await signIn(CHROME_LINUX);
    await signIn(SAFARI_IPHONE);

    const body = await (await sessions(laptop)).json<{ sessions: { device: string }[] }>();

    expect(body.sessions).toHaveLength(2);
    expect(body.sessions.map((s) => s.device).sort()).toEqual([
      'Chrome on Linux',
      'Safari on iPhone',
    ]);
  });

  it('says which one you are looking from', async () => {
    const laptop = await signIn(CHROME_LINUX);
    await signIn(SAFARI_IPHONE);

    const body = await (
      await sessions(laptop)
    ).json<{
      sessions: { device: string; current: boolean }[];
    }>();

    // Seeing yourself in the list is how you know the list is the whole truth.
    expect(body.sessions.filter((s) => s.current)).toHaveLength(1);
    expect(body.sessions.find((s) => s.current)?.device).toBe('Chrome on Linux');
  });

  it('shows only your own devices', async () => {
    const mine = await signIn(CHROME_LINUX);
    await SELF.fetch('https://api.example.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'other@example.com', password: PASSWORD }),
    });

    const body = await (await sessions(mine)).json<{ sessions: unknown[] }>();

    expect(body.sessions).toHaveLength(1);
  });
});

describe('ending one device from the list', () => {
  const revoke = (cookie: string, id: string) =>
    SELF.fetch(`https://api.example.com/api/auth/sessions/${id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });

  it('ends that one and leaves the rest signed in', async () => {
    const laptop = await signIn(CHROME_LINUX);
    const phone = await signIn(SAFARI_IPHONE);
    const body = await (
      await sessions(laptop)
    ).json<{
      sessions: { id: string; device: string }[];
    }>();
    const phoneId = body.sessions.find((s) => s.device === 'Safari on iPhone')!.id;

    expect((await revoke(laptop, phoneId)).status).toBe(200);

    // The phone's token is still signed and unexpired — the row being gone is what stops it.
    expect((await me(phone)).status).toBe(401);
    expect((await me(laptop)).status).toBe(200);
  });

  it('will not let one account end another account’s session', async () => {
    const mine = await signIn(CHROME_LINUX);
    const otherRes = await SELF.fetch('https://api.example.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'other@example.com', password: PASSWORD }),
    });
    const theirCookie = cookiePair(otherRes.headers.get('Set-Cookie') ?? '');
    const theirs = await (await sessions(theirCookie)).json<{ sessions: { id: string }[] }>();

    // An id is not authority: the delete is scoped to the caller's own rows.
    expect((await revoke(mine, theirs.sessions[0]!.id)).status).toBe(404);
    expect((await me(theirCookie)).status).toBe(200);
  });

  it('clears your own cookie when the one you end is the one you are using', async () => {
    const laptop = await signIn(CHROME_LINUX);
    const body = await (await sessions(laptop)).json<{ sessions: { id: string }[] }>();

    const res = await revoke(laptop, body.sessions[0]!.id);

    expect(res.headers.get('Set-Cookie')).toContain('fm_session=;');
    expect((await me(laptop)).status).toBe(401);
  });
});

describe('signing out of this device', () => {
  it('really ends it, not just the cookie', async () => {
    const laptop = await signIn(CHROME_LINUX);
    const phone = await signIn(SAFARI_IPHONE);

    await SELF.fetch('https://api.example.com/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: laptop },
    });

    // Clearing the cookie only ends a session for a browser that cooperates; the row being gone
    // ends it for anyone holding the token.
    expect((await me(laptop)).status).toBe(401);
    expect((await me(phone)).status).toBe(200);
  });

  it('drops it out of the list the other devices can see', async () => {
    const laptop = await signIn(CHROME_LINUX);
    const phone = await signIn(SAFARI_IPHONE);

    await SELF.fetch('https://api.example.com/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: laptop },
    });

    const body = await (await sessions(phone)).json<{ sessions: unknown[] }>();
    expect(body.sessions).toHaveLength(1);
  });
});

describe('signing out everywhere', () => {
  it('empties the list and ends every device', async () => {
    const laptop = await signIn(CHROME_LINUX);
    const phone = await signIn(SAFARI_IPHONE);

    await SELF.fetch('https://api.example.com/api/auth/logout-all', {
      method: 'POST',
      headers: { Cookie: laptop },
    });

    expect((await me(phone)).status).toBe(401);
    expect((await me(laptop)).status).toBe(401);
  });

  it('reaches a token issued before sessions existed, which nothing else can', async () => {
    // The row is what ends a modern session; token_version is the only handle on an older token.
    const legacy = cookiePair(await issueSessionCookie(UID, 'password', env));
    await env.DB.prepare('DELETE FROM auth_sessions').run();
    // With no row and no sid check to fail, it would otherwise still be a valid token.
    const current = await signIn(CHROME_LINUX);

    await SELF.fetch('https://api.example.com/api/auth/logout-all', {
      method: 'POST',
      headers: { Cookie: current },
    });

    expect((await me(legacy)).status).toBe(401);
  });
});
