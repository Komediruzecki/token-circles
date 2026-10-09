import { addTransaction, rowsOf, transactionForm } from '../helpers';
import { CATEGORY_MAPPING_MESSAGES } from '../../categoryMappingSchema';
import { added, expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';
import { billForm } from './bills';
import { goalForm } from './goals';
import { ruleForm } from './recurring';

async function uncategorised(api: ContractApi, expect: Expect, description: string) {
  return added(api, expect, '/api/transactions', transactionForm({ description, amount: 15.99 }));
}

export const categories = [
  scenario('a category is added, read back, changed and removed', async (api, expect) => {
    const id = await added(api, expect, '/api/categories', {
      name: 'Coffee',
      type: 'expense',
      color: '#aa5500',
      icon: 'coffee',
    });
    const one = await api.get(`/api/categories/${id}`);
    expectOk(expect, one, 'GET the category');
    expect(one.body).toMatchObject({ id, name: 'Coffee', type: 'expense', color: '#aa5500' });
    expect((await api.get('/api/categories')).body).toContainEqual(
      expect.objectContaining({ id, name: 'Coffee' })
    );

    expectOk(
      expect,
      await api.put(`/api/categories/${id}`, {
        name: 'Coffee out',
        type: 'expense',
        color: '#225588',
        icon: 'coffee',
      }),
      'PUT the category'
    );
    expect((await api.get(`/api/categories/${id}`)).body).toMatchObject({
      id,
      name: 'Coffee out',
      color: '#225588',
    });

    expectOk(expect, await api.delete(`/api/categories/${id}`), 'DELETE the category');
    expect((await api.get(`/api/categories/${id}`)).status).toBe(404);
    expect(await rowsOf(api, expect, '/api/categories')).not.toContainEqual(
      expect.objectContaining({ id })
    );
  }),

  scenario(
    'a category in use is removed: what used it keeps going without it',
    async (api, expect) => {
      const food = await added(api, expect, '/api/categories', {
        name: 'Food',
        type: 'expense',
        color: '#aa5500',
        icon: 'tag',
      });
      const bakery = await added(api, expect, '/api/categories', {
        name: 'Bakery',
        type: 'expense',
        color: '#bb7733',
        icon: 'tag',
        parent_id: food,
      });
      const groceries = await addTransaction(api, expect, {
        description: 'Groceries',
        amount: 45.5,
        category_id: food,
      });
      const goal = await added(api, expect, '/api/savings-goals', goalForm({ category_id: food }));
      const bill = await added(api, expect, '/api/bills', billForm({ category_id: food }));
      const rule = await added(api, expect, '/api/recurring', ruleForm({ category_id: food }));
      await added(api, expect, '/api/budgets', {
        category_id: food,
        amount: 300,
        period: 'monthly',
        start_date: '2026-03-01',
      });
      await added(api, expect, '/api/categories/mappings', { pattern: 'lidl', category_id: food });
      // The other profile's own Food, budgeted and spent on, is not this one.
      const theirFood = await added(api.other, expect, '/api/categories', {
        name: 'Food',
        type: 'expense',
        color: '#aa5500',
        icon: 'tag',
      });
      await addTransaction(api.other, expect, { description: 'Theirs', category_id: theirFood });
      await added(api.other, expect, '/api/budgets', {
        category_id: theirFood,
        amount: 200,
        period: 'monthly',
        start_date: '2026-03-01',
      });
      const theirsBefore = await api.stored(api.other.profile);

      expectOk(expect, await api.delete(`/api/categories/${food}`), 'DELETE the category');

      // A transaction, a goal, a bill and a recurring rule lose the category and stay.
      expect((await api.get(`/api/transactions/${groceries}`)).body).toMatchObject({
        id: groceries,
        amount: 45.5,
        category_id: null,
      });
      const listed = async (path: string, id: number) =>
        ((await api.get(path)).body as Json[]).find((row) => row.id === id);
      expect(await listed('/api/savings-goals', goal)).toMatchObject({ category_id: null });
      expect(await listed('/api/bills', bill)).toMatchObject({ category_id: null });
      expect(await listed('/api/recurring', rule)).toMatchObject({ category_id: null });
      // A budget and a mapping need the category, and go with it.
      expect((await api.get('/api/budgets')).body).toEqual([]);
      expect((await api.get('/api/categories/mappings')).body).toEqual([]);
      // A child category moves to the top.
      expect((await api.get(`/api/categories/${bakery}`)).body).toMatchObject({
        id: bakery,
        parent_id: null,
      });
      expect(await api.stored(api.other.profile)).toEqual(theirsBefore);
    }
  ),

  scenario("another profile's category is not read, changed or removed", async (api, expect) => {
    const id = await added(api, expect, '/api/categories', {
      name: 'Mine',
      type: 'expense',
      color: '#aa5500',
    });
    const other = api.other;
    expect((await other.get(`/api/categories/${id}`)).status).toBe(404);
    expect(await rowsOf(other, expect, '/api/categories')).not.toContainEqual(
      expect.objectContaining({ id })
    );
    expect(
      (
        await other.put(`/api/categories/${id}`, {
          name: 'Theirs',
          type: 'expense',
          color: '#aa5500',
        })
      ).status
    ).toBe(404);
    expect((await other.delete(`/api/categories/${id}`)).status).toBe(404);
    expect((await api.get(`/api/categories/${id}`)).body).toMatchObject({ id, name: 'Mine' });
  }),

  scenario(
    'resetting the categories removes the ones added and leaves the defaults',
    async (api, expect) => {
      const id = await added(api, expect, '/api/categories', {
        name: 'Coffee',
        type: 'expense',
        color: '#aa5500',
      });
      const theirs = await added(api.other, expect, '/api/categories', {
        name: 'Kept',
        type: 'expense',
        color: '#225588',
      });
      expectOk(expect, await api.delete('/api/categories'), 'DELETE /api/categories');
      const list = (await api.get('/api/categories')).body as { id: number; name: string }[];
      expect(list).not.toContainEqual(expect.objectContaining({ id }));
      expect(list.length).toBeGreaterThan(0);
      expect((await api.other.get(`/api/categories/${theirs}`)).body).toMatchObject({
        name: 'Kept',
      });
    }
  ),
  scenario(
    'a learned mapping is saved, listed, applied to a transaction and removed',
    async (api, expect) => {
      const streaming = await added(api, expect, '/api/categories', {
        name: 'Streaming',
        type: 'expense',
        color: '#225588',
        icon: 'tag',
      });
      const tx = await uncategorised(api, expect, 'Netflix monthly');

      const saved = await api.post('/api/categories/mappings', {
        pattern: 'netflix',
        category_id: streaming,
        confidence: 0.8,
      });
      expectOk(expect, saved, 'POST the mapping');
      expect(saved.body).toEqual({ ok: true, id: expect.any(Number), use_count: 1 });
      const mapping = saved.body.id as number;
      const listed = await api.get('/api/categories/mappings');
      expectOk(expect, listed, 'GET the mappings');
      expect(listed.body).toEqual([
        expect.objectContaining({
          id: mapping,
          pattern: 'netflix',
          category_id: streaming,
          confidence: 0.8,
          use_count: 1,
          category_name: 'Streaming',
          category_color: '#225588',
        }),
      ]);
      expect((await api.other.get('/api/categories/mappings')).body).toEqual([]);
      expect((await api.other.delete(`/api/categories/mappings/${mapping}`)).status).toBe(404);

      const applied = await api.post('/api/categories/apply-mappings', {
        mappings: [{ transaction_id: tx, category_id: streaming, pattern: 'Netflix monthly' }],
      });
      expectOk(expect, applied, 'POST apply-mappings');
      expect(applied.body).toEqual({ ok: true, updated: 1 });
      expect((await api.get(`/api/transactions/${tx}`)).body).toMatchObject({
        category_id: streaming,
      });
      // The pattern it was sent is learned in its matching form, beside the one saved above, and
      // listed first: the list runs from the most used, then the most sure.
      expect((await api.get('/api/categories/mappings')).body).toEqual([
        expect.objectContaining({
          pattern: 'netflixmonthly',
          category_id: streaming,
          confidence: 0.9,
          use_count: 1,
        }),
        expect.objectContaining({ id: mapping, pattern: 'netflix', confidence: 0.8 }),
      ]);

      expectOk(
        expect,
        await api.delete(`/api/categories/mappings/${mapping}`),
        'DELETE the mapping'
      );
      expect((await api.get('/api/categories/mappings')).body).toEqual([
        expect.objectContaining({ pattern: 'netflixmonthly' }),
      ]);
    }
  ),

  scenario('the same pattern saved twice is one mapping, counted twice', async (api, expect) => {
    const food = await added(api, expect, '/api/categories', {
      name: 'Food',
      type: 'expense',
      color: '#aa5500',
      icon: 'tag',
    });
    const first = await api.post('/api/categories/mappings', {
      pattern: 'lidl',
      category_id: food,
    });
    const second = await api.post('/api/categories/mappings', {
      pattern: '  lidl ',
      category_id: food,
    });
    expectOk(expect, first, 'POST the mapping');
    expectOk(expect, second, 'POST it again');
    expect(second.body).toEqual({ ok: true, id: first.body.id, use_count: 2 });
    expect((await api.get('/api/categories/mappings')).body).toEqual([
      expect.objectContaining({
        id: first.body.id,
        pattern: 'lidl',
        use_count: 2,
        category_name: 'Food',
      }),
    ]);
  }),

  scenario(
    'a mapping or an apply that cannot be stored is refused at its field',
    async (api, expect) => {
      const theirs = await added(api.other, expect, '/api/categories', {
        name: 'Theirs',
        type: 'expense',
        color: '#225588',
      });
      const mine = await added(api, expect, '/api/categories', {
        name: 'Mine',
        type: 'expense',
        color: '#aa5500',
      });
      const tx = await uncategorised(api, expect, 'Corner shop');

      const blank = await api.post('/api/categories/mappings', { pattern: '  ', category_id: 0 });
      expect(blank.status).toBe(400);
      expect(blank.body.fields).toEqual({
        pattern: CATEGORY_MAPPING_MESSAGES.pattern,
        category_id: CATEGORY_MAPPING_MESSAGES.category,
      });
      const foreign = await api.post('/api/categories/mappings', {
        pattern: 'corner',
        category_id: theirs,
      });
      expect(foreign.status).toBe(400);
      expect(foreign.body.fields).toEqual({ category_id: CATEGORY_MAPPING_MESSAGES.category });
      const sure = await api.post('/api/categories/mappings', {
        pattern: 'corner',
        category_id: mine,
        confidence: 2,
      });
      expect(sure.status).toBe(400);
      expect(sure.body.fields).toEqual({ confidence: CATEGORY_MAPPING_MESSAGES.confidence });

      const notAList = await api.post('/api/categories/apply-mappings', { mapping_ids: [1] });
      expect(notAList.status).toBe(400);
      expect(notAList.body.fields).toEqual({ mappings: CATEGORY_MAPPING_MESSAGES.mappings });
      const misfiled = await api.post('/api/categories/apply-mappings', {
        mappings: [
          { transaction_id: tx, category_id: mine },
          { transaction_id: tx, category_id: theirs },
        ],
      });
      expect(misfiled.status).toBe(400);
      expect(misfiled.body.fields).toEqual({
        'mappings.1.category_id': CATEGORY_MAPPING_MESSAGES.category,
      });

      // Nothing was stored or filed by any of them.
      expect((await api.get('/api/categories/mappings')).body).toEqual([]);
      expect((await api.get(`/api/transactions/${tx}`)).body).toMatchObject({ category_id: null });
    }
  ),

  scenario(
    'auto-map suggests a category for each transaction, and files none',
    async (api, expect) => {
      const streaming = await added(api, expect, '/api/categories', {
        name: 'Streaming',
        type: 'expense',
        color: '#225588',
        icon: 'tag',
      });
      expectOk(
        expect,
        await api.post('/api/categories/mappings', { pattern: 'netflix', category_id: streaming }),
        'POST the mapping'
      );
      const tx = await uncategorised(api, expect, 'Netflix monthly');
      const other = await uncategorised(api, expect, 'Zq 4417');

      const reply = await api.post('/api/categories/auto-map', { transaction_ids: [tx, other] });
      expectOk(expect, reply, 'POST auto-map');
      expect(reply.body).toEqual({
        total: 2,
        mapped: 1,
        mappings: [
          {
            transaction_id: tx,
            description: 'Netflix monthly',
            proposed_category_id: streaming,
            proposed_category_name: 'Streaming',
            proposed_category_color: '#225588',
            confidence: expect.any(Number),
          },
        ],
      });
      // A learned mapping's confidence, raised by its one use: 0.9 x (1 + log10(2) x 0.2).
      expect(reply.body.mappings[0].confidence).toBeCloseTo(0.9542, 4);
      expect((await api.get(`/api/transactions/${tx}`)).body).toMatchObject({ category_id: null });

      const refused = await api.post('/api/categories/auto-map', { transaction_ids: 'all' });
      expect(refused.status).toBe(400);
      expect(refused.body.fields).toEqual({
        transaction_ids: CATEGORY_MAPPING_MESSAGES.transactionIds,
      });
    }
  ),
];
