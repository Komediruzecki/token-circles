/**
 * Pure decisions about the `/api/billing/status` payload — chiefly waiting for a checkout to
 * land after Stripe sends the browser back, and what the resulting state entitles the UI to
 * offer.
 *
 * Separate from Settings.tsx on purpose, and for the same reason billingMail.ts is separate
 * from the webhook route: the interesting part is not the fetching, it is the decision — what
 * counts as "it landed", and when to stop waiting. Kept pure, that can be tested exhaustively
 * without timers or a network; inside the component it could only be tested by rendering the
 * whole of Settings and mocking fetch.
 *
 * WHY THIS EXISTS AT ALL. Stripe redirects to `/?billing=success` the instant payment
 * succeeds, but the plan is written by `checkout.session.completed`, which arrives out of band
 * on its own connection — measured at roughly 3 seconds on dev. Settings read the status once
 * at mount, so it raced that webhook and usually lost: the page sat showing Free until the user
 * reloaded by hand.
 */

/** The parts of /api/billing/status that tell us whether anything moved. */
export interface BillingSnapshot {
  plan?: string
  status?: string | null
  interval?: string | null
}

/**
 * Statuses the worker treats as entitled (`isEntitled` in routes/billing.ts). `past_due` is in
 * that list deliberately -- it is a dunning grace window, not a lapse -- so a plan landing in
 * that state still counts as arrived. Keep the two in step.
 */
const ENTITLED = new Set(['active', 'trialing', 'past_due'])

/**
 * Has the tier the user just bought actually landed?
 *
 * `expected` comes from the `plan` query param the worker puts on `success_url`. It is needed
 * because a checkout return is a FRESH PAGE LOAD: every scrap of pre-checkout client state is
 * gone, so there is nothing to diff against. Comparing to "whatever we read first" instead is
 * wrong in the case that matters most -- switching Advanced -> Ultimate reads `advanced` on the
 * first poll, which is the tier being left, and announcing it would be actively misleading.
 *
 * 'premium' is the legacy single-price alias for 'advanced'; a row still carrying it satisfies
 * an expectation of either.
 *
 * `expectedInterval` exists because the tier alone cannot see a monthly <-> annual switch: the
 * plan either side of it is the same one, and it is already entitled, so the very first read
 * matched and we announced "Switched to the Basic plan" before Stripe had moved anything. When
 * an interval is expected, it has to be the one on the row before this counts as landed. Null
 * means no hint -- a checkout link made before the interval travelled in the URL, or a caller
 * that has none -- and is not treated as a mismatch.
 */
export function billingActivated(
  expected: string | null,
  after: BillingSnapshot | null,
  expectedInterval?: string | null
): boolean {
  if (!after?.plan || !ENTITLED.has(after.status ?? '')) return false
  // A row that predates migration 0025 has no interval at all. Holding out for one would poll
  // the full 17 seconds and then announce nothing, so an absent interval is "cannot tell",
  // never "wrong".
  if (expectedInterval && after.interval && after.interval !== expectedInterval) return false
  if (!expected) return after.plan !== 'free' // no hint in the URL: any entitled paid plan will do
  if (expected === 'advanced' || expected === 'premium')
    return after.plan === 'advanced' || after.plan === 'premium'
  return after.plan === expected
}

/**
 * Is there a Stripe subscription behind this plan for the user to go and manage?
 *
 * Free has none. Neither does a comped plan: it was granted directly, so the account has no
 * `stripe_customer_id` and `/api/billing/portal` answers 400 "No billing account yet". The
 * manage link was offered on "not free" alone, which put a link that could only fail directly
 * above a plan card already reading "Granted — nothing to manage".
 */
export function hasManageableSubscription(billing: BillingSnapshot | null): boolean {
  if (!billing?.plan || billing.plan === 'free') return false
  return billing.status !== 'comped'
}

/**
 * Backoff between reads, in ms. Front-loaded because the webhook usually lands in the first few
 * seconds, then spaced out so a slow one is still caught. Totals ~17s, which is the point past
 * which a person has already decided the page is broken and reloaded it themselves.
 */
export const BILLING_CONFIRM_DELAYS_MS = [600, 1200, 2000, 3000, 4500, 6000]

export type BillingConfirmOutcome = 'changed' | 'timeout'

/**
 * Re-read the billing status until the expected plan is entitled, or until the delays run out.
 *
 * `read` and `sleep` are injected so tests drive this with neither a network nor a clock.
 * Returns 'timeout' rather than throwing: Stripe has taken the money either way, so a timeout
 * is "not seen yet", never "failed", and the caller must not announce it as an error.
 */
export async function confirmBillingActivation(opts: {
  expected: string | null
  /** Monthly or annual, when the caller knows which was bought. See billingActivated. */
  expectedInterval?: string | null
  read: () => Promise<BillingSnapshot | null>
  sleep: (ms: number) => Promise<void>
  delays?: number[]
  onChanged?: (after: BillingSnapshot) => void
}): Promise<BillingConfirmOutcome> {
  const delays = opts.delays ?? BILLING_CONFIRM_DELAYS_MS
  for (const wait of delays) {
    await opts.sleep(wait)
    const after = await opts.read()
    if (billingActivated(opts.expected, after, opts.expectedInterval)) {
      opts.onChanged?.(after as BillingSnapshot)
      return 'changed'
    }
  }
  return 'timeout'
}
