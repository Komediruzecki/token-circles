# Finance Manager — Personal Finance Tracker

<p align="center">
  <img src="https://img.shields.io/badge/version-4.0.0-blue" alt="Version 4.0.0">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License MIT">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs Welcome">
</p>

A comprehensive personal finance management application built with **SolidJS** + **TypeScript** for the frontend and **Express** + **SQLite** for the backend.

## Quick Start

```bash
git clone https://github.com/Komediruzecki/finance-manager.git
cd finance-manager
pnpm install
pnpm run start       # Start backend on port 3847
pnpm run dev         # Start frontend dev server on port 5173
```

Open `http://localhost:5173` in your browser.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for full development setup.

## Tech Stack

- **Frontend**: SolidJS + TypeScript + Vite
- **Backend**: Node.js + Express REST API
- **Database**: SQLite (better-sqlite3) with WAL mode — also supports PostgreSQL
- **Charts**: Chart.js
- **PDF Generation**: PDFKit (fallback) and Puppeteer (charts)
- **Data Import**: XLSX (Excel)

## Project Structure

```
finance-manager/
├── .github/           # GitHub workflows, issue/PR templates
├── backend/           # Node.js/Express backend API
│   ├── index.js       # Main server entry point
│   ├── database.js    # SQLite schema, migrations, and seed data
│   └── models/        # Business logic
├── frontend/          # SolidJS + TypeScript frontend
│   ├── src/           # Source code (components, features, core)
│   ├── package.json   # Frontend dependencies
│   └── vite.config.js # Vite configuration
├── docs/              # Documentation (specs, guides, postmortems)
├── test/              # E2E and unit tests
└── scripts/           # Utility scripts
```

## Features

### Core

- **Transactions** — Add/edit/delete income and expense transactions with categories, tags, notes, and payment methods. Quick add via `Ctrl+Shift+T`. Bulk operations.
- **Accounts** — Multiple account types (giro, savings, IB, cash) with balance tracking, starting balances, and transfer handling.
- **Categories** — Custom income/expense categories with colors, icons, budget limits, and tax-deductible flags.
- **Tags** — Flexible tagging system with auto-generated colors for cross-category organization.
- **Budgets** — Monthly category budgets with progress indicators and rollover support.

### Analytics

- Category spending trends over time
- Budget vs actual flow (Sankey diagram)
- Spending heatmap calendar
- Monthly/yearly summaries with period comparison overlay
- Portfolio tracker with real-time Yahoo Finance prices

### Calculators

- **Loan Calculator** — Amortization schedules with variable interest rates, prepayments, and principal/interest charts
- **Retirement Calculator** — Compound interest projections and savings goal planning
- **Compound Interest**, **Emergency Fund**, **FIRE**, and **Rent vs Buy** calculators

### Import & Export

- Import from Excel (.xlsx, .xls) and Google Sheets with column mapping
- Export to CSV, JSON, and PDF (monthly/annual reports with charts)
- Tax summary and profit & loss reports

### Other

- Dark/light theme with mobile-responsive layout
- Counterparties view (who-owes-who from transaction data)
- Category auto-mapping from merchant description patterns
- Session-based authentication with bcrypt password hashing

## API

The backend exposes a REST API on port 3847. All endpoints require an `X-Profile-Id` header (integer profile ID).

### Health Check

```
GET /api/health → { status: "ok", timestamp: "...", database: "connected" }
```

### Full Endpoint Reference

<details>
<summary>Click to expand — all API endpoints</summary>

| Method | Path                                   | Description                                  |
| ------ | -------------------------------------- | -------------------------------------------- |
| GET    | `/api/profiles`                        | List all profiles                            |
| POST   | `/api/profiles`                        | Create profile                               |
| PUT    | `/api/profiles/:id`                    | Update profile                               |
| DELETE | `/api/profiles/:id`                    | Delete profile                               |
| DELETE | `/api/profiles/:id/data`               | Delete all profile data                      |
| GET    | `/api/settings`                        | Get profile settings                         |
| PUT    | `/api/settings`                        | Update settings                              |
| GET    | `/api/categories`                      | List categories                              |
| POST   | `/api/categories`                      | Create category                              |
| PUT    | `/api/categories/:id`                  | Update category                              |
| DELETE | `/api/categories/:id`                  | Delete category                              |
| GET    | `/api/transactions`                    | List transactions (sort, filter, pagination) |
| POST   | `/api/transactions`                    | Create transaction                           |
| PUT    | `/api/transactions/:id`                | Update transaction                           |
| DELETE | `/api/transactions/:id`                | Delete transaction                           |
| PUT    | `/api/transactions/bulk`               | Bulk update/delete transactions              |
| GET    | `/api/budgets`                         | List budgets                                 |
| POST   | `/api/budgets`                         | Create/update budgets                        |
| GET    | `/api/accounts`                        | List accounts                                |
| POST   | `/api/accounts`                        | Create account                               |
| PUT    | `/api/accounts/:id`                    | Update account                               |
| DELETE | `/api/accounts/:id`                    | Delete account                               |
| POST   | `/api/accounts/:id/history`            | Record balance history                       |
| GET    | `/api/loans`                           | List loans                                   |
| POST   | `/api/loans`                           | Create loan                                  |
| PUT    | `/api/loans/:id`                       | Update loan                                  |
| DELETE | `/api/loans/:id`                       | Delete loan                                  |
| POST   | `/api/loans/:id/rates`                 | Add rate period                              |
| DELETE | `/api/loans/:id/rates/:rateId`         | Delete rate period                           |
| POST   | `/api/loans/:id/prepayments`           | Add prepayment                               |
| DELETE | `/api/loans/:id/prepayments/:prepayId` | Delete prepayment                            |
| POST   | `/api/loans/:id/calculate`             | Get amortization schedule                    |
| GET    | `/api/dashboard/summary`               | Dashboard summary                            |
| GET    | `/api/dashboard/charts`                | Dashboard chart data                         |
| GET    | `/api/analytics/category-trends`       | Category trends                              |
| GET    | `/api/analytics/distinct-years`        | Distinct transaction years                   |
| GET    | `/api/reports/monthly-pdf`             | Monthly PDF report                           |
| GET    | `/api/reports/tax-summary-pdf`         | Tax summary PDF                              |
| GET    | `/api/reports/pl-summary-pdf`          | P&L summary PDF                              |
| GET    | `/api/reports/annual-pdf`              | Annual financial report PDF                  |
| GET    | `/api/export/transactions`             | Export transactions (CSV/JSON)               |
| GET    | `/api/export/summary`                  | Export summary (CSV/JSON)                    |
| POST   | `/api/calculator/retire`               | Retirement calculator                        |
| POST   | `/api/import/upload`                   | Upload Excel file                            |
| POST   | `/api/import/file-sheet`               | Parse sheet columns                          |
| POST   | `/api/import/googlesheet`              | Import from Google Sheets                    |
| POST   | `/api/import/execute`                  | Execute import                               |

</details>

API documentation is also available at `/api/docs` (Swagger UI) when the server is running.

## Deployment

See [docs/self-hosting.md](./docs/self-hosting.md) for detailed deployment instructions.

### Quick Docker Deployment

```bash
# Set required environment variables
export SESSION_SECRET=$(openssl rand -hex 32)
export ALLOWED_ORIGINS=https://your-domain.com

# Start
docker compose up -d
```

### Manual Deployment

```bash
# 1. Build frontend
pnpm run build

# 2. Serve frontend/backend behind a reverse proxy (Apache/Nginx)
#    pointing /api to the Express server on port 3847

# 3. Start backend
NODE_ENV=production SESSION_SECRET=your-secret node backend/index.js
```

## Documentation

- [Contributing Guide](./CONTRIBUTING.md) — Setup, workflow, testing, PR guidelines
- [Code of Conduct](./CODE_OF_CONDUCT.md) — Community standards
- [Security Policy](./SECURITY.md) — Vulnerability reporting
- [Roadmap](./ROADMAP.md) — Planned features and improvements
- [Changelog](./CHANGELOG.md) — Version history
- [Docs Index](./docs/README.md) — All documentation

## License

MIT — see [LICENSE](./LICENSE) for details.
