import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

// Editing a goal 500'd: the PUT bound current_amount (which the edit form doesn't send)
// as undefined, which D1 rejects. The update is now a partial update that only touches
// provided fields, accepts target_date as an alias for the `deadline` column, and stores
// monthly_contribution (migration 0015). Contributions must survive an edit.

let cookie = '';

beforeEach(async () => {
  for (const t of ['savings_goals', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (60, 'goal@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (600, 60, 'Main')"),
    env.DB.prepare(
      "INSERT INTO savings_goals (id, profile_id, name, target_amount, current_amount, deadline, monthly_contribution) VALUES (1, 600, 'Car', 10000, 2500, '2027-01-01', 200)"
    ),
  ]);
  cookie = (await issueSessionCookie(60, 'password', env)).split(';')[0];
});

function put(body: unknown): Promise<Response> {
  return SELF.fetch('https://example.com/api/savings-goals/1', {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': '600' },
    body: JSON.stringify(body),
  });
}
async function goal() {
  return env.DB.prepare('SELECT * FROM savings_goals WHERE id = 1').first<Record<string, any>>();
}

describe('PUT /api/savings-goals/:id', () => {
  it('edits without 500 when the body omits current_amount (the edit-form shape)', async () => {
    const res = await put({
      name: 'New Car',
      target_amount: 12000,
      target_date: '2028-06-01',
      monthly_contribution: 300,
    });
    expect(res.status).toBe(200);
    const g = await goal();
    expect(g!.name).toBe('New Car');
    expect(g!.target_amount).toBe(12000);
    expect(g!.deadline).toBe('2028-06-01'); // target_date mapped to deadline
    expect(g!.monthly_contribution).toBe(300);
    // progress preserved (edit didn't send current_amount)
    expect(g!.current_amount).toBe(2500);
  });

  it('does not wipe the deadline when the edit omits it', async () => {
    await put({ name: 'Renamed' });
    const g = await goal();
    expect(g!.deadline).toBe('2027-01-01');
    expect(g!.current_amount).toBe(2500);
  });

  it('contribute then edit keeps the contributed amount', async () => {
    await SELF.fetch('https://example.com/api/savings-goals/1/contribute', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': '600' },
      body: JSON.stringify({ amount: 500 }),
    });
    expect((await goal())!.current_amount).toBe(3000);
    await put({ name: 'Car v2', target_amount: 15000, target_date: '2027-01-01' });
    expect((await goal())!.current_amount).toBe(3000);
  });

  it('404s for another user', async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, auth_provider, token_version) VALUES (61, 'x@example.com', 'password', 1)"
      ),
      env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (601, 61, 'Main')"),
    ]);
    const other = (await issueSessionCookie(61, 'password', env)).split(';')[0];
    const res = await SELF.fetch('https://example.com/api/savings-goals/1', {
      method: 'PUT',
      headers: { Cookie: other, 'Content-Type': 'application/json', 'X-Profile-Id': '601' },
      body: JSON.stringify({ name: 'hijack' }),
    });
    expect(res.status).toBe(404);
  });
});
