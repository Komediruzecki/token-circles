/**
 * Requests that change data are taken from the app's own pages, with a JSON body
 * (request-origin.ts). Each case below sends one thing a browser says about a request and leaves
 * the rest as the app sends it, so each answer comes from one check.
 */
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
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
/** The dev deployment, whose APP_ENV is `dev`, not `development` (wrangler.jsonc). */
const DEV_DEPLOYED: Env = { ...DEPLOYED, APP_ENV: 'dev' };
/** An origin that is not the app's. */
const OTHER = 'https://other.example';

let sequence = 0;
const unique = () => `${Date.now().toString(36)}-${++sequence}`;
const address = (what: string) => `app-requests-${what}-${unique()}@example.com`;
let requests = 0;
/**
 * A network address for each request, counted per request and from a range no other test file
 * uses (10.86.0.0/16), so a per-address limit never answers a case.
 */
const nextIp = () => {
  requests += 1;
  return `10.86.${Math.floor(requests / 250)}.${(requests % 250) + 1}`;
};

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

/** Hand `request` to the Worker, and wait for what it does after answering. */
async function deliver(request: Request, e: Env = LOCAL): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** Send `path` to the Worker as `sent` describes. */
function send(path: string, sent: Sent = {}): Promise<Response> {
  const headers = new Headers(sent.headers);
  headers.set('CF-Connecting-IP', nextIp());
  if (sent.origin !== undefined) headers.set('Origin', sent.origin);
  if (sent.site !== undefined) headers.set('Sec-Fetch-Site', sent.site);
  if (sent.type !== undefined) headers.set('Content-Type', sent.type);
  if (sent.cookie !== undefined) headers.set('Cookie', sent.cookie);
  return deliver(
    new Request(`${BASE}${path}`, { method: sent.method ?? 'POST', headers, body: sent.body }),
    sent.e
  );
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

  it('is taken when Sec-Fetch-Site says the same site or nothing: cross-site gets 403, no cookie, no writes', async () => {
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

describe('a PUT and a DELETE', () => {
  /** A signed-in account with two profiles besides its first, and the name a profile has now. */
  async function withTwoMoreProfiles() {
    const { id, session } = await confirmedAccount();
    const ids: number[] = [];
    for (const name of ['Second', 'Third']) {
      const row = await env.DB.prepare(
        'INSERT INTO profiles (name, user_id) VALUES (?, ?) RETURNING id'
      )
        .bind(`${name} ${unique()}`, id)
        .first<{ id: number }>();
      ids.push(row!.id);
    }
    const nameOf = async (profile: number) =>
      (
        await env.DB.prepare('SELECT name FROM profiles WHERE id = ?')
          .bind(profile)
          .first<{ name: string }>()
      )?.name ?? null;
    return { session, ids: ids as [number, number], nameOf };
  }

  it("a PUT is taken from the app's page, and as text/plain gets 403 and renames nothing", async () => {
    const { session, ids, nameOf } = await withTwoMoreProfiles();
    const renamed = `Renamed ${unique()}`;

    const fromApp = await send(
      `/api/profiles/${ids[0]}`,
      fromTheApp({ name: renamed }, { method: 'PUT', cookie: session })
    );
    expect(fromApp.ok).toBe(true);
    expect(await nameOf(ids[0])).toBe(renamed);

    const before = await nameOf(ids[1]);
    const asText = await send(
      `/api/profiles/${ids[1]}`,
      fromTheApp(
        { name: `Renamed ${unique()}` },
        { method: 'PUT', cookie: session, origin: undefined, site: undefined, type: 'text/plain' }
      )
    );
    expect(await notTaken(asText)).toBe(true);
    expect(await nameOf(ids[1])).toBe(before);
  });

  it("a DELETE is taken from the app's page, and from another origin gets 403 and deletes nothing", async () => {
    const { session, ids, nameOf } = await withTwoMoreProfiles();

    const fromApp = await send(`/api/profiles/${ids[0]}`, {
      method: 'DELETE',
      origin: LOCAL_APP,
      site: 'same-origin',
      cookie: session,
    });
    expect(fromApp.ok).toBe(true);
    expect(await nameOf(ids[0])).toBeNull();

    const fromElsewhere = await send(`/api/profiles/${ids[1]}`, {
      method: 'DELETE',
      origin: OTHER,
      cookie: session,
    });
    expect(await notTaken(fromElsewhere)).toBe(true);
    expect(await nameOf(ids[1])).not.toBeNull();
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

  it('include a local app on any loopback port in development, and none outside it', async () => {
    const local = [
      'http://localhost:3800',
      'http://127.0.0.1:3800',
      'http://localhost:3900',
      'http://127.0.0.1:4173',
      'http://[::1]:3811',
    ];
    for (const origin of local) {
      expect((await newProfileFrom(origin, LOCAL)).ok, `${origin} in development`).toBe(true);
    }
    // Loopback over http only: not a machine on the network, and not https.
    expect(await notTaken(await newProfileFrom('http://192.168.1.20:3800', LOCAL))).toBe(true);
    expect(await notTaken(await newProfileFrom('https://localhost:3800', LOCAL))).toBe(true);

    for (const e of [DEPLOYED, DEV_DEPLOYED]) {
      for (const origin of [
        'http://localhost:3800',
        'http://127.0.0.1:3900',
        'http://[::1]:3811',
      ]) {
        const res = await newProfileFrom(origin, e);
        expect(await notTaken(res), `${origin} with APP_ENV=${e.APP_ENV}`).toBe(true);
      }
    }
  });

  it('never include an Origin of null, even when an APP_ORIGINS entry has that origin', async () => {
    // about:blank is a URL whose origin is "null", as a sandboxed page's is.
    const withBlank: Env = { ...DEPLOYED, APP_ORIGINS: `${APP}, about:blank` };
    expect(await notTaken(await newProfileFrom('null', withBlank))).toBe(true);
    expect(await notTaken(await newProfileFrom('null', LOCAL))).toBe(true);
  });
});

describe('Sec-Fetch-Site', () => {
  async function newProfileSaying(site: string | undefined): Promise<Response> {
    const { body, cookie } = await CASES['a new profile']!.request();
    return send('/api/profiles', fromTheApp(body, { cookie, site }));
  }

  it('is taken when it says same-origin, same-site or none, or says nothing', async () => {
    for (const site of ['same-origin', 'same-site', 'none', undefined]) {
      expect((await newProfileSaying(site)).ok, `Sec-Fetch-Site: ${site ?? 'absent'}`).toBe(true);
    }
  });

  it('gets 403 when it says anything else', async () => {
    for (const site of ['cross-site', 'bogus']) {
      expect(await notTaken(await newProfileSaying(site)), `Sec-Fetch-Site: ${site}`).toBe(true);
    }
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

  it('a POST that sends nothing is taken as workerd hands it over: Content-Length 0, an empty stream', async () => {
    // As the app asks for a new confirm link (emailVerification.ts): a POST with no body and no
    // Content-Type, which reaches the Worker with an empty body stream rather than none.
    const { session } = await confirmedAccount();
    const request = new Request(`${BASE}/api/auth/resend-verification`, {
      method: 'POST',
      body: new ReadableStream({ start: (c) => c.close() }),
      duplex: 'half',
      headers: {
        'CF-Connecting-IP': nextIp(),
        Origin: LOCAL_APP,
        'Sec-Fetch-Site': 'same-origin',
        Cookie: session,
        'Content-Length': '0',
      },
    } as RequestInit);
    expect(request.body).not.toBeNull();
    expect(request.headers.get('Content-Length')).toBe('0');
    expect(request.headers.get('Content-Type')).toBeNull();

    const res = await deliver(request);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, alreadyVerified: true });
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

    // As Stripe's servers send it: JSON, with no Origin and no Sec-Fetch-Site.
    const res = await send('/api/billing/webhook', {
      type: 'application/json; charset=utf-8',
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

  it("the MCP server takes a client's JSON with an API token", async () => {
    const { id } = await confirmedAccount();
    const token = await mintApiToken(env.DB, id, { name: 'App requests test', scopes: ['read'] });

    // As an MCP client sends it: JSON and a bearer token, with no Origin.
    const res = await send('/mcp', {
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

    // The Unsubscribe button on the page this API serves. The page's Referrer-Policy is
    // no-referrer, so the browser sends its empty form with Origin: null.
    const page = await withToken();
    const button = await send(`/api/notifications/unsubscribe?token=${page}`, {
      origin: 'null',
      site: 'same-origin',
      type: 'application/x-www-form-urlencoded',
      body: '',
      e: DEPLOYED,
    });
    expect(button.status).toBe(200);
    expect(await unsubscribed(page)).toBe(1);
  });

  it('are matched on the path a request resolves to: /api/v1/%2e%2e/auth/login is the sign-in', async () => {
    for (const path of ['/api/v1/%2e%2e/auth/login', '/mcp/%2e%2e/api/auth/login']) {
      const { body, done } = await CASES['a sign-in']!.request();

      const res = await send(path, fromTheApp(body, { origin: OTHER, site: 'cross-site' }));

      expect(await notTaken(res), path).toBe(true);
      expect(res.headers.getSetCookie()).toEqual([]);
      expect(await done()).toBe(false);
    }
  });
});

describe('the log line', () => {
  it('names the check, at level warn, with the request id', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { body, cookie } = await CASES['a new profile']!.request();

      const res = await send(
        '/api/profiles',
        fromTheApp(body, { cookie, origin: OTHER, headers: { 'cf-ray': 'ray-app-requests-1' } })
      );

      expect(await notTaken(res)).toBe(true);
      const lines = warn.mock.calls
        .map(([line]) => {
          try {
            return JSON.parse(String(line)) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((line) => line?.event === 'request_not_taken');
      expect(lines).toEqual([
        expect.objectContaining({
          level: 'warn',
          event: 'request_not_taken',
          check: 'origin',
          method: 'POST',
          path: '/api/profiles',
          origin: OTHER,
          requestId: 'ray-app-requests-1',
        }),
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});
