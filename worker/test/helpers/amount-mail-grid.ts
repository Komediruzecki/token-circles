/**
 * A grid of inputs for the four mails that show an amount of money (the first shell in
 * emailTemplates.ts), covering each renderer's branches, and one digest per renderer over every
 * output of its grid. mail-catalogue.test.ts pins those digests.
 *
 * It takes the renderers as an argument and imports nothing, so a plain Node script can run the
 * same grid against another copy of emailTemplates.ts (Node strips the types).
 */
import type * as Templates from '../../src/emailTemplates';

type AmountRenderers = Pick<
  typeof Templates,
  'renderBudgetAlert' | 'renderBillsReminder' | 'renderSpendingReport' | 'renderPaymentFailed'
>;

const CURRENCIES = ['EUR', 'USD', null];
const UNSUBSCRIBE = ['https://api.example.com/api/notifications/unsubscribe?token=a&b=<c>', null];
const ORIGINS = ['https://dev.example.com', undefined];
const TEST = [true, false];

/** Every combination of the values in `axes`, as objects. */
function grid<T extends Record<string, readonly unknown[]>>(
  axes: T
): Array<{ [K in keyof T]: T[K][number] }> {
  let rows: Array<Record<string, unknown>> = [{}];
  for (const [key, values] of Object.entries(axes)) {
    rows = rows.flatMap((row) => values.map((value) => ({ ...row, [key]: value })));
  }
  return rows as Array<{ [K in keyof T]: T[K][number] }>;
}

const ALERTS = [
  [],
  // Over budget only: the sentence and preheader for a budget gone over.
  [
    {
      categoryName: 'Groceries',
      categoryColor: '#22c55e',
      budgetAmount: 400,
      spent: 440,
      percentage: 110,
      status: 'over' as const,
    },
  ],
  // A warning only: the sentence and preheader for budgets approaching their limit.
  [
    {
      categoryName: 'Dining <b>&</b> "out"',
      categoryColor: 'red',
      budgetAmount: 100,
      spent: 90,
      percentage: 90,
      status: 'warning' as const,
    },
  ],
  // Both, and a colour that is not one.
  [
    {
      categoryName: 'Rent',
      categoryColor: 'url(javascript:x)',
      budgetAmount: 1,
      spent: 2,
      percentage: 200,
      status: 'over' as const,
    },
    {
      categoryName: 'Fuel',
      categoryColor: '#abcdef',
      budgetAmount: 1000.5,
      spent: 800.25,
      percentage: 80,
      status: 'warning' as const,
    },
  ],
];

const BILLS = [
  [],
  [{ name: 'Rent', amount: 900, due_date: '2026-11-01', daysUntilDue: 0, overdue: false }],
  // Tomorrow, in two days, in five, and one with no due date.
  [
    { name: 'Streaming <x>', amount: 10, due_date: null, daysUntilDue: 1, overdue: false },
    { name: 'Water', amount: 33.3, due_date: '2026-11-03', daysUntilDue: 2, overdue: false },
    { name: 'Gym', amount: 25, due_date: '2026-11-06', daysUntilDue: 5, overdue: false },
  ],
  // One overdue alone, then two overdue with one upcoming.
  [{ name: 'Old', amount: 5, due_date: '2026-10-01', daysUntilDue: -30, overdue: true }],
  [
    { name: 'Old 1', amount: 5, due_date: '2026-10-01', daysUntilDue: -30, overdue: true },
    { name: 'Old 2', amount: 6, due_date: '2026-10-02', daysUntilDue: -29, overdue: true },
    { name: 'Phone', amount: 20, due_date: '2026-11-04', daysUntilDue: 3, overdue: false },
  ],
];

const REPORTS = [
  // With categories, one of them with no name and no colour; a positive net.
  {
    totalIncome: 2000,
    totalExpenses: 1500,
    netBalance: 500,
    categoryBreakdown: [
      { name: 'Rent', color: '#6e9bff', total: 900 },
      { name: null, color: null, total: 4 },
    ],
    transactionCount: 40,
    startDate: '2026-10-01',
    endDate: '2026-10-15',
  },
  // Without categories, a negative net, and dates that need escaping.
  {
    totalIncome: 0,
    totalExpenses: 300,
    netBalance: -300,
    categoryBreakdown: [],
    transactionCount: 1,
    startDate: '<s>',
    endDate: '&e',
  },
  // No transactions: no mail.
  {
    totalIncome: 0,
    totalExpenses: 0,
    netBalance: 0,
    categoryBreakdown: [],
    transactionCount: 0,
    startDate: 'a',
    endDate: 'b',
  },
];

/** The inputs, by renderer. */
export function amountMailGrid() {
  return {
    renderBudgetAlert: grid({
      alerts: ALERTS,
      currency: CURRENCIES,
      unsubUrl: UNSUBSCRIBE,
      periodLabel: ['November 2026', undefined],
      test: TEST,
      assetOrigin: ORIGINS,
    }),
    renderBillsReminder: grid({
      bills: BILLS,
      currency: CURRENCIES,
      unsubUrl: UNSUBSCRIBE,
      test: TEST,
      assetOrigin: ORIGINS,
    }),
    renderSpendingReport: grid({
      report: REPORTS,
      currency: CURRENCIES,
      unsubUrl: UNSUBSCRIBE,
      periodLabel: ['October 2026, first half', undefined],
      test: TEST,
      assetOrigin: ORIGINS,
    }),
    // With and without an amount (none, zero, a fraction) and a retry date; with and without a
    // page to pay on and an app to link into; a plan name that needs escaping.
    renderPaymentFailed: grid({
      planName: ['Basic', 'Premium & <Co> "x"'],
      amountDue: [4, 0, null, 12.345],
      currency: ['EUR', null],
      nextAttempt: [new Date('2026-11-04T00:00:00Z'), null],
      payUrl: ['https://invoice.example.com/i/x?a=1&b=2', null],
      appUrl: ORIGINS,
    }),
  };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * One digest per renderer: of every output its grid renders, in order (a mail's subject, HTML and
 * text, or null for no mail), with the footer's year read as YYYY so the pin does not expire with
 * the calendar. Also the number of inputs, so a grid that shrinks shows.
 */
export async function amountMailDigests(
  renderers: AmountRenderers
): Promise<Record<string, { inputs: number; digest: string }>> {
  const year = String(new Date().getUTCFullYear());
  const out: Record<string, { inputs: number; digest: string }> = {};
  for (const [name, inputs] of Object.entries(amountMailGrid())) {
    const render = renderers[name as keyof AmountRenderers] as (input: unknown) => unknown;
    const rendered = inputs.map((input) => JSON.stringify(render(input)));
    out[name] = {
      inputs: inputs.length,
      digest: await sha256(rendered.join('\n').replaceAll(`&copy; ${year}`, '&copy; YYYY')),
    };
  }
  return out;
}
