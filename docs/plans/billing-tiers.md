# Billing: three paid tiers that actually differ

Status: **shipped** in #546 (released in 5.14.0, 2026-09-08), with the light-theme card art
following in #553 and the `?plan=<tier>` deep link in #552. Kept as the record of what was built
and why. Companion to `worker/src/plans.ts`, which is the single source of truth — most of this
was edits to that one object plus the gates that read it.

## The problem

The tiers do not differ. Free is genuinely different — no cloud, no server — but Basic, Advanced
and Ultimate carry **identical feature flags**:

```ts
features: { cloudSync: true, emailReminders: true, receipts: true, advancedReports: true }
```

Only three numbers separate them: profiles, receipts and reminders. So the pricing page asks
somebody to pay 3x for "more of the same", and the two upgrade steps have nothing on them a
person can want by name. Meanwhile the app has grown capabilities that nobody is being asked to
pay for at all — the public API and the MCP server are ungated, so a Free account can drive the
whole product from a script.

Two constraints shape everything below:

- **Free must stay genuinely useful.** Local-first is the product's argument. Free is not a
  trial; it is the whole app on your own device. What paid buys is _our_ infrastructure —
  servers, storage, email, compute — never a feature that could run on the user's machine.
- **Tiers are cumulative.** Each tier is "everything before, plus…". That is how the cards
  should read and how the Stripe descriptions should read.

## The shape

|                              | **Free**               | **Basic** €3/mo          | **Advanced** €6/mo        | **Ultimate** €10/mo          |
| ---------------------------- | ---------------------- | ------------------------ | ------------------------- | ---------------------------- |
|                              | Your device, your data | Everything in Free, plus | Everything in Basic, plus | Everything in Advanced, plus |
| Profiles                     | 2                      | 5                        | 10                        | Unlimited                    |
| Cloud sync                   | —                      | Yes                      | Yes                       | Yes                          |
| Email reminders              | —                      | **500**/mo               | **2 000**/mo              | Unlimited                    |
| Receipt storage              | —                      | 500                      | 5 000                     | Unlimited                    |
| Advanced reports (tax & P&L) | —                      | Yes                      | Yes                       | Yes                          |
| **API access + MCP**         | —                      | **Yes**                  | Yes                       | Yes                          |
| **API tokens**               | —                      | **2**                    | **10**                    | **Unlimited**                |
| **Automated imports**        | —                      | —                        | **Yes**                   | Yes                          |
| **Priority support**         | —                      | —                        | —                         | **Yes**                      |

Annual is unchanged: 10 months for 12 (€30 / €60 / €100).

### What changed and why

**Email reminders drop hard.** 2 000 and 20 000 a month were never real: a household on top of
every bill sends maybe 30. The old numbers advertised a cost we would eat if anyone took them
literally, and they made the Basic→Advanced step look absurd (2 000 → 20 000 of something
nobody uses ten of). **500 / 2 000 / unlimited** is generous against real use and honest about
what it is protecting.

**API access becomes a listed paid feature.** It already _needs_ cloud sync — an API token
authenticates against the account's server data, which Free does not have — so it is paid in
practice today, just not enforced or advertised. Two things follow:

- It should be **on the pricing page**, because "there is an API and an MCP server" is a reason
  to choose the product, and right now nobody reading the plans learns it exists.
- It should be **enforced**, because `POST /api/api-tokens` and the MCP routes currently carry
  no plan gate at all.

**Token count is the tier lever, not access.** Access at Basic keeps the promise simple; the
count separates a person automating their own budget from someone running an integration.

**Automated imports are the Advanced hook.** `import_sources` already carries a `schedule`
column, so scheduled ingestion is the natural paid-compute feature: it runs on our machines
while the user is asleep. Manual import stays free forever — it is the user's own file.

**Priority support is the Ultimate hook.** It costs no engineering, it is what the people who
pay 10 a month actually want, and it is honest: a named response time, not a feature flag.

## What else could be gated — and what should not be

Surveyed the whole surface. Most of it should stay free, and saying why matters as much as the
list.

### Reasonable candidates

| Candidate                                                 | Tier      | Argument                                              |
| --------------------------------------------------------- | --------- | ----------------------------------------------------- |
| **Scheduled/automated imports**                           | Advanced  | Our compute, on a schedule. Already modelled.         |
| **API token count**                                       | all three | A count is a fair meter on an integration surface.    |
| **Priority support**                                      | Ultimate  | Costs time, not code. Wanted by exactly that buyer.   |
| **Receipt OCR / auto-extract**                            | Advanced  | Not built. Real per-call cost when it is.             |
| **Household sharing** (a second sign-in on one household) | Advanced  | Real server cost per seat; the natural "family" step. |
| **Longer retention of deleted data** (30 vs 7 days)       | Ultimate  | Storage cost, and a genuine safety net.               |
| **Larger receipt file cap** (5 MB → 25 MB)                | Ultimate  | Bandwidth and R2. One constant already exists.        |

### Deliberately not gated

- **Every calculator, chart, budget, goal, loan, retirement and housing tool.** They compute on
  the device. Charging for arithmetic the user's own browser does is the thing that would make
  the local-first claim a lie.
- **Achievements and the Progress page.** A badge behind a paywall is an insult, not a mechanic.
- **Manual import and CSV export.** The user's own data, in and out, always. Locking export is
  hostage-taking and would undercut the whole pitch.
- **Bank connectivity** (when it lands) — it will have a real per-connection cost, so it will
  need its own decision rather than being folded in here on the assumption it is Ultimate.
- **Encryption** (when it lands) — on every tier, including Free. Security is not an
  upsell, and an AGPL repo publishes the implementation anyway.

## The card art

The plan cards are plain bordered boxes with inline styles. Four generated backgrounds, one per
tier, in the brand's own language: the medallion's ring motif, navy ground, azure into gold as
the tier climbs — Free coolest and flattest, Ultimate the deepest gold. Same treatment as the
badge faces, so the paid surface and the reward surface look like one product.

- Generated at high resolution, then downscaled to a ~1200x800 WebP each, ~25 KB, as
  `frontend/public/plans/card-<tier>.webp`.
- Applied as a `background-image` behind the existing content at low opacity with a solid
  fallback, so the cards degrade to exactly what they are now if an image fails.
- Text contrast checked against the ground in both themes before it ships.

## Stripe

The tier descriptions in Stripe should match the cards word for word, because a customer sees
them again in checkout and on the invoice.

The Stripe CLI is installed and configured for the TokenCircles account, but **the live key is
expired** — `stripe products list --live` returns "your live mode API key needs to be
re-configured". So:

1. You run `stripe login` (interactive; it cannot be done from here).
2. I read the live products and prices and diff them against the table above.
3. I show you the exact `stripe products update` calls, and you say go before anything is
   written to the live account.

Test mode is reachable now and holds only a fixture product, so the rehearsal can happen there
first.

## Sizing

| Piece                                                       | Size         | Notes                                             |
| ----------------------------------------------------------- | ------------ | ------------------------------------------------- |
| `plans.ts`: new limits, new feature flags, reminder numbers | small        | One object; every gate reads through helpers      |
| Enforce API access + token count                            | small        | `requireFeature` on the api-tokens and MCP routes |
| Enforce automated imports                                   | small        | Gate the non-`manual` schedule at write time      |
| Pricing card rows: cumulative rendering, new rows           | small–medium | `BillingPlans.tsx` renders a flat list today      |
| Card backgrounds (generate, downscale, apply)               | medium       | Four images plus CSS and a contrast pass          |
| Stripe product/description sync                             | small        | Blocked on `stripe login`                         |
| Tests: gates return 402, limits enforced, cards render      | medium       | The part worth doing carefully                    |

Roughly one focused PR for the model and the gates, one for the pricing UI and art, one for
Stripe once the login is refreshed.

## Decisions (taken 2026-09-08)

1. **Reminders**: 500 / 2 000 / unlimited. Agreed.
2. **API access starts at Basic**, tokens at 2 / 10 / unlimited. Agreed.
3. **Automated imports at Advanced.** Agreed.
4. **Priority support at Ultimate: a reply within 1–3 working days**, holidays excepted. That
   wording goes on the card and into the Stripe description verbatim, because it is a promise.
5. **Larger receipt uploads move to Advanced**, not Ultimate: 5 MB on Basic, **25 MB on
   Advanced**, 50 MB on Ultimate. `RECEIPT_MAX_BYTES` becomes a per-plan limit.
6. **Prices unchanged** at €3 / €6 / €10 monthly, €30 / €60 / €100 annual — which is exactly
   what the live Stripe prices already charge.
7. **Household sharing is not in v1.** Left in the candidates table.

### Two features that are not built yet

- **Receipt OCR** — Advanced and up, when it ships.
- **End-to-end encryption** — free on every tier, including Free. Decided 2026-09-10;
  it is in "Deliberately not gated" above, so it never becomes a paid row and never
  gets a `PlanFeatures` flag. The only reason it is unlisted is that it is not built.

**Neither goes on the pricing card until it works.** A paid pricing page that lists a feature
the product does not have is a misleading commercial practice under the EU's UCPD, and this is
the same account the compliance work was done for; "coming soon" on a page whose whole job is
taking money does not save it. The tier intent is recorded here and in `plans.ts` comments so
the decision is not lost, and the row appears the day the feature does.

## What changes in Stripe

The three live products already exist with the right prices (€3/€6/€10 monthly, €30/€60/€100
annual) and each has an image and a `marketing_features` list. What needs updating:

| Product      | Change                                                                                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Basic**    | Add "API access and MCP server — 2 tokens". State the reminder allowance as 500/mo.                                                                                         |
| **Advanced** | Add "Automated imports on a schedule", "10 API tokens", "Receipt uploads up to 25 MB". State reminders as 2 000/mo. Fix the stray `~` in "Up to 10 profiles / households~". |
| **Ultimate** | Add "Unlimited API tokens" and "Priority support — a reply within 1–3 working days".                                                                                        |

Descriptions get the same cumulative wording as the cards, since a customer reads them again at
checkout and on the invoice. Nothing is written to the live account without a go-ahead on the
exact commands.
