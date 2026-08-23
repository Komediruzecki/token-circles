/**
 * Which mail, if any, a Stripe billing event should produce.
 *
 * Separate from the webhook route on purpose. The interesting part of this feature is not the
 * sending — it is the decisions: which of three quite different messages an event deserves, and
 * the several cases where the right answer is silence. Kept pure, those decisions can be tested
 * exhaustively; mixed into the route they could only be tested through an outbound HTTP call.
 *
 * The route still owns everything stateful: reading the account before the plan changes, the
 * ordering guard, and the best-effort send.
 */
import type { RenderedEmail } from './emailTemplates';
import {
  renderPaymentActionRequired,
  renderPaymentFailed,
  renderSubscriptionEnded,
} from './emailTemplates';
import { planOf } from './plans';

/** What the route knows about the account behind the Stripe customer id. */
export interface BillingAccount {
  email: string | null;
  plan: string | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * The mail for this event, or null when there is nothing worth saying.
 *
 * `subscription.deleted` is only passed in when the route's ordering guard actually applied the
 * change — a late event that changed nothing must not announce that it did.
 */
export function mailForBillingEvent(
  type: string,
  obj: Record<string, unknown>,
  account: BillingAccount | null,
  appUrl: string
): { to: string; mail: RenderedEmail } | null {
  // No address, no mail. A Google account can reach this state with its email left off.
  const to = account?.email;
  if (!to) return null;
  const planName = planOf(account?.plan).name;

  switch (type) {
    case 'invoice.payment_failed': {
      // Not the first invoice of a checkout: the user is standing in front of Stripe's own error
      // at that moment, and a mail about it arrives after they have already tried again.
      if (str(obj.billing_reason) === 'subscription_create') return null;
      const attempt = num(obj.next_payment_attempt);
      const amount = num(obj.amount_due);
      return {
        to,
        mail: renderPaymentFailed({
          planName,
          // Stripe reports minor units; the template formats a real amount.
          amountDue: amount === null ? null : amount / 100,
          currency: str(obj.currency)?.toUpperCase() ?? null,
          nextAttempt: attempt === null ? null : new Date(attempt * 1000),
          // Stripe's hosted page is the only place the card can actually be replaced.
          payUrl: str(obj.hosted_invoice_url),
          appUrl,
        }),
      };
    }
    case 'invoice.payment_action_required':
      // Deliberately not the same mail as a decline. Nothing is wrong, and the only thing that
      // fixes it is the user opening a page — which a "your payment failed" subject makes them
      // less likely to do, not more.
      return {
        to,
        mail: renderPaymentActionRequired({
          planName,
          payUrl: str(obj.hosted_invoice_url),
          appUrl,
        }),
      };
    case 'customer.subscription.deleted':
      return { to, mail: renderSubscriptionEnded({ planName, appUrl }) };
    default:
      return null;
  }
}
