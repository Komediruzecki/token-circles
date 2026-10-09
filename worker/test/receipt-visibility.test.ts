import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';

// Receipt visibility: the transactions list must expose receipt_id/receipt_name (the
// table's chip renders from them — they used to be missing entirely), and the file must
// be fetchable by receipt id at /api/receipts/:id/file (the path the frontend client
// uses; only the /file/:filename variant existed before).

const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  ),
  (ch) => ch.charCodeAt(0)
);

let cookie = '';

async function uploadReceipt(transactionId: number, name: string): Promise<number> {
  const form = new FormData();
  form.append('receipt', new File([PNG], name, { type: 'image/png' }));
  form.append('transaction_id', String(transactionId));
  const res = await SELF.fetch('https://example.com/api/receipts/upload', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });
  expect(res.status).toBe(201);
  const receipt = (await res.json()) as { id: number };
  return receipt.id;
}

beforeEach(async () => {
  for (const t of ['receipts', 'transactions', 'categories', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (70, 'receipt@example.com', 'password', 1, 'basic')"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (700, 70, 'Main')"),
    env.DB.prepare(
      "INSERT INTO transactions (id, profile_id, description, amount, type, date) VALUES (7001, 700, 'Lunch', 12.5, 'expense', '2026-07-01')"
    ),
  ]);
  cookie = (await sessionCookie(70, 'password', env)).split(';')[0];
});

describe('receipt visibility', () => {
  it('transactions list exposes receipt_id and receipt_name after upload', async () => {
    const receiptId = await uploadReceipt(7001, 'lunch-receipt.png');

    const res = await SELF.fetch('https://example.com/api/transactions', {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows?: unknown[] } | unknown[];
    const rows = (Array.isArray(body) ? body : (body.rows ?? [])) as Record<string, unknown>[];
    const lunch = rows.find((t) => t.id === 7001);
    expect(lunch).toBeDefined();
    expect(lunch!.receipt_id).toBe(receiptId);
    expect(lunch!.receipt_name).toBe('lunch-receipt.png');
  });

  it('serves the file at /api/receipts/:id/file (the path the frontend uses)', async () => {
    const receiptId = await uploadReceipt(7001, 'lunch-receipt.png');

    const res = await SELF.fetch(`https://example.com/api/receipts/${receiptId}/file`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes).toEqual(PNG);
  });

  it('does not serve another user receipt by id', async () => {
    const receiptId = await uploadReceipt(7001, 'lunch-receipt.png');
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (71, 'other@example.com', 'password', 1, 'basic')"
      ),
      env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (701, 71, 'Main')"),
    ]);
    const otherCookie = (await sessionCookie(71, 'password', env)).split(';')[0];

    const res = await SELF.fetch(`https://example.com/api/receipts/${receiptId}/file`, {
      headers: { Cookie: otherCookie },
    });
    expect(res.status).toBe(404);
  });

  it('re-upload replaces the previous receipt (list stays 1 row per transaction)', async () => {
    await uploadReceipt(7001, 'first.png');
    const secondId = await uploadReceipt(7001, 'second.png');

    const res = await SELF.fetch('https://example.com/api/transactions', {
      headers: { Cookie: cookie },
    });
    const body = (await res.json()) as { rows?: unknown[] } | unknown[];
    const rows = (Array.isArray(body) ? body : (body.rows ?? [])) as Record<string, unknown>[];
    const lunchRows = rows.filter((t) => t.id === 7001);
    expect(lunchRows).toHaveLength(1);
    expect(lunchRows[0].receipt_id).toBe(secondId);
    expect(lunchRows[0].receipt_name).toBe('second.png');
  });
});
