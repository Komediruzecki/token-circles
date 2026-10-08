import { expectMoney } from '../helpers';
import { QUOTES } from '../outbound';
import { expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';

/** The body the Portfolio form saves (features/Portfolio.tsx, handleSubmit). */
function holdingForm(fields: Record<string, unknown> = {}) {
  return {
    ticker: 'ACME',
    shares: 10,
    purchase_price: 100.25,
    purchase_date: '2026-02-10',
    notes: 'First buy',
    ...fields,
  };
}

async function addHolding(api: ContractApi, expect: Expect, fields: Record<string, unknown> = {}) {
  const reply = await api.post('/api/portfolio/holdings', holdingForm(fields));
  expectOk(expect, reply, 'POST /api/portfolio/holdings');
  expect(reply.status).toBe(201);
  return reply.body;
}

async function holdings(api: ContractApi, expect: Expect): Promise<Json[]> {
  const reply = await api.get('/api/portfolio/holdings');
  expectOk(expect, reply, 'GET /api/portfolio/holdings');
  return reply.body as Json[];
}

export const portfolio = [
  scenario('a holding is added, read back, changed and removed', async (api, expect) => {
    const added = await addHolding(api, expect);
    expect(added).toMatchObject({
      id: expect.any(Number),
      ticker: 'ACME',
      shares: 10,
      purchase_price: 100.25,
      purchase_date: '2026-02-10',
      notes: 'First buy',
    });
    const id = added.id as number;

    // Without a live price, a holding is valued at what was paid for it.
    let row = (await holdings(api, expect)).find((h) => h.id === id);
    expect(row).toMatchObject({ ticker: 'ACME', shares: 10, gain: 0, gainPercent: 0 });
    expectMoney(expect, row.currentPrice, 100.25, 'price');
    expectMoney(expect, row.marketValue, 1002.5, 'value');
    expectMoney(expect, row.costBasis, 1002.5, 'cost');

    // The form's edit sends the whole holding again.
    const changed = await api.put(
      `/api/portfolio/holdings/${id}`,
      holdingForm({ shares: 12, purchase_price: 98, purchase_date: '2026-02-11', notes: '' })
    );
    expectOk(expect, changed, 'PUT the holding');
    expect(changed.body).toMatchObject({ id, shares: 12, purchase_price: 98, notes: '' });
    row = (await holdings(api, expect)).find((h) => h.id === id);
    expect(row).toMatchObject({ shares: 12, purchase_date: '2026-02-11', notes: '' });
    expectMoney(expect, row.costBasis, 1176, 'cost');

    expectOk(expect, await api.delete(`/api/portfolio/holdings/${id}`), 'DELETE the holding');
    expect(await holdings(api, expect)).toEqual([]);
    expect((await api.delete(`/api/portfolio/holdings/${id}`)).status).toBe(404);
    const empty = await api.get('/api/portfolio/summary');
    expectOk(expect, empty, 'GET /api/portfolio/summary with no holdings');
    expect(empty.body).toEqual({
      totalValue: 0,
      totalCostBasis: 0,
      totalGain: 0,
      totalGainPercent: 0,
      holdings: [],
      allocation: [],
    });
  }),

  scenario("another profile's holding is not changed or removed", async (api, expect) => {
    const { id } = await addHolding(api, expect);
    const other = api.other;
    expect(await holdings(other, expect)).toEqual([]);
    expect(
      (await other.put(`/api/portfolio/holdings/${id}`, holdingForm({ shares: 1 }))).status
    ).toBe(404);
    expect((await other.delete(`/api/portfolio/holdings/${id}`)).status).toBe(404);
    expect(await holdings(api, expect)).toEqual([
      expect.objectContaining({ id, ticker: 'ACME', shares: 10 }),
    ]);
  }),

  scenario('live prices for the tickers held', async (api, expect) => {
    // The Portfolio page's refresh sends every ticker it holds.
    const reply = await api.post('/api/portfolio/prices', { tickers: ['ACME', 'NOPE'] });
    expectOk(expect, reply, 'POST /api/portfolio/prices');
    // DIFFERENCE portfolio-prices
    if (api.runtime === 'worker') {
      const acme = QUOTES.ACME;
      expect(reply.body).toEqual({
        ACME: {
          price: acme.price,
          previousClose: acme.previousClose,
          change: 0.5,
          changePercent: expect.any(Number),
          currency: 'USD',
          name: 'Acme Corp',
        },
      });
      expect(reply.body.ACME.changePercent).toBeCloseTo((0.5 / 12) * 100, 6);
    } else {
      expect(reply.body).toEqual({});
    }
    expect((await api.post('/api/portfolio/prices', { tickers: [] })).status).toBe(400);
  }),
];
