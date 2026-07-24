import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

let cookie = '';

beforeEach(async () => {
  for (const table of ['bills', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (60, 'bills@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (600, 60, 'Main')"),
  ]);
  cookie = (await issueSessionCookie(60, 'password', env)).split(';')[0];
});

function request(path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown) {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': '600',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('bill Autopay persistence', () => {
  it('round-trips Autopay through create, list, update, and get', async () => {
    const create = await request('/api/bills', 'POST', {
      name: 'Electricity',
      amount: 50,
      frequency: 'monthly',
      dueDate: '2026-08-15',
      autopay: true,
    });
    expect(create.status).toBe(200);
    const { id } = (await create.json()) as { id: number };

    const list = await request('/api/bills', 'GET');
    expect(list.status).toBe(200);
    expect(((await list.json()) as Array<{ autopay: boolean }>)[0]?.autopay).toBe(true);

    const update = await request(`/api/bills/${id}`, 'PUT', { autopay: false });
    expect(update.status).toBe(200);

    const get = await request(`/api/bills/${id}`, 'GET');
    expect(get.status).toBe(200);
    expect(((await get.json()) as { autopay: boolean }).autopay).toBe(false);
  });

  it('does not clear unrelated fields during a partial Autopay update', async () => {
    const create = await request('/api/bills', 'POST', {
      name: 'Hosting',
      amount: 20,
      frequency: 'yearly',
      dueDate: '2026-09-20',
      notes: 'Production service',
      autopay: false,
    });
    const { id } = (await create.json()) as { id: number };

    await request(`/api/bills/${id}`, 'PUT', { autopay: true });
    const bill = (await (await request(`/api/bills/${id}`, 'GET')).json()) as Record<
      string,
      unknown
    >;

    expect(bill).toMatchObject({
      name: 'Hosting',
      amount: 20,
      frequency: 'yearly',
      due_date: '2026-09-20',
      notes: 'Production service',
      autopay: true,
    });
  });
});
