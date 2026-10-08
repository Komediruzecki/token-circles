import { expectMoney } from '../helpers';
import { added, expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';

/** The body the Loans form saves (features/Loans.tsx, handleSubmit). */
function loanForm(fields: Record<string, unknown> = {}) {
  return {
    name: 'Car',
    principal: 15000,
    interest_rate: 4.5,
    term_months: 60,
    start_date: '2026-01-15',
    status: 'active',
    rate_periods: [],
    ...fields,
  };
}

async function loan(api: ContractApi, expect: Expect, fields: Record<string, unknown> = {}) {
  return added(api, expect, '/api/loans', loanForm(fields));
}

async function loanDetail(api: ContractApi, expect: Expect, id: number): Promise<Json> {
  const reply = await api.get(`/api/loans/${id}`);
  expectOk(expect, reply, `GET /api/loans/${id}`);
  return reply.body;
}

async function loans(api: ContractApi, expect: Expect): Promise<Json[]> {
  const reply = await api.get('/api/loans');
  expectOk(expect, reply, 'GET /api/loans');
  return reply.body as Json[];
}

async function schedule(api: ContractApi, expect: Expect, id: number): Promise<Json> {
  // LoanAmortizationTable posts an empty body.
  const reply = await api.post(`/api/loans/${id}/calculate`, {});
  expectOk(expect, reply, `POST /api/loans/${id}/calculate`);
  return reply.body;
}

/** A rate period as the Loans form sends it back: the fields it edits, none of the row's own. */
function asForm(period: Json) {
  return {
    rate: period.rate,
    start_month: period.start_month,
    end_month: period.end_month ?? null,
  };
}

export const loanScenarios = [
  scenario('a loan is added, read back, changed and removed', async (api, expect) => {
    const id = await loan(api, expect, {
      rate_periods: [{ rate: 6, start_month: 13, end_month: 24 }],
    });

    const one = await loanDetail(api, expect, id);
    expect(one).toMatchObject({
      id,
      name: 'Car',
      interest_rate: 4.5,
      term_months: 60,
      start_date: '2026-01-15',
      prepayments: [],
    });
    expectMoney(expect, one.principal, 15000);
    expect(one.rate_periods).toHaveLength(1);
    expect(one.rate_periods[0]).toMatchObject({ rate: 6, start_month: 13, end_month: 24 });

    const listed = (await loans(api, expect)).find((l) => l.id === id);
    expect(listed).toMatchObject({ name: 'Car', prepayment_count: 0 });
    expectMoney(expect, listed.principal, 15000);
    // DIFFERENCE loan-total-prepaid-none
    expect(listed.total_prepaid).toBe(api.runtime === 'worker' ? null : 0);

    expectOk(
      expect,
      await api.put(
        `/api/loans/${id}`,
        loanForm({
          name: 'Car loan',
          principal: 14000,
          interest_rate: 3.9,
          term_months: 48,
          start_date: '2026-02-01',
          rate_periods: [],
        })
      ),
      'PUT the loan'
    );
    const changed = await loanDetail(api, expect, id);
    expect(changed).toMatchObject({
      name: 'Car loan',
      interest_rate: 3.9,
      term_months: 48,
      start_date: '2026-02-01',
      rate_periods: [],
    });
    expectMoney(expect, changed.principal, 14000);

    expectOk(expect, await api.delete(`/api/loans/${id}`), 'DELETE the loan');
    expect((await api.get(`/api/loans/${id}`)).status).toBe(404);
    expect(await loans(api, expect)).not.toContainEqual(expect.objectContaining({ id }));
    expect((await api.delete(`/api/loans/${id}`)).status).toBe(404);
  }),

  scenario(
    "another profile's loan is not read, changed, extended or removed",
    async (api, expect) => {
      const id = await loan(api, expect);
      const other = api.other;

      expect((await other.get(`/api/loans/${id}`)).status).toBe(404);
      expect(await loans(other, expect)).toEqual([]);
      expect((await other.put(`/api/loans/${id}`, loanForm({ name: 'Theirs' }))).status).toBe(404);
      expect((await other.post(`/api/loans/${id}/calculate`, {})).status).toBe(404);
      expect(
        (await other.post(`/api/loans/${id}/prepayments`, { month: 3, amount: 100, note: '' }))
          .status
      ).toBe(404);
      expect(
        (await other.post(`/api/loans/${id}/rates`, { rate: 9, start_month: 1, end_month: null }))
          .status
      ).toBe(404);
      expect((await other.delete(`/api/loans/${id}`)).status).toBe(404);

      expect(await loanDetail(api, expect, id)).toMatchObject({
        name: 'Car',
        interest_rate: 4.5,
        prepayments: [],
      });
    }
  ),

  scenario(
    'a loan saved without rate periods has none, so its own rate is the one charged',
    async (api, expect) => {
      // The Loans form always sends its rate periods, an empty list when there are none.
      const id = await loan(api, expect);
      expect((await loanDetail(api, expect, id)).rate_periods).toEqual([]);

      // Editing: the form loads the loan's periods, and sends them back with the new rate.
      const loaded = (await loanDetail(api, expect, id)).rate_periods as Json[];
      expectOk(
        expect,
        await api.put(
          `/api/loans/${id}`,
          loanForm({ interest_rate: 3, rate_periods: loaded.map(asForm) })
        ),
        'PUT a new rate'
      );
      // 15000 over 60 months at 3%.
      expectMoney(expect, (await schedule(api, expect, id)).schedule[0].payment, 269.53, 'payment');
    }
  ),

  scenario('extra payments are added, listed and removed', async (api, expect) => {
    const id = await loan(api, expect);
    // The Loans page's extra payment form.
    expectOk(
      expect,
      await api.post(`/api/loans/${id}/prepayments`, { month: 12, amount: 2000, note: 'Bonus' }),
      'POST an extra payment'
    );
    expectOk(
      expect,
      await api.post(`/api/loans/${id}/prepayments`, { month: 24, amount: 500.5, note: '' }),
      'POST another'
    );

    let extras = (await loanDetail(api, expect, id)).prepayments as Json[];
    expect(extras).toEqual([
      expect.objectContaining({ month: 12, amount: 2000, note: 'Bonus' }),
      expect.objectContaining({ month: 24, amount: 500.5 }),
    ]);
    const listed = (await loans(api, expect)).find((l) => l.id === id);
    expect(listed.prepayment_count).toBe(2);
    expectMoney(expect, listed.total_prepaid, 2500.5, 'total prepaid');

    // The page deletes an extra payment by the id the loan's detail gives it.
    expect(extras[0].id).toEqual(expect.any(Number));
    expectOk(
      expect,
      await api.delete(`/api/loans/${id}/prepayments/${extras[0].id}`),
      'DELETE the extra payment'
    );
    extras = (await loanDetail(api, expect, id)).prepayments as Json[];
    expect(extras).toEqual([expect.objectContaining({ month: 24, amount: 500.5 })]);
    expect((await api.other.delete(`/api/loans/${id}/prepayments/${extras[0].id}`)).status).toBe(
      404
    );
  }),

  scenario(
    'rate periods are added, changed and removed by their own routes',
    async (api, expect) => {
      const id = await loan(api, expect);
      expectOk(
        expect,
        await api.post(`/api/loans/${id}/rates`, { rate: 6, start_month: 13, end_month: 24 }),
        'POST a rate period'
      );
      let periods = (await loanDetail(api, expect, id)).rate_periods as Json[];
      expect(periods).toEqual([
        expect.objectContaining({ rate: 6, start_month: 13, end_month: 24 }),
      ]);
      expect(periods[0].id).toEqual(expect.any(Number));

      expectOk(
        expect,
        await api.put(`/api/loans/${id}/rates/${periods[0].id}`, {
          rate: 5.5,
          start_month: 13,
          end_month: 36,
        }),
        'PUT the rate period'
      );
      periods = (await loanDetail(api, expect, id)).rate_periods as Json[];
      expect(periods).toEqual([
        expect.objectContaining({ rate: 5.5, start_month: 13, end_month: 36 }),
      ]);

      expectOk(
        expect,
        await api.delete(`/api/loans/${id}/rates/${periods[0].id}`),
        'DELETE the rate period'
      );
      expect((await loanDetail(api, expect, id)).rate_periods).toEqual([]);
    }
  ),

  scenario('the amortization schedule, and what an extra payment saves', async (api, expect) => {
    const id = await loan(api, expect);
    let plan = await schedule(api, expect, id);
    // 15000 over 60 months at 4.5%.
    expect(plan.schedule).toHaveLength(60);
    expectMoney(expect, plan.schedule[0].payment, 279.65, 'payment');
    expect(plan.summary.totalPayments).toBe(60);
    expect(plan.summary.totalInterest).toBeCloseTo(1778.72, 0);

    expectOk(
      expect,
      await api.post(`/api/loans/${id}/prepayments`, { month: 12, amount: 2000, note: 'Bonus' }),
      'POST an extra payment'
    );
    plan = await schedule(api, expect, id);
    expect(plan.summary.totalPayments).toBe(52);
    expect(plan.summary.monthsSaved).toBe(8);
    expect(plan.summary.interestSaved).toBeCloseTo(1778.72 - 1418.42, 0);
    expect(plan.comparison.withoutPrepayments.totalPayments).toBe(60);

    // The list says where the loan stands today, from the same engine.
    const listed = (await loans(api, expect)).find((l) => l.id === id);
    expect(listed.monthly_payment).toBeGreaterThan(0);
    expect(listed.remaining_balance).toBeLessThan(15000);
  }),
];
