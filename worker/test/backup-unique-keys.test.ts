/**
 * A backup is validated before a single row is staged, so a bad file answers 422 naming the
 * problem. Three uniqueness rules were not part of that validation, so a file that broke one got
 * all the way to the INSERT and failed on D1's constraint as a 500:
 *   - tags(name, profile_id) is UNIQUE: two tags with the same name in one profile;
 *   - receipts.transaction_id is UNIQUE: two receipts for one transaction;
 *   - transaction_tags(transaction_id, tag_id) is the PRIMARY KEY: one tag twice on a
 *     transaction, which the browser shape produces from `tag_ids: [1, 1]`.
 * The app never writes such a file, but a backup is a file people keep, edit and merge.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';

const USER_ID = 94;
let cookie = '';

beforeEach(async () => {
  for (const t of [
    'transaction_tags',
    'receipts',
    'transactions',
    'tags',
    'categories',
    'accounts',
    'settings',
    'error_logs',
    'rate_limits',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'restore@example.com', 'password', 1)"
    ).bind(USER_ID),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (940, ?, 'Current')").bind(
      USER_ID
    ),
  ]);
  cookie = (await sessionCookie(USER_ID, 'password', env)).split(';')[0];
});

function backup(over: Record<string, unknown>): Record<string, unknown> {
  return {
    version: '3.0.0',
    profiles: [{ id: 1, name: 'Restored', created_at: '2026-01-01' }],
    transactions: [
      {
        id: 1,
        profile_id: 1,
        description: 'Lunch',
        amount: 10,
        date: '2026-01-01',
        type: 'expense',
        currency: 'EUR',
      },
    ],
    tags: [{ id: 1, profile_id: 1, name: 'work' }],
    ...over,
  };
}

function restore(payload: unknown): Promise<Response> {
  return SELF.fetch('https://example.com/api/import', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': '940' },
    body: JSON.stringify(payload),
  });
}

async function profileNames(): Promise<string[]> {
  const rows = await env.DB.prepare('SELECT name FROM profiles WHERE user_id = ? ORDER BY id')
    .bind(USER_ID)
    .all<{ name: string }>();
  return (rows.results ?? []).map((r) => r.name);
}

describe('restoring a backup that repeats a unique key', () => {
  it('refuses two tags with the same name in one profile', async () => {
    const res = await restore(
      backup({
        tags: [
          { id: 1, profile_id: 1, name: 'work' },
          { id: 2, profile_id: 1, name: 'work' },
        ],
      })
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'Duplicate tag name "work" in profile 1' });
    expect(await profileNames()).toEqual(['Current']);
  });

  it('still restores the same tag name in two different profiles', async () => {
    const res = await restore(
      backup({
        profiles: [
          { id: 1, name: 'Restored' },
          { id: 2, name: 'Second' },
        ],
        tags: [
          { id: 1, profile_id: 1, name: 'work' },
          { id: 2, profile_id: 2, name: 'work' },
        ],
      })
    );
    expect(res.status).toBe(200);
  });

  it('refuses two receipts for one transaction', async () => {
    const file = { content_type: 'image/png', data_base64: btoa('png') };
    const res = await restore(
      backup({
        receipts: [
          {
            id: 1,
            profile_id: 1,
            transaction_id: 1,
            original_name: 'a.png',
            file_type: 'image/png',
          },
          {
            id: 2,
            profile_id: 1,
            transaction_id: 1,
            original_name: 'b.png',
            file_type: 'image/png',
          },
        ],
        receiptFiles: [
          { ...file, receipt_id: 1 },
          { ...file, receipt_id: 2 },
        ],
      })
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'Duplicate receipt for transaction 1' });
    expect(await profileNames()).toEqual(['Current']);
  });

  it('still restores one receipt for the transaction', async () => {
    const res = await restore(
      backup({
        receipts: [
          {
            id: 1,
            profile_id: 1,
            transaction_id: 1,
            original_name: 'a.png',
            file_type: 'image/png',
          },
        ],
        receiptFiles: [{ receipt_id: 1, content_type: 'image/png', data_base64: btoa('png') }],
      })
    );
    expect(res.status).toBe(200);
  });

  it('refuses one tag twice on a transaction, from the browser shape', async () => {
    const res = await restore(
      backup({
        transactions: [
          {
            id: 1,
            profile_id: 1,
            description: 'Lunch',
            amount: 10,
            date: '2026-01-01',
            type: 'expense',
            currency: 'EUR',
            tag_ids: [1, 1],
          },
        ],
      })
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'Duplicate tag 1 on transaction 1' });
    expect(await profileNames()).toEqual(['Current']);
  });
});
