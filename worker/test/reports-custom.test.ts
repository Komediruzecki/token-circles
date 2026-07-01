/**
 * Custom-report ownership: these used to live in a per-isolate in-memory Map keyed by a Date.now()
 * id with no ownership check (an IDOR). They now persist in D1 (custom_reports) scoped by user_id.
 * Runs the real worker in workerd against a local D1 built from worker/migrations/.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

let cookieA = '';
let cookieB = '';

beforeEach(async () => {
  for (const t of ['custom_reports', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (1, 'a@example.com', 'password', 1)"
    ),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (2, 'b@example.com', 'password', 1)"
    ),
  ]);
  cookieA = (await issueSessionCookie(1, 'password', env)).split(';')[0];
  cookieB = (await issueSessionCookie(2, 'password', env)).split(';')[0];
});

function req(cookie: string, path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
}
const body = (res: Response) => res.json() as Promise<Record<string, unknown>>;

describe('custom reports — ownership (IDOR fix)', () => {
  it('requires authentication', async () => {
    const res = await SELF.fetch('https://example.com/api/reports/custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it("a user cannot read, update, or delete another user's report", async () => {
    const created = await body(
      await req(cookieA, '/api/reports/custom', {
        method: 'POST',
        body: JSON.stringify({ name: 'Mine' }),
      })
    );
    expect(created.id as number).toBeGreaterThan(0);
    const id = created.id;

    // Owner can read; the other user gets 404 (not the other tenant's data).
    expect((await req(cookieA, `/api/reports/custom/${id}`)).status).toBe(200);
    expect((await req(cookieB, `/api/reports/custom/${id}`)).status).toBe(404);
    expect(
      (
        await req(cookieB, `/api/reports/custom/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: 'Hacked' }),
        })
      ).status
    ).toBe(404);
    expect((await req(cookieB, `/api/reports/custom/${id}`, { method: 'DELETE' })).status).toBe(
      404
    );

    // The owner's report is untouched.
    const still = await body(await req(cookieA, `/api/reports/custom/${id}`));
    expect(still.name).toBe('Mine');
  });

  it('persists in D1 and /saved lists only the requesting user reports', async () => {
    await req(cookieA, '/api/reports/save', {
      method: 'POST',
      body: JSON.stringify({ name: 'A-report', params: { x: 1 } }),
    });
    await req(cookieB, '/api/reports/save', {
      method: 'POST',
      body: JSON.stringify({ name: 'B-report' }),
    });

    const savedA = (await body(await req(cookieA, '/api/reports/saved'))) as {
      reports: Array<{ name: string }>;
    };
    expect(savedA.reports.map((r) => r.name)).toEqual(['A-report']);
    const savedB = (await body(await req(cookieB, '/api/reports/saved'))) as {
      reports: Array<{ name: string }>;
    };
    expect(savedB.reports.map((r) => r.name)).toEqual(['B-report']);
  });
});
