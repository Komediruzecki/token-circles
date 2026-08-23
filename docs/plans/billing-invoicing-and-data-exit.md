# Plan: dunning mail, invoices, and what happens when someone leaves

Status: **research + proposal for decision.** Written 2026-08-23 alongside the email-verification
work (#415, #416/#419). Nothing here is built yet. Items marked _(verify)_ need first-hand
confirmation — in the Stripe dashboard, or with an accountant — before anything is built on them.

Companion issues: [#417](https://github.com/Komediruzecki/token-circles/issues/417) (PWA),
[#418](https://github.com/Komediruzecki/token-circles/issues/418) (mobile).

---

## Part A — What happens when a payment fails **[DONE — PR #421]**

### What the code does today

`worker/src/routes/billing.ts` handles exactly four Stripe events:
`checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`. **No `invoice.*` event is handled at all.**

So on a declined card:

- Stripe moves the subscription to `past_due` and starts retrying.
- `customer.subscription.updated` arrives, and `isEntitled()` deliberately keeps the paid plan
  through `past_due` — a grace window while Stripe retries.
- `Settings.tsx:429` shows a red line: _"Your <plan> plan payment is past due — update your card
  to keep access."_
- **We send no email of our own.** Not one.

If retries run out, Stripe cancels, `customer.subscription.deleted` drops the plan to free, and
the first the user hears of it is the app looking different.

### What Stripe may already be doing _(verify)_

Stripe can send its own dunning mail, but it is **off by default** and lives in
Dashboard → Settings → Billing → _Subscriptions and emails_:

- **Manage failed payments for subscriptions** → "Send emails when card payments fail"
- **Smart Retries** — ML-timed retry schedule rather than a fixed one
- **Manage invoices sent to customers** → "Always email your customers a finalized invoice"

Branding (logo, colour, icon) for those mails is under Dashboard → Settings → Branding.
Sent mail from the last 30 days is visible on each customer's page.

**First action, and it costs nothing: open that page and write down which of the three toggles
are on.** Everything below branches on the answer.

### Proposal

Whatever Stripe is doing, send our own — Stripe's mail is transactional plumbing, ours is the one
that can say what the user loses and link straight to the portal.

1. Handle `invoice.payment_failed` in the webhook. Send a branded mail: which card, what happens
   next, when the retries stop, and a portal link. `renderPasswordReset` already establishes the
   shape for a single-CTA transactional mail.
2. Handle `invoice.payment_action_required` too — 3DS/SCA is a distinct case where the user has
   to _do_ something, and a generic "payment failed" is wrong for it.
3. Handle `customer.subscription.deleted` → a plain "your plan has ended" mail, which is also the
   natural place to point at the data export in Part C.
4. Turn Stripe's own failed-payment mail **off** once ours ships, so a declined card does not
   produce two mails saying different things in different voices.
5. Keep Smart Retries **on** — it is free recovery and does not email anyone by itself.

Rate limiting is not a concern here (Stripe fires these, not the user), but the sends must be
best-effort and never fail the webhook: an unacked webhook is retried, and a retry that re-sends
mail is worse than a missing mail. `stripe_events` already gives idempotency per event id.

**Size:** one PR, worker-only plus three email templates. No schema change.

---

## Part B — Invoices, and what Croatian law actually asks for

### The finding that matters

Croatia's **Fiskalizacija 2.0** took effect **1 January 2026** — it is in force now, not upcoming.
Two separate obligations, and the distinction decides everything:

- **B2B (domestic, Croatia→Croatia):** structured e-invoices are **mandatory**. UBL 2.1 against
  the Croatian CIUS, exchanged through an authorised access point / information intermediary, with
  fiscalisation and e-reporting data submitted separately to the Tax Administration in its own XML.
  Non-VAT taxpayers (small businesses, flat-rate craftsmen) are in scope too; the state provides a
  free _FiskAplikacija_.
- **B2C:** e-invoicing is **optional**, but **fiscalisation is mandatory for all payments** — and
  Fiskalizacija 2.0 explicitly extends that to online payments (card, bank transfer, PayPal,
  Google Pay). Real-time reporting to the Tax Administration.

**This is not legal advice and I am not able to give it.** Two things decide whether any of it
applies, and I do not know either: **where the invoicing legal entity is established**, and
**whether it is VAT-registered**. If the entity is not Croatian, none of the above binds it and
the question becomes ordinary EU VAT/MOSS invoicing. Confirm with an accountant before building.

### What it means for the "email an invoice every month?" question

The question as posed — _do we have to email each user an invoice every month?_ — has a cleaner
answer than expected: **almost certainly no, not by email.** No EU or Croatian rule I can find
requires delivery _by email_ specifically. What is required is that a compliant invoice **exists,
is issued, and is available to the customer**, and — if Croatian B2C fiscalisation applies — that
the **payment is reported in real time**, which is a completely separate obligation from sending
anyone a PDF.

So email delivery is a product decision. The compliance question is fiscalisation, and no amount
of in-app PDF generation answers it.

### Three options

|                                   | What it is                                                                         | Effort                     | Compliance                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------- |
| **B1. Stripe emails the invoice** | Flip "Always email your customers a finalized invoice"                             | Minutes                    | Same as today. Stripe does **not** do Croatian fiscalisation. |
| **B2. In-app download**           | Settings → Billing lists past invoices, "Download" generates on demand in a Worker | Medium                     | Same as B1 — presentation only                                |
| **B3. Fiscalisation**             | Real-time reporting to the Tax Administration via an access point / intermediary   | Large, and mostly not code | The only one that actually answers the law                    |

**Recommendation:** do **B1 today** (a toggle, and it means every customer already has an invoice
they can retrieve), then **B2** as the product surface once the renderer is ready — Stripe's
`invoice.hosted_invoice_url` and `invoice_pdf` mean the Worker may not need to render anything at
all, only list and proxy, which is much less work than a renderer. Treat **B3 as a separate track**
that starts with the accountant, not with us.

Worth checking while there: Stripe Tax is already enabled in the checkout params
(`automatic_tax[enabled]=true`, `tax_id_collection[enabled]=true`), so VAT is being handled. That
is a good sign for B2B EU customers and unrelated to fiscalisation.

**Size:** B1 is a dashboard toggle. B2 is one PR — a `GET /api/billing/invoices` listing from
Stripe plus a download link in the billing card. B3 is its own project.

---

## Part C — When someone cancels, but their data is over the free limits

### The problem

A paid account can hold more profiles than Free allows, plus receipts stored on our servers. When
the subscription ends, the plan drops to free and the data is suddenly over every limit. Today
nothing happens to it — which is quietly the worst of both worlds: we keep storing it, and they
cannot necessarily reach all of it.

### What the export actually does today _(audited 2026-08-24)_

Better than assumed in one respect and worse in three. `GET /api/export` → `exportBackup()` in
`worker/src/backup.ts` returns a full JSON backup **including the receipt files themselves**, as
base64 in a `receiptFiles[]` array beside the `receipts` rows. There is no missing-blob problem:
the bytes are in there, and `POST /api/import` restores them. A ZIP is therefore a **convenience**,
not a data-exit requirement — the data can already come out.

The three gaps are real, and the first is the one that matters for cancellation:

1. **It exports the selected profiles, not the account.** `getProfileIds(c)` reads `X-Profile-Ids`
   and falls back to the _current_ profile. Settings → Export sends whatever scope `apiFetch`
   injects, so a user with five profiles in single-profile scope downloads one of them and is told
   "Data exported successfully". For a cancellation path that is the wrong default by a mile:
   the one moment someone needs _everything_ is the moment the button gives them a fifth of it.
   → **The fix is small and worth doing on its own: an explicit account-wide export.** Either a
   `?scope=account` on the existing route or a separate `GET /api/export/all`, plus a Settings
   control that says "all profiles" in so many words.
2. **It is built entirely in memory.** Every receipt is read from R2, base64-encoded (+33%), held
   in an array, and then `c.json()` serializes the lot. A Worker has ~128 MB. The practical
   ceiling is therefore somewhere around 40–60 MB of receipts, and past it the user gets a failure,
   not a download. Worth _measuring_ before designing anything: for most accounts this never
   binds, and a streaming ZIP is a lot of machinery to build for a limit nobody has hit.
3. **One missing R2 object aborts the whole backup.** `exportBackup` throws
   `503 Receipt file "…" is unavailable; full backup aborted` if any single object is absent.
   All-or-nothing on a condition the user can neither see nor fix — and it fails exactly the
   person with the most data. A missing blob should be _reported in the payload_ (the receipt row
   exported with a `file_missing: true` marker) and the rest of the backup delivered.
   → This is the one I would fix first. It is a handful of lines and it converts an unrecoverable
   export into a complete one with a footnote.

### Proposal, in the order the user experiences it

1. **Export first, always.** Before anything is blocked, make sure the export covers the whole
   account and cannot fail wholesale — the two fixes above. Linked from the "your plan has ended"
   mail in Part A.
   - A ZIP (receipts as real files rather than base64, profiles as CSV) is a nice-to-have on top,
     and only worth building once the memory ceiling has been measured against real accounts. The
     JSON backup already satisfies "get my data out"; the ZIP satisfies "open my receipts".
2. **Then read-only, not deleted.** Over-limit profiles become read-only rather than hidden: the
   user can still see and export them, but cannot add to them. Hiding data someone paid to create
   reads as data loss even when it isn't.
3. **Then a stated retention window.** After N months of no return, over-limit data is deleted —
   with mail at 30 days and 7 days before, each carrying the export link. **6 months is the
   number I would pick**: long enough to cover a lapse and a change of mind, short enough that
   storage is not unbounded.
4. **Say it before they cancel.** The cancel flow should state what will happen to the data and
   offer the export right there, not after the fact.

### Open questions

- Is read-only over-limit data worth the complexity versus a hard block with an export? Read-only
  is kinder and more code; a block plus a guaranteed export is defensible.
- GDPR already gives a right to erasure on request, which is a separate mechanism from a retention
  sweep — `AccountDeletion` exists, but its relationship to this needs checking.
- Retention deletion must be idempotent and dry-runnable. It is the most dangerous cron in the
  codebase and should ship behind a flag that logs what it _would_ delete for at least one cycle.

**Size:** three PRs, not one — export, then over-limit handling, then retention. The export is
worth doing on its own regardless of the rest: it is useful to everyone, dangerous to nobody, and
it is the thing that makes every later decision safe to make.

---

## Suggested order

1. ~~**A** (dunning mail)~~ — **done, PR #421.**
2. **C, the two export fixes** — account-wide scope and no all-or-nothing failure. Small, useful to
   everyone, and they make everything after them safe.
3. **B1** — a dashboard toggle, and it is the compliance-relevant half of "invoices".
4. **B3 track** starts with the accountant, in parallel and not by us.
5. **C, limits + retention** — once the export exists and the numbers are known.
