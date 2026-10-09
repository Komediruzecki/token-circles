/**
 * An edit of a category changes what it sends, and keeps every stored field it leaves out.
 *
 * The Categories and Budgets edit forms send `{ name, type, color, icon }`, and their colour
 * swatches send `{ color }` alone. PUT /api/categories/:id set `parent_id` to null and
 * `tax_deductible` to 0 whenever the body left them out, so every edit made in cloud mode lost the
 * category's parent and its tax-deductible flag, which the tax reports read.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { sessionCookie } from './helpers/session';

const USER = 9303;
const PROFILE = 93030;
const OTHER = 93031;
const HEALTH = 930301;
const PHARMACY = 930302;
const ELSEWHERE = 930311;
let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM categories WHERE profile_id IN (?, ?)').bind(PROFILE, OTHER),
    env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?)').bind(PROFILE, OTHER),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'category-edit@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)').bind(
      PROFILE,
      USER,
      'Personal'
    ),
    env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)').bind(
      OTHER,
      USER,
      'Family'
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon) VALUES (?, ?, 'Health', 'expense', '#22c55e', 'heart')"
    ).bind(HEALTH, PROFILE),
    // A subcategory of Health, and tax deductible.
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon, parent_id, tax_deductible) VALUES (?, ?, 'Pharmacy', 'expense', '#0ea5e9', 'pill', ?, 1)"
    ).bind(PHARMACY, PROFILE, HEALTH),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon) VALUES (?, ?, 'Elsewhere', 'expense', '#6e9bff', 'tag')"
    ).bind(ELSEWHERE, OTHER),
  ]);
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0];
});

function put(id: number, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com/api/categories/${id}`, {
    method: 'PUT',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(PROFILE),
    },
    body: JSON.stringify(body),
  });
}

async function stored(id: number) {
  return env.DB.prepare(
    'SELECT name, color, icon, type, parent_id, tax_deductible FROM categories WHERE id = ?'
  )
    .bind(id)
    .first<Record<string, unknown>>();
}

/** What the Categories and Budgets forms send on Save (handleSubmit, handleCatSubmit). */
const formBody = {
  name: 'Pharmacy & drugstore',
  type: 'expense',
  color: '#0284c7',
  icon: 'pill',
};

describe('editing a category', () => {
  it('with the edit form, keeps its parent and its tax-deductible flag', async () => {
    const res = await put(PHARMACY, formBody);

    expect(res.status).toBe(200);
    expect(await stored(PHARMACY)).toEqual({
      name: 'Pharmacy & drugstore',
      color: '#0284c7',
      icon: 'pill',
      type: 'expense',
      parent_id: HEALTH,
      tax_deductible: 1,
    });
  });

  it('with a colour swatch, changes the colour alone', async () => {
    const res = await put(PHARMACY, { color: '#f97316' });

    expect(res.status).toBe(200);
    expect(await stored(PHARMACY)).toEqual({
      name: 'Pharmacy',
      color: '#f97316',
      icon: 'pill',
      type: 'expense',
      parent_id: HEALTH,
      tax_deductible: 1,
    });
  });

  it('still clears the parent and the flag when the body says so', async () => {
    const res = await put(PHARMACY, { ...formBody, parent_id: null, tax_deductible: false });

    expect(res.status).toBe(200);
    expect(await stored(PHARMACY)).toMatchObject({ parent_id: null, tax_deductible: 0 });
  });

  it('still refuses a parent from another profile, at parent_id', async () => {
    const res = await put(PHARMACY, { ...formBody, parent_id: ELSEWHERE });

    // A 400 that names the field, as local-first answers it (category-refusals.test.ts). It was a
    // 403 with no field.
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      fields: { parent_id: 'Choose a parent category from the list, or leave it empty.' },
    });
    expect(await stored(PHARMACY)).toMatchObject({ name: 'Pharmacy', parent_id: HEALTH });
  });
});
