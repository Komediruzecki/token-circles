# Documentation Index

**Start here if you are an agent or a new contributor: [AGENTS.md](../AGENTS.md)** — what ships
(the SolidJS frontend and the Cloudflare Worker), what does not (the retired Express/SQLite server
under `backend/`, and the Docker files that describe it), and the rules that are not negotiable.

## Getting Started

- [README.md](../README.md) — Project overview, setup, features, API reference
- [CONTRIBUTING.md](../CONTRIBUTING.md) — Development setup, workflow, testing, PR guidelines
- [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) — Community standards
- [SECURITY.md](../SECURITY.md) — Vulnerability reporting and security features
- [AGENTS.md](../AGENTS.md) — Repository orientation: what ships, what is retired, migration and deploy rules
- [ROADMAP.md](../ROADMAP.md) — Planned features and improvements
- [CHANGELOG.md](../CHANGELOG.md) — Version history and release notes
- [LICENSE](../LICENSE) — GNU AGPL-3.0

## Deploying

- [worker/README.md](../worker/README.md) — **Self-hosting today**: your own Cloudflare Worker, D1 and R2
- [Self-Hosting Guide](self-hosting.md) — _retired_ — Docker, reverse proxy, environment variables for the Express server
- [Docker Guide](docker.md) — _retired_ — container setup for the Express server
- [Deploy-Update Pipeline](deploy-update-pipeline.md) — How open tabs cross a release: service worker, version.json, reload bounds, manual verification
- [Docker Compose](../docker-compose.yml) — _retired_ — one-command deployment of the Express server
- [Dockerfile](../Dockerfile) — _retired_ — container image for the Express server

## Marketing

- [Marketing Screenshots](marketing-screenshots.md) — Re-shooting the product stills the landing sites bundle: seeding, profiles, and the traps that produce a plausible wrong image

## Feature Specifications

Detailed EARS (Exactly As Required Specification) documents for all features:

### Frontend

| Module            | Spec                                                                       |
| ----------------- | -------------------------------------------------------------------------- |
| Dashboard         | [specs/frontend/dashboard.md](specs/frontend/dashboard.md)                 |
| Transactions      | [specs/frontend/transactions.md](specs/frontend/transactions.md)           |
| Accounts          | [specs/frontend/accounts.md](specs/frontend/accounts.md)                   |
| Categories        | [specs/frontend/categories.md](specs/frontend/categories.md)               |
| Budgets           | [specs/frontend/budgets.md](specs/frontend/budgets.md)                     |
| Goals             | [specs/frontend/goals.md](specs/frontend/goals.md)                         |
| Loans             | [specs/frontend/loans.md](specs/frontend/loans.md)                         |
| Bills             | [specs/frontend/bills.md](specs/frontend/bills.md)                         |
| Housing           | [specs/frontend/housing.md](specs/frontend/housing.md)                     |
| Retirement        | [specs/frontend/retirement.md](specs/frontend/retirement.md)               |
| Compound Interest | [specs/frontend/compound-interest.md](specs/frontend/compound-interest.md) |
| Emergency Fund    | [specs/frontend/emergency-fund.md](specs/frontend/emergency-fund.md)       |
| Analytics         | [specs/frontend/analytics.md](specs/frontend/analytics.md)                 |
| Import            | [specs/frontend/import.md](specs/frontend/import.md)                       |
| Settings          | [specs/frontend/settings.md](specs/frontend/settings.md)                   |
| Rent vs Buy       | [specs/frontend/rent-buy.md](specs/frontend/rent-buy.md)                   |
| Loans             | [specs/frontend/loans.md](specs/frontend/loans.md)                         |

### Backend

> These describe the **API contract** — the routes, their inputs and their guarantees. They were
> written against the retired Express implementation, so read them for _what the API does_, not
> for how it is built. The implementation is `worker/src/routes/`. See [AGENTS.md](../AGENTS.md).

| Module         | Spec                                                             |
| -------------- | ---------------------------------------------------------------- |
| Authentication | [specs/backend/auth.md](specs/backend/auth.md)                   |
| Profiles       | [specs/backend/profiles.md](specs/backend/profiles.md)           |
| Transactions   | [specs/backend/transactions.md](specs/backend/transactions.md)   |
| Accounts       | [specs/backend/accounts.md](specs/backend/accounts.md)           |
| Categories     | [specs/backend/categories.md](specs/backend/categories.md)       |
| Tags           | [specs/backend/tags.md](specs/backend/tags.md)                   |
| Budgets        | [specs/backend/budgets.md](specs/backend/budgets.md)             |
| Bills          | [specs/backend/bills.md](specs/backend/bills.md)                 |
| Loans          | [specs/backend/loans.md](specs/backend/loans.md)                 |
| Savings Goals  | [specs/backend/savings-goals.md](specs/backend/savings-goals.md) |
| Reports        | [specs/backend/reports.md](specs/backend/reports.md)             |
| Settings       | [specs/backend/settings.md](specs/backend/settings.md)           |
| Health         | [specs/backend/health.md](specs/backend/health.md)               |
| Analytics      | [specs/backend/analytics.md](specs/backend/analytics.md)         |
| Housing        | [specs/backend/housing.md](specs/backend/housing.md)             |
| Receipts       | [specs/backend/receipts.md](specs/backend/receipts.md)           |
| Recurring      | [specs/backend/recurring.md](specs/backend/recurring.md)         |
| Calculator     | [specs/backend/calculator.md](specs/backend/calculator.md)       |
| Profiles       | [specs/backend/profiles.md](specs/backend/profiles.md)           |

See also: [specs/INDEX.md](specs/INDEX.md)
