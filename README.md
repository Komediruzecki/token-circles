# Token Circles — open-source personal finance manager

<p align="center">
  <img src="https://img.shields.io/badge/version-5.2.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-green" alt="License AGPL-3.0">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs Welcome">
</p>

Track transactions, budgets, accounts, loans, and investments — with analytics, calculators, and PDF reports. Built **local-first**: run it entirely in your browser with no account and no server, self-host your own backend, or use the managed cloud for sync across devices.

> **Status:** the managed cloud service ([tokencircles.com](https://tokencircles.com)) is in **beta**. The app itself — local-only and self-hosted — is free and usable today.

## Three ways to run it

| Mode                      | Data lives                      | Account  | Cost                   |
| ------------------------- | ------------------------------- | -------- | ---------------------- |
| **Local-first** (default) | Your browser (IndexedDB)        | None     | Free                   |
| **Self-hosted**           | Your own Cloudflare Worker + D1 | Your own | Free                   |
| **Managed cloud**         | Token Circles (our Cloudflare)  | Sign in  | Free tier + paid plans |

All core budgeting, analytics, calculators, and monthly/annual PDF exports work in every mode. Cloud sync, managed email reminders, receipt storage, and advanced (tax / P&L) reports are the managed-cloud paid features — or run them yourself when self-hosting.

## Quick start (local-first, no account)

```bash
git clone https://github.com/Komediruzecki/finance-manager.git
cd finance-manager
pnpm install
pnpm dev            # frontend on http://localhost:3800
```

Open **http://localhost:3800** — it runs entirely in your browser (client-only IndexedDB) with seeded demo data; no account or server needed. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full dev setup.

## Features

- **Transactions** — income / expense / transfers with categories, tags, notes, and payment methods; bulk edit; quick-add (`Ctrl+Shift+T`); Excel & Google-Sheets import with column mapping.
- **Accounts** — giro / savings / investment / cash, starting balances, transfers, balance history.
- **Budgets** — monthly category budgets with rollover, plus zero-based budgeting.
- **Analytics** — category trends, spending heatmap, income/expense Sankey, period comparisons.
- **Calculators** — loan amortization (variable rates + prepayments), retirement, compound interest, emergency fund, FIRE, rent-vs-buy.
- **Investments** — portfolio tracker with live price lookup and allocation breakdown.
- **Reports & export** — CSV / JSON export and PDF monthly/annual reports (tax & P&L on paid / self-host).
- **Cloud (managed or self-hosted)** — sync across devices, email reminders (budget alerts + spending reports), receipt storage, multi-profile households.
- Dark / light theme, mobile-responsive, PWA, and a no-account demo.

## Architecture

- **Frontend** — SolidJS + TypeScript + Vite. Runs standalone on IndexedDB, or against the Worker API.
- **Backend (current)** — [`worker/`](./worker): a Cloudflare Worker (Hono) with **D1** (SQLite) for data and **R2** for receipts. Auth is Google sign-in + email/password (HS256 JWT cookie); Stripe for billing; Resend for email; Cloudflare Turnstile on the auth forms.
- **Backend (legacy)** — [`backend/`](./backend): the original Node/Express + SQLite server, superseded by the Worker and slated for removal.

```
finance-manager/
├── frontend/   # SolidJS app (local-first, or against the Worker)
├── worker/     # Cloudflare Worker API — D1 + R2 (the maintained backend)
├── backend/    # legacy Express/SQLite server (deprecated)
├── docs/       # specs, guides, postmortems
└── .github/    # CI + deploy workflows, issue/PR templates
```

## Self-hosting

Run your own backend on Cloudflare's free tier (Workers + D1 + R2). See **[worker/README.md](./worker/README.md)** for the full setup — create the D1 database and R2 bucket, apply migrations, set secrets, and deploy — then point the frontend at it with `VITE_API_URL`.

## Documentation

- [Contributing](./CONTRIBUTING.md) · [Code of Conduct](./CODE_OF_CONDUCT.md) · [Security Policy](./SECURITY.md)
- [Roadmap](./ROADMAP.md) · [Changelog](./CHANGELOG.md) · [Docs index](./docs/README.md)

## License

[GNU AGPL-3.0](./LICENSE) — Copyright (C) 2026 Komediruzecki.

Token Circles is free software: use, study, share, and modify it under the AGPL. If you run a modified version as a network service, you must offer its users the corresponding source (AGPL §13).
