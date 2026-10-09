import { toCents } from '../money';
import type { LoanCalculation } from '../loanSchedule';

/**
 * Test data, not app code: loans as a person types them into the Loans dialog, the body the dialog
 * sends for each (features/loans/loanForm.ts, `loanBody`), the extra payments added on the loan's
 * Extra payments tab and the body that sends for each (features/loans/extraPaymentForm.ts,
 * `extraPaymentBody`), and what each schedule comes to, worked out in closed form rather than by
 * the engine.
 *
 * Both runtimes' tests POST each body through their own API, add its extra payments, calculate it
 * and list it: the Worker's in worker/test/loan-form-parity.test.ts, the local-first one in
 * frontend/src/core/storage/__tests__/loanFormParity.test.ts, which also checks that the forms send
 * exactly `body` for `typed`. Each must come to `expected` and `listed`, to the cent, so the two
 * runtimes give a loan saved from the dialog the same installment, total interest, payoff date and
 * extra payments total.
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
  /** Its extra payments, in the order they are added. */
  extras: FormExtra[];
  expected: ScheduleFigures;
  /** What the loan's row in `GET /api/loans` says about its extra payments. */
  listed: ListedFigures;
}

/** An extra payment as the Extra payments tab's add form holds it, and what the form sends. */
export interface FormExtra {
  typed: { month: string; amount: string; note: string };
  body: Record<string, unknown>;
}

export interface ScheduleFigures {
  /** The payment due in each of these months, to the cent: the installment, or the last one. */
  installments: { month: number; amount: number }[];
  /** The extra payments the schedule applies, added together by month, to the cent. */
  extras: { month: number; amount: number }[];
  totalInterest: number;
  payoffDate: string | null;
  payments: number;
}

/**
 * Every extra payment saved on the loan, counted and added up to the cent: one the schedule never
 * reaches, after the loan is paid off, counts too.
 */
export interface ListedFigures {
  total_prepaid: number;
  prepayment_count: number;
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
    extras: [],
    // 15,000 at 0.375 % a month over 60: 279.6452886..., and 60 of them less 15,000.
    expected: {
      installments: [{ month: 1, amount: 279.65 }],
      extras: [],
      totalInterest: 1778.72,
      payoffDate: '2030-12-15',
      payments: 60,
    },
    listed: { total_prepaid: 0, prepayment_count: 0 },
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
    extras: [],
    // 570.09 for payments 1-12 leaves 19,164.57; at 6.25 % over the 36 left that is 585.20 for
    // payments 13-30, which leaves 10,029.97; back at 4.5 % over the 18 left, 577.28.
    expected: {
      installments: [
        { month: 1, amount: 570.09 },
        { month: 13, amount: 585.2 },
        { month: 31, amount: 577.28 },
      ],
      extras: [],
      totalInterest: 2765.66,
      payoffDate: '2028-12-31',
      payments: 48,
    },
    listed: { total_prepaid: 0, prepayment_count: 0 },
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
    extras: [],
    expected: {
      installments: [{ month: 1, amount: 100 }],
      extras: [],
      totalInterest: 0,
      payoffDate: '2027-02-01',
      payments: 12,
    },
    listed: { total_prepaid: 0, prepayment_count: 0 },
  },
  {
    label: 'a loan with two extra payments in one month and one after it is paid off',
    typed: {
      name: 'Kitchen',
      principal: '12000',
      interest_rate: '6',
      term_months: '24',
      start_date: '2026-04-10',
      rate_periods: [],
    },
    body: {
      name: 'Kitchen',
      principal: 12000,
      interest_rate: 6,
      term_months: 24,
      start_date: '2026-04-10',
      rate_periods: [],
    },
    extras: [
      {
        typed: { month: '6', amount: '2500', note: 'Bonus' },
        body: { month: 6, amount: 2500, note: 'Bonus' },
      },
      {
        typed: { month: '6', amount: '1250,75', note: 'Tax refund' },
        body: { month: 6, amount: 1250.75, note: 'Tax refund' },
      },
      {
        typed: { month: '22', amount: '400', note: 'Late' },
        body: { month: 22, amount: 400, note: 'Late' },
      },
    ],
    // 12,000 at 0.5 % a month over 24: 531.8473230... After payment 6, 9,133.2907... is owed, and
    // the two extra payments with it, 3,750.75 together, leave 5,382.5407... At the same
    // installment that runs out in 11 more payments: payment 17 pays the 219.1463... left, on
    // 2027-08-10. Interest: 16 installments, the last payment and the extra payments, less 12,000.
    // The extra payment with payment 22 comes after that, so the schedule applies none of it, but
    // it is saved: the list counts three, 4,150.75 in all.
    expected: {
      installments: [
        { month: 1, amount: 531.85 },
        { month: 7, amount: 531.85 },
        { month: 17, amount: 219.15 },
      ],
      extras: [{ month: 6, amount: 3750.75 }],
      totalInterest: 479.45,
      payoffDate: '2027-08-10',
      payments: 17,
    },
    listed: { total_prepaid: 4150.75, prepayment_count: 3 },
  },
];

/** What `POST /api/loans/:id/calculate` answered, as the figures `expected` holds. */
export function scheduleFigures(answer: LoanCalculation, like: ScheduleFigures): ScheduleFigures {
  return {
    installments: like.installments.map(({ month }) => ({
      month,
      amount: toCents(answer.schedule[month - 1].payment),
    })),
    extras: answer.schedule
      .filter((row) => row.prepayment > 0)
      .map((row) => ({ month: row.month, amount: toCents(row.prepayment) })),
    totalInterest: toCents(answer.summary.totalInterest),
    payoffDate: answer.summary.payoffDate,
    payments: answer.summary.totalPayments,
  };
}

/** What `GET /api/loans` listed for the loan, as the figures `listed` holds. */
export function listedFigures(row: Record<string, unknown>): ListedFigures {
  return {
    total_prepaid: row.total_prepaid as number,
    prepayment_count: row.prepayment_count as number,
  };
}
