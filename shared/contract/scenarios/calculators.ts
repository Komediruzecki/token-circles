import { addTransaction, dayOf } from '../helpers';
import { added, expectOk, scenario } from '../types';
import { account, accountBody } from './accounts';

/** The body the FIRE calculator would send: nothing in the app calls it today. */
const fireBody = {
  currentAge: 30,
  retirementAge: 50,
  currentSavings: 100000,
  monthlyContribution: 2000,
  annualReturn: 7,
  annualExpenses: 30000,
  withdrawalRate: 4,
  country: 'croatia',
};

export const calculators = [
  scenario('the compound interest calculator', async (api, expect) => {
    // The page's payload (features/CompoundInterestCalculator.tsx), with its opening figures.
    const reply = await api.post('/api/calculator/compound-interest', {
      principal: 10000,
      monthlyContribution: 500,
      annualReturn: 7,
      years: 10,
    });
    expectOk(expect, reply, 'POST /api/calculator/compound-interest');
    expect(reply.body).toMatchObject({
      principal: 10000,
      monthlyContribution: 500,
      annualReturn: 7,
      years: 10,
      finalBalance: 106639,
      totalContributions: 70000,
      totalInterest: 36639,
    });
    expect(reply.body.projection).toHaveLength(11);
    expect(reply.body.projection[1]).toEqual({
      year: 1,
      balance: 16919,
      contributions: 16000,
      interest: 919,
    });
    expect(
      reply.body.scenarios.map((s: { name: string; finalBalance: number }) => [
        s.name,
        s.finalBalance,
      ])
    ).toEqual([
      ['Conservative', 88533],
      ['Moderate', 100134],
      ['Optimistic', 113669],
    ]);
  }),

  scenario(
    "the emergency fund calculator averages the profile's spending and counts its savings",
    async (api, expect) => {
      await added(api, expect, '/api/accounts', {
        ...accountBody('Rainy day', 4500.75),
        type: 'savings',
      });
      await account(api, expect, 'Everyday', 1000);
      for (const [offset, spent] of [
        [-1, 1000.25],
        [-2, 1200],
        [-3, 799.75],
      ] as const) {
        await addTransaction(api, expect, { amount: spent, date: dayOf(offset, 12) });
      }
      await addTransaction(api, expect, {
        description: 'Salary',
        type: 'income',
        amount: 3000,
        date: dayOf(-1, 5),
      });
      // Older than the twelve months the calculator looks back over.
      await addTransaction(api, expect, { amount: 9999, date: dayOf(-14, 12) });
      await added(api.other, expect, '/api/accounts', {
        ...accountBody('Their savings', 99999),
        type: 'savings',
      });

      const reply = await api.get('/api/calculator/emergency-fund');
      expectOk(expect, reply, 'GET /api/calculator/emergency-fund');
      // The page shows the average, the fund, the months of data and the three levels.
      expect(reply.body).toMatchObject({
        avgMonthlyExpenses: 1000,
        totalEmergencyFund: 4501,
        monthsWithData: 3,
      });
      expect(reply.body.coverage).toEqual([
        {
          months: 3,
          label: 'Starter',
          required: 3000,
          current: 4501,
          coveragePct: 100,
          status: 'complete',
        },
        {
          months: 6,
          label: 'Standard',
          required: 6000,
          current: 4501,
          coveragePct: 75,
          status: 'partial',
        },
        {
          months: 12,
          label: 'Conservative',
          required: 12000,
          current: 4501,
          coveragePct: 38,
          status: 'low',
        },
      ]);
      // DIFFERENCE emergency-fund-extras
      if (api.runtime === 'worker') {
        expect(reply.body.monthsOfCoverage).toBe(5);
        expect(reply.body.totalBalance).toBeUndefined();
      } else {
        expect(reply.body.totalBalance).toBe(5501);
        expect(reply.body.accounts).toEqual([expect.objectContaining({ name: 'Rainy day' })]);
        expect(reply.body.monthsOfCoverage).toBeUndefined();
      }

      const theirs = await api.other.get('/api/calculator/emergency-fund');
      expectOk(expect, theirs, 'GET /api/calculator/emergency-fund for the other profile');
      expect(theirs.body).toMatchObject({
        avgMonthlyExpenses: 0,
        totalEmergencyFund: 99999,
        monthsWithData: 0,
      });
    }
  ),

  scenario('the FIRE calculator', async (api, expect) => {
    const reply = await api.post('/api/calculator/retire', fireBody);
    expectOk(expect, reply, 'POST /api/calculator/retire');
    // 30,000 a year at Croatian prices (0.6) is 18,000, and at 4% that takes 450,000.
    expect(reply.body).toMatchObject({
      fireNumber: 450000,
      fireMonth: 102,
      monthsToFire: 102,
      fireAge: 38.5,
      fireYear: 38,
      savingsAtRetirement: 1402041,
      traditionalRetirementAge: 65,
    });
    expect(reply.body.inputs).toMatchObject({ adjustedExpenses: 18000, country: 'croatia' });
    expect(reply.body.timeline.map((t: { age: number }) => t.age)).toEqual([30, 35, 40, 45, 50]);
    expect(reply.body.withdrawalTimeline).toHaveLength(20);
    expect(reply.body.withdrawalTimeline[0]).toEqual({
      year: 1,
      savings: 1482184,
      balance: 1482184,
    });
    expect(
      reply.body.scenarios.map((s: { name: string; fireAge: number; reached: boolean }) => [
        s.name,
        s.fireAge,
        s.reached,
      ])
    ).toEqual([
      ['Conservative', 40.3, true],
      ['Moderate', 39, true],
      ['Optimistic', 38.1, true],
    ]);

    expect(
      (await api.post('/api/calculator/retire', { ...fireBody, retirementAge: 30 })).status
    ).toBe(400);

    // Without an inflation rate the projection is in nominal money, as above. With one, it is
    // deflated by it, so the same savings reach the FIRE number later. The Worker used to drop
    // the rate and answer as if none had been sent.
    expect(reply.body.inputs.inflationRate).toBe(0);
    const inflated = await api.post('/api/calculator/retire', { ...fireBody, inflationRate: 2.5 });
    expectOk(expect, inflated, 'POST /api/calculator/retire with inflation');
    expect(inflated.body).toMatchObject({
      fireNumber: 450000,
      fireMonth: 130,
      monthsToFire: 130,
      fireAge: 40.8,
      fireYear: 40,
    });
    expect(inflated.body.inputs.inflationRate).toBe(2.5);
  }),
];
