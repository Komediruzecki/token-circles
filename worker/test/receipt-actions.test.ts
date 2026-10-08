import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

// The four receipt actions: POST /api/receipts/:id/categorize, /export, /share and /split. They are
// stubs (worker/src/routes/receipts.ts): each answers success for a receipt of the active profile
// and changes nothing, and nothing serves the URLs that share and export answer. Nothing in the
// app sends them (WORKER_ONLY in shared/contract/routes.ts). This pins them as they are, so that
// a change to what they do is a decision made in a diff rather than found later.

const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  ),
  (ch) => ch.charCodeAt(0)
);

let cookie = '';
let otherCookie = '';

/** The four actions' paths for one receipt. */
const actions = (id: number) => ({
  categorize: `/api/receipts/${id}/categorize`,
  export: `/api/receipts/${id}/export`,
  share: `/api/receipts/${id}/share`,
  split: `/api/receipts/${id}/split`,
});

function post(path: string, session = cookie, body?: unknown) {
  return SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: {
      Cookie: session,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function upload(): Promise<number> {
  const form = new FormData();
  form.append('receipt', new File([PNG], 'lunch.png', { type: 'image/png' }));
  form.append('transaction_id', '9501');
  const res = await SELF.fetch('https://example.com/api/receipts/upload', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

/** The receipt's row and its transaction's, to show an action left both as they were. */
async function rows(receiptId: number) {
  return {
    receipt: await env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(receiptId).first(),
    transaction: await env.DB.prepare('SELECT * FROM transactions WHERE id = 9501').first(),
  };
}

beforeEach(async () => {
  for (const table of ['receipts', 'transactions', 'categories', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (95, 'receipts@example.com', 'password', 1, 'basic')"
    ),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (96, 'someone@example.com', 'password', 1, 'basic')"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (950, 95, 'Main')"),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (960, 96, 'Main')"),
    env.DB.prepare(
      "INSERT INTO transactions (id, profile_id, description, amount, type, date) VALUES (9501, 950, 'Lunch', 12.5, 'expense', '2026-07-01')"
    ),
  ]);
  cookie = (await issueSessionCookie(95, 'password', env)).split(';')[0];
  otherCookie = (await issueSessionCookie(96, 'password', env)).split(';')[0];
});

describe('the receipt actions', () => {
  it('each answers success for a receipt of the active profile, and changes nothing', async () => {
    const id = await upload();
    const before = await rows(id);

    const answers: Record<string, unknown> = {};
    for (const [action, path] of Object.entries(actions(id))) {
      const res = await post(
        path,
        cookie,
        action === 'categorize' ? { category: 'Food' } : undefined
      );
      expect(res.status, action).toBe(200);
      answers[action] = await res.json();
    }
    expect(answers).toEqual({
      categorize: { ok: true, category: 'Food', message: 'Receipt categorized successfully' },
      export: {
        ok: true,
        exportUrl: `/receipts/export/${id}`,
        message: 'Receipt exported successfully',
      },
      share: {
        ok: true,
        shareUrl: `/receipts/shared/${id}`,
        message: 'Receipt shared successfully',
      },
      split: { ok: true, splits: [], message: 'Receipt split successfully' },
    });
    // Categorize with no category names the stand-in.
    expect(await (await post(actions(id).categorize)).json()).toMatchObject({
      category: 'Uncategorized',
    });

    expect(await rows(id)).toEqual(before);
  });

  it("finds no receipt of another account's, and none that is missing", async () => {
    const id = await upload();
    const missing = actions(id + 1000);
    for (const [action, path] of Object.entries(actions(id))) {
      expect((await post(path, otherCookie)).status, `${action}, another account`).toBe(404);
      expect(
        (await post(missing[action as keyof typeof missing])).status,
        `${action}, no receipt`
      ).toBe(404);
    }
  });
});
