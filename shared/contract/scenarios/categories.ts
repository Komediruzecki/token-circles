import { added, expectOk, scenario } from '../types';

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
];
