/**
 * Learned category mappings on a real D1, with older rows in place: saved, saved again, listed,
 * applied to transactions, and used by auto-map (shared/categoryMappingSchema.ts,
 * shared/autoCategorize.ts). The twin of the local-first test,
 * frontend/src/core/storage/__tests__/categoryMappings.test.ts.
 *
 * Before, the Worker refused a mapping without saying at which field ("Pattern is required"), a
 * category of another profile with 403, and an apply-mappings body that was not a list in words of
 * its own; and `transaction_ids` that were not a list stopped auto-map with a 500. Now each refusal
 * is a 400 at its field, in the words local-first uses, and a refused request stores nothing.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { CATEGORY_MAPPING_MESSAGES as M } from '../../shared/categoryMappingSchema';
import { sessionCookie } from './helpers/session';

const USER_ID = 6430;
const PROFILE = 64300;
const SIDE = 64301;
const STREAMING = 64310;
const OTHER = 64311;
const GROCERIES = 64312;
const THEIRS = 64313;
const NETFLIX_TX = 64320;
const CORNER_TX = 64321;
const GROCERIES_TX = 64322;
const SIDE_TX = 64323;
let cookie = '';

beforeEach(async () => {
  for (const t of ['category_mappings', 'transactions', 'categories', 'rate_limits', 'profiles']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER_ID).run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'category-mappings@example.com', 'password', 1, 'free')"
    ).bind(USER_ID),
    env.DB.prepare(
      "INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Household'), (?, ?, 'Side')"
    ).bind(PROFILE, USER_ID, SIDE, USER_ID),
    env.DB.prepare(
      `INSERT INTO categories (id, profile_id, name, color, type) VALUES
         (?, ?, 'Streaming', '#225588', 'expense'), (?, ?, 'Other', '#6b7280', 'expense'),
         (?, ?, 'Groceries', '#aa5500', 'expense'), (?, ?, 'Theirs', '#335577', 'expense')`
    ).bind(STREAMING, PROFILE, OTHER, PROFILE, GROCERIES, PROFILE, THEIRS, SIDE),
    // Older rows: a mapping used three times, and one naming another profile's category, as a
    // row stored before categories were checked against the profile would.
    env.DB.prepare(
      `INSERT INTO category_mappings (id, profile_id, pattern, category_id, confidence, use_count) VALUES
         (64340, ?, 'netflix', ?, 0.8, 3), (64341, ?, 'corner', ?, 0.9, 9)`
    ).bind(PROFILE, STREAMING, PROFILE, THEIRS),
    env.DB.prepare(
      `INSERT INTO transactions (id, profile_id, description, amount, type, date, category_id) VALUES
         (?, ?, 'Netflix monthly', 15.99, 'expense', '2026-03-01', NULL),
         (?, ?, 'Corner shop', 4.5, 'expense', '2026-03-02', ?),
         (?, ?, 'Groceries run', 40, 'expense', '2026-03-03', ?),
         (?, ?, 'Side job tools', 12, 'expense', '2026-03-04', NULL)`
    ).bind(
      NETFLIX_TX,
      PROFILE,
      CORNER_TX,
      PROFILE,
      OTHER,
      GROCERIES_TX,
      PROFILE,
      GROCERIES,
      SIDE_TX,
      SIDE
    ),
  ]);
  cookie = (await sessionCookie(USER_ID, 'password', env)).split(';')[0];
});

function send(method: string, path: string, payload?: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(PROFILE),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

async function answer(res: Response): Promise<{ status: number; body: any }> {
  return { status: res.status, body: await res.json() };
}

async function mappings(): Promise<Record<string, unknown>[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, profile_id, pattern, category_id, confidence, use_count FROM category_mappings ORDER BY id'
  ).all();
  return results;
}

async function categoryOf(id: number): Promise<unknown> {
  return (
    await env.DB.prepare('SELECT category_id FROM transactions WHERE id = ?').bind(id).first()
  )?.category_id;
}

describe('the mappings list', () => {
  it("holds the profile's mappings with their category, leaving out one whose category is another profile's", async () => {
    const { status, body } = await answer(await send('GET', '/api/categories/mappings'));
    expect(status).toBe(200);
    expect(body).toEqual([
      expect.objectContaining({
        id: 64340,
        pattern: 'netflix',
        use_count: 3,
        category_name: 'Streaming',
        category_color: '#225588',
      }),
    ]);
  });
});

describe('a mapping saved', () => {
  it('is refused at its field, and nothing is stored', async () => {
    const before = await mappings();
    expect(
      await answer(
        await send('POST', '/api/categories/mappings', { pattern: ' ', category_id: 'x' })
      )
    ).toEqual({
      status: 400,
      body: {
        error: `${M.pattern} ${M.category}`,
        fields: { pattern: M.pattern, category_id: M.category },
      },
    });
    expect(
      await answer(
        await send('POST', '/api/categories/mappings', { pattern: 'side', category_id: THEIRS })
      )
    ).toEqual({ status: 400, body: { error: M.category, fields: { category_id: M.category } } });
    for (const confidence of [0, -0.5, 1.5, 'sure']) {
      expect(
        await answer(
          await send('POST', '/api/categories/mappings', {
            pattern: 'side',
            category_id: STREAMING,
            confidence,
          })
        )
      ).toEqual({
        status: 400,
        body: { error: M.confidence, fields: { confidence: M.confidence } },
      });
    }
    expect(await mappings()).toEqual(before);
  });

  it('again, for a pattern the profile has, is that mapping counted once more', async () => {
    expect(
      await answer(
        await send('POST', '/api/categories/mappings', {
          pattern: ' netflix ',
          category_id: STREAMING,
        })
      )
    ).toEqual({ status: 200, body: { ok: true, id: 64340, use_count: 4 } });
    expect(await mappings()).toContainEqual(
      expect.objectContaining({ id: 64340, pattern: 'netflix', confidence: 0.9, use_count: 4 })
    );
    expect((await mappings()).filter((row) => row.pattern === 'netflix')).toHaveLength(1);
  });
});

describe('apply-mappings', () => {
  it('refuses a body it cannot file at its field, and files and learns nothing', async () => {
    const before = await mappings();
    expect(
      await answer(await send('POST', '/api/categories/apply-mappings', { mapping_ids: [64340] }))
    ).toEqual({ status: 400, body: { error: M.mappings, fields: { mappings: M.mappings } } });
    expect(
      (
        await answer(
          await send('POST', '/api/categories/apply-mappings', {
            mappings: [
              { transaction_id: NETFLIX_TX, category_id: STREAMING, pattern: 'Netflix' },
              { transaction_id: 'x', category_id: STREAMING, pattern: { text: 'x' } },
            ],
          })
        )
      ).body.fields
    ).toEqual({
      'mappings.1.transaction_id': M.transaction,
      'mappings.1.pattern': M.patternText,
    });
    expect(
      await answer(
        await send('POST', '/api/categories/apply-mappings', {
          mappings: [
            { transaction_id: NETFLIX_TX, category_id: STREAMING, pattern: 'Netflix monthly' },
            { transaction_id: CORNER_TX, category_id: THEIRS },
          ],
        })
      )
    ).toEqual({
      status: 400,
      body: { error: M.category, fields: { 'mappings.1.category_id': M.category } },
    });
    expect(await categoryOf(NETFLIX_TX)).toBeNull();
    expect(await mappings()).toEqual(before);
  });

  it("files the profile's transactions and learns their text, and skips another profile's", async () => {
    expect(
      await answer(
        await send('POST', '/api/categories/apply-mappings', {
          mappings: [
            { transaction_id: NETFLIX_TX, category_id: STREAMING, pattern: 'Netflix Monthly!' },
            { transaction_id: CORNER_TX, category_id: GROCERIES, pattern: 'ab' },
            { transaction_id: SIDE_TX, category_id: GROCERIES, pattern: 'Side job' },
          ],
        })
      )
    ).toEqual({ status: 200, body: { ok: true, updated: 2 } });
    expect(await categoryOf(NETFLIX_TX)).toBe(STREAMING);
    expect(await categoryOf(CORNER_TX)).toBe(GROCERIES);
    expect(await categoryOf(SIDE_TX)).toBeNull();
    // "ab" is too short to learn from; the others are learned in their matching form.
    expect((await mappings()).map((row) => [row.pattern, row.category_id, row.use_count])).toEqual([
      ['netflix', STREAMING, 3],
      ['corner', THEIRS, 9],
      ['netflixmonthly', STREAMING, 1],
      ['sidejob', GROCERIES, 1],
    ]);
  });
  it('updates the goals linked to the categories it moves transactions out of and into', async () => {
    await env.DB.prepare('DELETE FROM savings_goals WHERE profile_id = ?').bind(PROFILE).run();
    await env.DB.prepare(
      `INSERT INTO savings_goals (id, profile_id, name, target_amount, current_amount, category_id, tracking_start_date) VALUES
         (64350, ?, 'Groceries fund', 100, 40, ?, '2026-01-01'),
         (64351, ?, 'Other fund', 100, 4.5, ?, '2026-01-01')`
    )
      .bind(PROFILE, GROCERIES, PROFILE, OTHER)
      .run();

    await send('POST', '/api/categories/apply-mappings', {
      mappings: [{ transaction_id: CORNER_TX, category_id: GROCERIES, pattern: 'Corner shop' }],
    });

    // The stored amounts: the goals list recalculates them itself, other readers do not.
    const { results } = await env.DB.prepare(
      'SELECT id, current_amount FROM savings_goals WHERE profile_id = ? ORDER BY id'
    )
      .bind(PROFILE)
      .all();
    expect(results).toEqual([
      { id: 64350, current_amount: 44.5 },
      { id: 64351, current_amount: 0 },
    ]);
  });
});

describe('auto-map', () => {
  it('suggests a category for the uncategorised transactions and files none', async () => {
    const { status, body } = await answer(await send('POST', '/api/categories/auto-map', {}));
    expect(status).toBe(200);
    // Netflix (no category) and the corner shop (Other); not the groceries, which are filed, nor
    // the other profile's. The corner shop's mapping names another profile's category, so it
    // suggests nothing.
    expect(body).toEqual({
      total: 2,
      mapped: 1,
      mappings: [
        {
          transaction_id: NETFLIX_TX,
          description: 'Netflix monthly',
          proposed_category_id: STREAMING,
          proposed_category_name: 'Streaming',
          proposed_category_color: '#225588',
          confidence: expect.any(Number),
        },
      ],
    });
    // 0.8, raised by three uses: 0.8 x (1 + log10(4) x 0.2).
    expect(body.mappings[0].confidence).toBeCloseTo(0.8963, 4);
    expect(await categoryOf(NETFLIX_TX)).toBeNull();
    expect(await categoryOf(CORNER_TX)).toBe(OTHER);
  });

  it('narrows to a description given with an amount', async () => {
    const { body } = await answer(
      await send('POST', '/api/categories/auto-map', { description: 'Corner', amount: 4.5 })
    );
    expect(body).toEqual({ total: 1, mapped: 0, mappings: [] });
  });

  it('refuses transaction ids that are not a list of ids', async () => {
    for (const transaction_ids of ['all', [NETFLIX_TX, 'x'], { id: NETFLIX_TX }]) {
      expect(
        await answer(await send('POST', '/api/categories/auto-map', { transaction_ids }))
      ).toEqual({
        status: 400,
        body: { error: M.transactionIds, fields: { transaction_ids: M.transactionIds } },
      });
    }
  });
});
