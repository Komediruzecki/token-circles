import { added, expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';

async function uncategorised(api: ContractApi, expect: Expect, description: string) {
  return added(api, expect, '/api/transactions', {
    description,
    amount: 15.99,
    date: '2026-03-10',
    type: 'expense',
    category_id: null,
    currency: 'EUR',
  });
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
    expect((await api.get('/api/categories')).body).not.toContainEqual(
      expect.objectContaining({ id })
    );
  }),

  scenario("another profile's category is not read, changed or removed", async (api, expect) => {
    const id = await added(api, expect, '/api/categories', {
      name: 'Mine',
      type: 'expense',
      color: '#aa5500',
    });
    const other = api.other;
    expect((await other.get(`/api/categories/${id}`)).status).toBe(404);
    expect((await other.get('/api/categories')).body).not.toContainEqual(
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
        confidence: 0.9,
      });
      expectOk(expect, saved, 'POST the mapping');
      const mapping = saved.body.id as number;
      const listed = await api.get('/api/categories/mappings');
      expectOk(expect, listed, 'GET the mappings');
      expect(listed.body).toEqual([
        expect.objectContaining({ id: mapping, pattern: 'netflix', category_id: streaming }),
      ]);
      expect((await api.other.get('/api/categories/mappings')).body).toEqual([]);
      expect((await api.other.delete(`/api/categories/mappings/${mapping}`)).status).toBe(404);

      // DIFFERENCE category-apply-mappings
      const applied = await api.post('/api/categories/apply-mappings', {
        mappings: [{ transaction_id: tx, category_id: streaming, pattern: 'netflix' }],
        mapping_ids: [mapping],
      });
      expectOk(expect, applied, 'POST apply-mappings');
      expect(applied.body).toMatchObject(
        api.runtime === 'worker' ? { ok: true, updated: 1 } : { ok: true, applied: 1 }
      );
      expect((await api.get(`/api/transactions/${tx}`)).body).toMatchObject({
        category_id: streaming,
      });

      expectOk(
        expect,
        await api.delete(`/api/categories/mappings/${mapping}`),
        'DELETE the mapping'
      );
      expect((await api.get('/api/categories/mappings')).body).toEqual([]);
    }
  ),

  scenario(
    'the same pattern saved twice is one mapping on the Worker only',
    async (api, expect) => {
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
        pattern: 'lidl',
        category_id: food,
      });
      expectOk(expect, first, 'POST the mapping');
      expectOk(expect, second, 'POST it again');
      const listed = (await api.get('/api/categories/mappings')).body as Json[];
      // DIFFERENCE category-mapping-upsert
      if (api.runtime === 'worker') {
        expect(second.body).toMatchObject({ ok: true, id: first.body.id, use_count: 2 });
        expect(listed).toEqual([
          expect.objectContaining({ pattern: 'lidl', use_count: 2, category_name: 'Food' }),
        ]);
      } else {
        expect(second.body.id).not.toBe(first.body.id);
        expect(listed).toHaveLength(2);
      }
    }
  ),

  scenario(
    'auto-map suggests a category on the Worker and files it in local-first',
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

      const reply = await api.post('/api/categories/auto-map', { transaction_ids: [tx] });
      expectOk(expect, reply, 'POST auto-map');
      expect(reply.body).toMatchObject({ mapped: 1 });
      const row = (await api.get(`/api/transactions/${tx}`)).body;
      // DIFFERENCE category-auto-map
      if (api.runtime === 'worker') {
        expect(reply.body.mappings).toEqual([
          expect.objectContaining({ transaction_id: tx, proposed_category_id: streaming }),
        ]);
        expect(row.category_id).toBeNull();
      } else {
        expect(reply.body).toMatchObject({ ok: true });
        expect(row.category_id).toBe(streaming);
      }
    }
  ),
];
