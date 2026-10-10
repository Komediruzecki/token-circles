/**
 * What the tag routes refuse, and how they say it.
 *
 * A refused body answers 400 `{ error, fields }` (shared/refusal.ts), by the rules in
 * shared/tagSchema.ts, which local-first and the Tags page run too. Before:
 *
 * - A blank name was "Tag name is required" with no field; a name of any length, and any colour
 *   at all, was stored.
 * - A duplicate was compared exactly, so "Holiday" and "holiday" were two tags, and was "Tag
 *   already exists" with no field.
 * - A tag sent without a colour took the next of a palette the app shows nowhere (#3b82f6
 *   first), and an edit without one reset it to grey.
 * - Another profile's tag put on a transaction was a 403 with no field.
 * - GET /api/transactions/by-tag/:tagId compared a timestamped row's whole date with the end
 *   date, leaving out the last day's, and answered 500 to an offset without a limit.
 *
 * An edit checks and writes only what it changes, so a tag an older version stored (a long name,
 * a colour like "red") stays editable. The local-first twin:
 * frontend/src/core/storage/__tests__/tagRefusals.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';
import { CONSTELLATION } from '../../shared/palette';
import { TAG_MESSAGES as M } from '../../shared/tagSchema';

const USER = 6571;
const PROFILE = 65710;
const OTHER_USER = 6572;
const OTHER_PROFILE = 65720;
const HOLIDAY = 657101;
const TWIN = 657102; // "holiday": stored before names were compared without case
const OLD = 657103; // a name over 50 characters and the colour "red", stored before the rules
const WORK = 657104;
const ELSEWHERE = 657201;
const FOOD = 657120;
const FIRST = 657110;
const SECOND = 657111;
const THIRD = 657112;
const THEIRS = 657210;
const LONG = 'Weekend trips to the coast with the family '.repeat(2).trim();

let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM transaction_tags WHERE transaction_id IN (SELECT id FROM transactions WHERE profile_id IN (?, ?))'
    ).bind(PROFILE, OTHER_PROFILE),
    env.DB.prepare('DELETE FROM transactions WHERE profile_id IN (?, ?)').bind(
      PROFILE,
      OTHER_PROFILE
    ),
    env.DB.prepare('DELETE FROM tags WHERE profile_id IN (?, ?)').bind(PROFILE, OTHER_PROFILE),
    env.DB.prepare('DELETE FROM categories WHERE profile_id IN (?, ?)').bind(
      PROFILE,
      OTHER_PROFILE
    ),
    env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?)').bind(PROFILE, OTHER_PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(USER, OTHER_USER),
  ]);
  const tag = (id: number, profile: number, name: string, color: string) =>
    env.DB.prepare('INSERT INTO tags (id, profile_id, name, color) VALUES (?, ?, ?, ?)').bind(
      id,
      profile,
      name,
      color
    );
  const spend = (
    id: number,
    profile: number,
    date: string,
    type = 'expense',
    category: number | null = null
  ) =>
    env.DB.prepare(
      "INSERT INTO transactions (id, profile_id, description, amount, type, date, category_id) VALUES (?, ?, 'Ferry', 20, ?, ?, ?)"
    ).bind(id, profile, type, date, category);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'tag-refusals@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'tag-elsewhere@example.com', 'password', 1)"
    ).bind(OTHER_USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Else')").bind(
      OTHER_PROFILE,
      OTHER_USER
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color, icon) VALUES (?, ?, 'Food', 'expense', '#aa5500', 'tag')"
    ).bind(FOOD, PROFILE),
    tag(HOLIDAY, PROFILE, 'Holiday', '#22aa66'),
    tag(TWIN, PROFILE, 'holiday', '#225588'),
    tag(OLD, PROFILE, LONG, 'red'),
    tag(WORK, PROFILE, 'Work', '#aa5500'),
    tag(ELSEWHERE, OTHER_PROFILE, 'Elsewhere', '#000000'),
    spend(FIRST, PROFILE, '2026-03-01', 'expense', FOOD),
    spend(SECOND, PROFILE, '2026-03-31T12:00:00'),
    spend(THIRD, PROFILE, '2026-03-09', 'income'),
    spend(THEIRS, OTHER_PROFILE, '2026-03-02'),
  ]);
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0]!;
});

async function call(method: string, path: string, body?: unknown): Promise<Response> {
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

async function refusal(res: Response): Promise<{ status: number; body: unknown }> {
  return { status: res.status, body: await res.json() };
}

async function stored(id: number): Promise<{ name: string; color: string } | null> {
  return env.DB.prepare('SELECT name, color FROM tags WHERE id = ?').bind(id).first();
}

async function tagCount(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM tags WHERE profile_id = ?')
    .bind(PROFILE)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

const taken = (name: string) => {
  const message = `You already have a tag called "${name}". Choose another name.`;
  return { status: 400, body: { error: message, fields: { name: message } } };
};

describe('POST /api/tags', () => {
  it('refuses a blank name at the field', async () => {
    for (const body of [{}, { name: '' }, { name: '   ' }, { name: 7 }]) {
      expect(await refusal(await call('POST', '/api/tags', body))).toEqual({
        status: 400,
        body: { error: M.name, fields: { name: M.name } },
      });
    }
    expect(await tagCount()).toBe(4);
  });

  it('refuses a name over 50 characters and a colour that is not #RRGGBB', async () => {
    const res = await call('POST', '/api/tags', { name: 'x'.repeat(51), color: 'red' });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.nameLength} ${M.color}`,
        fields: { name: M.nameLength, color: M.color },
      },
    });
    expect(await tagCount()).toBe(4);
  });

  it('refuses a name another tag has in another case, quoting it', async () => {
    expect(await refusal(await call('POST', '/api/tags', { name: ' WORK ' }))).toEqual(
      taken('Work')
    );
    expect(await tagCount()).toBe(4);
  });

  it("takes a name only another profile's tag has", async () => {
    expect((await call('POST', '/api/tags', { name: 'Elsewhere' })).status).toBe(201);
  });

  it('stores what the Tags page sends, trimmed', async () => {
    const res = await call('POST', '/api/tags', { name: ' Groceries ', color: '#225588' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number };
    expect(body).toEqual({ id: expect.any(Number), name: 'Groceries', color: '#225588' });
    expect(await stored(body.id)).toEqual({ name: 'Groceries', color: '#225588' });
  });

  it("gives a tag sent without a colour the one the Tags page offers next: the palette's, by the profile's tag count", async () => {
    const res = await call('POST', '/api/tags', { name: 'Groceries' });
    const { id, color } = (await res.json()) as { id: number; color: string };
    // Four tags of this profile's; the other profile's tag does not count.
    expect(color).toBe(CONSTELLATION[4]);
    expect(await stored(id)).toEqual({ name: 'Groceries', color: CONSTELLATION[4] });
  });
});

describe('PUT /api/tags/:id', () => {
  it('keeps the colour when the edit leaves it out', async () => {
    expect((await call('PUT', `/api/tags/${WORK}`, { name: 'Office' })).status).toBe(200);
    expect(await stored(WORK)).toEqual({ name: 'Office', color: '#aa5500' });
  });

  it('refuses a blank or long name and a colour that is not #RRGGBB, and stores nothing', async () => {
    expect(await refusal(await call('PUT', `/api/tags/${WORK}`, { name: ' ' }))).toEqual({
      status: 400,
      body: { error: M.name, fields: { name: M.name } },
    });
    const long = await call('PUT', `/api/tags/${WORK}`, { name: 'x'.repeat(51), color: '#abc' });
    expect(await refusal(long)).toEqual({
      status: 400,
      body: {
        error: `${M.nameLength} ${M.color}`,
        fields: { name: M.nameLength, color: M.color },
      },
    });
    expect(await stored(WORK)).toEqual({ name: 'Work', color: '#aa5500' });
  });

  it("refuses a rename onto another tag's name in another case, quoting it", async () => {
    const res = await call('PUT', `/api/tags/${WORK}`, { name: 'holiday', color: '#aa5500' });
    expect(await refusal(res)).toEqual(taken('Holiday'));
    expect(await stored(WORK)).toEqual({ name: 'Work', color: '#aa5500' });
  });

  it('lets a tag change the case of its own name, unless a tag has exactly that name', async () => {
    expect((await call('PUT', `/api/tags/${WORK}`, { name: 'WORK' })).status).toBe(200);
    expect(await stored(WORK)).toEqual({ name: 'WORK', color: '#aa5500' });
    const twin = await call('PUT', `/api/tags/${TWIN}`, { name: 'Holiday', color: '#225588' });
    expect(await refusal(twin)).toEqual(taken('Holiday'));
    expect(await stored(TWIN)).toEqual({ name: 'holiday', color: '#225588' });
  });

  it('takes back what an older version stored, and changes what the edit changes', async () => {
    expect((await call('PUT', `/api/tags/${OLD}`, { name: LONG, color: 'red' })).status).toBe(200);
    expect((await call('PUT', `/api/tags/${OLD}`, { name: LONG, color: '#225588' })).status).toBe(
      200
    );
    expect(await stored(OLD)).toEqual({ name: LONG, color: '#225588' });
  });

  it("answers 404 for another profile's tag, and changes nothing", async () => {
    const res = await call('PUT', `/api/tags/${ELSEWHERE}`, { name: 'Mine', color: '#123456' });
    expect(await refusal(res)).toEqual({ status: 404, body: { error: M.notFound } });
    expect(await stored(ELSEWHERE)).toEqual({ name: 'Elsewhere', color: '#000000' });
  });
});

describe('PUT /api/transactions/:id/tags', () => {
  async function tagsOn(id: number): Promise<number[]> {
    const { results } = await env.DB.prepare(
      'SELECT tag_id FROM transaction_tags WHERE transaction_id = ? ORDER BY tag_id'
    )
      .bind(id)
      .all<{ tag_id: number }>();
    return results.map((row) => row.tag_id);
  }

  it('refuses anything but a list of tag ids at tagIds', async () => {
    for (const tagIds of [undefined, 'Holiday', HOLIDAY, [0], ['x']]) {
      expect(
        await refusal(await call('PUT', `/api/transactions/${FIRST}/tags`, { tagIds }))
      ).toEqual({ status: 400, body: { error: M.tagIds, fields: { tagIds: M.tagIds } } });
    }
  });

  it("refuses another profile's tag at tagIds as a 400, and stores none of the list", async () => {
    const res = await call('PUT', `/api/transactions/${FIRST}/tags`, {
      tagIds: [HOLIDAY, ELSEWHERE],
    });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.tagIds, fields: { tagIds: M.tagIds } },
    });
    expect(await tagsOn(FIRST)).toEqual([]);
  });

  it("stores the profile's own tags, each once", async () => {
    const res = await call('PUT', `/api/transactions/${FIRST}/tags`, {
      tagIds: [WORK, HOLIDAY, WORK],
    });
    expect(res.status).toBe(200);
    expect(await tagsOn(FIRST)).toEqual([HOLIDAY, WORK]);
  });
});

describe('GET /api/transactions/by-tag/:tagId', () => {
  beforeEach(async () => {
    for (const id of [FIRST, SECOND, THIRD]) {
      expect(
        (await call('PUT', `/api/transactions/${id}/tags`, { tagIds: [HOLIDAY] })).status
      ).toBe(200);
    }
  });

  async function rows(query: string): Promise<Record<string, unknown>[]> {
    const res = await call('GET', `/api/transactions/by-tag/${HOLIDAY}${query}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Record<string, unknown>[]; total: number };
    expect(body.total).toBe(body.rows.length);
    return body.rows;
  }

  const ids = async (query: string) => (await rows(query)).map((row) => row.id);

  it('answers newest first, and counts a timestamped row on its own day', async () => {
    expect(await ids('')).toEqual([SECOND, THIRD, FIRST]);
    expect(await ids('?startDate=2026-03-02&endDate=2026-03-31')).toEqual([SECOND, THIRD]);
    expect(await ids('?type=income')).toEqual([THIRD]);
    expect(await ids(`?category_ids=${FOOD},999`)).toEqual([FIRST]);
  });

  it('pages with a limit, an offset, or an offset alone', async () => {
    expect(await ids('?limit=1&offset=1')).toEqual([THIRD]);
    expect(await ids('?offset=2')).toEqual([FIRST]);
    expect(await ids('?limit=2')).toEqual([SECOND, THIRD]);
  });

  it("names each row's category", async () => {
    const [first] = await rows(`?category_ids=${FOOD}`);
    expect(first).toMatchObject({
      id: FIRST,
      category_name: 'Food',
      category_color: '#aa5500',
      category_icon: 'tag',
    });
  });
});
