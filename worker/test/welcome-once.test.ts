/**
 * The Welcome mail goes to an account once (worker/src/welcome.ts): when its address is first
 * confirmed, by its confirm link, a change link (a Google account stored with no confirmed address
 * that adds one), Google sign-in, an emailed sign-in code or a reset link, and at
 * once for a Google sign-up, whose address Google has confirmed. A password sign-up gets Confirm,
 * which carries the link that opens the account and nothing of the welcome. An account made before
 * migration 0033 had the welcome of its day at sign-up, and gets no second one.
 *
 * Every mail is caught on its way to Resend, and every request that sends one waits for the work
 * its route does after the answer (fetchSettled), so each test counts what was sent. Accounts are
 * made by signing up, so their ids are new ones that no other test file has used.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signState } from '../src/auth';
import { fetchSettled } from './helpers/after-answer';
import { sessionCookie, unconfirmedSessionCookie } from './helpers/session';

const API = 'https://api.example.com';
// CORS_ORIGIN in wrangler.jsonc's test environment: the app the mails link into.
const APP = 'http://localhost:3800';
const PASSWORD = 'correct horse battery staple';
const CONFIRM_SUBJECT = 'Confirm your email for Token Circles';
const WELCOME_SUBJECT = 'Token Circles is ready for your first statement';

/** Words and links that belong to the Welcome, none of which Confirm may carry. */
const WELCOME_CONTENT = [
  'Welcome',
  'is ready',
  'Start with a year',
  'Where to go first',
  'Import statements',
  'Bring your history',
  'Find your subscriptions',
  'Watch your year fill in',
  '/#import',
  '/#bills',
  '/#progress',
  'hero-engraved-night',
];

interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const realFetch = globalThis.fetch;
let sent: Mail[] = [];
/** What Google's tokeninfo answers, for the test that signs in with Google. */
let googleClaims: Record<string, string> = {};
/** Resend's answer to a welcome, for the test where it fails. */
let welcomeAnswer: () => Response = () => Response.json({ id: 're_welcome' });

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM rate_limits').run();
  const vars = env as unknown as Record<string, string>;
  vars.RESEND_API_KEY = 'rk_test';
  vars.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  sent = [];
  welcomeAnswer = () => Response.json({ id: 're_welcome' });
  // Resend, and the callback's two calls to Google. Anything else is a mistake in the test,
  // never a request that leaves the machine.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://api.resend.com/emails') {
      const mail = JSON.parse(String(init?.body ?? '{}')) as Mail;
      sent.push(mail);
      return mail.subject === WELCOME_SUBJECT
        ? welcomeAnswer()
        : Response.json({ id: `re_${sent.length}` });
    }
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ id_token: 'test-id-token' });
    }
    if (url === 'https://www.googleapis.com/oauth2/v3/tokeninfo')
      return Response.json(googleClaims);
    throw new Error(`Unexpected fetch in a test: ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  const vars = env as unknown as Record<string, string>;
  delete vars.RESEND_API_KEY;
  delete vars.GOOGLE_CLIENT_SECRET;
});

/** An address no other test uses, in lower case, as the Worker keeps addresses. */
const address = (what: string) =>
  `welcome-${what}-${crypto.randomUUID().slice(0, 8)}@example.com`.toLowerCase();

const post = (path: string, body: unknown, cookie?: string) =>
  fetchSettled(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

const mailsTo = (to: string) => sent.filter((mail) => mail.to === to);
const welcomesTo = (to: string) => mailsTo(to).filter((mail) => mail.subject === WELCOME_SUBJECT);

const emailVerified = async (id: number) =>
  (
    await env.DB.prepare('SELECT email_verified FROM users WHERE id = ?')
      .bind(id)
      .first<{ email_verified: number }>()
  )?.email_verified;

/** The cookie pair named `name` that a response sets. */
function cookieFrom(res: Response, name: string): string {
  const line = res.headers.getSetCookie().find((set) => set.startsWith(`${name}=`));
  expect(line, `a ${name} cookie`).toBeDefined();
  return line!.split(';')[0]!;
}

interface SignedUp {
  id: number;
  email: string;
  /** The confirm link the sign-up mailed. */
  link: string;
}

/** Sign up with a password, as the form does: one mail goes, Confirm, with the link in it. */
async function signUp(email: string): Promise<SignedUp> {
  // Sign-up allows five an hour from one network address, and a test may make more accounts.
  await env.DB.prepare('DELETE FROM rate_limits').run();
  expect((await post('/api/auth/register', { email, password: PASSWORD })).status).toBe(200);
  expect(mailsTo(email).map((mail) => mail.subject)).toEqual([CONFIRM_SUBJECT]);
  const link =
    /https:\/\/api\.example\.com\/api\/auth\/verify-email\?token=[0-9a-f]+&returnTo=\S+/.exec(
      mailsTo(email)[0]!.text
    );
  expect(link, 'the confirm link').not.toBeNull();
  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number }>();
  expect(await emailVerified(user!.id)).toBe(0);
  return { id: user!.id, email, link: link![0] };
}

/** Open the link signed out: it asks for a sign-in and leaves this browser its marker. */
async function openSignedOut(link: string): Promise<string> {
  const opened = await SELF.fetch(link, { redirect: 'manual' });
  expect(opened.headers.get('Location')).toBe(`${APP}/#everified_error=signin_required`);
  return cookieFrom(opened, 'fm_email_link');
}

/** A session from before the account had to confirm its address first: it confirms nothing. */
const oldSession = async (id: number) => (await unconfirmedSessionCookie(id)).split(';')[0]!;

/** Ask for a sign-in code, read it from its mail, and sign in with it. */
async function signInWithCode(email: string): Promise<void> {
  const asked = await post('/api/auth/email-code/request', { email });
  expect(asked.status).toBe(200);
  const code = /^\d{6}/.exec(mailsTo(email).at(-1)!.subject);
  expect(code, 'a code first in the subject').not.toBeNull();
  const res = await post(
    '/api/auth/email-code/verify',
    { email, code: code![0] },
    cookieFrom(asked, 'fm_logincode')
  );
  expect(res.status).toBe(200);
}

/** Ask for a reset link, read it from its mail, and set a new password with it. */
async function resetPassword(email: string): Promise<void> {
  expect((await post('/api/auth/forgot-password', { email })).status).toBe(200);
  const token = /#reset-password\?token=([A-Za-z0-9_-]+)/.exec(mailsTo(email).at(-1)!.text);
  expect(token, 'a reset link').not.toBeNull();
  const res = await post('/api/auth/reset-password', {
    token: token![1],
    password: `a-new-password-${crypto.randomUUID()}`,
  });
  expect(res.status).toBe(200);
}

/** Arrive at the Google callback the way Google's redirect does, as `sub` with `email`. */
async function signInWithGoogle(email: string, sub: string): Promise<void> {
  googleClaims = {
    aud: (env as unknown as Record<string, string>).GOOGLE_CLIENT_ID!,
    iss: 'https://accounts.google.com',
    sub,
    email,
    email_verified: 'true',
    exp: String(Math.floor(Date.now() / 1000) + 3600),
  };
  const state = await signState({ returnTo: APP, ts: Date.now() }, env.JWT_SECRET);
  const res = await fetchSettled(
    `${API}/api/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`,
    { redirect: 'manual' }
  );
  expect(res.status).toBe(302);
}

/** Every way an address gets confirmed, from an account that has just signed up. */
const CONFIRM_PATHS: Array<{ way: string; confirm: (account: SignedUp) => Promise<void> }> = [
  {
    way: 'its link, then a password sign-in in the browser that opened it',
    confirm: async ({ email, link }) => {
      const marker = await openSignedOut(link);
      const res = await post('/api/auth/login', { email, password: PASSWORD }, marker);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ emailConfirmed: true });
    },
  },
  {
    way: 'its link, opened where the account is signed in',
    confirm: async ({ id, link }) => {
      const res = await fetchSettled(link, {
        redirect: 'manual',
        headers: { Cookie: await oldSession(id) },
      });
      expect(res.headers.get('Location')).toBe(`${APP}/#everified=1`);
    },
  },
  {
    way: 'its link, finished after another kind of sign-in',
    confirm: async ({ id, link }) => {
      const marker = await openSignedOut(link);
      const res = await post(
        '/api/auth/email-link/finish',
        {},
        `${marker}; ${await oldSession(id)}`
      );
      expect(await res.json()).toMatchObject({ outcome: 'confirmed' });
    },
  },
  {
    way: 'Google sign-in',
    confirm: ({ id, email }) => signInWithGoogle(email, `google-sub-${id}`),
  },
  { way: 'an emailed sign-in code', confirm: ({ email }) => signInWithCode(email) },
  { way: 'a reset link', confirm: ({ email }) => resetPassword(email) },
];

describe('a password sign-up', () => {
  it('mails Confirm alone: the link that opens the account, and nothing of the welcome', async () => {
    const { email, link } = await signUp(address('signup'));
    const [confirm] = mailsTo(email);
    expect(confirm!.text).toContain(`Confirm my email: ${link}`);
    expect(confirm!.html).toContain(`href="${link.replaceAll('&', '&amp;')}"`);
    for (const part of [confirm!.subject, confirm!.html, confirm!.text]) {
      for (const words of WELCOME_CONTENT) expect(part).not.toContain(words);
    }
  });
});

describe('the Welcome', () => {
  for (const { way, confirm } of CONFIRM_PATHS) {
    it(`goes once when ${way} confirms the address`, async () => {
      const account = await signUp(address('path'));

      await confirm(account);

      expect(await emailVerified(account.id)).toBe(1);
      expect(welcomesTo(account.email)).toHaveLength(1);
      // Signing in with a code, or resetting the password, confirms an address too. Done again
      // on a confirmed account, neither mails a second welcome.
      await signInWithCode(account.email);
      await resetPassword(account.email);
      expect(welcomesTo(account.email)).toHaveLength(1);
    });
  }

  it('goes once at a Google sign-up, and not at the sign-ins after it', async () => {
    const email = address('google');
    const sub = `google-sub-${crypto.randomUUID()}`;

    await signInWithGoogle(email, sub);
    expect(mailsTo(email).map((mail) => mail.subject)).toEqual([WELCOME_SUBJECT]);

    await signInWithGoogle(email, sub);
    await signInWithCode(email);
    expect(welcomesTo(email)).toHaveLength(1);
  });

  it('links into the app that sent it, and loads its art from there', async () => {
    const account = await signUp(address('links'));
    await signInWithCode(account.email);
    const [welcome] = welcomesTo(account.email);
    for (const page of ['import', 'bills', 'progress']) {
      expect(welcome!.html).toContain(`href="${APP}/#${page}"`);
      expect(welcome!.text).toContain(`${APP}/#${page}`);
    }
    expect(welcome!.html).toContain(`src="${APP}/email/hero-engraved-night-v1.jpg"`);
  });

  it('is not sent again when it failed to send: the address is confirmed and the claim stays', async () => {
    welcomeAnswer = () => new Response('unavailable', { status: 503 });
    const account = await signUp(address('failed'));

    await signInWithCode(account.email);
    expect(await emailVerified(account.id)).toBe(1);
    expect(welcomesTo(account.email)).toHaveLength(1);

    welcomeAnswer = () => Response.json({ id: 're_welcome' });
    await resetPassword(account.email);
    expect(welcomesTo(account.email)).toHaveLength(1);
  });

  it('goes to no account that was confirmed before its welcome was recorded', async () => {
    // An account that signed up and confirmed while the code before this one was running: the
    // address is confirmed and there is no record either way. Confirming paths that see a
    // confirmed address claim nothing.
    const account = await signUp(address('confirmed-before'));
    await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(account.id).run();

    await signInWithCode(account.email);
    await resetPassword(account.email);
    await signInWithGoogle(account.email, `google-sub-${account.id}`);
    expect(welcomesTo(account.email)).toHaveLength(0);
  });
});

describe('a Google account with no confirmed address', () => {
  /** Ask to move the account to `email` in Settings, and open the link mailed there signed in. */
  async function changeAddress(cookie: string, email: string): Promise<void> {
    const saved = await fetchSettled(`${API}/api/notifications/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ email }),
    });
    expect(saved.status).toBe(200);
    const link =
      /https:\/\/api\.example\.com\/api\/auth\/verify-email\?token=[0-9a-f]+&returnTo=\S+/.exec(
        mailsTo(email).at(-1)!.text
      );
    expect(link, 'the change link').not.toBeNull();
    const opened = await fetchSettled(link![0], {
      redirect: 'manual',
      headers: { Cookie: cookie },
    });
    expect(opened.headers.get('Location')).toBe(`${APP}/#everified=1&change=1`);
  }

  it('gets the Welcome once, at the new address, when a change link confirms its first address', async () => {
    // A Google sign-up whose address Google had not confirmed is stored with none.
    const made = await env.DB.prepare(
      "INSERT INTO users (email, email_verified, auth_provider, provider_id) VALUES (NULL, 0, 'google', ?) RETURNING id"
    )
      .bind(`google-sub-${crypto.randomUUID()}`)
      .first<{ id: number }>();
    const id = made!.id;
    await env.DB.prepare("INSERT INTO profiles (name, user_id) VALUES ('Personal Profile', ?)")
      .bind(id)
      .run();
    const cookie = (await unconfirmedSessionCookie(id, 'google')).split(';')[0]!;
    const first = address('change-first');

    await changeAddress(cookie, first);

    expect(await emailVerified(id)).toBe(1);
    expect(sent.filter((mail) => mail.subject === WELCOME_SUBJECT).map((mail) => mail.to)).toEqual([
      first,
    ]);

    // A later change moves a confirmed account: no second Welcome, to either address.
    const second = address('change-second');
    await env.DB.prepare('DELETE FROM rate_limits').run();
    await changeAddress(cookie, second);

    expect(welcomesTo(second)).toHaveLength(0);
    expect(sent.filter((mail) => mail.subject === WELCOME_SUBJECT)).toHaveLength(1);
  });

  it('gets no Welcome from a change link once its address is confirmed, with no welcome on record', async () => {
    // Confirmed before the Welcome was recorded: confirming paths that see a confirmed address
    // claim nothing, and a change link is one of them.
    const made = await env.DB.prepare(
      "INSERT INTO users (email, email_verified, auth_provider, provider_id) VALUES (?, 1, 'google', ?) RETURNING id"
    )
      .bind(address('confirmed-google'), `google-sub-${crypto.randomUUID()}`)
      .first<{ id: number }>();
    const id = made!.id;
    await env.DB.prepare("INSERT INTO profiles (name, user_id) VALUES ('Personal Profile', ?)")
      .bind(id)
      .run();
    const cookie = (await sessionCookie(id, 'google')).split(';')[0]!;
    const moved = address('change-confirmed');

    await changeAddress(cookie, moved);

    expect(sent.filter((mail) => mail.subject === WELCOME_SUBJECT)).toHaveLength(0);
  });

  it('claims nothing with a change link refused because another account took the address', async () => {
    const made = await env.DB.prepare(
      "INSERT INTO users (email, email_verified, auth_provider, provider_id) VALUES (NULL, 0, 'google', ?) RETURNING id"
    )
      .bind(`google-sub-${crypto.randomUUID()}`)
      .first<{ id: number }>();
    const id = made!.id;
    await env.DB.prepare("INSERT INTO profiles (name, user_id) VALUES ('Personal Profile', ?)")
      .bind(id)
      .run();
    const cookie = (await unconfirmedSessionCookie(id, 'google')).split(';')[0]!;
    const taken = address('change-taken');
    const saved = await fetchSettled(`${API}/api/notifications/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ email: taken }),
    });
    expect(saved.status).toBe(200);
    const link =
      /https:\/\/api\.example\.com\/api\/auth\/verify-email\?token=[0-9a-f]+&returnTo=\S+/.exec(
        mailsTo(taken).at(-1)!.text
      );
    // Another account has the address by the time the link is opened.
    await env.DB.prepare(
      "INSERT INTO users (email, email_verified, auth_provider) VALUES (?, 0, 'password')"
    )
      .bind(taken)
      .run();

    const opened = await fetchSettled(link![0], {
      redirect: 'manual',
      headers: { Cookie: cookie },
    });
    expect(opened.headers.get('Location')).toContain('everified_error=email_taken');
    expect(welcomesTo(taken)).toHaveLength(0);

    // The account's first confirmed address, later, still gets the Welcome.
    const free = address('change-free');
    await env.DB.prepare('DELETE FROM rate_limits').run();
    await changeAddress(cookie, free);
    expect(welcomesTo(free)).toHaveLength(1);
  });
});

describe('an account made before migration 0033', () => {
  it('gets no welcome when it confirms its address, whichever way it does', async () => {
    // Made the way a sign-up made them before this deploy: waiting for their link, which the
    // welcome of the day carried, with no record of a welcome yet.
    const accounts: SignedUp[] = [];
    for (const { way } of CONFIRM_PATHS) accounts.push(await signUp(address(way.split(' ')[0]!)));

    // The migration, run as the deploy runs it. It marks every account there is, so the rows it
    // adds for other test files' accounts are taken out again.
    const welcomed = async () =>
      new Set(
        (
          await env.DB.prepare(
            "SELECT user_id FROM reminder_dedup WHERE dedup_key = 'welcome'"
          ).all<{ user_id: number }>()
        ).results.map((row) => row.user_id)
      );
    const before = await welcomed();
    const backfill = env.TEST_MIGRATIONS.find((migration) => migration.name.startsWith('0033_'));
    expect(backfill, 'migration 0033').toBeDefined();
    for (const query of backfill!.queries) await env.DB.prepare(query).run();
    const mine = new Set(accounts.map((account) => account.id));
    for (const id of await welcomed()) {
      if (!before.has(id) && !mine.has(id)) {
        await env.DB.prepare(
          "DELETE FROM reminder_dedup WHERE user_id = ? AND dedup_key = 'welcome'"
        )
          .bind(id)
          .run();
      }
    }

    for (const [i, { confirm }] of CONFIRM_PATHS.entries()) {
      await env.DB.prepare('DELETE FROM rate_limits').run();
      await confirm(accounts[i]!);
    }

    for (const account of accounts) {
      expect(await emailVerified(account.id)).toBe(1);
      expect(welcomesTo(account.email)).toHaveLength(0);
    }
  });
});
