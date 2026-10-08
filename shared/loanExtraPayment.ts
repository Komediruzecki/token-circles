/**
 * An extra payment as a request body carries it, checked once for both runtimes: the Worker's
 * prepayment routes and the local-first handlers read it from here, so the two accept and refuse
 * the same bodies.
 */
import { MAX_TERM_MONTHS } from './loanSchedule';

/** What an extra payment stores: the payment it goes with, how much, and a note. */
export interface ExtraPayment {
  month: number;
  amount: number;
  note: string;
}

export type ExtraPaymentRead = { ok: true; value: ExtraPayment } | { ok: false; error: string };

/** The words for each refusal, written for the person filling in the form. */
export const EXTRA_PAYMENT_ERRORS = {
  month: 'Choose which payment the extra payment goes with.',
  amount: 'Enter an amount above zero.',
  note: 'The note must be text.',
} as const;

/**
 * The extra payment a body describes, or why it describes none. `month` is a whole payment number
 * from 1 to the loan's term, `amount` a number above zero, kept to the cent, and `note` text or
 * nothing at all.
 */
export function readExtraPayment(body: unknown, termMonths?: number | null): ExtraPaymentRead {
  const b = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const last =
    typeof termMonths === 'number' && termMonths >= 1
      ? Math.min(Math.floor(termMonths), MAX_TERM_MONTHS)
      : MAX_TERM_MONTHS;
  const month = b.month;
  if (typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > last) {
    return { ok: false, error: EXTRA_PAYMENT_ERRORS.month };
  }
  const amount = typeof b.amount === 'number' ? Math.round(b.amount * 100) / 100 : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: EXTRA_PAYMENT_ERRORS.amount };
  }
  const note = b.note ?? '';
  if (typeof note !== 'string') return { ok: false, error: EXTRA_PAYMENT_ERRORS.note };
  return { ok: true, value: { month, amount, note: note.trim() } };
}
