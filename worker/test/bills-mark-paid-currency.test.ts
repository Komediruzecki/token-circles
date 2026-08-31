/**
 * Mark-paid writes a real transaction, and transactions carry a currency. The INSERT used to
 * omit it, so the schema default ('USD', 0001_init.sql) stamped every mark-paid transaction as
 * dollars — an EUR user then saw a "converted from USD" estimate on a bill they entered in
 * euros. The bill amount is in the profile's base currency by construction (there is no
 * currency field on a bill), so the transaction must say so: currency = configured base,
 * amount_local = amount.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

let cookie = '';

beforeEach(async () => {
  for (const table of ['transactions', 'bills', 'settings', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (61, 'paid@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (610, 61, 'Main')"),
  ]);
  cookie = (await issueSessionCookie(61, 'password', env)).split(';')[0];
});

function request(path: string, method: 'GET' | 'POST', body?: unknown) {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': '610',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createBill(): Promise<number> {
  const res = await request('/api/bills', 'POST', {
    name: 'Rent',
    amount: 918.81,
    frequency: 'monthly',
    dueDate: '2026-08-01',
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: number }).id;
}

const paidTransaction = () =>
  env.DB.prepare(
    'SELECT currency, amount, amount_local FROM transactions WHERE profile_id = 610'
  ).first<{ currency: string; amount: number; amount_local: number | null }>();

describe('mark-paid transaction currency', () => {
  it("uses the profile's configured base currency, not the schema's USD default", async () => {
    await env.DB.prepare(
      "INSERT INTO settings (key, value, profile_id) VALUES ('currency', 'EUR', 610)"
    ).run();
    const id = await createBill();

    const res = await request(`/api/bills/${id}/mark-paid`, 'POST', {});
    expect(res.status).toBe(200);

    const tx = await paidTransaction();
    expect(tx?.currency).toBe('EUR');
    // amount_local is the base-currency value; equal to amount means "no conversion happened",
    // which is what suppresses the converted-from-USD estimate badge in the app.
    expect(tx?.amount_local).toBe(tx?.amount);
  });

  it('falls back to EUR when the profile never persisted a currency setting', async () => {
    // Same default the recurring cron uses; anything is better than silently minting USD.
    const id = await createBill();
    const res = await request(`/api/bills/${id}/mark-paid`, 'POST', {});
    expect(res.status).toBe(200);
    expect((await paidTransaction())?.currency).toBe('EUR');
  });
});
