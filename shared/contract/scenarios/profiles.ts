import { addCategory, addTransaction } from '../helpers';
import { added, expectOk, scenario, STORED_KINDS } from '../types';
import type { ContractApi, Expect, Json, Owned, StoredKind } from '../types';
import { account } from './accounts';
import { billForm } from './bills';
import { goalForm } from './goals';
import { housingForm } from './housing';
import { sourceForm } from './importSources';
import { loanForm } from './loans';
import { holdingForm } from './portfolio';
import { ruleForm } from './recurring';
import { retirementForm } from './retirement';

export async function profileList(api: ContractApi, expect: Expect): Promise<Json[]> {
  const reply = await api.get('/api/profiles');
  expectOk(expect, reply, 'GET /api/profiles');
  return reply.body as Json[];
}

async function addProfile(api: ContractApi, expect: Expect, name: string): Promise<number> {
  const reply = await api.post('/api/profiles', { name });
  expectOk(expect, reply, 'POST /api/profiles');
  // The new profile as the list shows it.
  expect(reply.status).toBe(201);
  expect(reply.body).toEqual({
    id: expect.any(Number),
    name,
    created_at: expect.any(String),
    transaction_count: 0,
    account_count: 0,
    budget_count: 0,
  });
  return reply.body.id as number;
}

/** Nothing of any kind. */
export const NONE = Object.fromEntries(STORED_KINDS.map((kind) => [kind, 0])) as Record<
  StoredKind,
  number
>;

/**
 * One of everything a profile holds, each written as the app writes it. Answers the rows that own
 * rows of their own: a loan's extra payments, an account's history, a transaction's tags.
 */
export async function fillProfile(api: ContractApi, expect: Expect): Promise<Owned> {
  const everyday = await account(api, expect, 'Everyday', 1000);
  expectOk(
    expect,
    await api.post(`/api/accounts/${everyday}/history`, { balance: 980 }),
    'POST the balance history'
  );
  const food = await addCategory(api, expect, 'Food');
  const groceries = await addTransaction(api, expect, {
    description: 'Coffee and groceries',
    amount: 45.5,
    category_id: food,
    account_id: everyday,
  });
  const receipt = new FormData();
  receipt.append('receipt', new File(['%PDF-1.4\n'], 'groceries.pdf', { type: 'application/pdf' }));
  receipt.append('transaction_id', String(groceries));
  expectOk(expect, await api.post('/api/receipts/upload', receipt), 'POST the receipt');
  const coffee = await added(api, expect, '/api/tags', { name: 'Coffee', color: '#6b4f2a' });
  expectOk(
    expect,
    await api.post(`/api/tags/${coffee}/transactions`, { transactionIds: [groceries] }),
    'tag the transaction'
  );
  await added(api, expect, '/api/tags/rules', {
    tag_id: coffee,
    name: 'Coffee runs',
    criteria: { description: 'coffee', descriptionMode: 'contains' },
    auto_apply: false,
  });
  await added(api, expect, '/api/categories/mappings', {
    pattern: 'grocer',
    category_id: food,
    confidence: 0.9,
  });
  await added(api, expect, '/api/budgets', {
    category_id: food,
    amount: 300,
    period: 'monthly',
    start_date: '2026-03-01',
  });
  await added(api, expect, '/api/savings-goals', goalForm());
  await added(api, expect, '/api/bills', billForm());
  await added(api, expect, '/api/recurring', ruleForm());
  const car = await added(
    api,
    expect,
    '/api/loans',
    loanForm({ rate_periods: [{ rate: 6, start_month: 13, end_month: 24 }] })
  );
  expectOk(
    expect,
    await api.post(`/api/loans/${car}/prepayments`, { month: 12, amount: 2000, note: 'Bonus' }),
    'POST the extra payment'
  );
  expectOk(expect, await api.post('/api/housing', housingForm()), 'POST the housing expense');
  await added(api, expect, '/api/portfolio/holdings', holdingForm());
  await added(api, expect, '/api/import-sources', sourceForm());
  expectOk(
    expect,
    await api.post('/api/import-logs', {
      import_id: 'contract-import-1',
      source: 'statement.csv',
      imported: 1,
      duplicates_skipped: 0,
      accounts_created: 0,
      categories_created: 0,
    }),
    'POST the import log'
  );
  await added(api, expect, '/api/retirement-goals', retirementForm());
  const plan = await api.get('/api/retirement/settings');
  expectOk(expect, plan, 'GET /api/retirement/settings');
  expectOk(
    expect,
    await api.put('/api/retirement/settings', { ...plan.body.settings, birthMonth: '1986-04' }),
    'PUT the retirement plan'
  );
  return { loans: [car], accounts: [everyday], transactions: [groceries] };
}

export const profiles = [
  scenario(
    'a profile is added, listed, renamed, and removed with everything in it',
    async (api, expect) => {
      const id = await addProfile(api, expect, 'Holiday house');
      expect(await profileList(api, expect)).toEqual([
        expect.objectContaining({ id: api.profile, name: 'Me' }),
        expect.objectContaining({ id: api.other.profile, name: 'Partner' }),
        expect.objectContaining({
          id,
          name: 'Holiday house',
          transaction_count: 0,
          account_count: 0,
          budget_count: 0,
        }),
      ]);

      // The app switches to the new profile, and everything it writes lands there.
      const holiday = api.as(id);
      const owned = await fillProfile(holiday, expect);
      const mine = await fillProfile(api, expect);
      expect((await profileList(api, expect)).find((p) => p.id === id)).toMatchObject({
        transaction_count: 1,
        account_count: 1,
        budget_count: 1,
      });

      // Renamed by either verb; Settings sends PUT.
      const renamed = await api.put(`/api/profiles/${id}`, { name: 'Beach house' });
      expectOk(expect, renamed, 'PUT');
      expect(renamed.body).toEqual({ id, name: 'Beach house', created_at: expect.any(String) });
      expect((await profileList(api, expect)).find((p) => p.id === id)?.name).toBe('Beach house');
      expectOk(expect, await api.patch(`/api/profiles/${id}`, { name: 'Lake house' }), 'PATCH');
      expect((await profileList(api, expect)).find((p) => p.id === id)?.name).toBe('Lake house');

      const before = await api.stored(id, owned);
      for (const kind of STORED_KINDS) {
        expect(before[kind], `${kind} before the delete`).toBeGreaterThan(0);
      }
      const mineBefore = await api.stored(api.profile, mine);

      // Settings deletes the profile it is on (handleDeleteProfile), then moves to the first left.
      expectOk(expect, await holiday.delete(`/api/profiles/${id}`), 'DELETE /api/profiles/:id');
      expect((await profileList(api, expect)).map((p) => p.id)).toEqual([
        api.profile,
        api.other.profile,
      ]);
      expect(await api.stored(id, owned)).toEqual(NONE);
      expect(await api.stored(api.profile, mine)).toEqual(mineBefore);
      expect((await api.delete(`/api/profiles/${id}`)).status).toBe(404);
    }
  ),

  scenario("a profile's data is cleared, and the profile kept", async (api, expect) => {
    const mine = await fillProfile(api, expect);
    const theirs = await fillProfile(api.other, expect);
    const theirsBefore = await api.stored(api.other.profile, theirs);

    // The Danger Zone names the profile it clears in X-Profile-Id: here, this one.
    const cleared = await api.delete('/api/profile/data');
    expectOk(expect, cleared, 'DELETE /api/profile/data');
    expect(cleared.body).toMatchObject({ ok: true, message: 'Profile data reset successfully' });

    // Both keep the profile's retirement plan, and delete its import sources with the rest: a
    // source on the daily schedule would fill the cleared profile again.
    expect(await api.stored(api.profile, mine)).toEqual({ ...NONE, 'retirement settings': 1 });
    expect((await profileList(api, expect)).map((p) => p.name)).toEqual(['Me', 'Partner']);
    expect(await api.stored(api.other.profile, theirs)).toEqual(theirsBefore);
  }),

  scenario('a profile other than the active one is deleted', async (api, expect) => {
    const id = await addProfile(api, expect, 'Old flat');
    await account(api.as(id), expect, 'Old savings', 10);

    // The Danger Zone can target any profile while this one stays active.
    expectOk(expect, await api.delete(`/api/profiles/${id}`), 'DELETE another profile');
    expect((await profileList(api, expect)).map((p) => p.id)).toEqual([
      api.profile,
      api.other.profile,
    ]);
    expect((await api.stored(id)).accounts).toBe(0);
  }),

  scenario('the last profile left is deleted', async (api, expect) => {
    expectOk(
      expect,
      await api.other.delete(`/api/profiles/${api.other.profile}`),
      'DELETE the partner profile'
    );
    await account(api, expect, 'Everyday', 1000);
    // The Danger Zone offers no delete with one profile left; a request that asks is refused.
    const reply = await api.delete(`/api/profiles/${api.profile}`);
    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({
      error: 'This is your only profile. Create another one before you delete this one.',
    });
    expect((await profileList(api, expect)).map((p) => p.id)).toEqual([api.profile]);
    expect((await api.stored(api.profile)).accounts).toBe(1);
  }),

  scenario('the demo data is reseeded', async (api, expect) => {
    await account(api, expect, 'Everyday', 1000);
    await account(api.other, expect, 'Theirs', 5);
    // The Danger Zone offers this in local-first only; the Worker keeps it for older pages.
    const reply = await api.post('/api/profiles/reseed-demo');
    expectOk(expect, reply, 'POST /api/profiles/reseed-demo');
    // DIFFERENCE profile-reseed-demo
    if (api.runtime === 'worker') {
      expect(reply.body).toEqual({ ok: true, message: 'Profile reset with default categories' });
      expect((await profileList(api, expect)).map((p) => p.name)).toEqual(['Me', 'Partner']);
      const stored = await api.stored(api.profile);
      expect(stored.accounts).toBe(0);
      expect(stored.categories).toBe(14);
      expect((await api.stored(api.other.profile)).accounts).toBe(1);
    } else {
      expect(reply.body).toEqual({ ok: true, message: 'Demo data reseeded' });
      expect((await profileList(api, expect)).map((p) => p.name)).toEqual([
        'Example Low Income',
        'Example Mid Income',
        'Example High Income',
      ]);
      expect((await api.stored(api.profile)).accounts).toBe(0);
      expect((await api.stored(api.other.profile)).accounts).toBe(0);
    }
  }),
];
