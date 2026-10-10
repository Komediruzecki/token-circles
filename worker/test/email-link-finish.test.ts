/**
 * An emailed link opened in a browser without its account's session finishes once that account
 * signs in there: verify-email leaves a marker (an HttpOnly cookie only the finish route
 * receives), and POST /api/auth/email-link/finish spends the link for the signed-in account.
 *
 * Every way of signing in is tried, for both kinds of link: the one that confirms the address and
 * the one that moves the account to a new address.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signState } from '../src/auth';
import { createLoginCode, newCodeHandle } from '../src/login-codes';
import { issueLoginCodeCookie } from '../src/routes/email-code';
import { currentStep, totpCode } from '../src/totp';
import {
  accountRow,
  PASSWORD,
  post,
  removeAccounts,
  seedAccount,
  sessionFrom,
} from './helpers/account-access';
import { sessionCookie } from './helpers/session';
import { createAuthenticator } from './helpers/software-authenticator';
import type { SoftwareAuthenticator } from './helpers/software-authenticator';

const UID = 6650;
const OTHER = 6651;
const ADDRESS = 'household-link@example.com';
const OTHER_ADDRESS = 'household-other@example.com';
const NEW_ADDRESS = 'household-moved@example.com';
const GOOGLE_SUB = 'google-sub-6650';
const MINE = `SELECT ${UID} UNION SELECT ${OTHER} UNION SELECT id FROM users WHERE provider_id = '${GOOGLE_SUB}'`;
const APP = 'http://localhost:3800';
const ORIGIN = 'http://localhost:3800';
const RP_ID = 'localhost';
const FINISH = '/api/auth/email-link/finish';
const MARKER = 'fm_email_link';

const realFetch = globalThis.fetch;
const vars = env as unknown as Record<string, string | undefined>;

beforeEach(async () => {
  await removeAccounts(MINE);
  await env.DB.prepare('DELETE FROM rate_limits').run();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete vars.GOOGLE_CLIENT_SECRET;
  vars.APP_ENV = 'development';
  vi.useRealTimers();
  await removeAccounts(MINE);
});

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

type Purpose = 'confirm' | 'change';

/** A link with a token the test knows: a confirm for the account's address, or a change. */
async function mintLink(
  purpose: Purpose,
  opts: { userId?: number; email?: string; expiresAt?: string } = {}
): Promise<string> {
  const token = `token-${purpose}-${crypto.randomUUID()}`;
  await env.DB.prepare(
    'INSERT INTO email_verifications (user_id, email, token_hash, expires_at, purpose) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(
      opts.userId ?? UID,
      opts.email ?? (purpose === 'change' ? NEW_ADDRESS : ADDRESS),
      await sha256(token),
      opts.expiresAt ?? new Date(Date.now() + 3_600_000).toISOString(),
      purpose
    )
    .run();
  return token;
}

const open = (token: string, cookie?: string) =>
  SELF.fetch(
    `https://example.com/api/auth/verify-email?token=${encodeURIComponent(token)}&returnTo=${encodeURIComponent(APP)}`,
    { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} }
  );

/** The Set-Cookie line that names the marker, or null. */
function markerLine(res: Response): string | null {
  return res.headers.getSetCookie().find((line) => line.startsWith(`${MARKER}=`)) ?? null;
}

/** The marker as a browser sends it back. */
function markerFrom(res: Response): string {
  const line = markerLine(res);
  expect(line).not.toBeNull();
  const pair = line!.split(';')[0]!;
  expect(pair.length).toBeGreaterThan(`${MARKER}=`.length);
  return pair;
}

/** Open the link without a session, as a mail app's own browser does, and keep its marker. */
async function openSignedOut(token: string): Promise<string> {
  const res = await open(token);
  expect(res.headers.get('Location')).toMatch(/#everified_error=signin_required/);
  return markerFrom(res);
}

const finish = (cookie?: string) =>
  SELF.fetch(`https://example.com${FINISH}`, {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
  });

async function finishWith(cookie: string): Promise<{ res: Response; body: unknown }> {
  const res = await finish(cookie);
  return { res, body: await res.json() };
}

const cleared = (res: Response) => expect(markerLine(res)).toMatch(/^fm_email_link=;.*Max-Age=0/);

async function linkRow(token: string) {
  return env.DB.prepare('SELECT used_at FROM email_verifications WHERE token_hash = ?')
    .bind(await sha256(token))
    .first<{ used_at: string | null }>();
}

function cookieFrom(res: Response, name: string): string {
  for (const set of res.headers.getSetCookie()) {
    const pair = set.split(';')[0]!;
    if (pair.startsWith(`${name}=`) && pair.length > name.length + 1) return pair;
  }
  throw new Error(`no ${name} cookie`);
}

/** Google's two answers to the callback, for the account's address. */
function answerGoogle(): void {
  vars.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  const claims = {
    aud: vars.GOOGLE_CLIENT_ID,
    iss: 'https://accounts.google.com',
    sub: GOOGLE_SUB,
    email: ADDRESS,
    email_verified: 'true',
    exp: String(Math.floor(Date.now() / 1000) + 3600),
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ id_token: 'test-id-token' });
    }
    if (url === 'https://www.googleapis.com/oauth2/v3/tokeninfo') return Response.json(claims);
    throw new Error(`Unexpected fetch in a test: ${url}`);
  }) as typeof fetch;
}

const dropSecondFactor = () =>
  env.DB.prepare('DELETE FROM totp_credentials WHERE user_id = ?').bind(UID).run();

interface SignInWay {
  /** Set the account up for this way in, before the link is opened. */
  seed(verified: 0 | 1): Promise<void>;
  /** Sign in that way, in a browser without a session, and return the session it gets. */
  signIn(): Promise<string>;
  /** Whether this sign-in confirms an unconfirmed address itself (and so removes its links). */
  confirmsItself: boolean;
}

function signInWays(): Record<string, SignInWay> {
  let totpSecret = '';
  let authenticator: SoftwareAuthenticator | null = null;
  return {
    'a password': {
      confirmsItself: false,
      async seed(verified) {
        await seedAccount(UID, ADDRESS, verified);
        await dropSecondFactor();
      },
      async signIn() {
        const res = await post('/api/auth/login', { email: ADDRESS, password: PASSWORD });
        expect(res.status).toBe(200);
        return sessionFrom(res)!;
      },
    },
    'a password and a second factor': {
      confirmsItself: false,
      async seed(verified) {
        totpSecret = (await seedAccount(UID, ADDRESS, verified)).totpSecret;
      },
      async signIn() {
        const first = await post('/api/auth/login', { email: ADDRESS, password: PASSWORD });
        expect(await first.json()).toEqual({ twofaRequired: true });
        const code = await totpCode(totpSecret, currentStep());
        const res = await post('/api/auth/2fa/verify', { code }, cookieFrom(first, 'fm_2fa'));
        expect(res.status).toBe(200);
        return sessionFrom(res)!;
      },
    },
    'a passkey': {
      confirmsItself: false,
      async seed(verified) {
        const { session } = await seedAccount(UID, ADDRESS, verified);
        const options = await post('/api/auth/passkeys/register/options', {}, session);
        const { challenge } = (await options.json()) as { challenge: string };
        authenticator = await createAuthenticator();
        const attestation = await authenticator.register(challenge, ORIGIN, RP_ID);
        const registered = await post(
          '/api/auth/passkeys/register/verify',
          { response: attestation, name: 'Laptop' },
          `${session}; ${cookieFrom(options, 'fm_webauthn')}`
        );
        expect(registered.status).toBe(200);
      },
      async signIn() {
        const options = await post('/api/auth/passkeys/login/options', {});
        const { challenge } = (await options.json()) as { challenge: string };
        const assertion = await authenticator!.authenticate(challenge, ORIGIN, RP_ID);
        const res = await post(
          '/api/auth/passkeys/login/verify',
          { response: assertion },
          cookieFrom(options, 'fm_webauthn')
        );
        expect(res.status).toBe(200);
        return sessionFrom(res)!;
      },
    },
    'an emailed code': {
      confirmsItself: true,
      async seed(verified) {
        await seedAccount(UID, ADDRESS, verified);
        await dropSecondFactor();
      },
      async signIn() {
        const handle = newCodeHandle();
        const { code } = await createLoginCode(env, UID, ADDRESS, handle);
        const ceremony = issueLoginCodeCookie(env, handle).split(';')[0]!;
        const res = await post('/api/auth/email-code/verify', { email: ADDRESS, code }, ceremony);
        expect(res.status).toBe(200);
        return sessionFrom(res)!;
      },
    },
    Google: {
      confirmsItself: true,
      async seed(verified) {
        await seedAccount(UID, ADDRESS, verified);
        await dropSecondFactor();
      },
      async signIn() {
        answerGoogle();
        const state = await signState({ returnTo: APP, ts: Date.now() }, env.JWT_SECRET);
        const res = await SELF.fetch(
          `https://example.com/api/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`,
          { redirect: 'manual' }
        );
        expect(res.status).toBe(302);
        return sessionFrom(res)!;
      },
    },
  };
}

describe.each(Object.keys(signInWays()))('after signing in with %s', (how) => {
  it('a change link opened before without a session finishes', async () => {
    const way = signInWays()[how]!;
    await way.seed(1);
    const token = await mintLink('change');
    const marker = await openSignedOut(token);
    const session = await way.signIn();

    const { res, body } = await finishWith(`${session}; ${marker}`);

    expect(body).toEqual({ outcome: 'changed', change: true });
    cleared(res);
    expect((await accountRow(UID))?.email).toBe(NEW_ADDRESS);
    expect((await linkRow(token))?.used_at).not.toBeNull();
  });

  it('a confirm link opened before without a session ends with the address confirmed', async () => {
    const way = signInWays()[how]!;
    await way.seed(0);
    const token = await mintLink('confirm');
    const marker = await openSignedOut(token);
    const session = await way.signIn();

    const { res, body } = await finishWith(`${session}; ${marker}`);

    // A sign-in that confirms the address itself has also removed its links, so there is
    // nothing left for the marker to finish.
    expect(body).toEqual(
      way.confirmsItself
        ? { outcome: 'none', change: false }
        : { outcome: 'confirmed', change: false }
    );
    cleared(res);
    expect((await accountRow(UID))?.email_verified).toBe(1);
  });
});

describe('the marker verify-email leaves', () => {
  it('is HttpOnly, SameSite=Lax, host-only, sent only to the finish route, and lasts 30 minutes', async () => {
    await seedAccount(UID, ADDRESS, 0);
    const res = await open(await mintLink('confirm'));

    const line = markerLine(res)!;
    expect(line).toMatch(/^fm_email_link=[^;]+; /);
    const attrs = line.split('; ').slice(1);
    expect(attrs).toEqual([
      'Path=/api/auth/email-link/finish',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=1800',
    ]);
  });

  it('is Secure outside development', async () => {
    await seedAccount(UID, ADDRESS, 0);
    vars.APP_ENV = 'production';

    const res = await open(await mintLink('confirm'));

    expect(markerLine(res)!.split('; ')).toContain('Secure');
  });

  it("is left for another account's session too, and the link stays unspent", async () => {
    await seedAccount(UID, ADDRESS, 0);
    await seedAccount(OTHER, OTHER_ADDRESS, 1);
    const other = (await sessionCookie(OTHER)).split(';')[0]!;
    const token = await mintLink('confirm');

    const res = await open(token, other);

    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=signin_required`);
    markerFrom(res);
    expect((await linkRow(token))?.used_at).toBeNull();
  });

  it('is not left when the link finishes at once', async () => {
    const { session } = await seedAccount(UID, ADDRESS, 0);

    const res = await open(await mintLink('confirm'), session);

    expect(res.headers.get('Location')).toBe(`${APP}/#everified=1`);
    expect(markerLine(res)).toBeNull();
  });

  it('is not left for a link that was spent, which is no longer valid', async () => {
    const { session } = await seedAccount(UID, ADDRESS, 0);
    const token = await mintLink('change');
    expect((await open(token, session)).headers.get('Location')).toBe(
      `${APP}/#everified=1&change=1`
    );

    const res = await open(token);

    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=invalid_or_used`);
    expect(markerLine(res)).toBeNull();
  });

  it('is not left for a link that has expired, which says so and stays as it was', async () => {
    await seedAccount(UID, ADDRESS, 0);
    const token = await mintLink('change', {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const res = await open(token);

    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=expired&change=1`);
    expect(markerLine(res)).toBeNull();
    expect((await linkRow(token))?.used_at).toBeNull();
  });
});

describe('POST /api/auth/email-link/finish', () => {
  it('needs a session', async () => {
    await seedAccount(UID, ADDRESS, 0);
    const marker = await openSignedOut(await mintLink('confirm'));

    expect((await finish(marker)).status).toBe(401);
  });

  it("keeps the marker for another account's session, and the right account then finishes it", async () => {
    await seedAccount(UID, ADDRESS, 0);
    await seedAccount(OTHER, OTHER_ADDRESS, 1);
    const token = await mintLink('confirm');
    const marker = await openSignedOut(token);
    const other = (await sessionCookie(OTHER)).split(';')[0]!;

    const wrong = await finishWith(`${other}; ${marker}`);

    expect(wrong.body).toEqual({ outcome: 'other_account', change: false });
    expect(markerLine(wrong.res)).toBeNull();
    expect((await linkRow(token))?.used_at).toBeNull();
    expect((await accountRow(UID))?.email_verified).toBe(0);
    expect((await accountRow(OTHER))?.email_verified).toBe(1);

    const mine = (await sessionCookie(UID)).split(';')[0]!;
    const right = await finishWith(`${mine}; ${marker}`);

    expect(right.body).toEqual({ outcome: 'confirmed', change: false });
    expect((await accountRow(UID))?.email_verified).toBe(1);
  });

  it('does nothing with the marker of a link spent since, and clears it', async () => {
    const { session } = await seedAccount(UID, ADDRESS, 0);
    const token = await mintLink('change');
    const marker = await openSignedOut(token);
    expect((await open(token, session)).headers.get('Location')).toBe(
      `${APP}/#everified=1&change=1`
    );
    await env.DB.prepare('UPDATE users SET email = ?, email_verified = 1 WHERE id = ?')
      .bind(ADDRESS, UID)
      .run();

    const { res, body } = await finishWith(`${session}; ${marker}`);

    expect(body).toEqual({ outcome: 'none', change: false });
    cleared(res);
    expect((await accountRow(UID))?.email).toBe(ADDRESS);
  });

  it('does nothing with the marker of a link that expired since, and leaves the link as it was', async () => {
    const { session } = await seedAccount(UID, ADDRESS, 0);
    const token = await mintLink('confirm');
    const marker = await openSignedOut(token);
    await env.DB.prepare('UPDATE email_verifications SET expires_at = ? WHERE token_hash = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), await sha256(token))
      .run();

    const { res, body } = await finishWith(`${session}; ${marker}`);

    expect(body).toEqual({ outcome: 'none', change: false });
    cleared(res);
    expect((await linkRow(token))?.used_at).toBeNull();
    expect((await accountRow(UID))?.email_verified).toBe(0);
  });

  it('finishes a link once: the same marker again answers none', async () => {
    const { session } = await seedAccount(UID, ADDRESS, 0);
    const marker = await openSignedOut(await mintLink('confirm'));

    expect((await finishWith(`${session}; ${marker}`)).body).toEqual({
      outcome: 'confirmed',
      change: false,
    });
    const again = await finishWith(`${session}; ${marker}`);

    expect(again.body).toEqual({ outcome: 'none', change: false });
    cleared(again.res);
  });

  it('answers none, and sets no cookie, without a marker', async () => {
    const { session } = await seedAccount(UID, ADDRESS, 0);
    await mintLink('confirm');

    const { res, body } = await finishWith(session);

    expect(body).toEqual({ outcome: 'none', change: false });
    expect(res.headers.getSetCookie()).toEqual([]);
    expect((await accountRow(UID))?.email_verified).toBe(0);
  });

  it('refuses a marker that was altered, and clears it', async () => {
    const { session } = await seedAccount(UID, ADDRESS, 0);
    const marker = await openSignedOut(await mintLink('confirm'));
    const [id, exp, sig] = marker.slice(`${MARKER}=`.length).split('.');
    // The first character carries six bits of the signature; the last one has padding in it.
    const flipped = `${sig!.startsWith('A') ? 'B' : 'A'}${sig!.slice(1)}`;

    for (const altered of [`${id}.${exp}.${flipped}`, `${id}.${Number(exp) + 60}.${sig}`]) {
      const { res, body } = await finishWith(`${session}; ${MARKER}=${altered}`);
      expect(body).toEqual({ outcome: 'none', change: false });
      cleared(res);
    }
    expect((await accountRow(UID))?.email_verified).toBe(0);
  });

  it("refuses one link's marker for another link of the same account", async () => {
    const { session } = await seedAccount(UID, ADDRESS, 0);
    const marker = await openSignedOut(await mintLink('confirm'));
    const change = await mintLink('change');
    const changeId = (await env.DB.prepare(
      'SELECT id FROM email_verifications WHERE token_hash = ?'
    )
      .bind(await sha256(change))
      .first<{ id: number }>())!.id;
    const [, exp, sig] = marker.slice(`${MARKER}=`.length).split('.');

    const { body } = await finishWith(`${session}; ${MARKER}=${changeId}.${exp}.${sig}`);

    expect(body).toEqual({ outcome: 'none', change: false });
    expect((await accountRow(UID))?.email).toBe(ADDRESS);
    expect((await linkRow(change))?.used_at).toBeNull();
  });

  it('refuses a marker whose link was replaced by another under the same id', async () => {
    const { session } = await seedAccount(UID, ADDRESS, 0);
    const first = await mintLink('confirm');
    const marker = await openSignedOut(first);
    const id = Number(marker.slice(`${MARKER}=`.length).split('.')[0]);
    const second = `token-confirm-${crypto.randomUUID()}`;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM email_verifications WHERE id = ?').bind(id),
      env.DB.prepare(
        "INSERT INTO email_verifications (id, user_id, email, token_hash, expires_at, purpose) VALUES (?, ?, ?, ?, ?, 'confirm')"
      ).bind(
        id,
        UID,
        ADDRESS,
        await sha256(second),
        new Date(Date.now() + 3_600_000).toISOString()
      ),
    ]);

    const { body } = await finishWith(`${session}; ${marker}`);

    expect(body).toEqual({ outcome: 'none', change: false });
    expect((await linkRow(second))?.used_at).toBeNull();
    expect((await accountRow(UID))?.email_verified).toBe(0);
  });

  it('refuses a marker after its 30 minutes, though the link is still good', async () => {
    const { session } = await seedAccount(UID, ADDRESS, 0);
    const token = await mintLink('confirm');
    const marker = await openSignedOut(token);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 31 * 60_000);

    const { res, body } = await finishWith(`${session}; ${marker}`);

    expect(body).toEqual({ outcome: 'none', change: false });
    cleared(res);
    expect((await linkRow(token))?.used_at).toBeNull();
  });

  it('is rate-limited like opening a link', async () => {
    const { session } = await seedAccount(UID, ADDRESS, 0);
    for (let i = 0; i < 30; i++) expect((await finish(session)).status).toBe(200);

    expect((await finish(session)).status).toBe(429);
  });
});
