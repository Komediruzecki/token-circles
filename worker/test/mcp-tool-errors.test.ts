/**
 * A tools/call that fails is answered as a result with isError, so the model can read it. That
 * text used to be err.message for anything thrown, so a raw D1 error reached the MCP client word
 * for word. It now follows the onError rule: an HttpError's message is written for the caller and
 * passes through, anything else is GENERIC_ERROR, and the full error is logged.
 *
 * The tools here are registered by the test and run through the real dispatch() on a minimal app,
 * so the failure is a genuine D1 constraint without depending on a shipped tool having a bug.
 */
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { z } from 'zod';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorResponse, GENERIC_ERROR } from '../src/error-response';
import { HttpError } from '../src/http';
import type { AppEnv } from '../src/index';
import { dispatch } from '../src/mcp/rpc';
import { defineTool, TOOLS } from '../src/mcp/registry';

const USER_ID = 9700;
const PROFILE_ID = 9701;
const RAW = 'test_only_raw_failure';
const WRITTEN = 'test_only_written_failure';

const app = new Hono<AppEnv>();
app.onError(errorResponse);
app.post('/mcp', async (c) => {
  c.set('userId', USER_ID);
  c.set('token', {
    tokenId: 'test-token',
    userId: USER_ID,
    scopes: ['read', 'write', 'import'],
    defaultProfileId: PROFILE_ID,
  });
  return c.json(await dispatch(c, await c.req.json()));
});

async function call(name: string): Promise<any> {
  const res = await app.request(
    '/mcp',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name } }),
    },
    env
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as any).result;
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  defineTool({
    name: RAW,
    title: 'Fails in D1',
    description: 'Test only.',
    scope: 'write',
    input: z.object({}),
    handler: async (c, _args, profileId) => {
      // categories.name is NOT NULL.
      await c.env.DB.prepare('INSERT INTO categories (name, profile_id) VALUES (NULL, ?)')
        .bind(profileId)
        .run();
      return { ok: true };
    },
  });
  defineTool({
    name: WRITTEN,
    title: 'Refuses on purpose',
    description: 'Test only.',
    scope: 'write',
    input: z.object({}),
    handler: async () => {
      throw new HttpError(409, 'A budget for that category already exists this month.');
    },
  });
});

afterAll(() => {
  for (const name of [RAW, WRITTEN]) {
    const i = TOOLS.findIndex((t) => t.name === name);
    if (i !== -1) TOOLS.splice(i, 1);
  }
});

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM error_logs').run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'mcp-errors@example.com', 'password', 1, 'advanced')"
  )
    .bind(USER_ID)
    .run();
  await env.DB.prepare("INSERT OR IGNORE INTO profiles (id, name, user_id) VALUES (?, 'Main', ?)")
    .bind(PROFILE_ID, USER_ID)
    .run();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe('tools/call failures', () => {
  it('answers an unexpected error with GENERIC_ERROR and none of the D1 text', async () => {
    const result = await call(RAW);
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: GENERIC_ERROR }]);
    const text = JSON.stringify(result);
    for (const leak of ['D1_ERROR', 'SQLITE', 'NOT NULL', 'categories.name']) {
      expect(text).not.toContain(leak);
    }
  });

  it('logs the unexpected error the way onError does', async () => {
    await call(RAW);

    const line = consoleError.mock.calls
      .map((args) => String(args[0]))
      .find((l) => l.includes('categories.name'));
    expect(line).toBeDefined();
    const logged = JSON.parse(line!);
    expect(logged).toMatchObject({ level: 'error', status: 500, method: 'POST', path: '/mcp' });
    expect(logged.message).toMatch(/NOT NULL constraint failed: categories\.name/);
    expect(typeof logged.stack).toBe('string');

    let row: { path: string; status: number; message: string } | null = null;
    for (let i = 0; i < 20 && !row; i++) {
      row = await env.DB.prepare(
        'SELECT path, status, message FROM error_logs ORDER BY id DESC LIMIT 1'
      ).first();
      if (!row) await new Promise((r) => setTimeout(r, 25));
    }
    expect(row).toMatchObject({ path: '/mcp', status: 500 });
    expect(row!.message).toMatch(/categories\.name/);
  });

  it("passes an HttpError's message through and does not log a 4xx", async () => {
    const result = await call(WRITTEN);
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'A budget for that category already exists this month.' },
    ]);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
