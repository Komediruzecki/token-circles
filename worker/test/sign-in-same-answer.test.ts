/**
 * Signing in with a wrong password, asking for a reset link, asking for a sign-in code and
 * creating an account answer with the same status, headers and body for an address that has an
 * account and for one that has none, and so does each route's limit on one address once it is
 * reached. Signing in with the right password to an account waiting for its confirm link is
 * answered as a wrong password is, after the same statements, and counts against the same limit. Every header but Date is compared, the cookie a sign-in code request sets without its
 * value: that is a new random handle on every request. Signing in checks a password for an address
 * with no account against a hash of the same cost as a real one.
 *
 * The routes that mail an address answer first, and their answer stays ok while the mail cannot be
 * sent or is held. The two that store a row for the address after their answer (a reset link, a
 * sign-in code) answer ok while that row cannot be written.
 */
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { b64urlDecode, hashPassword } from '../src/auth';
import { DUMMY_PASSWORD_HASH } from '../src/routes/auth';
import { fetchSettled, fetchUnsettled } from './helpers/after-answer';
import { dbThatNotes, realDb, withDb } from './helpers/racing-db';

const BASE = 'https://api.example.com';
const HAS_ACCOUNT = 'same-answer-account@example.com';
const NO_ACCOUNT = 'same-answer-nobody@example.com';
/** A password account whose address waits for its confirm link. */
const WAITING = 'same-answer-waiting@example.com';

let ip = 0;

/** Each request from its own address, so only the limit on one email address can be reached. */
function sending(body: unknown): RequestInit {
  ip += 1;
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': `10.88.${ip >> 8}.${ip & 255}`,
    },
    body: JSON.stringify(body),
  };
}

/**
 * Every header of an answer but Date, one `name: value` line each, in order. The value of the
 * cookie a sign-in code request sets is replaced by V.
 */
function headerLines(res: Response): string[] {
  const lines: string[] = [];
  res.headers.forEach((value, name) => {
    if (name !== 'date' && name !== 'set-cookie') lines.push(`${name}: ${value}`);
  });
  for (const cookie of res.headers.getSetCookie()) {
    lines.push(`set-cookie: ${cookie.replace(/^fm_logincode=[^;]*/, 'fm_logincode=V')}`);
  }
  return lines.sort();
}

async function read(res: Response) {
  return {
    status: res.status,
    type: res.headers.get('content-type'),
    headers: headerLines(res),
    body: await res.text(),
  };
}

type Answer = Awaited<ReturnType<typeof read>>;

/**
 * The answer to one request, read once the work the route does after its answer is done too, so
 * nothing it left running reaches the next test.
 */
async function answer(path: string, body: unknown): Promise<Answer> {
  return read(await fetchSettled(`${BASE}${path}`, sending(body)));
}

const ROUTES: { path: string; body: (email: string) => unknown; status: number; limit: number }[] =
  [
    {
      path: '/api/auth/login',
      body: (email) => ({ email, password: 'not-the-password' }),
      status: 401,
      limit: 10,
    },
    { path: '/api/auth/forgot-password', body: (email) => ({ email }), status: 200, limit: 3 },
    { path: '/api/auth/email-code/request', body: (email) => ({ email }), status: 200, limit: 3 },
    {
      path: '/api/auth/register',
      body: (email) => ({ email, password: 'a-new-password' }),
      status: 200,
      limit: 3,
    },
  ];

/** What a route that takes the request answers: ok, as JSON. Its other headers are not checked. */
const OK = { status: 200, type: 'application/json', body: '{"ok":true}' };

const bodyFor = (path: string) => ROUTES.find((r) => r.path === path)!.body;

/**
 * The routes that mail an address after their answer: what each logs when its mail cannot be
 * sent, and who gets a mail.
 */
const MAILING: { path: string; logged: string[]; mailedTo: string[] }[] = [
  {
    path: '/api/auth/forgot-password',
    logged: ['Password reset link could not be sent:'],
    mailedTo: [HAS_ACCOUNT],
  },
  {
    path: '/api/auth/email-code/request',
    logged: ['Sign-in code could not be sent:'],
    mailedTo: [HAS_ACCOUNT],
  },
  {
    path: '/api/auth/register',
    logged: ['account-exists notice email failed to send:', 'Welcome email failed:'],
    // The owner of the address hears someone tried it; the new account gets its welcome.
    mailedTo: [HAS_ACCOUNT, NO_ACCOUNT],
  },
];

/** The routes that store something for an address after their answer, and what they log. */
const STORING: { path: string; table: string; logged: string }[] = [
  {
    path: '/api/auth/forgot-password',
    table: 'password_resets',
    logged: 'Password reset link could not be sent:',
  },
  {
    path: '/api/auth/email-code/request',
    table: 'login_codes',
    logged: 'Sign-in code could not be sent:',
  },
];

const realFetch = globalThis.fetch;
/** The addresses the Worker's mails went to, in the order the mail service took them. */
let mailed: string[] = [];

/**
 * Give the Worker a mail service that cannot be reached ('fail'), or that holds every mail until
 * `release` is called ('hold').
 */
function mailService(answers: 'fail' | 'hold'): { release: () => void } {
  (env as unknown as Record<string, string>).RESEND_API_KEY = 'rk_test';
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes('api.resend.com')) return realFetch(input as RequestInfo, init);
    if (answers === 'fail') throw new TypeError('the mail service cannot be reached');
    await held;
    mailed.push((JSON.parse(String(init?.body)) as { to: string }).to);
    return new Response('{"id":"re_1"}', { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { release };
}

afterEach(async () => {
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
  delete (env as unknown as Record<string, string>).RESEND_API_KEY;
  mailed = [];
  for (const { table } of STORING) {
    await env.DB.prepare(`DROP TRIGGER IF EXISTS refuse_${table}`).run();
  }
});

beforeEach(async () => {
  for (const t of ['login_codes', 'password_resets', 'rate_limits', 'email_verifications']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  const theirs = 'SELECT id FROM users WHERE email IN (?, ?, ?)';
  await env.DB.prepare(`DELETE FROM profiles WHERE user_id IN (${theirs})`)
    .bind(HAS_ACCOUNT, NO_ACCOUNT, WAITING)
    .run();
  await env.DB.prepare('DELETE FROM users WHERE email IN (?, ?, ?)')
    .bind(HAS_ACCOUNT, NO_ACCOUNT, WAITING)
    .run();
  const hash = await hashPassword('the-password');
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (email, password_hash, email_verified, auth_provider) VALUES (?, ?, 1, 'password')"
    ).bind(HAS_ACCOUNT, hash),
    env.DB.prepare(
      "INSERT INTO users (email, password_hash, email_verified, auth_provider) VALUES (?, ?, 0, 'password')"
    ).bind(WAITING, hash),
  ]);
});

describe('an address with an account and one without', () => {
  for (const route of ROUTES) {
    it(`get the same status, headers and body from ${route.path}`, async () => {
      const withAccount = await answer(route.path, route.body(HAS_ACCOUNT));
      const without = await answer(route.path, route.body(NO_ACCOUNT));
      expect(withAccount.status).toBe(route.status);
      expect(without).toEqual(withAccount);
    });

    it(`get the same status, headers and body from ${route.path} once its limit on the address is reached`, async () => {
      const last = async (email: string) => {
        for (let i = 0; i < route.limit; i += 1) await answer(route.path, route.body(email));
        return answer(route.path, route.body(email));
      };
      const withAccount = await last(HAS_ACCOUNT);
      const without = await last(NO_ACCOUNT);
      expect(withAccount.status).toBe(429);
      // The wait is counted from each address's first attempt, a second or so apart.
      const anyWait = (said: string) => said.replace(/\d+/g, 'N');
      const waitAside = (one: Answer) => ({
        ...one,
        headers: one.headers.map(anyWait),
        body: anyWait(one.body),
      });
      expect(waitAside(without)).toEqual(waitAside(withAccount));
    });
  }
});

/** The cookie a sign-in code request for `email` sets: its whole Set-Cookie line, and its value. */
async function codeRequestCookie(email: string): Promise<{ line: string; value: string }> {
  const res = await fetchSettled(`${BASE}/api/auth/email-code/request`, sending({ email }));
  expect(res.status).toBe(200);
  const line = res.headers.getSetCookie().find((c) => c.startsWith('fm_logincode='));
  expect(line, 'a fm_logincode cookie').toBeDefined();
  return { line: line!, value: line!.slice('fm_logincode='.length).split(';')[0]! };
}

describe('the cookie a sign-in code request sets', () => {
  it('is a random handle of 32 bytes in base64url, with the same attributes on every request', async () => {
    const cookies = [await codeRequestCookie(HAS_ACCOUNT), await codeRequestCookie(NO_ACCOUNT)];
    for (const { value } of cookies) {
      expect(value).toMatch(/^[\w-]{43}$/);
      expect(b64urlDecode(value)).toHaveLength(32);
    }
    // Each line with its value taken out: the attributes set around it.
    const attributes = cookies.map(({ line, value }) => line.replace(value, 'V'));
    expect(new Set(attributes).size, attributes.join('\n')).toBe(1);
  });

  it('is a new handle on every request', async () => {
    const values = [
      (await codeRequestCookie(HAS_ACCOUNT)).value,
      (await codeRequestCookie(HAS_ACCOUNT)).value,
      (await codeRequestCookie(NO_ACCOUNT)).value,
    ];
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('while the mail cannot be sent', () => {
  for (const { path, logged } of MAILING) {
    it(`${path} answers ok`, async () => {
      mailService('fail');
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      for (const email of [HAS_ACCOUNT, NO_ACCOUNT]) {
        expect(await answer(path, bodyFor(path)(email)), email).toMatchObject(OK);
      }
      // The mail that failed is in the log, after the answer.
      for (const line of logged) expect(errors).toHaveBeenCalledWith(line, expect.any(TypeError));
    });
  }
});

describe('while the mail is held', () => {
  for (const { path, mailedTo } of MAILING) {
    it(`${path} answers first, and ok`, async () => {
      const service = mailService('hold');
      const sent = [HAS_ACCOUNT, NO_ACCOUNT].map((email) =>
        fetchUnsettled(`${BASE}${path}`, sending(bodyFor(path)(email)))
      );
      try {
        const answers = await Promise.race([
          Promise.all(sent.map(async (one) => read(await one.answer))),
          new Promise<'no answer'>((resolve) => setTimeout(() => resolve('no answer'), 5_000)),
        ]);
        expect(answers, 'the answers, while the mail is held').toMatchObject([OK, OK]);
        expect(mailed).toEqual([]);
      } finally {
        service.release();
        await Promise.all(sent.map((one) => one.settled()));
      }
      // Once the service lets the mail go, it reaches the address it was for.
      expect([...mailed].sort()).toEqual([...mailedTo].sort());
    });
  }
});

describe('while the row a route stores cannot be written', () => {
  for (const { path, table, logged } of STORING) {
    it(`${path} answers ok`, async () => {
      await env.DB.prepare(
        `CREATE TRIGGER refuse_${table} BEFORE INSERT ON ${table}
         BEGIN SELECT RAISE(ABORT, 'refused for the test'); END`
      ).run();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      for (const email of [HAS_ACCOUNT, NO_ACCOUNT]) {
        expect(await answer(path, bodyFor(path)(email)), email).toMatchObject(OK);
      }
      // The write that failed is in the log, after the answer.
      expect(errors).toHaveBeenCalledWith(logged, expect.anything());
    });
  }
});

describe('signing in with an address that has no account', () => {
  it('checks the password against a stand-in hash with the scheme, cost and lengths of a real one', async () => {
    const fields = (stored: string) => {
      const [scheme, cost, salt, hash] = stored.split('$');
      return {
        scheme,
        cost,
        saltBytes: b64urlDecode(salt!).length,
        hashBytes: b64urlDecode(hash!).length,
      };
    };
    expect(fields(DUMMY_PASSWORD_HASH)).toEqual(fields(await hashPassword('a real password')));
  });
});

describe('a sign-in with the right password to an account waiting for its confirm link', () => {
  const signIn = (email: string, password: string) =>
    answer('/api/auth/login', { email, password });

  it('gets the status, headers and body a wrong password gets', async () => {
    const right = await signIn(WAITING, 'the-password');
    const wrong = await signIn(WAITING, 'not-the-password');
    const elsewhere = await signIn(HAS_ACCOUNT, 'not-the-password');

    expect(wrong.status).toBe(401);
    expect(right).toEqual(wrong);
    expect(right).toEqual(elsewhere);
  });

  it('runs the statements a wrong password runs', async () => {
    const statements = async (password: string) => {
      const noting = dbThatNotes(realDb);
      await withDb(noting.db, () => signIn(WAITING, password));
      return noting.statements;
    };

    const right = await statements('the-password');
    const wrong = await statements('not-the-password');

    expect(right.length).toBeGreaterThan(0);
    expect(right).toEqual(wrong);
  });

  it('counts against the limit on the address as a wrong password does', async () => {
    const last = async (email: string, password: string) => {
      for (let i = 0; i < 10; i += 1) await signIn(email, password);
      return signIn(email, password);
    };

    const right = await last(WAITING, 'the-password');
    await env.DB.prepare('DELETE FROM rate_limits').run();
    const wrong = await last(WAITING, 'not-the-password');

    expect(right.status).toBe(429);
    const anyWait = (said: string) => said.replace(/\d+/g, 'N');
    const waitAside = (one: Answer) => ({
      ...one,
      headers: one.headers.map(anyWait),
      body: anyWait(one.body),
    });
    expect(waitAside(right)).toEqual(waitAside(wrong));
  });
});
