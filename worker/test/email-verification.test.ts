/**
 * Email verification for password signups — the confirm link, the resend, and what /me reports.
 *
 * The interesting cases are all the ones where a link should NOT work: spent, expired, minted for
 * an address the account no longer has, or pointed at somebody else's origin. Each is asserted to
 * leave email_verified alone, because that flag is what lets a password account into the app: a
 * link that can be talked into flipping it opens the account to an address nobody read.
 *
 * The link confirms only for its own account, signed in where it is opened. Anywhere else it is
 * left unspent and the browser is asked to sign in, so the cases above open it signed in.
 *
 * Runs the real worker in workerd via Miniflare. RESEND_API_KEY is unset unless a test sets it to
 * read the mail it sends; otherwise sendMail logs and skips, and the token rows are what these
 * assert on. The mail bodies have more tests in email-templates.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { unconfirmedSessionCookie } from './helpers/session';
import { renderAccountExists, renderEmailVerification, renderWelcome } from '../src/emailTemplates';
import { fetchSettled } from './helpers/after-answer';

const USER_ID = 8100;
const EMAIL = 'verify-me@example.com';
// wrangler.jsonc sets CORS_ORIGIN for the test environment; the worker bounces the browser back
// here, and treats any other returnTo as untrusted.
const APP = 'http://localhost:3800';

/** The seeded account's session, which `confirm` sends unless told otherwise. */
let signedIn = '';

/** A password account, confirmed as `verified` says, and the sessions here leave it that way. */
async function seedUser(id = USER_ID, email = EMAIL, verified = 0): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO users (id, email, password_hash, auth_provider, email_verified, token_version) VALUES (?, ?, 'pbkdf2$100000$x$y', 'password', ?, 1)"
  )
    .bind(id, email, verified)
    .run();
  if (id === USER_ID)
    signedIn = (await unconfirmedSessionCookie(id, 'password', env)).split(';')[0];
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

/** Open the link, by default in a browser where the seeded account is signed in. */
const confirm = (token: string, returnTo?: string, cookie: string | null = signedIn) =>
  SELF.fetch(
    `https://api.example.com/api/auth/verify-email?token=${encodeURIComponent(token)}` +
      (returnTo === undefined ? '' : `&returnTo=${encodeURIComponent(returnTo)}`),
    { redirect: 'manual', headers: cookie === null ? {} : { Cookie: cookie } }
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
  await env.DB.prepare('DELETE FROM auth_sessions').run();
  await env.DB.prepare('DELETE FROM rate_limits').run();
  await env.DB.prepare('DELETE FROM profiles').run();
  await env.DB.prepare('DELETE FROM users').run();
  signedIn = '';
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

describe('GET /api/auth/verify-email, opened where its account is not signed in', () => {
  it('asks to sign in and leaves the link waiting when there is no session', async () => {
    await seedUser();
    await mintToken({ token: 'good-token' });

    const res = await confirm('good-token', APP, null);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=signin_required`);
    expect(await isVerified()).toBe(0);
    expect(await unusedTokens()).toBe(1);
    // Signed in on this device, the same link then works.
    expect((await confirm('good-token', APP)).headers.get('Location')).toBe(`${APP}/#everified=1`);
    expect(await isVerified()).toBe(1);
  });

  it("asks to sign in when the session is another account's", async () => {
    await seedUser();
    await seedUser(8101, 'someone-else@example.com');
    await mintToken({ token: 'good-token' });
    const other = (await unconfirmedSessionCookie(8101, 'password', env)).split(';')[0];

    const res = await confirm('good-token', APP, other);

    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=signin_required`);
    expect(await isVerified()).toBe(0);
    expect(await isVerified(8101)).toBe(0);
    expect(await unusedTokens()).toBe(1);
  });

  it('does not count a session that has been signed out', async () => {
    await seedUser();
    await mintToken({ token: 'good-token' });
    await env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(USER_ID).run();

    const res = await confirm('good-token', APP);

    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=signin_required`);
    expect(await isVerified()).toBe(0);
    expect(await unusedTokens()).toBe(1);
  });

  it('answers a link whose account is gone as no longer valid', async () => {
    await seedUser();
    await mintToken({ token: 'good-token' });
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER_ID).run();

    const res = await confirm('good-token', APP);

    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=invalid_or_used`);
  });
});

describe('the welcome mail of a new sign-up', () => {
  // Registration sets no session, and an account waiting for its link signs in with its password
  // only together with that link. So the link is opened signed out, it asks for a sign-in, and
  // the password sign-in in that browser confirms the address. The mail is caught here, as in
  // forgot-password.test.ts, so the test opens the link the Worker sent.
  const ADDRESS = 'fresh-signup@example.com';
  const SIGNUP_PASSWORD = 'correct horse battery staple';
  const realFetch = globalThis.fetch;
  let sent: Array<{ to: string; text: string }> = [];

  beforeEach(() => {
    (env as unknown as Record<string, string>).RESEND_API_KEY = 'rk_test';
    sent = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('api.resend.com')) {
        sent.push(JSON.parse(String(init?.body ?? '{}')) as { to: string; text: string });
        return new Response('{"id":"re_1"}', { headers: { 'Content-Type': 'application/json' } });
      }
      return realFetch(input as RequestInfo, init);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete (env as unknown as Record<string, string>).RESEND_API_KEY;
  });

  /** Each request comes back once the work its route does after the answer (the mail) is done. */
  const post = (path: string, body: unknown) =>
    fetchSettled(`https://api.example.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  /** Sign up, and return the account and the confirm link its welcome mail carries. */
  async function signUp(): Promise<{ id: number; link: string }> {
    expect(
      (await post('/api/auth/register', { email: ADDRESS, password: SIGNUP_PASSWORD })).status
    ).toBe(200);
    const welcome = sent.find((m) => m.to === ADDRESS);
    const link =
      /https:\/\/api\.example\.com\/api\/auth\/verify-email\?token=[0-9a-f]+&returnTo=\S+/.exec(
        String(welcome?.text)
      );
    expect(link, `a confirm link in ${JSON.stringify(welcome?.text)}`).not.toBeNull();
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(ADDRESS)
      .first<{ id: number }>();
    return { id: user!.id, link: link![0] };
  }

  it('confirms the address with the password sign-in in the browser that opened it', async () => {
    const { id, link } = await signUp();
    const opened = await SELF.fetch(link, { redirect: 'manual' });
    expect(opened.headers.get('Location')).toBe(`${APP}/#everified_error=signin_required`);
    const marker = opened.headers
      .getSetCookie()
      .find((line) => line.startsWith('fm_email_link='))!
      .split(';')[0]!;

    const signedIn = await fetchSettled('https://api.example.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: marker },
      body: JSON.stringify({ email: ADDRESS, password: SIGNUP_PASSWORD }),
    });

    expect(signedIn.status).toBe(200);
    expect(await signedIn.json()).toEqual({ id, email: ADDRESS, emailConfirmed: true });
    expect(await isVerified(id)).toBe(1);
  });

  it('asks to sign in, and keeps the link waiting, when opened anywhere else', async () => {
    const { id, link } = await signUp();

    const res = await SELF.fetch(link, { redirect: 'manual' });

    expect(res.headers.get('Location')).toBe(`${APP}/#everified_error=signin_required`);
    expect(await isVerified(id)).toBe(0);
    expect(await unusedTokens(id)).toBe(1);
  });
});

describe('POST /api/auth/resend-verification', () => {
  const resend = (cookie?: string) =>
    SELF.fetch('https://api.example.com/api/auth/resend-verification', {
      method: 'POST',
      headers: cookie === undefined ? {} : { Cookie: cookie },
    });

  const sessionFor = async (id = USER_ID): Promise<string> =>
    (await unconfirmedSessionCookie(id, 'password', env)).split(';')[0];

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

  it('counts against a limit of three an hour on the address, for a session whose address waits for its link', async () => {
    await seedUser();
    const session = await sessionFor();

    const statuses = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await resend(session)).status);

    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(await unusedTokens()).toBe(1);
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
    // The account is made after the answer: this comes back once that work is done.
    const res = await fetchSettled('https://api.example.com/api/auth/register', {
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
    const cookie = (await unconfirmedSessionCookie(USER_ID, 'password', env)).split(';')[0];

    const res = await SELF.fetch('https://api.example.com/api/auth/me', {
      headers: { Cookie: cookie },
    });

    expect(await res.json()).toMatchObject({ email: EMAIL, email_verified: 1 });
  });
});

describe('the mail itself', () => {
  const link = `https://api.example.com/api/auth/verify-email?token=abc&returnTo=${encodeURIComponent(APP)}`;
  const confirm = renderWelcome({ appUrl: APP, verifyUrl: link });
  const fresh = renderEmailVerification({ link, ttlHours: 24, assetOrigin: APP });
  const welcome = renderWelcome({ appUrl: APP });
  /**
   * What each confirm mail says the link does. A new sign-up has no session, so its link always
   * asks for a sign-in (email-link.ts). A fresh link can also be asked for from a session, where it
   * confirms at once, so that mail says the sign-in only may come.
   */
  const CONFIRM_SAYS =
    'Open the link in any browser and sign in there. That confirms this address and opens your Token Circles account.';
  const FRESH_SAYS = [
    'Use this link to confirm your address. It replaces the ones sent before.',
    'If it asks you to sign in, sign in right there, in this browser or any other, and your Token Circles account opens.',
  ];

  it('gives a password sign-up one welcome: the confirm link as its button, and again as text to paste', () => {
    expect(confirm.subject).toBe('Welcome to Token Circles: confirm your email');
    expect(confirm.html).toContain('One link, one sign-in, and you&#39;re&nbsp;in.');
    expect(confirm.html).toContain('email/hero-engraved-night-v1.jpg');
    // The button and the paste-this line, and no other link to the confirm page.
    expect(confirm.html.split(`href="${link.replaceAll('&', '&amp;')}"`)).toHaveLength(3);
    expect(confirm.text).toContain(`Confirm my email: ${link}`);
    expect(confirm.text.startsWith('Welcome to Token Circles\n')).toBe(true);
  });

  it('says in both confirm mails, html and text, how the sign-in the link may ask for confirms the address', () => {
    for (const part of [confirm.html, confirm.text]) expect(part).toContain(CONFIRM_SAYS);
    for (const part of [fresh.html, fresh.text]) {
      for (const words of FRESH_SAYS) expect(part).toContain(words);
    }
  });

  it('points neither confirm mail into the app, in the HTML or the text', () => {
    // Main's guard (origin/main email-verification.test.ts): before its address is confirmed an
    // account's sign-in is refused, as a wrong password, so a confirm mail links nowhere in the app.
    // The wordmark, the text footer's "Open the app" and any page link would all end there.
    // The app the mail is sent from, and the canonical one the wordmark and the footer name.
    const appLink = /href="(?:http:\/\/localhost:3800|https:\/\/tokencircles\.com)(?:\/[^"]*)?"/;
    for (const mail of [confirm, fresh]) {
      expect(mail.html).not.toMatch(appLink);
      for (const part of [mail.html, mail.text]) {
        expect(part).not.toContain('Open the app');
        expect(part).not.toContain('Open Token Circles');
        expect(part).not.toMatch(/is ready/);
      }
    }
    // The welcome a Google sign-up gets, already confirmed, keeps them.
    expect(welcome.text).toContain(`Open the app: https://tokencircles.com`);
    expect(welcome.html).toMatch(appLink);
  });

  it('promises no one-click confirm in either mail while the link asks for a sign-in', () => {
    // maff's call of 2026-10-11: the mails promise nothing the app does not do yet.
    for (const mail of [confirm, fresh]) {
      for (const part of [mail.subject, mail.html, mail.text]) {
        expect(part).not.toMatch(/one click|one-click|single click/i);
      }
    }
  });

  it('says in both confirm mails what to do once the link has run out, and in the fresh one how long it works', () => {
    const runOut = 'Run out? Open it anyway and choose Send the link again.';
    for (const mail of [confirm, fresh]) {
      expect(mail.html).toContain(runOut);
      expect(mail.text).toContain(runOut);
    }
    // The HTML holds the number and its unit together with a no-break space.
    expect(fresh.html).toContain('The link works once, for 24&nbsp;hours.');
    expect(fresh.text).toContain('The link works once, for 24 hours.');
    expect(renderEmailVerification({ link, ttlHours: 1 }).text).toContain(
      'The link works once, for 1 hour.'
    );
  });

  it('says in the fresh link, html and text, that it replaces the links sent before it', () => {
    expect(fresh.subject).toBe('Your new confirm link for Token Circles');
    expect(fresh.html).toContain('Here&#39;s a fresh&nbsp;link.');
    expect(fresh.html).toContain('It replaces the links sent before. It works once, for 24 hours.');
    expect(fresh.text).toContain(`Confirm my email: ${link}`);
  });

  it('does not say the reader asked for the fresh link: it also goes to a sign-up again', () => {
    for (const part of [fresh.subject, fresh.html, fresh.text]) {
      expect(part).not.toMatch(/you asked/i);
    }
  });

  it('tells someone who never signed up that nobody can use the account until the address is confirmed', () => {
    const ignore =
      "Didn't sign up for Token Circles? Ignore this mail. Nobody can use the account until this address is confirmed.";
    for (const mail of [confirm, fresh]) {
      expect(mail.html).toContain(ignore.replace("'", '&#39;'));
      expect(mail.text).toContain(ignore);
    }
  });

  it('keeps the welcome out of the fresh link', () => {
    for (const part of [fresh.subject, fresh.html, fresh.text]) {
      for (const words of ['Welcome', 'Start with a year', 'Import statements', '/#import']) {
        expect(part).not.toContain(words);
      }
    }
  });

  it('lists where to start in the welcome of a password sign-up, with no page links before the address is confirmed', () => {
    // A sign-in is refused until the address is confirmed, so a page link would open on a sign-in
    // that fails: the confirm link is the only link in the card.
    for (const step of [
      'Once you are in',
      '1. Bring your history',
      '2. Find your subscriptions',
      '3. Watch your year fill in',
    ]) {
      expect(confirm.text).toContain(step);
    }
    for (const part of [confirm.html, confirm.text]) {
      for (const page of ['#import', '#bills', '#progress', '#dashboard']) {
        expect(part).not.toContain(`${APP}/${page}`);
      }
      expect(part).not.toContain('Open Import');
    }
  });

  it('names the YNAB file that imports, and what comes with it', () => {
    // A register export imports with its accounts, transfers and starting balances; the plan file
    // beside it in the same download does not. The mail says which one to use.
    expect(welcome.text).toContain(
      'So does the Register file in a YNAB plan export, with its accounts and transfers. Its starting balances go to accounts that are new or still empty.'
    );
  });

  it('welcomes a Google sign-up with no confirm link, and points at the three pages to start on', () => {
    expect(welcome.subject).toBe('Token Circles is ready for your first statement');
    for (const part of [welcome.html, welcome.text]) {
      expect(part).not.toContain('verify-email');
      expect(part).not.toContain('Confirm my email');
    }
    expect(welcome.text).toContain(`Import statements: ${APP}/#import`);
    for (const step of [
      `1. Bring your history`,
      `2. Find your subscriptions`,
      `3. Watch your year fill in`,
      `Open Bills: ${APP}/#bills`,
      `Open Progress: ${APP}/#progress`,
    ]) {
      expect(welcome.text).toContain(step);
    }
  });

  it('says what the A year badge asks for, in the terms the badge is counted by', () => {
    // Until prints ship, step 3 is Progress: a month with three or more entries counts, and twelve
    // in a row earn A year (frontend/src/core/achievements/definitions.ts).
    for (const mail of [welcome, confirm]) {
      const steps = mail.text.slice(mail.text.indexOf('3. Watch your year fill in'));
      expect(steps).toContain(
        "Progress counts every month that holds three or more entries. Twelve in a row earns the A year badge, and a full year's import can earn it on day one."
      );
    }
  });

  it('words the sign-up mails without an em dash', () => {
    for (const mail of [confirm, fresh, welcome]) {
      for (const part of [mail.subject, mail.html, mail.text]) expect(part).not.toContain('—');
    }
  });

  it('words the account-exists notice without an em dash, and says the account is unchanged', () => {
    const exists = renderAccountExists({ appUrl: APP });
    for (const part of [exists.subject, exists.html, exists.text]) expect(part).not.toContain('—');
    expect(exists.html).toContain(
      'Someone just tried to create a Token Circles account with this email address, but one already exists.'
    );
    expect(exists.html).toContain(
      'Someone tried to sign up with your address. Your account is unchanged.'
    );
    expect(exists.text).toContain(
      "If that was you, sign in, or reset your password from the sign-in screen if you've forgotten it. If it wasn't, there's nothing to do: your account is unchanged."
    );
    expect(exists.text).toContain(`Sign in: ${APP}`);
  });
});
