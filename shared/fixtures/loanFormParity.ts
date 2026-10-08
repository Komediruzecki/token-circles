import { toCents } from '../money';
import type { LoanCalculation } from '../loanSchedule';

/**
 * Test data, not app code: loans as a person types them into the Loans dialog, the body the dialog
 * sends for each (features/loans/loanForm.ts, `loanBody`), and what each schedule comes to, worked
 * out in closed form rather than by the engine.
 *
 * Both runtimes' tests POST each body through their own API and calculate it: the Worker's in
 * worker/test/loan-form-parity.test.ts, the local-first one in
 * frontend/src/core/storage/__tests__/loanFormParity.test.ts, which also checks that the dialog
 * sends exactly `body` for `typed`. Each must come to `expected`, to the cent, so the two runtimes
 * give a loan saved from the dialog the same installment, total interest and payoff date.
 *
 * The installment is P r / (1 - (1 + r)^-n), with r the monthly rate; at a rate change it is
 * worked out again on the balance left, over the payments left. The total interest is every
 * installment paid less the amount borrowed. The figures were worked out with 60-digit decimals.
 */
export interface FormLoan {
  /** What the test is called. */
  label: string;
  /** What is typed, field by field, as the dialog holds it. */
  typed: {
    name: string;
    principal: string;
    interest_rate: string;
    term_months: string;
    start_date: string;
    rate_periods: { rate: string; start_month: string; end_month: string }[];
  };
  /** What the dialog sends for it. */
  body: Record<string, unknown>;
  expected: ScheduleFigures;
}

export interface ScheduleFigures {
  /** The installment from each of these payments on, to the cent. */
  installments: { month: number; amount: number }[];
  totalInterest: number;
  payoffDate: string | null;
  payments: number;
}

export const FORM_LOANS: FormLoan[] = [
  {
    label: 'a car loan at one rate',
    typed: {
      name: 'Car',
      principal: '15000',
      interest_rate: '4.5',
      term_months: '60',
      start_date: '2026-01-15',
      rate_periods: [],
    },
    body: {
      name: 'Car',
      principal: 15000,
      interest_rate: 4.5,
      term_months: 60,
      start_date: '2026-01-15',
      rate_periods: [],
    },
    // 15,000 at 0.375 % a month over 60: 279.6452886..., and 60 of them less 15,000.
    expected: {
      installments: [{ month: 1, amount: 279.65 }],
      totalInterest: 1778.72,
      payoffDate: '2030-12-15',
      payments: 60,
    },
  },
  {
    label: 'a loan with a rate period, typed with decimal commas',
    typed: {
      name: 'Flat',
      principal: '25000',
      interest_rate: '4,5',
      term_months: '48',
      start_date: '2025-01-31',
      rate_periods: [{ rate: '6,25', start_month: '13', end_month: '30' }],
    },
    body: {
      name: 'Flat',
      principal: 25000,
      interest_rate: 4.5,
      term_months: 48,
      start_date: '2025-01-31',
      rate_periods: [{ rate: 6.25, start_month: 13, end_month: 30 }],
    },
    // 570.09 for payments 1-12 leaves 19,164.57; at 6.25 % over the 36 left that is 585.20 for
    // payments 13-30, which leaves 10,029.97; back at 4.5 % over the 18 left, 577.28.
    expected: {
      installments: [
        { month: 1, amount: 570.09 },
        { month: 13, amount: 585.2 },
        { month: 31, amount: 577.28 },
      ],
      totalInterest: 2765.66,
      payoffDate: '2028-12-31',
      payments: 48,
    },
  },
  {
    label: 'an interest-free loan',
    typed: {
      name: 'Family loan',
      principal: '1200',
      interest_rate: '0',
      term_months: '12',
      start_date: '2026-03-01',
      rate_periods: [],
    },
    body: {
      name: 'Family loan',
      principal: 1200,
      interest_rate: 0,
      term_months: 12,
      start_date: '2026-03-01',
      rate_periods: [],
    },
    expected: {
      installments: [{ month: 1, amount: 100 }],
      totalInterest: 0,
      payoffDate: '2027-02-01',
      payments: 12,
    },
  },
];

/** What `POST /api/loans/:id/calculate` answered, as the figures `expected` holds. */
export function scheduleFigures(answer: LoanCalculation, like: ScheduleFigures): ScheduleFigures {
  return {
    installments: like.installments.map(({ month }) => ({
      month,
      amount: toCents(answer.schedule[month - 1].payment),
    })),
    totalInterest: toCents(answer.summary.totalInterest),
    payoffDate: answer.summary.payoffDate,
    payments: answer.summary.totalPayments,
  };
}
