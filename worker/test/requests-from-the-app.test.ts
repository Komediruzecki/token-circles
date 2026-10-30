/**
 * Requests that change data are taken from the app's own pages, with a JSON body
 * (request-origin.ts). Each case below sends one thing a browser says about a request and leaves
 * the rest as the app sends it, so each answer comes from one check.
 */
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index';
import { hashPassword } from '../src/auth';
import { mintApiToken } from '../src/apitoken';
import { APP_REQUESTS_ONLY } from '../src/request-origin';
import { signCapability } from '../src/signed-url';
import { apiTokenRow } from './helpers/capability';
import { sessionCookie } from './helpers/session';
// Imported as text: these tests run inside workerd, which has no host filesystem.
import statementCsv from './fixtures/statement-clean.csv?raw';

const BASE = 'https://api.example.com';
const PASSWORD = 'the-right-password';
/** The JWT_SECRET vitest.config.ts binds, which signs capabilities too. */
const SECRET = 'test-jwt-secret-not-for-prod';

const base = env as unknown as Env;
/** Local development as `wrangler dev` runs it (wrangler.jsonc): the app is at :3800, no captcha. */
const LOCAL: Env = { ...base, APP_ENV: 'development', TURNSTILE_SECRET: undefined };
const LOCAL_APP = 'http://localhost:3800';
/** A deployment, whose app has two origins. */
const APP = 'https://app.example.com';
const SECOND_APP = 'https://beta.app.example.com';
const DEPLOYED: Env = {
  ...base,
  APP_ENV: 'production',
  CORS_ORIGIN: APP,
  APP_ORIGINS: `${APP}, ${SECOND_APP}`,
};
/** An origin that is not the app's. */
const OTHER = 'https://other.example';

let sequence = 0;
const unique = () => `${Date.now().toString(36)}-${++sequence}`;
const address = (what: string) => `app-requests-${what}-${unique()}@example.com`;
/** A network address of its own for each request, so no rate limit carries over. */
const nextIp = () => `198.51.100.${(sequence % 250) + 1}`;

interface Sent {
  method?: string;
  origin?: string;
  site?: string;
  type?: string;
  body?: BodyInit;
  cookie?: string;
  headers?: Record<string, string>;
  e?: Env;
}

/** Send `path` to the Worker as `sent` describes, and wait for what it does after answering. */
async function send(path: string, sent: Sent = {}): Promise<Response> {
  const headers = new Headers(sent.headers);
  headers.set('CF-Connecting-IP', nextIp());
  if (sent.origin !== undefined) headers.set('Origin', sent.origin);
  if (sent.site !== undefined) headers.set('Sec-Fetch-Site', sent.site);
  if (sent.type !== undefined) headers.set('Content-Type', sent.type);
  if (sent.cookie !== undefined) headers.set('Cookie', sent.cookie);
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`${BASE}${path}`, { method: sent.method ?? 'POST', headers, body: sent.body }),
    sent.e ?? LOCAL,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

/** How the app sends a JSON body: from its own page, same origin behind the dev server's proxy. */
const fromTheApp = (body: unknown, more: Sent = {}): Sent => ({
  origin: LOCAL_APP,
  site: 'same-origin',
  type: 'application/json',
  body: JSON.stringify(body),
  ...more,
});

/** Whether `res` is this rule's 403, rather than any route's answer. */
async function notTaken(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  return ((await res.clone().json()) as { error?: unknown }).error === APP_REQUESTS_ONLY;
}

/** Rows in every table a sign-in, a sign-up or a new profile writes to. */
async function rowCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of [
    'users',
    'profiles',
    'auth_sessions',
    'auth_logs',
    'rate_limits',
    'email_verifications',
  ]) {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
    counts[table] = row?.n ?? 0;
  }
  return counts;
}

/** A password account with a confirmed address, signed in: its id, address and session. */
async function confirmedAccount(): Promise<{ id: number; email: string; session: string }> {
  const email = address('account');
  const row = await env.DB.prepare(
    "INSERT INTO users (email, password_hash, email_verified, auth_provider, plan) VALUES (?, ?, 1, 'password', 'basic') RETURNING id"
  )
    .bind(email, await hashPassword(PASSWORD))
    .first<{ id: number }>();
  const id = row!.id;
  await env.DB.prepare("INSERT INTO profiles (name, user_id) VALUES ('Household', ?)")
    .bind(id)
    .run();
  const session = (await sessionCookie(id)).split(';')[0]!;
  return { id, email, session };
}

/** The three routes every check is tried on: a sign-in, a sign-up and a write to the app's data. */
interface Case {
  path: string;
  /** A fresh body for one request, and whatever the request needs besides. */
  request: () => Promise<{ body: unknown; cookie?: string; done: () => Promise<boolean> }>;
}

const CASES: Record<string, Case> = {
  'a sign-in': {
    path: '/api/auth/login',
    request: async () => {
      const { id, email } = await confirmedAccount();
      const sessions = async () =>
        (
          await env.DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id = ?')
            .bind(id)
            .first<{ n: number }>()
        )?.n ?? 0;
      const before = await sessions();
      return { body: { email, password: PASSWORD }, done: async () => (await sessions()) > before };
    },
  },
  'a sign-up': {
    path: '/api/auth/register',
    request: async () => {
      const email = address('sign-up');
      return {
        body: { email, password: PASSWORD },
        done: async () =>
          (await env.DB.prepare('SELECT 1 AS found FROM users WHERE email = ?')
            .bind(email)
            .first()) !== null,
      };
    },
  },
  'a new profile': {
    path: '/api/profiles',
    request: async () => {
      const { id, session } = await confirmedAccount();
      const name = `Profile ${unique()}`;
      return {
        body: { name },
        cookie: session,
        done: async () =>
          (await env.DB.prepare('SELECT 1 AS found FROM profiles WHERE user_id = ? AND name = ?')
            .bind(id, name)
            .first()) !== null,
      };
    },
  },
};

describe.each(Object.entries(CASES))('%s', (_name, route) => {
  it("is taken from the app's own page", async () => {
    const { body, cookie, done } = await route.request();

    const res = await send(route.path, fromTheApp(body, { cookie }));

    expect(res.ok).toBe(true);
    expect(await done()).toBe(true);
  });

  it("is taken with an Origin that is the app's only: another gets 403, no cookie, no writes", async () => {
    const { body, cookie, done } = await route.request();
    const before = await rowCounts();

    // As a browser that sends Origin but not Sec-Fetch-Site does.
    const res = await send(
      route.path,
      fromTheApp(body, { cookie, origin: OTHER, site: undefined })
    );

    expect(await notTaken(res)).toBe(true);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await rowCounts()).toEqual(before);
    expect(await done()).toBe(false);
  });

  it('is taken unless Sec-Fetch-Site says cross-site: then 403, no cookie, no writes', async () => {
    const { body, cookie, done } = await route.request();
    const before = await rowCounts();

    const res = await send(
      route.path,
      fromTheApp(body, { cookie, origin: undefined, site: 'cross-site' })
    );

    expect(await notTaken(res)).toBe(true);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await rowCounts()).toEqual(before);
    expect(await done()).toBe(false);
  });

  it('is taken with a JSON body only: the same JSON as text/plain gets 403, no cookie, no writes', async () => {
    const { body, cookie, done } = await route.request();
    const before = await rowCounts();

    // As a form sends its body: no Origin or Sec-Fetch-Site to go on, only the type.
    const res = await send(
      route.path,
      fromTheApp(body, { cookie, origin: undefined, site: undefined, type: 'text/plain' })
    );

    expect(await notTaken(res)).toBe(true);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await rowCounts()).toEqual(before);
    expect(await done()).toBe(false);
  });
});

describe("the app's origins", () => {
  async function newProfileFrom(origin: string, e: Env): Promise<Response> {
    const { body, cookie } = await CASES['a new profile']!.request();
    return send('/api/profiles', fromTheApp(body, { cookie, origin, site: 'same-site', e }));
  }

  it('are CORS_ORIGIN and every origin in APP_ORIGINS', async () => {
    expect((await newProfileFrom(APP, DEPLOYED)).ok).toBe(true);
    expect((await newProfileFrom(SECOND_APP, DEPLOYED)).ok).toBe(true);
    expect(await notTaken(await newProfileFrom(OTHER, DEPLOYED))).toBe(true);
  });

  it('include the local app at :3800, under both its names, in development only', async () => {
    expect((await newProfileFrom('http://localhost:3800', LOCAL)).ok).toBe(true);
    expect((await newProfileFrom('http://127.0.0.1:3800', LOCAL)).ok).toBe(true);
    expect(await notTaken(await newProfileFrom('http://localhost:3801', LOCAL))).toBe(true);

    expect(await notTaken(await newProfileFrom('http://localhost:3800', DEPLOYED))).toBe(true);
    expect(await notTaken(await newProfileFrom('http://127.0.0.1:3800', DEPLOYED))).toBe(true);
  });

  it('never include an Origin of null', async () => {
    expect(await notTaken(await newProfileFrom('null', LOCAL))).toBe(true);
  });
});

describe('requests the app sends besides', () => {
  it('a request with no Origin and no Sec-Fetch-Site, as scripts and tests send, is taken', async () => {
    const { body, cookie, done } = await CASES['a new profile']!.request();

    const res = await send(
      '/api/profiles',
      fromTheApp(body, { cookie, origin: undefined, site: undefined })
    );

    expect(res.ok).toBe(true);
    expect(await done()).toBe(true);
  });

  it('a change with no body needs no Content-Type, and a body needs one', async () => {
    const { session } = await confirmedAccount();
    const signOut = await send('/api/auth/logout', {
      origin: LOCAL_APP,
      site: 'same-origin',
      cookie: session,
    });
    expect(signOut.status).toBe(200);

    const { body, cookie, done } = await CASES['a new profile']!.request();
    const untyped = await send('/api/profiles', {
      origin: LOCAL_APP,
      site: 'same-origin',
      cookie,
      body: new TextEncoder().encode(JSON.stringify(body)),
    });
    expect(await notTaken(untyped)).toBe(true);
    expect(await done()).toBe(false);
  });

  it("an upload takes multipart/form-data from the app's page", async () => {
    const { session } = await confirmedAccount();
    const upload = () => {
      const form = new FormData();
      form.append('file', new File([statementCsv], 'statement.csv', { type: 'text/csv' }));
      return form;
    };

    const fromApp = await send('/api/import/upload', {
      origin: LOCAL_APP,
      site: 'same-origin',
      cookie: session,
      body: upload(),
    });
    expect(fromApp.status).toBe(200);

    const fromElsewhere = await send('/api/import/upload', {
      origin: OTHER,
      cookie: session,
      body: upload(),
    });
    expect(await notTaken(fromElsewhere)).toBe(true);
  });

  it('multipart/form-data is for the uploads only', async () => {
    const { cookie, done } = await CASES['a new profile']!.request();
    const form = new FormData();
    form.append('name', `Profile ${unique()}`);

    const res = await send('/api/profiles', {
      origin: LOCAL_APP,
      site: 'same-origin',
      cookie,
      body: form,
    });

    expect(await notTaken(res)).toBe(true);
    expect(await done()).toBe(false);
  });
});

describe('routes called from elsewhere by design', () => {
  it("the Stripe webhook takes Stripe's signed events", async () => {
    const webhookSecret = 'whsec_app_requests_test';
    const payload = JSON.stringify({
      id: `evt_app_requests_${unique()}`,
      type: 'customer.created',
      created: Math.floor(Date.now() / 1000),
      data: { object: {} },
    });
    const t = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
    const v1 = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

    const res = await send('/api/billing/webhook', {
      origin: OTHER,
      site: 'cross-site',
      type: 'text/plain',
      body: payload,
      headers: { 'stripe-signature': `t=${t},v1=${v1}` },
      e: { ...DEPLOYED, STRIPE_WEBHOOK_SECRET: webhookSecret },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true });
  });

  it('the token API takes an upload through a signed link from anywhere', async () => {
    const { id } = await confirmedAccount();
    const profile = await env.DB.prepare('SELECT id FROM profiles WHERE user_id = ?')
      .bind(id)
      .first<{ id: number }>();
    const tokenId = `tok-app-requests-${unique()}`;
    await apiTokenRow(tokenId, id);
    const sig = await signCapability(
      { tokenId, userId: id, profileId: profile!.id, purpose: 'import' },
      SECRET
    );
    const form = new FormData();
    form.append('file', new File([statementCsv], 'statement.csv', { type: 'text/csv' }));

    const res = await send(`/api/v1/import?${new URLSearchParams({ sig, mode: 'preview' })}`, {
      origin: OTHER,
      site: 'cross-site',
      body: form,
      e: DEPLOYED,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: 'preview' });
  });

  it('the MCP server takes an API token from anywhere', async () => {
    const { id } = await confirmedAccount();
    const token = await mintApiToken(env.DB, id, { name: 'App requests test', scopes: ['read'] });

    const res = await send('/mcp', {
      origin: OTHER,
      site: 'cross-site',
      type: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      headers: { Authorization: `Bearer ${token.secret}` },
      e: DEPLOYED,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ jsonrpc: '2.0', id: 1 });
  });

  it("one-click unsubscribe takes a mail provider's post and its own page's form", async () => {
    const unsubscribed = async (token: string) =>
      (
        await env.DB.prepare(
          'SELECT notifications_unsubscribed AS n FROM users WHERE unsubscribe_token = ?'
        )
          .bind(token)
          .first<{ n: number | null }>()
      )?.n;
    const withToken = async () => {
      const { id } = await confirmedAccount();
      const token = `unsubscribe-${unique()}`;
      await env.DB.prepare('UPDATE users SET unsubscribe_token = ? WHERE id = ?')
        .bind(token, id)
        .run();
      return token;
    };

    // A mail provider's one-click post (RFC 8058), from its own servers.
    const provider = await withToken();
    const oneClick = await send(`/api/notifications/unsubscribe?token=${provider}`, {
      type: 'application/x-www-form-urlencoded',
      body: 'List-Unsubscribe=One-Click',
      e: DEPLOYED,
    });
    expect(oneClick.status).toBe(200);
    expect(await unsubscribed(provider)).toBe(1);

    // The Unsubscribe button on the page this API serves, which posts from this host.
    const page = await withToken();
    const button = await send(`/api/notifications/unsubscribe?token=${page}`, {
      origin: BASE,
      site: 'same-origin',
      type: 'application/x-www-form-urlencoded',
      body: '',
      e: DEPLOYED,
    });
    expect(button.status).toBe(200);
    expect(await unsubscribed(page)).toBe(1);
  });
});
