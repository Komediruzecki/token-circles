/**
 * What the categories routes refuse, and how they say it.
 *
 * A refused body answers 400 `{ error, fields }`: `fields` names each body field that is wrong
 * with a sentence for people, and `error` joins them for a client that cannot place them
 * (shared/refusal.ts). The rules are shared/categorySchema.ts, the same ones local-first runs, so
 * the two runtimes agree on what a category may be:
 *
 * - The name is required on an edit too. It used to be stored blank, or answer a 500 with D1's
 *   constraint text when it was null.
 * - A duplicate is a duplicate whatever its case, on a create and on a rename. The route compared
 *   exactly, on a create only.
 * - Type and color are checked. Any type was stored, including ones the app's read schema then
 *   refused for the whole profile; a color that was not a string answered a 500.
 * - An edit that leaves `tax_deductible` or the parent out leaves them alone. It cleared both.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { issueSessionCookie } from '../src/auth';

const USER = 9811;
const PROFILE = 98110;
const FOOD = 981101;
const RENT = 981102;
const HOUSING = 981103;
const TRANSFERS = 981104;
let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM categories WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'category-refusals@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)').bind(
      PROFILE,
      USER,
      'Refusals'
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon) VALUES (?, ?, 'Housing', 'expense', '#6e9bff', 'home')"
    ).bind(HOUSING, PROFILE),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon, parent_id, tax_deductible) VALUES (?, ?, 'Food', 'expense', '#6e9bff', 'food', ?, 1)"
    ).bind(FOOD, PROFILE, HOUSING),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon) VALUES (?, ?, 'Rent', 'expense', '#f0a860', 'home')"
    ).bind(RENT, PROFILE),
    // What older imports left behind: a category of a type the forms do not offer.
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon) VALUES (?, ?, 'Transfers', 'account', '#59d2a2', 'tag')"
    ).bind(TRANSFERS, PROFILE),
  ]);
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0];
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

interface Stored {
  name: string;
  type: string;
  color: string;
  icon: string;
  parent_id: number | null;
  tax_deductible: number;
}

function stored(id: number): Promise<Stored | null> {
  return env.DB.prepare(
    'SELECT name, type, color, icon, parent_id, tax_deductible FROM categories WHERE id = ?'
  )
    .bind(id)
    .first<Stored>();
}

async function namesInProfile(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'SELECT name FROM categories WHERE profile_id = ? ORDER BY name'
  )
    .bind(PROFILE)
    .all<{ name: string }>();
  return results.map((r) => r.name);
}

/** The refusal body, after checking it is one. */
async function refusal(res: Response): Promise<{ error: string; fields: Record<string, string> }> {
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string; fields: Record<string, string> };
  expect(typeof body.error).toBe('string');
  expect(body.fields).toBeTypeOf('object');
  return body;
}

describe('creating a category', () => {
  it('without a name is refused at the name, in words for people', async () => {
    const body = await refusal(await call('POST', '/api/categories', { name: '   ' }));

    expect(body.fields).toEqual({ name: 'Give the category a name.' });
    expect(body.error).toBe('Give the category a name.');
    expect(await namesInProfile()).toEqual(['Food', 'Housing', 'Rent', 'Transfers']);
  });

  it('names every field that is wrong, and the summary joins them in form order', async () => {
    const body = await refusal(
      await call('POST', '/api/categories', { name: '', type: 'savings', color: 'red' })
    );

    expect(body.fields).toEqual({
      name: 'Give the category a name.',
      type: 'Choose Expense or Income.',
      color: "That color can't be used. Pick another one.",
    });
    expect(body.error).toBe(
      "Give the category a name. Choose Expense or Income. That color can't be used. Pick another one."
    );
  });

  it('with a name over 100 characters is refused', async () => {
    const body = await refusal(await call('POST', '/api/categories', { name: 'x'.repeat(101) }));

    expect(body.fields).toEqual({ name: 'Keep the name to 100 characters or fewer.' });
  });

  it('with a color that is not a string is refused, not a 500', async () => {
    const body = await refusal(await call('POST', '/api/categories', { name: 'Fuel', color: 7 }));

    expect(body.fields).toEqual({ color: "That color can't be used. Pick another one." });
  });

  it('with the name of an existing category in another case is refused at the name', async () => {
    const body = await refusal(await call('POST', '/api/categories', { name: ' food ' }));

    expect(body.fields).toEqual({
      name: 'You already have a category called “Food”. Choose another name.',
    });
    expect(await namesInProfile()).toEqual(['Food', 'Housing', 'Rent', 'Transfers']);
  });

  it('with nothing but a name stores the defaults', async () => {
    const res = await call('POST', '/api/categories', { name: ' Coffee ', icon: null, color: '' });

    expect(res.status).toBe(200);
    const created = (await res.json()) as { id: number; name: string };
    expect(created.name).toBe('Coffee');
    expect(await stored(created.id)).toEqual({
      name: 'Coffee',
      type: 'expense',
      color: '#6b7280',
      icon: 'tag',
      parent_id: null,
      tax_deductible: 0,
    });
  });
});

describe('editing a category', () => {
  it('to a blank name is refused, and the name is kept', async () => {
    const body = await refusal(await call('PUT', `/api/categories/${FOOD}`, { name: '' }));

    expect(body.fields).toEqual({ name: 'Give the category a name.' });
    expect((await stored(FOOD))?.name).toBe('Food');
  });

  it('to a null name is refused at the name, not answered with a 500', async () => {
    const body = await refusal(await call('PUT', `/api/categories/${FOOD}`, { name: null }));

    expect(body.fields).toEqual({ name: 'Give the category a name.' });
  });

  it('to the name of another category is refused at the name', async () => {
    const body = await refusal(await call('PUT', `/api/categories/${FOOD}`, { name: 'RENT' }));

    expect(body.fields).toEqual({
      name: 'You already have a category called “Rent”. Choose another name.',
    });
    expect((await stored(FOOD))?.name).toBe('Food');
  });

  it('to its own name in another case is allowed', async () => {
    const res = await call('PUT', `/api/categories/${FOOD}`, { name: 'FOOD' });

    expect(res.status).toBe(200);
    expect((await stored(FOOD))?.name).toBe('FOOD');
  });

  it('keeps tax deductible and the parent when the body leaves them out', async () => {
    // What the Categories form sends on Save: neither field.
    const res = await call('PUT', `/api/categories/${FOOD}`, {
      name: 'Groceries',
      type: 'expense',
      color: '#59d2a2',
      icon: 'cart',
    });

    expect(res.status).toBe(200);
    expect(await stored(FOOD)).toEqual({
      name: 'Groceries',
      type: 'expense',
      color: '#59d2a2',
      icon: 'cart',
      parent_id: HOUSING,
      tax_deductible: 1,
    });
  });

  it('of a type the forms do not offer is allowed, as it is stored', async () => {
    const res = await call('PUT', `/api/categories/${TRANSFERS}`, {
      name: 'Card payments',
      type: 'account',
      color: '#59d2a2',
      icon: null,
    });

    expect(res.status).toBe(200);
    expect(await stored(TRANSFERS)).toMatchObject({
      name: 'Card payments',
      type: 'account',
      icon: 'tag',
    });
  });

  it('to a type the app cannot read is refused', async () => {
    const body = await refusal(await call('PUT', `/api/categories/${FOOD}`, { type: 'savings' }));

    expect(body.fields).toEqual({ type: 'Choose Expense or Income.' });
    expect((await stored(FOOD))?.type).toBe('expense');
  });

  it('with nothing it can use changes nothing', async () => {
    const res = await call('PUT', `/api/categories/${FOOD}`, { id: FOOD, profile_id: 1 });

    expect(res.status).toBe(200);
    expect(await stored(FOOD)).toEqual({
      name: 'Food',
      type: 'expense',
      color: '#6e9bff',
      icon: 'food',
      parent_id: HOUSING,
      tax_deductible: 1,
    });
  });
});
