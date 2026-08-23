/**
 * Email verification for password signups — the confirm link, the resend, and what /me reports.
 *
 * The interesting cases are all the ones where a link should NOT work: spent, expired, minted for
 * an address the account no longer has, or pointed at somebody else's origin. Each is asserted to
 * leave email_verified alone, because a soft gate that can be talked into flipping is no gate.
 *
 * Runs the real worker in workerd via Miniflare. RESEND_API_KEY is unset in tests, so sendMail
 * logs and skips — the token rows are what these assert on; the mail bodies have their own test
 * in email-templates.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import { renderEmailVerification, renderWelcome } from '../src/emailTemplates';

const USER_ID = 8100;
const EMAIL = 'verify-me@example.com';
// wrangler.jsonc sets CORS_ORIGIN for the test environment; the worker bounces the browser back
// here, and treats any other returnTo as untrusted.
const APP = 'http://localhost:3800';

async function seedUser(id = USER_ID, email = EMAIL, verified = 0): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO users (id, email, password_hash, auth_provider, email_verified, token_version) VALUES (?, ?, 'pbkdf2$100000$x$y', 'password', ?, 1)"
  )
    .bind(id, email, verified)
    .run();
}

/** Mint a confirm row directly, so a test can choose the expiry and the address it is bound to. */
async function mintToken(opts: {
  userId?: number;
  email?: string;
  token: string;
  expiresAt?: string;
}): Promise<void> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(opts.token));
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare(
    'INSERT INTO email_verifications (user_id, email, token_hash, expires_at) VALUES (?, ?, ?, ?)'
  )
    .bind(
      opts.userId ?? USER_ID,
      opts.email ?? EMAIL,
      hash,
      opts.expiresAt ?? new Date(Date.now() + 3_600_000).toISOString()
    )
    .run();
}

const confirm = (token: string, returnTo?: string) =>
  SELF.fetch(
    `https://api.example.com/api/auth/verify-email?token=${encodeURIComponent(token)}` +
      (returnTo === undefined ? '' : `&returnTo=${encodeURIComponent(returnTo)}`),
    { redirect: 'manual' }
  );

const isVerified = async (id = USER_ID): Promise<number> =>
  (
    await env.DB.prepare('SELECT email_verified FROM users WHERE id = ?')
      .bind(id)
      .first<{ email_verified: number }>()
  )?.email_verified ?? -1;

const unusedTokens = async (id = USER_ID): Promise<number> =>
  (
    await env.DB.prepare(
      'SELECT COUNT(*) AS c FROM email_verifications WHERE user_id = ? AND used_at IS NULL'
    )
      .bind(id)
      .first<{ c: number }>()
  )?.c ?? -1;

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM email_verifications').run();
  await env.DB.prepare('DELETE FROM profiles').run();
  await env.DB.prepare('DELETE FROM users').run();
});

describe('GET /api/auth/verify-email', () => {
  it('confirms the address and sends the browser back to the app', async () => {
    await seedUser();
    await mintToken({ token: 'good-token' });

    const res = await confirm('good-token');

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${APP}/#everified=1`);
    expect(await isVerified()).toBe(1);
    // Spent, so the same link cannot be replayed out of a mailbox later.
    expect(await unusedTokens()).toBe(0);
  });

  it('refuses a link that has already been used, and says nothing about which case it was', async () => {
    await seedUser();
    await mintToken({ token: 'good-token' });
    await confirm('good-token');
    // Back to unverified, so the second attempt cannot be judged by the flag it left behind.
    await env.DB.prepare('UPDATE users SET email_verified = 0 WHERE id = ?').bind(USER_ID).run();

    const res = await confirm('good-token');

    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=invalid_or_used`);
    expect(await isVerified()).toBe(0);
  });

  it('gives an unknown token the same answer as a used one', async () => {
    await seedUser();

    const res = await confirm('never-existed');

    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=invalid_or_used`);
    expect(await isVerified()).toBe(0);
  });

  it('refuses an expired link, and spends it so it cannot be retried', async () => {
    await seedUser();
    await mintToken({ token: 'stale', expiresAt: new Date(Date.now() - 1000).toISOString() });

    const res = await confirm('stale');

    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=expired`);
    expect(await isVerified()).toBe(0);
    expect(await unusedTokens()).toBe(0);
  });

  it('refuses a link minted for an address the account no longer has', async () => {
    // Otherwise: ask for a link, change the address, then click — and the NEW address is confirmed
    // on the strength of mail delivered to the old one.
    await seedUser();
    await mintToken({ token: 'old-address', email: 'previous@example.com' });

    const res = await confirm('old-address');

    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=invalid_or_used`);
    expect(await isVerified()).toBe(0);
  });

  it('rejects a token with no token at all', async () => {
    const res = await SELF.fetch('https://api.example.com/api/auth/verify-email', {
      redirect: 'manual',
    });
    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=missing_token`);
  });

  it('ignores a returnTo that is not one of the app origins', async () => {
    await seedUser();
    await mintToken({ token: 'good-token' });

    const res = await confirm('good-token', 'https://evil.example.com');

    // The confirm still works; the browser just goes home rather than wherever the link said.
    expect(res.headers.get('Location')).toBe(`${APP}/#everified=1`);
    expect(await isVerified()).toBe(1);
  });

  it('honours a returnTo that IS an app origin', async () => {
    await seedUser();
    await mintToken({ token: 'good-token' });

    const res = await confirm('good-token', APP);

    expect(res.headers.get('Location')).toBe(`${APP}/#everified=1`);
  });
});

describe('POST /api/auth/resend-verification', () => {
  const resend = (cookie?: string) =>
    SELF.fetch('https://api.example.com/api/auth/resend-verification', {
      method: 'POST',
      headers: cookie === undefined ? {} : { Cookie: cookie },
    });

  const sessionFor = async (id = USER_ID): Promise<string> =>
    (await issueSessionCookie(id, 'password', env)).split(';')[0];

  it('needs a session', async () => {
    const res = await resend();
    expect(res.status).toBe(401);
  });

  it('mints a fresh link and retires the one already outstanding', async () => {
    await seedUser();
    await mintToken({ token: 'superseded' });

    const res = await resend(await sessionFor());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await unusedTokens()).toBe(1);
    // The link from the earlier mail is dead — two live links would mean the older one survives
    // a re-send requested precisely because the address may not be the user's any more.
    const stale = await confirm('superseded');
    expect(stale.headers.get('Location')).toBe(`${APP}/#everified_error=invalid_or_used`);
    expect(await isVerified()).toBe(0);
  });

  it('says so, rather than sending mail, when the address is already confirmed', async () => {
    await seedUser(USER_ID, EMAIL, 1);

    const res = await resend(await sessionFor());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alreadyVerified: true });
    expect(await unusedTokens()).toBe(0);
  });

  it('refuses an account with no address to send to', async () => {
    await env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, email_verified, token_version) VALUES (?, NULL, 'google', 0, 1)"
    )
      .bind(USER_ID)
      .run();

    const res = await resend(await sessionFor());

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/register', () => {
  it('creates the account unverified and leaves a confirm link waiting to be clicked', async () => {
    const email = 'fresh@example.com';
    const res = await SELF.fetch('https://api.example.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct horse battery staple' }),
    });

    expect(res.status).toBe(200);
    const user = await env.DB.prepare('SELECT id, email_verified FROM users WHERE email = ?')
      .bind(email)
      .first<{ id: number; email_verified: number }>();
    expect(user?.email_verified).toBe(0);
    expect(await unusedTokens(user!.id)).toBe(1);
    // Bound to the address it was sent to, not just to the account.
    const row = await env.DB.prepare('SELECT email FROM email_verifications WHERE user_id = ?')
      .bind(user!.id)
      .first<{ email: string }>();
    expect(row?.email).toBe(email);
  });
});

describe('GET /api/auth/me', () => {
  it('reports email_verified, which is the only thing that reads it', async () => {
    await seedUser(USER_ID, EMAIL, 1);
    const cookie = (await issueSessionCookie(USER_ID, 'password', env)).split(';')[0];

    const res = await SELF.fetch('https://api.example.com/api/auth/me', {
      headers: { Cookie: cookie },
    });

    expect(await res.json()).toMatchObject({ email: EMAIL, email_verified: 1 });
  });
});

describe('the mail itself', () => {
  it('puts the confirm link in the welcome when a password signup gets one', () => {
    const link = 'https://api.example.com/api/auth/verify-email?token=abc';
    const withLink = renderWelcome({ appUrl: APP, verifyUrl: link });
    expect(withLink.html).toContain(link);
    expect(withLink.text).toContain(link);
    expect(withLink.subject).toMatch(/confirm/i);
  });

  it('leaves the welcome exactly as it was for an account that needs no confirming', () => {
    const plain = renderWelcome({ appUrl: APP });
    expect(plain.html).not.toContain('verify-email');
    expect(plain.subject).not.toMatch(/confirm/i);
  });

  it('states the expiry in the stand-alone confirm mail', () => {
    const mail = renderEmailVerification({ link: 'https://x/y', ttlHours: 24, assetOrigin: APP });
    expect(mail.html).toContain('24 hours');
    expect(mail.text).toContain('https://x/y');
  });
});
