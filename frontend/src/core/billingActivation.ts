/**
 * Waiting for a checkout to land, after Stripe sends the browser back.
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
 */
export function billingActivated(expected: string | null, after: BillingSnapshot | null): boolean {
  if (!after?.plan || !ENTITLED.has(after.status ?? '')) return false
  if (!expected) return after.plan !== 'free' // no hint in the URL: any entitled paid plan will do
  if (expected === 'advanced' || expected === 'premium')
    return after.plan === 'advanced' || after.plan === 'premium'
  return after.plan === expected
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
  read: () => Promise<BillingSnapshot | null>
  sleep: (ms: number) => Promise<void>
  delays?: number[]
  onChanged?: (after: BillingSnapshot) => void
}): Promise<BillingConfirmOutcome> {
  const delays = opts.delays ?? BILLING_CONFIRM_DELAYS_MS
  for (const wait of delays) {
    await opts.sleep(wait)
    const after = await opts.read()
    if (billingActivated(opts.expected, after)) {
      opts.onChanged?.(after as BillingSnapshot)
      return 'changed'
    }
  }
  return 'timeout'
}
