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

async function profileList(api: ContractApi, expect: Expect): Promise<Json[]> {
  const reply = await api.get('/api/profiles');
  expectOk(expect, reply, 'GET /api/profiles');
  return reply.body as Json[];
}

async function addProfile(api: ContractApi, expect: Expect, name: string): Promise<number> {
  const reply = await api.post('/api/profiles', { name });
  expectOk(expect, reply, 'POST /api/profiles');
  // DIFFERENCE profile-answers
  expect(reply.status).toBe(api.runtime === 'worker' ? 200 : 201);
  expect(reply.body).toMatchObject({
    id: expect.any(Number),
    name,
    created_at: expect.any(String),
  });
  return reply.body.id as number;
}

/** Nothing of any kind. */
const NONE = Object.fromEntries(STORED_KINDS.map((kind) => [kind, 0])) as Record<
  StoredKind,
  number
>;

/**
 * One of everything a profile holds, each written as the app writes it. Answers the rows that own
 * rows of their own: a loan's extra payments, an account's history, a transaction's tags.
 */
async function fillProfile(api: ContractApi, expect: Expect): Promise<Owned> {
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
  scenario("a profile's data is cleared, and the profile kept", async (api, expect) => {
    const mine = await fillProfile(api, expect);
    const theirs = await fillProfile(api.other, expect);
    const theirsBefore = await api.stored(api.other.profile, theirs);

    // The Danger Zone names the profile it clears in X-Profile-Id: here, this one.
    const cleared = await api.delete('/api/profile/data');
    expectOk(expect, cleared, 'DELETE /api/profile/data');
    expect(cleared.body).toMatchObject({ ok: true, message: 'Profile data reset successfully' });

    // Both keep the profile's retirement plan.
    const kept: Partial<Record<StoredKind, number>> = { 'retirement settings': 1 };
    // DIFFERENCE profile-clear-import-sources
    if (api.runtime === 'worker') kept['import sources'] = 1;
    expect(await api.stored(api.profile, mine)).toEqual({ ...NONE, ...kept });
    expect((await profileList(api, expect)).map((p) => p.name)).toEqual(['Me', 'Partner']);
    expect(await api.stored(api.other.profile, theirs)).toEqual(theirsBefore);
  }),

  scenario('a profile other than the active one is deleted', async (api, expect) => {
    const id = await addProfile(api, expect, 'Old flat');
    await account(api.as(id), expect, 'Old savings', 10);

    // The Danger Zone can target any profile while this one stays active.
    const reply = await api.delete(`/api/profiles/${id}`);
    // DIFFERENCE profile-delete-selection
    if (api.runtime === 'worker') {
      expectOk(expect, reply, 'DELETE another profile');
      expect((await profileList(api, expect)).map((p) => p.id)).not.toContain(id);
      expect((await api.stored(id)).accounts).toBe(0);
    } else {
      expect(reply.status).toBe(403);
      expect((await profileList(api, expect)).map((p) => p.id)).toContain(id);
      expect((await api.stored(id)).accounts).toBe(1);
    }
  }),

  scenario('the last profile left is deleted', async (api, expect) => {
    expectOk(
      expect,
      await api.other.delete(`/api/profiles/${api.other.profile}`),
      'DELETE the partner profile'
    );
    await account(api, expect, 'Everyday', 1000);
    const reply = await api.delete(`/api/profiles/${api.profile}`);
    // DIFFERENCE profile-delete-last: the Danger Zone offers no delete with one profile left.
    if (api.runtime === 'worker') {
      expect(reply.status).toBe(400);
      expect((await profileList(api, expect)).map((p) => p.id)).toEqual([api.profile]);
      expect((await api.stored(api.profile)).accounts).toBe(1);
    } else {
      expectOk(expect, reply, 'DELETE the last profile');
      expect((await api.stored(api.profile)).accounts).toBe(0);
    }
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
