import { createExecutionContext, env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/index';
import { issueSessionCookie } from '../src/auth';

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
  // Storage bookkeeping (receipts.enc) never reaches a response.
  expect(receipt).not.toHaveProperty('enc');
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
  cookie = (await issueSessionCookie(70, 'password', env)).split(';')[0];
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
    const otherCookie = (await issueSessionCookie(71, 'password', env)).split(';')[0];

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

// Forced on, whatever mode the suite runs in. Users 56100-56199 only ever go through KEYED: a user
// who got a key here and was then read through SELF in a keyless run would get a 503 by design.
describe('receipts with field encryption on', () => {
  const K = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const KEYED = { ...env, DATA_KEK_1: K };
  const TCE1 = [0x54, 0x43, 0x45, 0x31];

  async function seedUser(userId: number, plan: string): Promise<string> {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, ?, 'password', 1, ?)"
      ).bind(userId, `sealed-${userId}@example.com`, plan),
      env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
        userId,
        userId
      ),
      env.DB.prepare(
        "INSERT INTO transactions (id, profile_id, description, amount, type, date) VALUES (?, ?, 'Lunch', 12.5, 'expense', '2026-07-01')"
      ).bind(userId, userId),
    ]);
    return (await issueSessionCookie(userId, 'password', env)).split(';')[0];
  }

  function keyed(userId: number, userCookie: string, path: string, init: RequestInit = {}) {
    return app.fetch(
      new Request(`https://example.com${path}`, {
        ...init,
        headers: { Cookie: userCookie, 'X-Profile-Id': String(userId), ...(init.headers || {}) },
      }),
      KEYED,
      createExecutionContext()
    );
  }

  async function keyedUpload(userId: number, userCookie: string, name: string) {
    const form = new FormData();
    form.append('receipt', new File([PNG], name, { type: 'image/png' }));
    form.append('transaction_id', String(userId));
    const res = await keyed(userId, userCookie, '/api/receipts/upload', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(201);
    return (await res.json()) as Record<string, unknown>;
  }

  // basic caps receipts per profile (the conditional INSERT); ultimate has no cap (db.insert).
  for (const [userId, plan] of [
    [56100, 'basic'],
    [56101, 'ultimate'],
  ] as const) {
    it(`seals the stored object and serves it opened (${plan} plan)`, async () => {
      const userCookie = await seedUser(userId, plan);
      const receipt = await keyedUpload(userId, userCookie, 'lunch.png');
      expect(receipt).not.toHaveProperty('enc');
      expect(receipt.file_size).toBe(PNG.length);
      expect(receipt.file_type).toBe('image/png');

      const row = await env.DB.prepare(
        'SELECT enc, storage_path, file_size FROM receipts WHERE id = ?'
      )
        .bind(receipt.id)
        .first<{ enc: number; storage_path: string; file_size: number }>();
      expect(row).toMatchObject({ enc: 1, file_size: PNG.length });
      const stored = new Uint8Array(
        await (await env.RECEIPTS!.get(row!.storage_path))!.arrayBuffer()
      );
      expect(Array.from(stored.subarray(0, 4))).toEqual(TCE1);
      expect(stored.length).toBeGreaterThan(PNG.length);

      for (const path of [
        `/api/receipts/${receipt.id}/file`,
        `/api/receipts/file/${encodeURIComponent(String(receipt.filename))}`,
      ]) {
        const res = await keyed(userId, userCookie, path);
        expect(res.status, path).toBe(200);
        expect(res.headers.get('Content-Type'), path).toBe('image/png');
        expect(new Uint8Array(await res.arrayBuffer()), path).toEqual(PNG);
      }

      for (const path of [
        '/api/receipts',
        `/api/receipts/${receipt.id}`,
        `/api/receipts/transaction/${userId}`,
      ]) {
        const res = await keyed(userId, userCookie, path);
        expect(res.status, path).toBe(200);
        const body = (await res.json()) as Record<string, unknown> | Record<string, unknown>[];
        for (const r of Array.isArray(body) ? body : [body])
          expect(r, path).not.toHaveProperty('enc');
      }
    });
  }

  it('serves a plaintext object and a sealed one side by side', async () => {
    const userId = 56102;
    const userCookie = await seedUser(userId, 'basic');
    // A receipt stored before the user had a key: raw bytes, enc 0, its own content type.
    const legacy = new Uint8Array([9, 8, 7, 6, 5]);
    await env.RECEIPTS!.put(`${userId}/legacy.pdf`, legacy, {
      httpMetadata: { contentType: 'application/pdf' },
    });
    const { meta } = await env.DB.prepare(
      `INSERT INTO receipts (transaction_id, filename, original_name, file_type, file_size, storage_path, profile_id, enc)
       VALUES (NULL, ?, 'legacy.pdf', 'application/pdf', ?, ?, ?, 0)`
    )
      .bind(`${userId}/legacy.pdf`, legacy.length, `${userId}/legacy.pdf`, userId)
      .run();
    const sealed = await keyedUpload(userId, userCookie, 'new.png');

    const plainRes = await keyed(userId, userCookie, `/api/receipts/${meta.last_row_id}/file`);
    expect(plainRes.status).toBe(200);
    expect(plainRes.headers.get('Content-Type')).toBe('application/pdf');
    expect(new Uint8Array(await plainRes.arrayBuffer())).toEqual(legacy);

    const sealedRes = await keyed(
      userId,
      userCookie,
      `/api/receipts/file/${encodeURIComponent(String(sealed.filename))}`
    );
    expect(sealedRes.status).toBe(200);
    expect(new Uint8Array(await sealedRes.arrayBuffer())).toEqual(PNG);
  });
});
