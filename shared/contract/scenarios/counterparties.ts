import { addTransaction } from '../helpers';
import { expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';

async function counterpartyList(api: ContractApi, expect: Expect): Promise<Json[]> {
  const reply = await api.get('/api/counterparties');
  expectOk(expect, reply, 'GET /api/counterparties');
  return reply.body as Json[];
}

export const counterparties = [
  scenario('who money went to and came from, netted per name', async (api, expect) => {
    const entry = (fields: Record<string, unknown>) => addTransaction(api, expect, fields);
    await entry({ description: 'Groceries', amount: 45.5, beneficiary: 'Corner Shop' });
    await entry({ description: 'Groceries', amount: 30.25, beneficiary: 'Corner Shop' });
    await entry({ description: 'Rent', amount: 800, beneficiary: 'Landlord' });
    await entry({ description: 'Refund', amount: 10, type: 'income', payor: 'Corner Shop' });
    await entry({ description: 'Salary', amount: 2500, type: 'income', payor: 'Employer' });
    // Neither a beneficiary nor a payor.
    await entry({ description: 'Coffee', amount: 4.5 });
    await addTransaction(api.other, expect, {
      description: 'Groceries',
      amount: 99,
      beneficiary: 'Corner Shop',
    });

    // Largest net first, either way.
    const named = [
      { name: 'Employer', incoming: 2500, outgoing: 0, net: 2500, transaction_count: 1 },
      { name: 'Landlord', incoming: 0, outgoing: 800, net: -800, transaction_count: 1 },
      { name: 'Corner Shop', incoming: 10, outgoing: 75.75, net: -65.75, transaction_count: 3 },
    ];
    // DIFFERENCE counterparties-from-description
    expect(await counterpartyList(api, expect)).toEqual(
      api.runtime === 'worker'
        ? named
        : [
            ...named,
            { name: 'Coffee', incoming: 0, outgoing: 4.5, net: -4.5, transaction_count: 1 },
          ]
    );
    expect(await counterpartyList(api.other, expect)).toEqual([
      { name: 'Corner Shop', incoming: 0, outgoing: 99, net: -99, transaction_count: 1 },
    ]);
  }),
];
