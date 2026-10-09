/**
 * A request whose body is not JSON is the client's mistake, not ours. It used to reach onError as
 * a SyntaxError from c.req.json() and answer 500, which also wrote a row to error_logs for every
 * bad request anyone sent. It now answers 400 with a plain sentence and logs nothing. Only the
 * body parse gets this: a SyntaxError from anywhere else (stored JSON, a token) is still ours and
 * still a generic 500.
 */
import { env, SELF } from 'cloudflare:test';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionCookie } from './helpers/session';
import {
  errorResponse,
  GENERIC_ERROR,
  MALFORMED_JSON,
  rejectMalformedJson,
} from '../src/error-response';
import type { AppEnv } from '../src/index';

let cookie = '';
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  for (const t of ['error_logs', 'categories', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (91, 'json@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (910, 91, 'Main')"),
    env.DB.prepare(
      "INSERT INTO categories (id, name, color, icon, type, profile_id) VALUES (9101, 'Rent', '#6b7280', 'home', 'expense', 910)"
    ),
  ]);
  cookie = (await sessionCookie(91, 'password', env)).split(';')[0];
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

function send(path: string, method: string, body: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': '910' },
    body,
  });
}

async function errorLogCount(): Promise<number> {
  // logWorkerError hands its insert to waitUntil; give a would-be row time to land.
  await new Promise((r) => setTimeout(r, 100));
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM error_logs').first<{ n: number }>();
  return row?.n ?? 0;
}

describe('a body that is not JSON', () => {
  it('answers 400 with a plain sentence on a route that parses its body', async () => {
    const res = await send('/api/categories/9101', 'PUT', '{"name": "Rent", ');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: MALFORMED_JSON });
    expect(MALFORMED_JSON).toBe("The request body isn't valid JSON.");
  });

  it('is not logged as a server error', async () => {
    await send('/api/categories/9101', 'PUT', 'not json at all');
    expect(await errorLogCount()).toBe(0);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('leaves the routes that treat a bad body as empty alone', async () => {
    // POST /api/profiles reads its body with .catch(() => ({})), so a bad body is a missing name.
    const res = await send('/api/profiles', 'POST', '{oops');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).not.toBe(MALFORMED_JSON);
  });
});

describe('a SyntaxError that is not the body', () => {
  it('stays a generic 500 and is logged', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', rejectMalformedJson);
    app.onError(errorResponse);
    app.post('/stored', async (c) => {
      await c.req.json(); // the body is fine
      JSON.parse('{"saved": '); // a corrupt stored value is our fault
      return c.json({ ok: true });
    });
    app.post('/body', async (c) => c.json(await c.req.json()));

    const stored = await app.request(
      '/stored',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      env
    );
    expect(stored.status).toBe(500);
    expect(await stored.json()).toEqual({ error: GENERIC_ERROR });
    expect(consoleError).toHaveBeenCalled();

    const body = await app.request(
      '/body',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' },
      env
    );
    expect(body.status).toBe(400);
    expect(await body.json()).toEqual({ error: MALFORMED_JSON });
  });
});
