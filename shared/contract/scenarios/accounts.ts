import { added, expectOk, scenario } from '../types';

export const accounts = [
  scenario('an account is added, read back, changed and removed', async (api, expect) => {
    const id = await added(api, expect, '/api/accounts', {
      name: 'Everyday',
      type: 'giro',
      currency: 'EUR',
      balance: 250.5,
    });
    const one = await api.get(`/api/accounts/${id}`);
    expectOk(expect, one, 'GET the account');
    expect(one.body).toMatchObject({ id, name: 'Everyday', type: 'giro', currency: 'EUR' });
    expect(Number(one.body.balance)).toBeCloseTo(250.5, 2);
    expect((await api.get('/api/accounts')).body).toContainEqual(
      expect.objectContaining({ id, name: 'Everyday' })
    );

    expectOk(
      expect,
      await api.put(`/api/accounts/${id}`, { name: 'Bills', type: 'giro', currency: 'EUR' }),
      'PUT the account'
    );
    expect((await api.get(`/api/accounts/${id}`)).body).toMatchObject({ id, name: 'Bills' });

    expectOk(expect, await api.delete(`/api/accounts/${id}`), 'DELETE the account');
    expect((await api.get(`/api/accounts/${id}`)).status).toBe(404);
    expect((await api.get('/api/accounts')).body).not.toContainEqual(
      expect.objectContaining({ id })
    );
  }),

  scenario("another profile's account is not read, changed or removed", async (api, expect) => {
    const id = await added(api, expect, '/api/accounts', {
      name: 'Mine',
      type: 'giro',
      currency: 'EUR',
      balance: 10,
    });
    const other = api.other;
    expect((await other.get(`/api/accounts/${id}`)).status).toBe(404);
    expect((await other.get('/api/accounts')).body).not.toContainEqual(
      expect.objectContaining({ id })
    );
    expect(
      (await other.put(`/api/accounts/${id}`, { name: 'Theirs', type: 'giro', currency: 'EUR' }))
        .status
    ).toBe(404);
    expect((await other.delete(`/api/accounts/${id}`)).status).toBe(404);
    expect((await api.get(`/api/accounts/${id}`)).body).toMatchObject({ id, name: 'Mine' });
  }),
];
