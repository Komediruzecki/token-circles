import { expectOk, scenario } from '../types';

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

    // DIFFERENCE fire-inflation
    const inflated = await api.post('/api/calculator/retire', { ...fireBody, inflationRate: 2.5 });
    expectOk(expect, inflated, 'POST /api/calculator/retire with inflation');
    if (api.runtime === 'worker') {
      expect(inflated.body).toEqual(reply.body);
    } else {
      expect(inflated.body).toMatchObject({ fireMonth: 130, fireAge: 40.8 });
      expect(inflated.body.inputs.inflationRate).toBe(2.5);
    }
  }),
];
