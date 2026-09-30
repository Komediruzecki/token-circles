# Token Circles mobile product

Token Circles records transactions, tracks accounts and budgets, and includes financial calculators. It works on this device without an account, with optional managed cloud services or a self-hosted Cloudflare Worker. The iOS and Android application will use the same finance features with layouts designed for phones and tablets.

## Confirmed commitments

- Use Capacitor with the existing SolidJS, TypeScript, Vite and pnpm ecosystem. Keep the Cloudflare Worker, D1 and R2 as the backend.
- Preserve the Token Circles identity and redesign each mobile flow. Do not import the desktop App, shell, page CSS or page components into the native presentation layer.
- Start with EU/EEA and US distribution planning; model other storefronts separately.
- Develop inside the Token Circles monorepo. Extract useful business logic and capability boundaries incrementally when real consumers justify them.
- The existing personal Apple developer account and Google Play organization account are already available. Do not add account-enrollment or personal-account tester-count projects.
- Plan in acceptance-gated phases, without schedule or deadline estimates. Commercial, security and design decisions require an explicit recorded answer before dependent implementation.

## Truth and boundaries

The repository README calls the managed cloud service beta, even though this planning program treats the existing application as the finished starting product. Code and current user-facing behavior must be reconciled before publishing store descriptions. Current advertised prices are Basic EUR 3/month or 30/year, Advanced 6/60 and Ultimate 10/100. Historical `PriceUsd` identifiers do not mean USD.

Local-first and managed cloud are separate storage modes today. Do not imply that offline edits automatically synchronize. Profiles and household aggregation do not establish multi-user sharing or invitations. Receipt attachment does not imply receipt OCR. Encryption claims require inspection of the exact shipping branch; do not import claims from unmerged worktrees. Finance data in mockups is synthetic, not customer data or financial advice.

## Usage scenes

A person records a purchase one-handed after paying, checks the remaining grocery budget in daylight, reviews accounts and spending at home, or uses a tablet to reconcile a longer transaction list. Someone choosing local use must be able to start without subscribing or signing in. Explain what a cloud upgrade adds when that capability becomes relevant.

## Success

Users can enter and correct amounts, tell whether a change was saved, and recover from a failed save. They know where their data is stored and how to back it up. Screens work with touch, keyboards and assistive technology at both compact and expanded widths. Existing subscribers retain their plan without accidentally purchasing it twice. Native platform conventions determine behavior even where controls are rendered by Solid in a Capacitor WebView.

## Sources

Product behavior and code references: [product audit](research/product-audit.md). Architecture analogues: [reference audit](research/reference-architecture.md). Commercial conditions: [subscription research](research/subscriptions-and-economics.md). The decisions register is authoritative for proposals awaiting approval.
