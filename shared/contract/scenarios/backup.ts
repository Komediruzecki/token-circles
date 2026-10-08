import { addCategory, addTransaction } from '../helpers';
import { expectOk, scenario } from '../types';
import { account } from './accounts';
import { fillProfile, NONE, profileList } from './profiles';

export const backup = [
  scenario('one kind of row is exported as a spreadsheet or as JSON', async (api, expect) => {
    const everyday = await account(api, expect, 'Everyday', 1000);
    const food = await addCategory(api, expect, 'Food');
    await addTransaction(api, expect, {
      description: 'Groceries',
      amount: 45.5,
      date: '2026-03-10',
      category_id: food,
      account_id: everyday,
    });
    await account(api.other, expect, 'Theirs', 5);

    // Settings' per-kind export sends the profile it exports and the format the page chose, and
    // saves whatever comes back as the file.
    const csv = await api.get('/api/export/transactions?format=csv');
    expectOk(expect, csv, 'GET /api/export/:type as CSV');
    const json = await api.get('/api/export/accounts?format=json');
    expectOk(expect, json, 'GET /api/export/:type as JSON');
    // DIFFERENCE export-by-type
    if (api.runtime === 'worker') {
      expect(csv.body).toBe(
        'date,description,amount,type,currency,means_of_payment,beneficiary,payor,notes,category\n' +
          '2026-03-10,Groceries,45.5,expense,EUR,,,,,Food'
      );
      expect(json.body).toEqual([
        { name: 'Everyday', type: 'giro', currency: 'EUR', balance: 954.5, notes: '' },
      ]);
    } else {
      expect(csv.body).toBe(
        'date,type,description,amount,currency,category_id,notes\n' +
          `2026-03-10,expense,"Groceries",45.5,EUR,${food},""`
      );
      expect(json.body).toEqual({
        accounts: [expect.objectContaining({ id: everyday, name: 'Everyday', balance: 954.5 })],
      });
    }
  }),

  scenario('all data is cleared, and the profiles kept', async (api, expect) => {
    const mine = await fillProfile(api, expect);
    const theirs = await fillProfile(api.other, expect);
    // Settings' reset sends no profile header: it clears every profile.
    const cleared = await api.unscoped.delete('/api/clear-all');
    expectOk(expect, cleared, 'DELETE /api/clear-all');
    expect(cleared.body).toEqual({ ok: true, message: 'All data cleared' });
    expect((await profileList(api, expect)).map((p) => p.name)).toEqual(['Me', 'Partner']);
    // DIFFERENCE profile-clear-import-sources
    const kept = api.runtime === 'worker' ? { 'import sources': 1 } : {};
    expect(await api.stored(api.profile, mine)).toEqual({ ...NONE, ...kept });
    expect(await api.stored(api.other.profile, theirs)).toEqual({ ...NONE, ...kept });
  }),
];
