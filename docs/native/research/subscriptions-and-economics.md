# Native subscriptions and unit economics

Token Circles can retain Stripe for web sales and let those subscribers sign in on iOS and Android. Mobile distribution adds a separate decision: how somebody who discovers the app on a store buys a subscription. A Capacitor shell does not change the store's payment rules.

The recommended baseline is native store subscriptions for new mobile customers, the existing Stripe checkout for web customers, and one entitlement service in the Cloudflare Worker. Preserve a genuinely useful local-only Free mode. Evaluate US iOS external checkout as a separate, measurable option after confirming the applicable fee terms. Do not choose EU or Android external checkout simply because Stripe's headline processing percentage looks lower.

This recommendation is provisional for confirmation. It optimizes a clear purchase experience, predictable regional behavior, and supportability. It does not authorize account enrollment, accepting commercial terms, product creation, price changes, or production billing.

## Scope and evidence status

- Policy and published pricing checked on **13 September 2026**. First launch markets: **EU/EEA and United States**.
- The account holder already has an individual Apple developer membership and an organization Google Play account with D-U-N-S verification. These are existing portfolio accounts, not new-account setup projects.
- Repository evidence is read-only. No Stripe dashboard, App Store Connect contract, Google payment profile, account invoices, or customer counts were inspected. Published list prices below are planning assumptions, not a reconstruction of actual revenue.
- Material changes take effect **1 October 2026**. This document distinguishes those announced terms from terms already effective. There is no proposed launch date.
- Prices and costs use their actual published currencies. EUR scenarios and USD vendor invoices must not be added without an explicit exchange-rate assumption.

## The product being sold

The current API sells three cumulative paid plans. The source is `worker/src/plans.ts`; the historic `monthlyPriceUsd` and `annualPriceUsd` names contain **EUR** amounts. These values are display defaults; actual charges come from the Stripe Price IDs configured for the Worker.

| Plan     | Monthly | Annual | Annual equivalent/month | Principal paid value                                                                                               |
| -------- | ------: | -----: | ----------------------: | ------------------------------------------------------------------------------------------------------------------ |
| Free     |      €0 |     €0 |                      €0 | Marketed as local-first or self-hosted use; two profiles; no managed cloud sync, cloud receipt allowance, or email |
| Basic    |      €3 |    €30 |                   €2.50 | Cloud sync, receipts, reports, email reminders, API access; five profiles                                          |
| Advanced |      €6 |    €60 |                   €5.00 | Higher allowances, ten profiles, automated imports                                                                 |
| Ultimate |     €10 |   €100 |                   €8.33 | Fair-use unlimited allowances and priority support                                                                 |

This table describes the marketed catalog, not a complete runtime authorization audit. The current local adapter supports receipts, and the Worker does not enforce the catalog's `cloudSync` flag as a general route gate. A free account's actual behavior can therefore differ from the advertised plan matrix. Reconcile these differences under B09 before introducing native paywall claims or new restrictions; preserve existing local data and capabilities during that decision. See [the product audit](./product-audit.md) for the implementation evidence.

The current billing route creates Stripe subscription Checkout sessions, enables automatic tax, collects billing addresses and tax IDs, and exposes the Stripe customer portal. It changes the existing live Stripe subscription when changing tiers rather than creating a second one. Webhooks deduplicate events and guard ordering. `users.plan`, status, interval, renewal date, and Stripe identifiers currently form a Stripe-specific projection. The server grants access for active, trialing, and past-due Stripe subscriptions.

These are reusable foundations, not a complete mobile billing system. Read `worker/src/routes/billing.ts`, `worker/src/plan.ts`, `worker/src/plans.ts`, `worker/src/routes/account.ts`, and `frontend/src/core/billingActivation.ts` before implementation. The plan file explicitly excludes unbuilt OCR and end-to-end encryption; neither belongs in mobile paywall promises until shipped.

An unresolved catalog issue is tax presentation: automatic tax does not prove that the live Stripe Prices are inclusive. Record each Price's currency, amount, recurring interval, and `tax_behavior`, plus the account's tax registrations, before approving cross-channel price parity.

## Purchase-policy decision matrix

| Route                                                           | Existing Stripe subscriber            | New mobile subscription                          | Economics and implementation                                                               | Assessment                                       |
| --------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Native Apple/Play purchase plus existing web Stripe             | Sign in and retain the purchased plan | Native store sheet                               | Store commission; optional subscription middleware; unified entitlements                   | Recommended baseline                             |
| Free companion, no in-app purchases or purchase calls to action | Sign in and retain plan               | Must discover and buy separately outside the app | Web processing economics; weaker in-app acquisition; Apple classification must be accepted | Credible fallback, not guaranteed Apple approval |
| US iOS external web checkout                                    | Retain Stripe                         | Eligible storefront opens web checkout           | Own PSP and tax operations; Apple fee uncertainty must be rechecked                        | Controlled option, not global policy             |
| EU Apple alternative billing/link offers                        | Retain plan; preserve source          | Contract-specific in-app choice and/or link flow | Apple commission remains, plus PSP; entitlement/API/reporting requirements                 | Defer unless measured gain justifies complexity  |
| EEA/US Play alternative billing or external offers              | Retain plan                           | Enrolled program flow                            | Generally 10% recurring service fee plus PSP under current/announced programs              | Usually unattractive at current monthly prices   |

### Apple: ordinary rules, companion use, and US storefront

Paid app functionality and cloud services fall within digital purchases. Multiplatform services can recognize purchases made elsewhere while making equivalent items available through IAP; free standalone companion apps have a no-purchase/no-purchase-call-to-action exception. Token Circles is not a reader app merely because it displays a user's financial records. US storefront apps may include purchase links and calls to action without the external-link entitlement. These are storefront rules, not rules based on the developer living in Croatia. [Apple App Review Guidelines, 3.1.1(a), 3.1.3(b), 3.1.3(f)](https://developer.apple.com/app-store/review/guidelines/)

**Assessment:** a useful free local tracker plus access to an existing cloud subscription has a plausible companion case. Obtain review acceptance of the actual implementation and notes before making a companion-only route the business model. Do not hide a checkout in Help, a WebView, or a generic account link.

US link permission does not establish a permanent zero commission. A current, settled US link-out commission schedule was not verified in the official pages inspected; the former US entitlement page now redirects. The US zero-platform-fee calculations below are explicitly a sensitivity scenario. Save the accepted commercial terms and verify any court-ordered fee changes before implementation approval and submission. The December 2025 appellate decision reopened the fee issue, making older claims that commissions are permanently forbidden unsafe. [Ninth Circuit material in the Supreme Court docket appendix, May 2026](https://www.supremecourt.gov/DocketPDF/25/25A1213/407958/20260504154541634_Appendix%20to%20Apple%20Application%20for%20Stay%20-%20Appx%201a%20-%20230a.pdf)

### Apple: EU terms change on 1 October 2026

The new published EU schedule is **26% IAP / 20% alternative in-app processing / 15% out-of-app offers**. Qualifying Small Business Program transactions and qualifying subscription renewals after year one use **15% / 10% / 10%** respectively. IAP and alternatives can coexist. Alternative options require entitlement/API integration, disclosures, age protections, and reporting; payment selections persist across EU storefronts for twelve months. Multiplatform apps must offer IAP and/or an in-app alternative payment option, so an EU web-link-only design is insufficient. [Apple EU payment options](https://developer.apple.com/support/payment-options-on-the-app-store-in-the-eu/)

The agreement takes effect on 1 October or the date it is accepted, whichever is later. Its commission base excludes transaction taxes. A qualifying linked subscription begins within seven days of the actionable link; **subsequent auto-renewals remain commissionable**. This is not a seven-day exemption for later renewal charges. The agreement's general-app scope is EU; its wider EEA provision is for music streaming, so Token Circles cannot infer Iceland/Norway eligibility from the support page's shared entitlement-country list. Use ordinary IAP for non-EU EEA storefronts unless an independently applicable exception is verified. [Apple Developer Program License Agreement, Attachment 14, §§3.1 and 3.5](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/)

The older EU structures involving initial-acquisition/store-services fees and either a Core Technology Commission or per-install Core Technology Fee are a separate, superseded planning branch. The old support page now explicitly identifies its discontinuation on 1 October. Do not add those old fees to the new unified commission. If signing or shipping under earlier terms, calculate that agreement separately. [Apple's outgoing EU offer terms](https://developer.apple.com/support/communication-and-promotion-of-offers-on-the-app-store-in-the-eu/)

**Design implications:** create a regional payment-capability adapter rather than a country-specific text toggle. It must combine native eligibility, storefront, active contract/program, OS support, age requirements, and product availability. Unknown eligibility should produce the approved IAP or access-only flow. IP address, device locale, currency, and profile country are insufficient substitutes. Include the actual alternative flow in App Review notes.

### Apple: 15%, 26%, and 30% are different scenarios

The ordinary subscription schedule is 30% in the first year and 15% after a subscriber accumulates a paid year in the same subscription group; qualifying Small Business Program participation gives 15% from the beginning. The new EU schedule changes the standard IAP branch to 26%. Never present 30% as the universal iOS fee, or assume that having a small individual account automatically enrolls it in the Small Business Program. [Apple subscription proceeds](https://developer.apple.com/app-store/subscriptions/)

Small Business eligibility considers the account's and associated accounts' proceeds across apps. MercuryPitch, BesideCue, Chaos Master, and Token Circles do not each receive an independent $1 million qualification allowance. Confirm enrollment and account relationships; the published eligibility basis is proceeds, not a guessed Token Circles-only gross-sales threshold. [Apple Small Business Program](https://developer.apple.com/app-store/small-business-program/)

### Google Play: EEA and US

For EEA/UK/US transactions from 30 June 2026, the published recurring subscription fee is 10% service fee plus a 5% billing fee when Google Play Billing is used: **15% total**. Remaining markets still generally list 15% recurring subscriptions pending the rollout of updated terms. Country-specific alternatives elsewhere require their own program review. [Google Play service fees](https://support.google.com/googleplay/android-developer/answer/112622?hl=en)

EEA alternative billing without user choice is available to registered businesses, requires program enrollment and APIs, and carries a **10% recurring subscription fee** from 30 June 2026. Authorized transactions must be reported within 24 hours. Do not reuse the earlier three-percentage-point reduction as the current EEA calculation. [Google EEA alternative billing](https://support.google.com/googleplay/android-developer/answer/12348241?hl=en)

The EEA external-offers program uses **10% recurring subscription fees**, with the updated schedule effective 4 June 2026 and a 24-hour link attribution window. It requires enrollment and external-offers APIs; participating apps cannot combine those offers with Play Billing or user-choice billing under the published program. This differs from US coexistence rules. [Google EEA external offers](https://support.google.com/googleplay/android-developer/answer/14372887?hl=en)

External-transaction terms include subscription renewals and assign consumer support, tax and refund responsibilities to the developer. Treat the qualifying subscription's attribution as durable billing data; do not assume every renewal needs a fresh link click. [Google external-offers terms](https://support.google.com/googleplay/android-developer/answer/14539286)

US alternative billing and external-content links can coexist with Google Play Billing. Both require enrollment and API integration. Google announced on 22 July 2026 that reporting and applicable fees begin **1 October 2026**; the recurring fee is **10% plus the external PSP**, not a durable fee holiday. External-content purchase attribution uses 24 hours. These programs remain tied to the US legal order and can change. [US alternative billing](https://support.google.com/googleplay/android-developer/answer/16497028?hl=en), [US external-content links](https://support.google.com/googleplay/android-developer/answer/16470497?hl=en), [Google's dated US policy update](https://support.google.com/googleplay/android-developer/answer/15582165)

Google also permits consumption-only access to a service bought elsewhere. Administrative links must not become a path to a prohibited alternate purchase. For a single conservative companion design across platforms, omit purchase calls to action until the approved regional route is known. [Google Payments policy explanation](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en)

## Cost assumptions

These are published standard prices and explicit model inputs. Actual account contracts, taxable status, card mix, currency conversion, and product configuration override them.

| Input                                                        |                                                             Planning value | Basis                                                                                                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe card processing, Croatian account, standard EEA card  |                                                               1.5% + €0.25 | [Croatian Stripe pricing](https://stripe.com/en-hr/pricing)                                                                                                                 |
| Premium EEA / UK / international card                        |                                          2.8% / 2.5% / 3.15%, each + €0.25 | Same pricing page; US cards are the international scenario for a Croatian merchant                                                                                          |
| Stripe currency conversion                                   |                                               Additional 2% where required | Same pricing page; not automatically charged on every foreign card                                                                                                          |
| Stripe Checkout                                              |                                                     Included with Payments | Same pricing page                                                                                                                                                           |
| Stripe Billing, pay as you go                                |                                                     0.7% of Billing volume | [Stripe Billing pricing](https://stripe.com/en-hr/billing/pricing)                                                                                                          |
| Stripe Tax Basic through Checkout/Billing                    |               0.5% of gross transaction volume where registered to collect | [Stripe Tax pricing explanation](https://support.stripe.com/questions/understanding-stripe-tax-pricing?locale=en-GB)                                                        |
| Additional standalone Invoicing fee on subscription invoices |                                                           €0 in this model | Recurring invoices are covered by Billing; do not add 0.4% again. [Stripe Invoicing pricing](https://support.stripe.com/questions/stripe-invoicing-pricing)                 |
| RevenueCat Pro                                               | Free below threshold; model 1% of all tracked gross once threshold reached | See separate section below                                                                                                                                                  |
| VAT                                                          |           25% inclusive example; 0% and other rates are sensitivity inputs | Croatia's standard rate is 25%; not every customer has Croatian VAT. [EU VAT rates](https://europa.eu/youreurope/business/finance-and-tax/vat/vat-rules-rates/index_en.htm) |

Use the Croatian Stripe schedule only after confirming that the actual merchant account is in Croatia and uses standard pricing. A US customer does not make the merchant a US Stripe account. The 0.7% Billing fee is modeled on collected gross volume; validate the effective billed base and any negotiated or legacy pricing against an account invoice. Tax Basic's 0.5% base explicitly includes calculated tax. Enabling Tax Basic does not itself include every registration, filing, or remittance service.

The tables exclude refunds, disputes, fee taxes, withholding, discounts, FX spreads beyond the stated scenario, acquisition costs, support, infrastructure and development. Rounding occurs only at display time; actual transaction and invoice rounding can differ by cents.

### Reproducible formulas

Let `G` be the total collected from the customer, `t` the tax rate, `B = G / (1 + t)` the tax-exclusive revenue, `c` the store rate, `p` the PSP percentage, `b` the Billing percentage, `x` the Tax percentage, and `f` the fixed payment fee. For a tax-exclusive list price `L`, first calculate `G = L * (1 + t)` and `B = L`.

```text
Native IAP proceeds      = B * (1 - c)
Web Stripe proceeds      = B - G * (p + b + x) - f
Store + external PSP     = B * (1 - c) - G * (p + b + x) - f
RevenueCat paid-tier fee = 0.01 * tracked gross volume
Contribution margin     = proceeds - middleware - variable delivery/support/refund costs
Operating profit        = contribution margin - fixed operating costs - development expense
```

Apple alternative commission uses the net-of-transaction-tax base specified in Attachment 14. The Google external calculations use the corresponding net-sales modeling base; reconcile that against the accepted reporting/invoice treatment before final budget approval. These tables are **proceeds estimates**, not profit estimates.

### EU example: current numeric prices are the customer total, including 25% VAT

This is a deliberately explicit consumer-price scenario, not a claim about the live Stripe catalog. `Stripe` includes 1.5% Payments, 0.7% Billing, 0.5% Tax, and €0.25. `External 10%` adds a 10% store commission to the same Stripe costs. Native columns include store processing and do not add Stripe costs.

| Plan / payment   | Customer pays | Ex-VAT revenue | Web Stripe | Native 15% | EU native 26% | Native 30% | External 10% + Stripe |
| ---------------- | ------------: | -------------: | ---------: | ---------: | ------------: | ---------: | --------------------: |
| Basic monthly    |         €3.00 |          €2.40 |      €2.07 |      €2.04 |         €1.78 |      €1.68 |                 €1.83 |
| Basic annual     |        €30.00 |         €24.00 |     €22.94 |     €20.40 |        €17.76 |     €16.80 |                €20.54 |
| Advanced monthly |         €6.00 |          €4.80 |      €4.39 |      €4.08 |         €3.55 |      €3.36 |                 €3.91 |
| Advanced annual  |        €60.00 |         €48.00 |     €46.13 |     €40.80 |        €35.52 |     €33.60 |                €41.33 |
| Ultimate monthly |        €10.00 |          €8.00 |      €7.48 |      €6.80 |         €5.92 |      €5.60 |                 €6.68 |
| Ultimate annual  |       €100.00 |         €80.00 |     €77.05 |     €68.00 |        €59.20 |     €56.00 |                €69.05 |

At the present monthly prices, Stripe plus a 10% platform fee returns **less** than native 15% billing under this scenario. For an Advanced annual payment, the difference is only €0.53 for a whole year before the extra operational work. An external route can still matter for a different card mix, higher price, larger purchase, or a genuinely zero-platform-fee acquisition path; those are separate calculations.

The annual-plan discount is 16.67% against twelve monthly charges. Fixed-fee savings recover part of it, not all of it. Annual cash arrives earlier but funds twelve months of service.

| Plan     | Monthly: Stripe proceeds/month | Annual: Stripe proceeds/month equivalent | Monthly: native 15% proceeds/month | Annual: native 15% proceeds/month equivalent |
| -------- | -----------------------------: | ---------------------------------------: | ---------------------------------: | -------------------------------------------: |
| Basic    |                         €2.069 |                                   €1.912 |                             €2.040 |                                       €1.700 |
| Advanced |                         €4.388 |                                   €3.844 |                             €4.080 |                                       €3.400 |
| Ultimate |                         €7.480 |                                   €6.421 |                             €6.800 |                                       €5.667 |

### Tax-inclusive and tax-exclusive are not interchangeable

At a €6 **inclusive** price and 25% VAT, the buyer pays €6, €1.20 is VAT, Stripe returns approximately €4.388 before other costs, and native 15% returns €4.08. If €6 is **exclusive**, the buyer pays €7.50, VAT is €1.50, Stripe returns approximately €5.548, and native 15% returns €5.10 at an equivalent €7.50 consumer total. Comparing €6 web before tax to €6 store after tax would manufacture a misleading margin difference.

EU cross-border electronic-service VAT has destination and registration rules, including a conditional €10,000 threshold for certain qualifying EU-established suppliers. Have the accountant determine the actual treatment, OSS needs, and fee-VAT recovery; do not assume every sale is taxed where the founder lives. [EU cross-border VAT](https://europa.eu/youreurope/business/finance-and-tax/vat/cross-border-vat/index_en.htm)

### US scenario: international card, same EUR numerical price, tax rate set to zero

This comparison holds the current EUR price constant to isolate fee effects. It is **not a proposed USD price list**, exchange-rate quote, or assertion that US sales tax is universally zero. Stripe uses 3.15% international-card processing + 0.7% Billing + 0.5% Tax with €0.25 fixed. If Tax Basic is not billable on the transaction, add back 0.5% of gross. If conversion is required, subtract a further 2% of gross.

| Plan / payment   | Modeled gross | Native 15% | Apple native 30% | Stripe with 0% store-fee scenario | Stripe + 10% platform fee |
| ---------------- | ------------: | ---------: | ---------------: | --------------------------------: | ------------------------: |
| Basic monthly    |         €3.00 |      €2.55 |            €2.10 |                             €2.62 |                     €2.32 |
| Basic annual     |        €30.00 |     €25.50 |           €21.00 |                            €28.45 |                    €25.45 |
| Advanced monthly |         €6.00 |      €5.10 |            €4.20 |                             €5.49 |                     €4.89 |
| Advanced annual  |        €60.00 |     €51.00 |           €42.00 |                            €57.14 |                    €51.14 |
| Ultimate monthly |        €10.00 |      €8.50 |            €7.00 |                             €9.32 |                     €8.32 |
| Ultimate annual  |       €100.00 |     €85.00 |           €70.00 |                            €95.40 |                    €85.40 |

For a €6-equivalent US transaction, an external Apple rate of 0% / 5% / 10% / 15% would leave approximately **€5.489 / €5.189 / €4.889 / €4.589**, before optional middleware and operations. Currency conversion would remove another €0.12. This is why US fee verification is a release decision, not a footnote.

### Break-even and price parity

With a 15% native rate, 10% external store rate, 25% inclusive VAT, 2.7% gross PSP/Billing/Tax fees, and €0.25 fixed, the per-payment break-even gross price is:

```text
G = 0.25 / ((0.15 - 0.10) / 1.25 - 0.027) = €19.23
```

That excludes additional integration and support costs. The annual prices exceed this threshold, but the advantage is small. At the current €6 monthly inclusive price, direct web Stripe returns €4.388 while native 15% returns €4.08. To match that web proceeds level, an equivalent store consumer price would be approximately **€6.45 at 15%, €7.41 at 26%, or €7.84 at 30%**, before currency pricing grids and optional RevenueCat fees. These are calculations, not proposed prices.

Conversion can outweigh the fee difference. At €6 inclusive and these assumptions, a zero-platform-fee external flow needs about **93.0% of native checkout's conversion** to match native 15% proceeds per exposed customer (`4.08 / 4.388`). At a 10% external levy, its proceeds per purchase are already lower. Measure completion and retention; do not assume a specific checkout-abandonment rate.

## RevenueCat versus direct store integration

RevenueCat Pro's published threshold is $2,500 monthly tracked revenue, followed by 1% of all tracked revenue, not merely the amount above the threshold. Treat the exact threshold boundary according to the account contract; the examples avoid it. MTR includes purchases and renewals before store commissions and taxes, and is not normalized monthly recurring revenue: an annual sale contributes its charge in the purchase month. [RevenueCat pricing](https://www.revenuecat.com/pricing), [RevenueCat account billing](https://www.revenuecat.com/docs/welcome/set-up-revenuecat/account-management)

| Tracked gross in a month | Published Pro fee scenario | Meaning                                        |
| ------------------------ | -------------------------: | ---------------------------------------------- |
| $1,000                   |                         $0 | Below threshold                                |
| $3,000                   |                        $30 | 1% of all tracked revenue                      |
| $10,000                  |                       $100 | Still additional to store commission           |
| $50,000                  |                       $500 | Compare with measured in-house ownership costs |

Once billable, an individual tracked €3/€6/€10 payment adds about €0.03/€0.06/€0.10 in same-currency fee equivalence; €30/€60/€100 annual payments add €0.30/€0.60/€1.00. The actual invoice currency/conversion remains account-specific. RevenueCat is a subscription infrastructure service, not a replacement for Apple/Google payment commission.

| Choice                                                            | What Token Circles owns                                                                                                      | Benefit                                                            | Cost/risk                                                                              |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| RevenueCat for native stores; Worker unifies with existing Stripe | Product mapping, account linking, signed webhook handling, D1 entitlement projection, reconciliation, support                | Official Capacitor purchase wrapper and normalized store lifecycle | 1% when billable; external dependency; privacy/contract review                         |
| RevenueCat for stores and tracked Stripe purchases                | Above plus Stripe tracking/import and one attribution model                                                                  | More unified purchase visibility                                   | Additional tracked web revenue can affect fees; migration needs careful event handling |
| Direct StoreKit + Play Billing with Worker APIs                   | Native wrappers, receipt/JWS verification, notifications, acknowledgements, lifecycle reconciliation, dashboards, monitoring | Maximum control; avoids RevenueCat percentage                      | More operational ownership and version-change work; cannot count engineering as free   |

RevenueCat has an official `@revenuecat/purchases-capacitor` integration. Its installation notes include purchase capability setup on iOS and Android activity launch-mode behavior during bank-app payment authentication. Verify plugin compatibility with the selected Capacitor major before pinning. [RevenueCat Capacitor installation](https://www.revenuecat.com/docs/getting-started/installation/capacitor)

Existing Stripe purchases can be tracked through notifications or API import while retaining the current checkout. Bulk imports do not emit normal webhook integrations and Stripe history is not reconstructed completely. Therefore backfill D1 deliberately and reconcile counts before any change of entitlement authority. [RevenueCat external Stripe purchases](https://www.revenuecat.com/docs/web/integrations/stripe/track-external-purchases), [RevenueCat bulk imports](https://www.revenuecat.com/docs/migrating-to-revenuecat/migrating-existing-subscriptions/receipt-imports)

**Recommendation:** evaluate RevenueCat for native lifecycle handling, with the Worker remaining the authoritative API access-control service and current Stripe handling retained initially. Do not add a second Stripe-to-RevenueCat-to-Worker entitlement loop until there is a concrete reason. The comparison is middleware fees versus maintenance/support effort; it is not middleware versus having no backend.

## Backend and entitlement execution design

Refactor in small migrations while keeping existing API response compatibility. The following names are conceptual; check every existing D1 migration before selecting final table names.

1. Extract pure plan IDs, capabilities, and non-provider business rules into a reusable package. Keep entitlement enforcement on the Worker. The mobile client may display status but cannot grant cloud access.
2. Add provider-neutral purchase records: internal account ID, provider, environment, store product/base-plan ID, original transaction or purchase-token identity, period boundaries, current state, auto-renew state, and last authoritative observation. Preserve original billing source and attribution separately from current device.
3. Add an idempotent provider-event inbox with a processing state. Durably receive a verified event, update the purchase record, then derive entitlement. An inbox entry marked received is not equivalent to successful processing.
4. Derive one entitlement snapshot from all valid grants, with explicit priority for paid tiers, manual grants, and overlapping purchases. Never let a canceled Stripe event erase a live Apple entitlement. Keep historical purchases for reconciliation without allowing multiple subscriptions to silently stack.
5. Add read-only subscription-status and billing-capabilities endpoints for both frontends. Expose plan, interval, renewal/expiry, provider, manage action, verification timestamp, and policy-safe purchase actions.
6. Handle purchase success by refreshing server entitlements, not by trusting a web redirect or plugin success flag. Show pending verification as a real state. Reconcile by provider before retrying a purchase.
7. Make account linking stable across email, Apple relay addresses, Google sign-in, reinstall, and cross-device sign-in. Store purchase identity must not be a mutable email address. Decide anonymous/local purchase linking before implementing a mandatory login gate.
8. Add reconciliation for missed notifications, delayed events, out-of-order delivery, restored purchases, and recovery from provider outages. Protect sandbox/production separation at every boundary.

Apple provides App Store Server Notifications for subscription events. Direct Play integration should query `purchases.subscriptionsv2.get` after RTDN and acknowledge new purchases; an unacknowledged purchase is refunded and revoked after three days. Grace can retain access; account hold and expiry do not. These duties remain acceptance criteria even if middleware performs them. [Apple server notifications](https://developer.apple.com/documentation/appstoreservernotifications), [Google subscription lifecycle](https://developer.android.com/google/play/billing/lifecycle/subscriptions)

| State or event                           | Required app/backend behavior                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Purchase canceled by customer            | Stay on current plan; no error alarm and no new subscription                                               |
| Pending approval/payment/verification    | Show pending; do not grant cloud privileges or prompt another payment                                      |
| Active/trial                             | Grant mapped capabilities after authoritative validation                                                   |
| Cancellation scheduled                   | Keep access until paid entitlement ends; distinguish cancel from expire                                    |
| Provider grace                           | Preserve access only through verified grace period                                                         |
| Hold/expired/revoked                     | Remove paid service access according to verified state; keep user data safe                                |
| Upgrade/downgrade/interval switch        | Provider-specific replacement and effective-date handling; explain when price and limits change            |
| Restore on new device                    | Validate and attach to correct account; never transfer between unrelated accounts silently                 |
| Refund/chargeback                        | Reconcile financial and entitlement state; support partial-revocation policy                               |
| Existing paid source on another platform | Show current source and management route; avoid another Subscribe action                                   |
| Account deletion                         | Separate deletion from provider cancellation; disclose and implement a complete cancellation/deletion path |
| Offline app                              | Preserve useful local data; distinguish cached entitlement from verified cloud authorization               |

The present Stripe customer deletion helper cannot cancel an Apple or Google subscription. Conversely, deleting the local app or account must not leave a customer believing a store subscription has ended. The deletion design needs a provider-aware cancellation/management path and a policy for retained accounting records; the current endpoint must not simply be reused unchanged.

### Paywall and billing-management design acceptance

- Display localized store-provided prices for store products. Never convert the Worker EUR number into a guessed native price string.
- Explain each tier's immediate mobile value. Show the full annual total prominently, with the monthly equivalent secondary.
- Include purchase, restore, management, legal links, pending, canceled, failed, revoked, grace, and existing-web-subscriber states in the mock gallery.
- Keep free local functionality understandable without an account. Clarify what sync adds and how local data moves into a cloud account.
- Distinguish the Apple/Google store account from the Token Circles account. Account mismatches need a recovery path.
- Block an in-app purchase when a verified equivalent subscription already exists elsewhere; show the existing plan and source. Do not auto-cancel or move a user's subscription between merchants.
- For a user-requested provider change, default to cancel-at-period-end and migrate after expiry, with explicit access continuity. Any immediate migration needs a reviewed refund/proration policy.
- Test household/profile entitlements separately from Apple Family Sharing. Multiple profiles do not imply Apple Family Sharing is enabled or appropriate.

## Delivery costs and what “profit” means

The backend remains Cloudflare. There is no reason to create another database/server solely for native apps. Additional usage and the billing event/reconciliation workload must be measured, rather than inventing a per-user cloud cost.

The proposed native opaque-session design also adds indexed D1 session/token reads, refresh-token writes, revocation lookups and expiry cleanup. Include those queries and Worker CPU in measurements alongside ordinary API requests and billing reconciliation. Shared hosting allowances do not make authentication operations intrinsically free; avoid an unmeasured zero-auth-overhead assumption.

| Cost                                                        | Published basis                                                                                          | Allocation for this project                                                                                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple membership                                            | $99/year or local equivalent                                                                             | Existing portfolio overhead; adding Token Circles does not create another membership charge. [Apple membership](https://developer.apple.com/support/compare-memberships/) |
| Google Play registration                                    | $25 one-time                                                                                             | Already incurred if the existing organization account is used. [Play setup](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en)                 |
| Workers paid                                                | $5/month base; 10M requests and 30M CPU-ms included, then $0.30/M requests and $0.02/M CPU-ms            | Allocate shared account usage; static assets are free. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)                                     |
| D1 paid allowances                                          | 25B reads, 50M writes, 5GB included; excess $0.001/M reads, $1/M writes, $0.75/GB-month                  | Use actual query rows read/written, not HTTP request counts. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)                                         |
| R2 standard                                                 | 10GB, 1M Class A, 10M Class B included; then $0.015/GB-month, $4.50/M A, $0.36/M B; internet egress free | Receipt bytes and operations are measurable variable cost. [R2 pricing](https://developers.cloudflare.com/r2/pricing/)                                                    |
| Email and import jobs                                       | Existing provider contract/usage not verified                                                            | Measure delivered reminders, auth mail, scheduled import work, and retry costs                                                                                            |
| Builds, devices, signing, design assets, monitoring         | Existing subscriptions/hardware not audited                                                              | Record incremental cash and shared overhead separately                                                                                                                    |
| Refunds, disputes, customer support, bookkeeping, fee taxes | Account history and legal/tax treatment not verified                                                     | Explicit input rows; do not set to zero in an approved budget                                                                                                             |
| Development and maintenance                                 | Owner-chosen accounting treatment                                                                        | Include when discussing operating profit; no time estimates are proposed                                                                                                  |

Receipt storage deserves a usage guard. Basic permits up to 500 receipts per profile across five profiles with a 5MB file ceiling: a ceiling calculation is about **12.5GB/account**, not typical usage. At R2's marginal storage rate this is about **$0.19/month** before operations and portfolio allowance allocation. Advanced permits 5,000 receipts across ten profiles with 25MB files: roughly **1,250GB/account**, or **$18.75/month** at the marginal rate. That exceeds the plan's revenue if every allowance is saturated. Actual average files will be much smaller, but the model exposes why upload compression, account-level retained-byte budgets, and fair-use policy need a deliberate product decision. “Unlimited” cannot mean unmetered provider expense.

For illustration only, **1,000 Advanced monthly payments** at €6 gross inclusive of 25% VAT produce €6,000 collected and €4,800 ex-VAT revenue. Native 15% leaves €4,080; modeled RevenueCat at its paid rate removes another €60 equivalent, leaving €4,020 before delivery, support, acquisition, and overhead. Direct EEA-card Stripe leaves €4,388 before those costs. Stripe plus a 10% store levy leaves €3,908. These are hypothetical cohort arithmetic, not actual customer numbers or a forecast.

An approved profit model should calculate:

```text
Contribution = sum(channel proceeds)
             - subscription middleware
             - incremental cloud/email/import costs
             - expected refunds, unrecovered fees and disputes
             - variable support and customer acquisition

Operating profit = Contribution
                 - shared fixed costs allocated to Token Circles
                 - maintenance, development and design expense
```

A break-even customer count is `fixed monthly costs / average monthly contribution per paying customer`, provided that contribution is positive and annual payments are normalized consistently. Leave the result blank until cohort mix, actual variable costs, and the chosen accounting basis are known. Paid conversion, churn, refund rate, and average storage are unknowns, not facts to manufacture.

## Decisions to confirm

The [master decision register](../decisions.md) is the only approval queue. The IDs below use that register; detail here explains the billing evidence rather than creating a second set of approvals.

| ID        | Decision                                   | Recommendation / missing evidence                                                                                                              | Approval gate                                    |
| --------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| B01       | Mobile acquisition model                   | Native IAP baseline; retain Stripe for web and existing subscribers                                                                            | Before store product setup                       |
| B06       | US external checkout                       | Optional after contractual fee recheck and a measurable conversion experiment                                                                  | Before designing a live external CTA             |
| B05       | EU/EEA alternative programs                | Defer initially; savings at current prices are weak after PSP costs                                                                            | Before accepting any alternative terms           |
| B02       | Subscription middleware                    | Evaluate RevenueCat for native stores; keep Worker authority                                                                                   | Before dependency/credential integration         |
| B03       | Cross-channel price/tier parity and offers | Keep capabilities consistent; approve actual EUR/USD storefront prices and any trial, introductory offer or Family Sharing behavior separately | After live catalog/tax inspection                |
| B04       | Apple Small Business                       | Confirm enrollment and portfolio/associated-account eligibility                                                                                | Before committing to 15% economics               |
| B07       | Tax and seller entities                    | Confirm Stripe merchant country, tax inclusion, registrations, fee VAT and account invoices                                                    | Before financial model approval                  |
| B08       | Real business inputs                       | Obtain actual cohort mix, expenses and tax/accounting basis before claiming profit                                                             | Before commercial forecast approval              |
| B09 / B11 | Free/local purchases and identity          | Reconcile catalog/runtime behavior; require a managed account for cloud purchases unless an anonymous recovery design is approved              | Before authentication and paywall implementation |
| B10       | Double subscriptions and migration         | One effective paid entitlement; retain provider; period-end migration by default                                                               | Before purchase tests                            |
| B12       | Receipt retained-byte budget               | Compression and account storage budgets compatible with published promises                                                                     | Before expanding native receipt capture          |
| R02       | Cancellation, deletion, refund policy      | Provider-aware flows with retained-data/accounting rules                                                                                       | Before release review                            |

## Execution and verification checklist

- [ ] Capture live Stripe catalog values and one representative invoice/fee statement, with secrets redacted.
- [ ] Record the active Apple/Google seller entity, Small Business status, agreements, and precise supported storefronts.
- [ ] Refresh this policy matrix after 1 October 2026 and immediately before billing implementation/submission; store the accepted agreement version.
- [ ] Resolve the applicable B01–B12 and R02 choices in the master decision register; implement only the chosen commercial model.
- [ ] Prototype paywall, current-subscription, restore, pending, cross-provider, grace, expiry, and account deletion screens on phone and tablet.
- [ ] Add append-only D1 migration(s) after schema-name inspection; preserve existing Stripe and API behavior during backfill.
- [ ] Add tests that fail without provider-event idempotency, account binding, environment separation, ordering protection, and cross-provider entitlement derivation.
- [ ] Validate native sandbox purchase, renewal, cancel, grace, hold, refund, restoration, upgrade/downgrade, app restart, offline recovery, and interrupted bank authentication.
- [ ] If using Play directly, verify new-purchase acknowledgement and RTDN reconciliation even when the app never reopens.
- [ ] If using external billing, verify every required eligibility/disclosure/reporting path and ledger-to-provider invoice reconciliation.
- [ ] Verify genuine device builds, localized actual prices, legal links, review notes and reviewer access.
- [ ] Use the existing organization Play account; do not add the new-personal-account 12-testers/14-days gate. Its published scope is personal accounts created after 13 November 2023. Product QA and store review still apply. [Google personal-account testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)

## Source inventory

All live sources were accessed on 13 September 2026. “Live” means the page does not establish a durable publication date; its content must be checked again at the gate. Repository paths refer to the read-only checkout used for this plan.

| Source                                                                                                                                                                              | Publisher / date                                                           | Use                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)                                                                                                   | Apple; live                                                                | Digital purchases, multiplatform, companion and US-link rules           |
| [EU payment options](https://developer.apple.com/support/payment-options-on-the-app-store-in-the-eu/)                                                                               | Apple; agreement update 18 Aug 2026; effective 1 Oct 2026                  | New schedule, coexistence and implementation requirements               |
| [DPLA, Attachment 14](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/)                                                                         | Apple; 18 Aug 2026 update                                                  | Governing scope, effective date, tax base, renewal attribution          |
| [Outgoing EU terms](https://developer.apple.com/support/communication-and-promotion-of-offers-on-the-app-store-in-the-eu/)                                                          | Apple; marked discontinued 1 Oct 2026                                      | Prevent mixing old fees with new terms                                  |
| [Subscription proceeds](https://developer.apple.com/app-store/subscriptions/)                                                                                                       | Apple; live                                                                | Ordinary 30%/15% and paid-year treatment                                |
| [Small Business Program](https://developer.apple.com/app-store/small-business-program/)                                                                                             | Apple; live                                                                | Enrollment and associated-account eligibility                           |
| [Court docket appendix](https://www.supremecourt.gov/DocketPDF/25/25A1213/407958/20260504154541634_Appendix%20to%20Apple%20Application%20for%20Stay%20-%20Appx%201a%20-%20230a.pdf) | US Supreme Court docket; filed 4 May 2026; contains earlier court opinions | US fee-law uncertainty, not a current fee quote                         |
| [Play service fees](https://support.google.com/googleplay/android-developer/answer/112622?hl=en)                                                                                    | Google; regional schedule effective 30 Jun 2026                            | Recurring service/billing split and rest-of-world caveat                |
| [EEA alternative billing](https://support.google.com/googleplay/android-developer/answer/12348241?hl=en)                                                                            | Google; schedule effective 30 Jun 2026                                     | 10%, enrollment and reporting                                           |
| [EEA external offers](https://support.google.com/googleplay/android-developer/answer/14372887?hl=en)                                                                                | Google; updated fees effective 4 Jun 2026                                  | Fee, attribution, coexistence restrictions                              |
| [External-offers terms](https://support.google.com/googleplay/android-developer/answer/14539286)                                                                                    | Google; effective 28 Oct 2025, incorporating current program schedule      | Renewals, tax and support responsibilities                              |
| [US alternative billing](https://support.google.com/googleplay/android-developer/answer/16497028?hl=en)                                                                             | Google; 22 Jul 2026 notice, fees start 1 Oct 2026                          | US recurring fee and API duties                                         |
| [US external-content links](https://support.google.com/googleplay/android-developer/answer/16470497?hl=en)                                                                          | Google; 22 Jul 2026 notice, fees start 1 Oct 2026                          | US external checkout and attribution                                    |
| [US dated policy update](https://support.google.com/googleplay/android-developer/answer/15582165)                                                                                   | Google; latest relevant notice 22 Jul 2026                                 | Separate court/program chronology from rollout                          |
| [Payments policy explanation](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en)                                                                        | Google; live                                                               | Consumption-only and management links                                   |
| [Croatian Stripe pricing](https://stripe.com/en-hr/pricing)                                                                                                                         | Stripe; live                                                               | Card processing, FX, Checkout                                           |
| [Stripe Billing pricing](https://stripe.com/en-hr/billing/pricing)                                                                                                                  | Stripe; live                                                               | Recurring service fee                                                   |
| [Stripe Tax pricing](https://support.stripe.com/questions/understanding-stripe-tax-pricing?locale=en-GB)                                                                            | Stripe; live                                                               | Gross-volume tax-calculation fee and scope                              |
| [Stripe Invoicing pricing](https://support.stripe.com/questions/stripe-invoicing-pricing)                                                                                           | Stripe; live                                                               | Avoid double-counting recurring invoices                                |
| [EU VAT rates](https://europa.eu/youreurope/business/finance-and-tax/vat/vat-rules-rates/index_en.htm)                                                                              | European Union; live                                                       | 25% Croatian sensitivity input                                          |
| [Cross-border VAT](https://europa.eu/youreurope/business/finance-and-tax/vat/cross-border-vat/index_en.htm)                                                                         | European Union; live                                                       | Destination/threshold distinction                                       |
| [RevenueCat pricing](https://www.revenuecat.com/pricing)                                                                                                                            | RevenueCat; live                                                           | Free threshold and paid rate                                            |
| [RevenueCat account billing](https://www.revenuecat.com/docs/welcome/set-up-revenuecat/account-management)                                                                          | RevenueCat; live                                                           | MTR gross basis versus MRR                                              |
| [RevenueCat Capacitor](https://www.revenuecat.com/docs/getting-started/installation/capacitor)                                                                                      | RevenueCat; live                                                           | Official integration and setup constraints                              |
| [Stripe external purchase tracking](https://www.revenuecat.com/docs/web/integrations/stripe/track-external-purchases)                                                               | RevenueCat; live                                                           | Retain existing checkout while importing                                |
| [Bulk imports](https://www.revenuecat.com/docs/migrating-to-revenuecat/migrating-existing-subscriptions/receipt-imports)                                                            | RevenueCat; live                                                           | Backfill limitations                                                    |
| [App Store Server Notifications](https://developer.apple.com/documentation/appstoreservernotifications)                                                                             | Apple; live                                                                | Authoritative store events                                              |
| [Play subscription lifecycle](https://developer.android.com/google/play/billing/lifecycle/subscriptions)                                                                            | Google; live                                                               | Validation, acknowledgement, grace and hold                             |
| [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)                                                                                                      | Cloudflare; live                                                           | Request/CPU and base costs                                              |
| [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)                                                                                                                | Cloudflare; live                                                           | Row and storage costs                                                   |
| [R2 pricing](https://developers.cloudflare.com/r2/pricing/)                                                                                                                         | Cloudflare; live                                                           | Receipt storage and operations                                          |
| [Apple membership](https://developer.apple.com/support/compare-memberships/)                                                                                                        | Apple; live                                                                | Existing portfolio membership cost                                      |
| [Play account setup](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en)                                                                                  | Google; live                                                               | Existing one-time registration                                          |
| [Personal-account testing](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)                                                                           | Google; live                                                               | Excludes organization account from special tester gate                  |
| `worker/src/plans.ts`; `worker/src/routes/billing.ts`; `worker/src/plan.ts`; `worker/src/routes/account.ts`                                                                         | Token Circles checkout; read 13 Sep 2026                                   | Actual catalog, tax flag, Stripe lifecycle and entitlement architecture |

Machine-readable scenario inputs are in [economics/assumptions.json](./economics/assumptions.json). The [formula workbook](../outputs/native-subscription-economics.xlsx) adds configurable fees, tax treatment, refunds, RevenueCat and operating-cost inputs. Values in those files are research calculations, never runtime billing configuration.
