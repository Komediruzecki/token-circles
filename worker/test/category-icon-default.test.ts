/**
 * A blank category icon is stored as the default ('tag'), on an edit as on a create.
 *
 * The Categories form sends `icon: null` once its icon field is emptied, on Add and on Edit. A
 * create already stored 'tag' for it. An edit wrote the null straight into `icon TEXT NOT NULL`,
 * so it failed with a 500 that carried the raw D1 constraint message to the client.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { sessionCookie } from './helpers/session';

const USER = 9301;
const PROFILE = 93010;
const FOOD = 930101;
let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM categories WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'icon-default@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)').bind(
      PROFILE,
      USER,
      'Icons'
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon) VALUES (?, ?, 'Food', 'expense', '#6e9bff', 'food')"
    ).bind(FOOD, PROFILE),
  ]);
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0];
});

function call(method: string, path: string, body?: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(PROFILE),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function storedIcon(id: number): Promise<unknown> {
  const row = await env.DB.prepare('SELECT icon FROM categories WHERE id = ?').bind(id).first<{
    icon: unknown;
  }>();
  return row?.icon;
}

/** What the Categories form sends on Save. */
const form = (icon: string | null) => ({ name: 'Food', type: 'expense', color: '#6e9bff', icon });

describe('a blank category icon', () => {
  it('on an edit that clears it, is stored as the default', async () => {
    const res = await call('PUT', `/api/categories/${FOOD}`, form(null));

    expect(res.status).toBe(200);
    expect(await storedIcon(FOOD)).toBe('tag');
  });

  it('on an edit that sends it empty, is stored as the default', async () => {
    const res = await call('PUT', `/api/categories/${FOOD}`, form(''));

    expect(res.status).toBe(200);
    expect(await storedIcon(FOOD)).toBe('tag');
  });

  it('is left alone by an edit that does not send one', async () => {
    const res = await call('PUT', `/api/categories/${FOOD}`, { name: 'Groceries' });

    expect(res.status).toBe(200);
    expect(await storedIcon(FOOD)).toBe('food');
  });

  it('on a create, is stored as the default, and the answer says so', async () => {
    for (const [name, icon] of [
      ['Rent', null],
      ['Fuel', ''],
    ] as const) {
      const res = await call('POST', '/api/categories', { ...form(icon), name });
      expect(res.status).toBe(200);
      const created = (await res.json()) as { id: number; icon: unknown };
      expect(created.icon).toBe('tag');
      expect(await storedIcon(created.id)).toBe('tag');
    }
  });
});
