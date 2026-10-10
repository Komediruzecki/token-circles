/**
 * A password account whose address is not confirmed reaches, from a session or an API token, only
 * what confirming the address needs. Every other route that takes a session answers its session
 * 403 EMAIL_UNCONFIRMED, and every route that takes an API token answers its token the same.
 *
 * The rows decide: an account made before this rule, and a session issued before it, are answered
 * the same way, and both work again once the address is confirmed. A Google account is never
 * asked, whatever its email_verified says.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mintApiToken } from '../src/apitoken';
import { mcpRoutes } from '../src/mcp';
import { sessionCookie, unconfirmedSessionCookie } from './helpers/session';

declare global {
  interface ImportMeta {
    glob<T>(pattern: string | string[], options: { eager: true }): Record<string, T>;
  }
}

const WAITING = 7720;
const GOOGLE = 7721;
const ADDRESS = 'gate-waiting@example.com';
const GOOGLE_ADDRESS = 'gate-google@example.com';
/** Every request here comes from this address, so the limits it fills are its own. */
const IP = '10.77.20.1';
const MINE = `SELECT id FROM users WHERE id IN (${WAITING}, ${GOOGLE})`;

const UNCONFIRMED = {
  error: 'Confirm your email address to use this account. Open the link we emailed you.',
  code: 'EMAIL_UNCONFIRMED',
};

/**
 * The routes a session of an account waiting for its link still reaches: what the Confirm your
 * email screen needs (who is signed in, sending the link again, signing out), and finishing a
 * link opened before signing in. GET /api/auth/verify-email checks the session itself, below.
 */
const LET_IN = [
  'GET /api/auth/me',
  'POST /api/auth/resend-verification',
  'POST /api/auth/logout',
  'POST /api/auth/email-link/finish',
];

/** Routes that take an API token rather than a session, or a capability an API token mints. */
const TOKEN_ROUTES = /^(\/mcp|\/api\/v1\/)/;

async function removeAccounts(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM auth_sessions WHERE user_id IN (${MINE})`),
    env.DB.prepare(`DELETE FROM api_tokens WHERE user_id IN (${MINE})`),
    env.DB.prepare(`DELETE FROM email_verifications WHERE user_id IN (${MINE})`),
    env.DB.prepare(`DELETE FROM profiles WHERE user_id IN (${MINE})`),
    env.DB.prepare(`DELETE FROM users WHERE id IN (${MINE})`),
  ]);
  await env.DB.prepare('DELETE FROM rate_limits WHERE bucket LIKE ?').bind(`%${IP}%`).run();
}

/** An account as the app makes one, and a profile, with `verified` and `provider` as given. */
async function seed(id: number, email: string, provider: string, verified: 0 | 1): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, auth_provider, provider_id, email_verified, token_version, plan) VALUES (?, ?, 'pbkdf2$100000$x$y', ?, ?, ?, 1, 'advanced')"
    ).bind(id, email, provider, provider === 'google' ? `google-sub-${id}` : null, verified),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Personal')").bind(
      id,
      id
    ),
  ]);
}

const confirm = (id: number) =>
  env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(id).run();

function send(method: string, path: string, cookie?: string): Promise<Response> {
  return SELF.fetch(`https://api.example.com${path}`, {
    method,
    redirect: 'manual',
    headers: {
      'CF-Connecting-IP': IP,
      'X-Profile-Id': String(WAITING),
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
}

const sessionOf = async (id: number) => (await unconfirmedSessionCookie(id)).split(';')[0]!;

type RouteTable = { routes: { method: string; path: string }[] };

/** Every route the Worker's route modules and the MCP server register, as `METHOD /path`. */
function everyRoute(): string[] {
  const modules = import.meta.glob<Record<string, unknown>>('../src/routes/*.ts', { eager: true });
  const tables: RouteTable[] = [mcpRoutes as unknown as RouteTable];
  for (const module of Object.values(modules)) {
    for (const value of Object.values(module)) {
      const routes = (value as Partial<RouteTable> | null)?.routes;
      if (Array.isArray(routes)) tables.push(value as RouteTable);
    }
  }
  const found = new Set<string>();
  for (const table of tables) {
    for (const r of table.routes) if (r.method !== 'ALL') found.add(`${r.method} ${r.path}`);
  }
  return [...found].sort();
}

beforeEach(removeAccounts);
afterEach(removeAccounts);

describe('a session of a password account whose address is not confirmed', () => {
  it('is answered 403 EMAIL_UNCONFIRMED on every route that takes a session, but the four the confirm screen and a waiting link need', async () => {
    await seed(WAITING, ADDRESS, 'password', 0);
    const session = await sessionOf(WAITING);
    const routes = everyRoute();
    expect(routes.length, 'the route modules were read').toBeGreaterThan(100);

    const sessionRoutes: string[] = [];
    const answered: Record<string, string> = {};
    for (const route of routes) {
      const [method, pattern] = route.split(' ') as [string, string];
      if (TOKEN_ROUTES.test(pattern)) continue;
      const path = pattern.replace(/:\w+/g, '1');
      // A route takes a session when, without one, it is answered as requireAuth answers.
      const signedOut = await send(method, path);
      if (signedOut.status !== 401 || (await signedOut.text()) !== '{"error":"Unauthorized"}') {
        continue;
      }
      sessionRoutes.push(route);
      // Signing out ends the session it is sent with, so it gets one of its own.
      const res = await send(
        method,
        path,
        route === 'POST /api/auth/logout' ? await sessionOf(WAITING) : session
      );
      const body = await res.text();
      answered[route] =
        res.status === 403 && body === JSON.stringify(UNCONFIRMED)
          ? 'EMAIL_UNCONFIRMED'
          : `answered ${res.status}`;
    }

    // Every route that takes a session, and the four on the list among them.
    expect(sessionRoutes.length).toBeGreaterThan(100);
    expect(sessionRoutes).toEqual(expect.arrayContaining(LET_IN));
    const expected = Object.fromEntries(
      sessionRoutes.map((route) => [
        route,
        LET_IN.includes(route) ? expect.stringMatching(/^answered 2\d\d$/) : 'EMAIL_UNCONFIRMED',
      ])
    );
    expect(answered).toEqual(expected);
    // Two requests for each of some two hundred routes.
  }, 120_000);

  it('is answered the same as before once the address is confirmed', async () => {
    await seed(WAITING, ADDRESS, 'password', 0);
    const session = await sessionOf(WAITING);
    expect((await send('GET', '/api/profiles', session)).status).toBe(403);

    await confirm(WAITING);

    const res = await send('GET', '/api/profiles', session);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([expect.objectContaining({ id: WAITING })]);
  });

  it('reads who is signed in, the address and whether it is confirmed, from GET /api/auth/me', async () => {
    await seed(WAITING, ADDRESS, 'password', 0);

    const res = await send('GET', '/api/auth/me', await sessionOf(WAITING));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: WAITING,
      email: ADDRESS,
      auth_provider: 'password',
      email_verified: 0,
    });
  });

  it('opens the confirm link, which confirms the address, and the session reaches every route then', async () => {
    await seed(WAITING, ADDRESS, 'password', 0);
    const session = await sessionOf(WAITING);
    const token = 'gate-confirm-link-token';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
      ''
    );
    await env.DB.prepare(
      "INSERT INTO email_verifications (user_id, email, token_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+1 day'))"
    )
      .bind(WAITING, ADDRESS, hash)
      .run();

    const opened = await send('GET', `/api/auth/verify-email?token=${token}`, session);

    expect(opened.headers.get('Location')).toMatch(/#everified=1$/);
    expect((await send('GET', '/api/profiles', session)).status).toBe(200);
  });
});

describe('an API token of a password account whose address is not confirmed', () => {
  async function tokenOf(id: number): Promise<string> {
    return (await mintApiToken(env.DB, id, { name: 'Nightly import', scopes: ['read'] })).secret;
  }

  const callMcp = (token: string) =>
    SELF.fetch('https://api.example.com/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

  it('is answered 403 EMAIL_UNCONFIRMED by the MCP server', async () => {
    await seed(WAITING, ADDRESS, 'password', 0);

    const res = await callMcp(await tokenOf(WAITING));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(UNCONFIRMED);
  });

  it('is answered as before once the address is confirmed', async () => {
    await seed(WAITING, ADDRESS, 'password', 0);
    const token = await tokenOf(WAITING);
    expect((await callMcp(token)).status).toBe(403);

    await confirm(WAITING);

    expect((await callMcp(token)).status).toBe(200);
  });
});

describe('a Google account', () => {
  it('reaches every route with email_verified 0, as with 1', async () => {
    await seed(GOOGLE, GOOGLE_ADDRESS, 'google', 0);

    const session = (await unconfirmedSessionCookie(GOOGLE, 'google')).split(';')[0]!;
    const res = await SELF.fetch('https://api.example.com/api/profiles', {
      headers: { Cookie: session, 'CF-Connecting-IP': IP },
    });

    expect(res.status).toBe(200);
    const token = (await mintApiToken(env.DB, GOOGLE, { name: 'Agent', scopes: ['read'] })).secret;
    const mcp = await SELF.fetch('https://api.example.com/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(mcp.status).toBe(200);
  });
});

describe('sessionCookie, the helper most tests sign in with', () => {
  it('confirms the address of the account it signs in', async () => {
    await seed(WAITING, ADDRESS, 'password', 0);

    const session = (await sessionCookie(WAITING)).split(';')[0]!;

    expect((await send('GET', '/api/profiles', session)).status).toBe(200);
  });
});
