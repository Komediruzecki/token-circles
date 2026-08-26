/**
 * The one Stripe API version this worker speaks.
 *
 * It is sent as `Stripe-Version` on every outbound call, and it is deliberately the same version
 * the prod webhook endpoint sends. Those are two independent knobs -- this header decides the
 * shape of what comes back from api.stripe.com, while the endpoint's version (set per-endpoint in
 * the dashboard, else the account default) decides the shape of what Stripe pushes at us -- and
 * nothing enforces that they agree. Keeping them equal is not a rule Stripe imposes; it means
 * there is one payload shape to hold in your head instead of two, which is worth more than the
 * flexibility of running them apart.
 *
 * It lives here rather than in routes/billing.ts so that "every call we make is pinned" is a
 * property you can check by grepping for the import, not by reading each call site.
 *
 * ── How Stripe versions move ────────────────────────────────────────────────
 * A breaking release lands every six months, flora-named and alphabetical: acacia 2024-09-30,
 * basil 2025-03-31, clover 2025-09-30, dahlia 2026-03-25. The dated releases in between carry the
 * previous flower's name and are additive ONLY -- 2026-06-24.dahlia contains no breaking changes
 * whatsoever. So a bump within a release is free; a bump across flowers is not, and is what the
 * audit below is for.
 *
 * ── What crossing 2024-06-20 -> 2026-06-24.dahlia actually changed for us ────
 * All four flora releases, and exactly two of their breaking changes reach this worker:
 *
 *   basil   `current_period_end` moved off the Subscription onto the subscription ITEM, and the
 *           top-level field was removed. Both readers in routes/billing.ts take the item first.
 *           The top-level fallback stays anyway, because what it guards is the WEBHOOK payload,
 *           and an endpoint can be pinned older than this constant. A missing period end does not
 *           throw -- it writes NULL, the billing card quietly drops the renewal date, and nobody
 *           notices for a month -- so the subscription branch logs the sending version when it
 *           finds the field in neither place.
 *
 *   clover  Flexible billing mode became the default for NEWLY created subscriptions, changing
 *           how prorations are calculated. Every tier change sends
 *           `proration_behavior=create_prorations`, so this is the one live behavioural
 *           difference. Subscriptions created before the bump keep classic mode; only ones
 *           created after it are affected.
 *
 * Everything else those releases broke is Stripe.js / Elements (never loaded -- checkout is a
 * plain redirect to `session.url`), Connect, Issuing, Terminal, Radar, coupons, invoices, or
 * legacy usage-based billing. None of it is reachable from the calls this worker makes:
 * `GET /v1/subscriptions`, `POST /v1/subscriptions/{id}`, `POST /v1/checkout/sessions`,
 * `POST /v1/billing_portal/sessions`, and `DELETE /v1/customers/{id}`.
 *
 * Bumping this is therefore a deliberate exercise -- re-run that audit against the changelog for
 * each flower crossed -- not something to do to make two numbers match.
 */
export const STRIPE_API_VERSION = '2026-06-24.dahlia';
