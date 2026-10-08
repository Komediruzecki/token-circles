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
 * - An edit never refuses a value the row already holds. Rows saved under the older, looser rules
 *   (a 3-digit or named color, a name over 100 characters, two names that differ only in case)
 *   stay editable, though the forms send every field they show on every save.
 * - A parent from another profile is a 400 naming `parent_id`, as local-first answers it. It was a
 *   403 with no field.
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
// Rows saved under the older rules, which the route used to store and now refuses on a create.
const FUEL = 981105; // a 3-digit color
const GIFTS = 981106; // a named color
const ALLOTMENT = 981107; // a name over 100 characters
const COFFEE = 981108; // "Coffee" and "coffee": two names that differ only in case
const COFFEE_LOWER = 981109;
const SAVINGS = 981112; // a type the app cannot read
const KIDS = 981113; // a parent in another profile
const PADDED = 981114; // a name over 100 characters, stored with a trailing space
const SPACES = 981115; // a name of nothing but spaces
const GYM = 981116; // "Gym " with a trailing space
// A second profile of the same user, and a category in it.
const OTHER_PROFILE = 98111;
const ELSEWHERE = 981110;
const LONG_NAME = 'Allotment '.repeat(12).trim();
const PADDED_NAME = 'Garden '.repeat(16);
const PARENT = 'Choose a parent category from the list, or leave it empty.';
let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM categories WHERE profile_id IN (?, ?)').bind(
      PROFILE,
      OTHER_PROFILE
    ),
    env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?)').bind(PROFILE, OTHER_PROFILE),
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
    env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)').bind(
      OTHER_PROFILE,
      USER,
      'Elsewhere'
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon) VALUES (?, ?, 'Elsewhere', 'expense', '#6e9bff', 'tag')"
    ).bind(ELSEWHERE, OTHER_PROFILE),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon) VALUES (?, ?, 'Fuel', 'expense', '#fff', 'car')"
    ).bind(FUEL, PROFILE),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon) VALUES (?, ?, 'Gifts', 'expense', 'red', 'tag')"
    ).bind(GIFTS, PROFILE),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon) VALUES (?, ?, ?, 'expense', '#6e9bff', 'tag')"
    ).bind(ALLOTMENT, PROFILE, LONG_NAME),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon) VALUES (?, ?, 'Coffee', 'expense', '#6e9bff', 'coffee')"
    ).bind(COFFEE, PROFILE),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon) VALUES (?, ?, 'coffee', 'expense', '#f0a860', 'coffee')"
    ).bind(COFFEE_LOWER, PROFILE),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon) VALUES (?, ?, 'Savings', 'savings', '#59d2a2', 'tag')"
    ).bind(SAVINGS, PROFILE),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon, parent_id) VALUES (?, ?, 'Kids', 'expense', '#e0708a', 'tag', ?)"
    ).bind(KIDS, PROFILE, ELSEWHERE),
    // Names as older versions stored them: as typed, stray spaces and all.
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon) VALUES (?, ?, ?, 'expense', '#6e9bff', 'tag')"
    ).bind(PADDED, PROFILE, PADDED_NAME),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon) VALUES (?, ?, '   ', 'expense', '#6e9bff', 'tag')"
    ).bind(SPACES, PROFILE),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon) VALUES (?, ?, 'Gym ', 'expense', '#e0708a', 'tag')"
    ).bind(GYM, PROFILE),
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
    const before = await namesInProfile();

    const body = await refusal(await call('POST', '/api/categories', { name: '   ' }));

    expect(body.fields).toEqual({ name: 'Give the category a name.' });
    expect(body.error).toBe('Give the category a name.');
    expect(await namesInProfile()).toEqual(before);
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
    const before = await namesInProfile();

    const body = await refusal(await call('POST', '/api/categories', { name: ' food ' }));

    expect(body.fields).toEqual({
      name: 'You already have a category called "Food". Choose another name.',
    });
    expect(await namesInProfile()).toEqual(before);
  });

  it('with nothing but a name stores the defaults', async () => {
    const res = await call('POST', '/api/categories', { name: ' Tea ', icon: null, color: '' });

    expect(res.status).toBe(200);
    const created = (await res.json()) as { id: number; name: string };
    expect(created.name).toBe('Tea');
    expect(await stored(created.id)).toEqual({
      name: 'Tea',
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
      name: 'You already have a category called "Rent". Choose another name.',
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

describe('a parent from another profile', () => {
  it('is refused on a create, at parent_id, as local-first refuses it', async () => {
    const before = await namesInProfile();

    const body = await refusal(
      await call('POST', '/api/categories', { name: 'Snacks', parent_id: ELSEWHERE })
    );

    expect(body.fields).toEqual({ parent_id: PARENT });
    expect(await namesInProfile()).toEqual(before);
  });

  it('is refused on an edit, at parent_id, and the parent is kept', async () => {
    const body = await refusal(
      await call('PUT', `/api/categories/${FOOD}`, { parent_id: ELSEWHERE })
    );

    expect(body.fields).toEqual({ parent_id: PARENT });
    expect((await stored(FOOD))?.parent_id).toBe(HOUSING);
  });
});

describe('editing a row saved under older rules', () => {
  // Every body here is what the edit dialogs send on Save: the four fields they show, the ones
  // the person did not touch sent back as the row holds them.
  it('sends a 3-digit color back unchanged, and the new name saves', async () => {
    const res = await call('PUT', `/api/categories/${FUEL}`, {
      name: 'Fuel and parking',
      type: 'expense',
      color: '#fff',
      icon: 'car',
    });

    expect(res.status).toBe(200);
    expect(await stored(FUEL)).toMatchObject({ name: 'Fuel and parking', color: '#fff' });
  });

  it('sends a named color back unchanged, and the new icon saves', async () => {
    const res = await call('PUT', `/api/categories/${GIFTS}`, {
      name: 'Gifts',
      type: 'expense',
      color: 'red',
      icon: 'gift',
    });

    expect(res.status).toBe(200);
    expect(await stored(GIFTS)).toMatchObject({ color: 'red', icon: 'gift' });
  });

  it('sends a name over 100 characters back unchanged, and the new color saves', async () => {
    const res = await call('PUT', `/api/categories/${ALLOTMENT}`, {
      name: LONG_NAME,
      type: 'expense',
      color: '#59d2a2',
      icon: 'tag',
    });

    expect(res.status).toBe(200);
    expect(await stored(ALLOTMENT)).toMatchObject({ name: LONG_NAME, color: '#59d2a2' });
  });

  // The dialogs sent the name back trimmed until they learned to send an untouched name as it
  // came. Without its trailing space this name is under no new rule, but over 100 characters.
  it('takes a name sent back without the space it was stored with as unchanged', async () => {
    const res = await call('PUT', `/api/categories/${PADDED}`, {
      name: PADDED_NAME.trim(),
      type: 'expense',
      color: '#59d2a2',
      icon: 'tag',
    });

    expect(res.status).toBe(200);
    expect(await stored(PADDED)).toMatchObject({ name: PADDED_NAME, color: '#59d2a2' });
  });

  it('takes a blank name sent back for a name of spaces as unchanged', async () => {
    const res = await call('PUT', `/api/categories/${SPACES}`, {
      name: '',
      type: 'expense',
      color: '#59d2a2',
      icon: 'tag',
    });

    expect(res.status).toBe(200);
    expect(await stored(SPACES)).toMatchObject({ name: '   ', color: '#59d2a2' });
  });

  it('sends a type the app cannot read back unchanged, and the new name saves', async () => {
    const res = await call('PUT', `/api/categories/${SAVINGS}`, {
      name: 'Savings pot',
      type: 'savings',
      color: '#59d2a2',
      icon: 'tag',
    });

    expect(res.status).toBe(200);
    expect(await stored(SAVINGS)).toMatchObject({ name: 'Savings pot', type: 'savings' });
  });

  it('keeps its name beside another that differs only in case', async () => {
    const res = await call('PUT', `/api/categories/${COFFEE_LOWER}`, {
      name: 'coffee',
      type: 'expense',
      color: '#59d2a2',
      icon: 'coffee',
    });

    expect(res.status).toBe(200);
    expect(await stored(COFFEE_LOWER)).toMatchObject({ name: 'coffee', color: '#59d2a2' });
  });

  it('renames itself in case alone, beside another of that name', async () => {
    const res = await call('PUT', `/api/categories/${COFFEE_LOWER}`, {
      name: 'Coffee',
      type: 'expense',
      color: '#f0a860',
      icon: 'coffee',
    });

    expect(res.status).toBe(200);
    expect((await stored(COFFEE_LOWER))?.name).toBe('Coffee');
  });

  it('sends a parent from another profile back unchanged', async () => {
    const res = await call('PUT', `/api/categories/${KIDS}`, {
      name: 'Children',
      parent_id: ELSEWHERE,
    });

    expect(res.status).toBe(200);
    expect(await stored(KIDS)).toMatchObject({ name: 'Children', parent_id: ELSEWHERE });
  });

  // A form field holds text, so a parent can come back as "981110" rather than 981110.
  it('sends that parent back as the string a form field holds, and it is still unchanged', async () => {
    const res = await call('PUT', `/api/categories/${KIDS}`, {
      name: 'Children',
      parent_id: String(ELSEWHERE),
    });

    expect(res.status).toBe(200);
    expect(await stored(KIDS)).toMatchObject({ name: 'Children', parent_id: ELSEWHERE });
  });

  it('still checks a value the edit changes', async () => {
    const body = await refusal(
      await call('PUT', `/api/categories/${FUEL}`, { name: 'Fuel', color: '#ffff' })
    );

    expect(body.fields).toEqual({ color: "That color can't be used. Pick another one." });
    expect((await stored(FUEL))?.color).toBe('#fff');
  });

  it('still refuses a rename onto another category, whatever its case', async () => {
    const body = await refusal(
      await call('PUT', `/api/categories/${FUEL}`, { name: 'COFFEE', color: '#fff' })
    );

    expect(body.fields).toEqual({
      name: 'You already have a category called "Coffee". Choose another name.',
    });
  });

  it('quotes a taken name without the stray space it was stored with', async () => {
    const body = await refusal(await call('PUT', `/api/categories/${RENT}`, { name: 'gym' }));

    expect(body.fields).toEqual({
      name: 'You already have a category called "Gym". Choose another name.',
    });
  });
});
