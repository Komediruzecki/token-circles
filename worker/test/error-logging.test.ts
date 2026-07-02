import { env } from 'cloudflare:test';
import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logWorkerError } from '../src/errorlog';
import type { AppEnv } from '../src/index';

// Minimal Context stand-in exercising only what logWorkerError touches. We pass the REAL test D1
// (env.DB, migrations applied) so the persistence path is genuinely verified.
function makeCtx(
  over: { method?: string; path?: string; ray?: string | null; userId?: number } = {}
): { ctx: Context<AppEnv>; waited: Promise<unknown>[] } {
  const waited: Promise<unknown>[] = [];
  const ctx = {
    req: {
      method: over.method ?? 'POST',
      path: over.path ?? '/api/transactions',
      header: (_name: string) => (over.ray === undefined ? 'ray-abc' : over.ray),
    },
    get: (_key: string) => over.userId ?? 7,
    env: { DB: env.DB },
    executionCtx: {
      waitUntil: (p: Promise<unknown>) => {
        waited.push(p);
      },
    },
  } as unknown as Context<AppEnv>;
  return { ctx, waited };
}

describe('logWorkerError', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM error_logs').run();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('persists 5xx failures to the error_logs table with request context', async () => {
    const { ctx, waited } = makeCtx({ method: 'PUT', path: '/api/transactions/9', userId: 42, ray: 'ray-xyz' });
    logWorkerError(ctx, new Error('kaboom'), 500);
    await Promise.all(waited);

    const row = await env.DB.prepare(
      'SELECT method, path, status, message, user_id, request_id FROM error_logs ORDER BY id DESC LIMIT 1'
    ).first<Record<string, unknown>>();

    expect(row).toMatchObject({
      method: 'PUT',
      path: '/api/transactions/9',
      status: 500,
      message: 'kaboom',
      user_id: 42,
      request_id: 'ray-xyz',
    });
  });

  it('does NOT record 4xx client errors (intentional control flow)', async () => {
    const { ctx, waited } = makeCtx();
    logWorkerError(ctx, new Error('bad input'), 400);
    await Promise.all(waited);

    const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM error_logs').first<{ n: number }>();
    expect(c?.n).toBe(0);
  });

  it('captures the error stack for 5xx', async () => {
    const { ctx, waited } = makeCtx();
    logWorkerError(ctx, new Error('with-stack'), 503);
    await Promise.all(waited);

    const row = await env.DB.prepare('SELECT stack FROM error_logs ORDER BY id DESC LIMIT 1').first<{
      stack: string | null;
    }>();
    expect(row?.stack).toContain('with-stack');
  });
});
