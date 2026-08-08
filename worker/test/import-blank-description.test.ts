/**
 * Parity cover: a row with no description must import on the Worker path too.
 *
 * The Worker has always accepted these; the IndexedDB path rejected them, so the same Google
 * Sheet imported clean in the cloud and silently lost 291 rows locally. The local check is gone
 * — this pins the Worker side of that contract so the rule cannot reappear here either.
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
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (97, 'blankdesc@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (970, 97, 'Main')"),
  ]);
  cookie = (await issueSessionCookie(97, 'password', env)).split(';')[0];
});

function execute(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch('https://example.com/api/import/execute', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': '970',
    },
    body: JSON.stringify(body),
  });
}

describe('Worker import accepts rows without a description', () => {
  it('imports a blank-description row and keeps described ones', async () => {
    const response = await execute({
      rows: [
        { date: '07/02/2026', description: '', amount: '1', category: 'Restaurant' },
        { date: '05/02/2026', description: 'Konzum', amount: '135.93', category: 'Groceries' },
      ],
      mapping: {
        date: 'date',
        description: 'description',
        amount: 'amount',
        category: 'category',
      },
      dry_run: false,
    });
    const body = (await response.json()) as {
      imported: number;
      skipped_items: Array<{ reason: string }>;
    };
    expect(response.status).toBe(200);
    expect(body.skipped_items ?? []).toEqual([]);
    expect(body.imported).toBe(2);

    const stored = await env.DB.prepare(
      'SELECT date, description FROM transactions WHERE profile_id = 970 ORDER BY date'
    ).all();
    expect(stored.results).toEqual([
      { date: '2026-02-05', description: 'Konzum' },
      { date: '2026-02-07', description: '' },
    ]);
  });
});
