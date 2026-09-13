# Token Circles mobile product

Token Circles is a personal finance application for recording transactions, maintaining accounts and budgets, understanding spending, and using financial calculators. Its distinct promise is a useful local-first product with optional managed cloud services or a self-hosted Cloudflare Worker. The mobile application serves the same product through a dedicated iOS and Android interface.

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

A person records a purchase one-handed after paying, checks remaining category budget in daylight, reviews accounts and spending at home, or uses a tablet to reconcile a longer transaction list. The first action must work without a forced subscription or sign-in funnel. Cloud upgrades should explain an actual capability at the point of need.

## Success

Fast, legible entry and correction of money amounts; trustworthy save/error states; transparent storage and backup choices; accessible touch, keyboard and assistive-technology navigation; excellent compact and expanded layouts; existing subscription recognition without accidental duplicate purchases. Native platform conventions determine behavior even where controls are rendered by Solid in a Capacitor WebView.

## Sources

Product behavior and code references: [product audit](research/product-audit.md). Architecture analogues: [reference audit](research/reference-architecture.md). Commercial conditions: [subscription research](research/subscriptions-and-economics.md). The decisions register is authoritative for proposals awaiting approval.
