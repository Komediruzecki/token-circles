import {
  addCategory,
  addTransaction,
  balanceOf,
  expectMoney,
  idsOf,
  listTransactions,
} from '../helpers';
import { expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json, Owned } from '../types';
import { account } from './accounts';
import { sourceForm } from './importSources';
import { fillProfile, NONE, profileList } from './profiles';

/** The ids that own rows of their own, as a profile's lists read now. */
async function ownedNow(api: ContractApi, expect: Expect): Promise<Owned> {
  const ids = async (path: string) => {
    const reply = await api.get(path);
    expectOk(expect, reply, `GET ${path}`);
    return idsOf(reply.body as Json[]);
  };
  return {
    loans: await ids('/api/loans'),
    accounts: await ids('/api/accounts'),
    transactions: idsOf(await listTransactions(api, expect)),
  };
}

/** Two sets of ids as one. */
function both(a: Owned, b: Owned): Owned {
  const join = (x: readonly number[] = [], y: readonly number[] = []) => [...new Set([...x, ...y])];
  return {
    loans: join(a.loans, b.loans),
    accounts: join(a.accounts, b.accounts),
    transactions: join(a.transactions, b.transactions),
  };
}

/**
 * Fills this profile and puts an account in the other, takes the whole-account backup as Settings
 * does (no profile header), and restores it. Answers what this profile held, the ids that owned
 * rows of their own in each profile before the restore, and the profiles the restore gave back.
 */
async function backUpAndRestore(api: ContractApi, expect: Expect) {
  const mine = await fillProfile(api, expect);
  const theirs: Owned = { accounts: [await account(api.other, expect, 'Theirs', 5)] };
  const before = await api.stored(api.profile, mine);

  const taken = await api.unscoped.get('/api/export');
  expectOk(expect, taken, 'GET /api/export');
  const file = taken.body;
  expect(file.version).toBe('3.0.0');
  expect(file.profiles.map((p: Json) => p.name)).toEqual(['Me', 'Partner']);
  expect(file.transactions).toHaveLength(1);
  expect(file.accounts.map((a: Json) => a.name).sort()).toEqual(['Everyday', 'Theirs']);
  expect(file.importSources).toEqual([
    expect.objectContaining({ profile_id: api.profile, label: 'Bank ledger' }),
  ]);

  // Restoring replaces every profile with the file's.
  const restored = await api.unscoped.post('/api/import', file);
  expectOk(expect, restored, 'POST /api/import');
  // DIFFERENCE backup-restore-answer
  if (api.runtime === 'worker') {
    expect(restored.body).toMatchObject({
      profiles_restored: 2,
      rows_restored: expect.any(Number),
      first_profile_id: expect.any(Number),
    });
  } else {
    expect(restored.body).toEqual({ ok: true, message: 'Data imported successfully' });
  }

  const listed = await profileList(api.unscoped, expect);
  expect(listed.map((p) => p.name)).toEqual(['Me', 'Partner']);
  const me = listed.find((p) => p.name === 'Me')!.id as number;
  const partner = listed.find((p) => p.name === 'Partner')!.id as number;
  expect([me, partner]).not.toContain(api.profile);
  return { before, mine, theirs, me, partner };
}

export const backup = [
  scenario(
    'a backup is taken and restored, and everything in it comes back',
    async (api, expect) => {
      const { before, mine, me, partner } = await backUpAndRestore(api, expect);
      const back = api.as(me);
      // Everything the file carried is back, under the restored profile, and once: the rows that
      // hang off a loan, an account or a transaction are counted under the replaced ids as well as
      // the restored ones, so one the restore left behind beside its copy counts twice. The
      // profile's saved import sources come back with it.
      const after = await api.stored(me, both(mine, await ownedNow(back, expect)));
      expect(after).toEqual(before);
      const sources = (await back.get('/api/import-sources')).body as Json[];
      expect(sources).toEqual([
        expect.objectContaining({
          profile_id: me,
          ...sourceForm(),
          last_synced_at: null,
        }),
      ]);
      const accounts = (await back.get('/api/accounts')).body as Json[];
      const everyday = accounts.find((a) => a.name === 'Everyday');
      expectMoney(expect, await balanceOf(back, expect, everyday.id), 954.5, 'Everyday');
      expect((await api.stored(partner)).accounts).toBe(1);
    }
  ),

  scenario('a restore leaves nothing behind of the profiles it replaced', async (api, expect) => {
    const { mine, theirs } = await backUpAndRestore(api, expect);
    // Rate periods, extra payments, balance history and transaction tags belong to their loan,
    // account or transaction, not to a profile: they are counted under the ids those had before
    // the restore.
    expect(await api.stored(api.profile, mine)).toEqual(NONE);
    expect(await api.stored(api.other.profile, theirs)).toEqual(NONE);
  }),

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
    // Import sources go too: a source on the daily schedule would fill the profile again.
    expect(await api.stored(api.profile, mine)).toEqual(NONE);
    expect(await api.stored(api.other.profile, theirs)).toEqual(NONE);
  }),
];
