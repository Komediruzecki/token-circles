/**
 * Warnings: rows that import but carry something the user should look at.
 *
 * Parity matters here. The IndexedDB path once rejected rows the Worker accepted, and the same
 * sheet imported clean in the cloud while silently losing 291 rows locally. Both runtimes now run
 * the same shared checks, and both report the same warnings.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

let cookie = '';

beforeEach(async () => {
  for (const table of [
    'transactions',
    'account_balance_history',
    'accounts',
    'categories',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (98, 'warn@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (980, 98, 'Main')"),
  ]);
  cookie = (await issueSessionCookie(98, 'password', env)).split(';')[0];
});

function execute(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch('https://example.com/api/import/execute', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': '980',
    },
    body: JSON.stringify(body),
  });
}

const MAPPING = {
  date: 'date',
  description: 'description',
  amount: 'amount',
  amount_local: 'amount_local',
  category: 'category',
};

describe('Worker import warnings', () => {
  it('imports a rounded amount and says which value it rounded', async () => {
    const response = await execute({
      rows: [
        {
          date: '24/12/2021',
          description: 'BoostIO 11 month pay',
          amount: '5802.4',
          amount_local: '754.312',
          category: 'Passive Income',
        },
      ],
      mapping: MAPPING,
      dry_run: false,
    });
    const body = (await response.json()) as {
      imported: number;
      skipped_items: unknown[];
      warnings: Array<{ index: number; reason: string; label?: string }>;
    };
    expect(response.status).toBe(200);
    expect(body.skipped_items ?? []).toEqual([]);
    expect(body.imported).toBe(1);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]!.reason).toContain('754.312');
    expect(body.warnings[0]!.label).toContain('BoostIO 11 month pay');

    const stored = await env.DB.prepare(
      'SELECT amount_local FROM transactions WHERE profile_id = 980'
    ).all();
    expect(stored.results[0]!.amount_local).toBeCloseTo(754.31, 2);
  });

  it("imports a dateless row as today's date rather than dropping it", async () => {
    const response = await execute({
      rows: [{ date: '', description: 'No date here', amount: '12.00', category: 'Groceries' }],
      mapping: MAPPING,
      dry_run: false,
    });
    const body = (await response.json()) as {
      imported: number;
      skipped_items: unknown[];
      warnings: Array<{ reason: string }>;
    };
    expect(body.skipped_items ?? []).toEqual([]);
    expect(body.imported).toBe(1);
    expect(body.warnings.some((w) => w.reason.includes("today's date"))).toBe(true);

    const stored = await env.DB.prepare(
      'SELECT date FROM transactions WHERE profile_id = 980'
    ).all();
    expect(stored.results[0]!.date).toBe(new Date().toISOString().slice(0, 10));
  });

  it('stays quiet for a clean row', async () => {
    const response = await execute({
      rows: [
        { date: '2026-01-05', description: 'Konzum', amount: '135.93', category: 'Groceries' },
      ],
      mapping: MAPPING,
      dry_run: false,
    });
    const body = (await response.json()) as { imported: number; warnings: unknown[] };
    expect(body.imported).toBe(1);
    expect(body.warnings).toEqual([]);
  });
});
