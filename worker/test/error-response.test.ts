import { env, SELF } from 'cloudflare:test';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import { errorResponse, GENERIC_ERROR } from '../src/error-response';
import { HttpError } from '../src/http';
import type { AppEnv } from '../src/index';

// An unexpected failure used to reach the browser word for word: the onError handler put
// err.message in the body, so a D1 constraint answered
//   {"error":"D1_ERROR: NOT NULL constraint failed: categories.icon: SQLITE_CONSTRAINT ..."}
// The handler now answers unexpected errors with one generic sentence and keeps the detail in the
// logs. Errors written for the client (HttpError, Hono's HTTPException) keep their status and
// their words, 5xx ones included.

let cookie = '';
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  for (const t of ['error_logs', 'categories', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (90, 'errors@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (900, 90, 'Main')"),
    env.DB.prepare(
      "INSERT INTO categories (id, name, color, icon, type, profile_id) VALUES (9001, 'Groceries', '#22c55e', 'cart', 'expense', 900)"
    ),
  ]);
  cookie = (await issueSessionCookie(90, 'password', env)).split(';')[0];
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

function api(path: string, init: { method: string; body?: unknown }): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: init.method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': '900' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

describe('unexpected errors', () => {
  it('answers a D1 constraint failure with the generic body and none of the internal text', async () => {
    // `color` is NOT NULL and the edit route writes whatever the body says. Any route that lets a
    // raw D1 error escape would do; this one is reachable with a plain session.
    const res = await api('/api/categories/9001', { method: 'PUT', body: { color: null } });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: GENERIC_ERROR });
    for (const leak of ['D1_ERROR', 'SQLITE', 'NOT NULL', 'categories.color', 'constraint']) {
      expect(text).not.toContain(leak);
    }
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('still logs the full error, with method and path, to the console and to error_logs', async () => {
    await api('/api/categories/9001', { method: 'PUT', body: { color: null } });

    const lines = consoleError.mock.calls.map((args) => String(args[0]));
    const line = lines.find((l) => l.includes('categories.color'));
    expect(line).toBeDefined();
    const logged = JSON.parse(line!);
    expect(logged).toMatchObject({ level: 'error', status: 500, method: 'PUT' });
    expect(logged.path).toBe('/api/categories/9001');
    expect(logged.message).toMatch(/NOT NULL constraint failed: categories\.color/);
    expect(typeof logged.stack).toBe('string');
    // The request body never goes to the log.
    expect(line).not.toContain('"color":null');

    // logWorkerError hands the insert to waitUntil; give it a turn to land.
    let row: { method: string; path: string; status: number; message: string } | null = null;
    for (let i = 0; i < 20 && !row; i++) {
      row = await env.DB.prepare(
        'SELECT method, path, status, message FROM error_logs ORDER BY id DESC LIMIT 1'
      ).first();
      if (!row) await new Promise((r) => setTimeout(r, 25));
    }
    expect(row).toMatchObject({ method: 'PUT', path: '/api/categories/9001', status: 500 });
    expect(row!.message).toMatch(/categories\.color/);
  });

  it('answers a thrown Error with the generic body, whatever its message says', async () => {
    const app = new Hono<AppEnv>();
    app.onError(errorResponse);
    app.get('/boom', () => {
      throw new Error('Invalid identifier: users; DROP TABLE users');
    });
    const res = await app.request('/boom', {}, env);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: GENERIC_ERROR });
    expect(text).not.toContain('Invalid identifier');
  });
});

describe('errors written for the client', () => {
  it('keeps an HttpError 4xx status and message', async () => {
    const res = await api('/api/categories/424242', { method: 'PUT', body: { name: 'x' } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Category not found' });
  });

  it('keeps an HttpError 5xx status and message', async () => {
    // STRIPE_SECRET_KEY is unset in the test Worker, so the portal route refuses with a 501
    // whose wording the Billing page shows as is.
    const res = await api('/api/billing/portal', { method: 'POST' });
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: 'Billing is not configured' });
  });

  it("keeps an HTTPException's status and message", async () => {
    const app = new Hono<AppEnv>();
    app.onError(errorResponse);
    app.get('/teapot', () => {
      throw new HTTPException(418, { message: 'Short and stout' });
    });
    app.get('/unavailable', () => {
      throw new HTTPException(503, { message: 'Imports are paused for maintenance' });
    });

    const teapot = await app.request('/teapot', {}, env);
    expect(teapot.status).toBe(418);
    expect(await teapot.json()).toEqual({ error: 'Short and stout' });

    const unavailable = await app.request('/unavailable', {}, env);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: 'Imports are paused for maintenance' });
  });

  it('keeps an HttpError thrown from a test route', async () => {
    const app = new Hono<AppEnv>();
    app.onError(errorResponse);
    app.get('/gone', () => {
      throw new HttpError(410, 'That export link has expired');
    });
    const res = await app.request('/gone', {}, env);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'That export link has expired' });
  });
});
