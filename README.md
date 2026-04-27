# Finance Manager - Personal Finance Tracker

A comprehensive personal finance management application built with SolidJS for the frontend and Express for the backend.

## Tech Stack

- **Frontend**: SolidJS + TypeScript + Vite
- **Backend**: Node.js + Express REST API
- **Database**: SQLite (better-sqlite3) with WAL mode - also supports PostgreSQL
- **Charts**: Chart.js
- **PDF Generation**: PDFKit (fallback) and Puppeteer (charts)
- **Data Import**: XLSX (Excel)

## Project Structure

```
finance-manager/
├── .github/           # GitHub workflows and CI/CD configuration
├── .claude/           # Claude Code project settings
├── backend/           # Node.js/Express backend API
│   ├── index.js       # Main server entry point
│   ├── database.js    # SQLite schema, migrations, and seed data
│   ├── models/        # Business logic
│   └── package.json   # Backend dependencies
├── frontend/          # SolidJS + TypeScript frontend
│   ├── src/           # Source code (components, features, core)
│   ├── package.json   # Frontend dependencies
│   ├── vite.config.js # Vite configuration
│   └── index.html     # Production build output
├── docs/              # Documentation and migration reports
├── db/                # SQLite database files
├── logs/              # Application logs
└── test/              # E2E tests
```

## Installation

```bash
# Install all dependencies (backend and frontend)
npm install
```

## Development

```bash
# Start frontend development server
npm run dev

# Start backend server
npm run start
```

## Building

```bash
# Build frontend for production
npm run build
```

## Features

### Transactions
- Add/edit/delete income and expense transactions
- Assign categories, notes, and payment method
- Quick add via keyboard shortcut (Ctrl+Shift+T)
- Bulk operations (update, delete)
- CSV and JSON export

### Budgets
- Monthly budget tracking per category
- Visual progress indicators
- Compare actual vs budgeted spending

### Categories
- Custom income/expense categories with colors and icons
- Budget limits per category
- Tax-deductible flags

### Analytics
- Category spending trends over time
- Top categories breakdown
- Budget vs actual flow (Sankey diagram)
- Spending heatmap calendar
- Monthly/yearly summaries
- Period comparison overlay
- Dark/light theme support

### Loan Calculator
- Track multiple loans with variable interest rate periods
- Amortization schedule with prepayment modeling
- Chart visualization of principal vs interest over time

### Data Import
- Import transactions from Excel (.xlsx, .xls)
- Google Sheets integration
- Column mapping and preview
- Automatic category color mapping on re-import

### Reports
- Monthly PDF reports with charts
- Annual financial reports with charts
- Tax summary reports (deductible/non-deductible)
- Profit & loss (P&L) reports

### Accounts
- Multiple account support (checking, savings, credit card)
- Balance history tracking
- Currency support per account

### Retirement Calculator
- Compound interest projections
- Savings goal planning

## API

### Health Check

The backend provides a health check endpoint to verify the service is running:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | API health status (check if backend is running) |

**Example response:**
```json
{
  "status": "ok",
  "timestamp": "2026-04-27T09:58:47.946Z",
  "database": "connected"
}
```

**Live site URLs:**
- Frontend: https://finance-manager.clodhost.com
- API: https://finance-manager.clodhost.com/api
- Health Check: https://finance-manager.clodhost.com/api/health

The backend exposes a REST API. All endpoints require an `X-Profile-Id` header (integer profile ID).

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/profiles` | List all profiles |
| POST | `/api/profiles` | Create profile |
| PUT | `/api/profiles/:id` | Update profile |
| DELETE | `/api/profiles/:id` | Delete profile |
| DELETE | `/api/profiles/:id/data` | Delete all profile data |
| GET | `/api/settings` | Get profile settings |
| PUT | `/api/settings` | Update settings |
| GET | `/api/categories` | List categories |
| POST | `/api/categories` | Create category |
| PUT | `/api/categories/:id` | Update category |
| DELETE | `/api/categories/:id` | Delete category |
| DELETE | `/api/categories` | Delete all categories |
| GET | `/api/transactions` | List transactions (supports sort, filter, pagination) |
| POST | `/api/transactions` | Create transaction |
| PUT | `/api/transactions/:id` | Update transaction |
| DELETE | `/api/transactions/:id` | Delete transaction |
| DELETE | `/api/transactions` | Delete all transactions |
| PUT | `/api/transactions/bulk` | Bulk update/delete transactions |
| GET | `/api/budgets` | List budgets |
| POST | `/api/budgets` | Create/update budgets |
| GET | `/api/accounts` | List accounts |
| POST | `/api/accounts` | Create account |
| PUT | `/api/accounts/:id` | Update account |
| DELETE | `/api/accounts/:id` | Delete account |
| POST | `/api/accounts/:id/history` | Record balance history |
| GET | `/api/loans` | List loans |
| POST | `/api/loans` | Create loan |
| PUT | `/api/loans/:id` | Update loan |
| DELETE | `/api/loans/:id` | Delete loan |
| POST | `/api/loans/:id/rates` | Add rate period |
| DELETE | `/api/loans/:id/rates/:rateId` | Delete rate period |
| POST | `/api/loans/:id/prepayments` | Add prepayment |
| DELETE | `/api/loans/:id/prepayments/:prepayId` | Delete prepayment |
| POST | `/api/loans/:id/calculate` | Get amortization schedule |
| GET | `/api/dashboard/summary` | Dashboard summary |
| GET | `/api/dashboard/charts` | Dashboard chart data |
| GET | `/api/analytics/category-trends` | Category trends |
| GET | `/api/analytics/distinct-years` | Distinct transaction years |
| GET | `/api/reports/monthly-pdf` | Monthly PDF report |
| GET | `/api/reports/tax-summary-pdf` | Tax summary PDF |
| GET | `/api/reports/pl-summary-pdf` | P&L summary PDF |
| GET | `/api/reports/annual-pdf` | Annual financial report PDF |
| GET | `/api/export/transactions` | Export transactions (CSV/JSON) |
| GET | `/api/export/summary` | Export summary (CSV/JSON) |
| POST | `/api/calculator/retire` | Retirement calculator |
| POST | `/api/import/upload` | Upload Excel file |
| POST | `/api/import/file-sheet` | Parse sheet columns |
| POST | `/api/import/googlesheet` | Import from Google Sheets |
| POST | `/api/import/execute` | Execute import |

## Contributing

1. Pick an open issue from GitHub Issues
2. Create a feature branch: `git checkout -b feat/issue-NUMBER-short-description`
3. Make changes and commit using Conventional Commits
4. Push and open a PR against `main`
5. Ensure CI passes before requesting review

### Testing

```bash
npm test              # Run all tests
npm test -- --watch  # Watch mode
npx jest <path>      # Run specific test file
```

Tests require the backend server running on port 3847 with `NODE_ENV=test`. The test database (`db/test.db`) and rate limit stores are reset automatically between test files. The server must have the `test.db` database seeded before running tests — run `npm test` once to initialize.

## Deployment

### Architecture

This project uses **frontend/ and backend/** as the source of truth (ground truth). The deployment process:

1. **Development Repo** (`/tmp/finance-manager-2`): Contains source code in `frontend/` and `backend/`
2. **Production Build**: Built via Vite and deployed to `/var/www/finance-manager.clodhost.com/frontend/dist`
3. **Production Backend**: Source code synced to `/var/www/finance-manager.clodhost.com/backend/index.js` and `database.js`

### Deployment Process

```bash
# 1. Build frontend (from ground truth)
cd /tmp/finance-manager-2/frontend
npm run build

# 2. Deploy frontend to production
./deploy.sh  # or manually copy dist/ to /var/www/finance-manager.clodhost.com/frontend/

# 3. Sync backend from ground truth
cp /tmp/finance-manager-2/backend/index.js /var/www/finance-manager.clodhost.com/backend/index.js
cp /tmp/finance-manager-2/backend/database.js /var/www/finance-manager.clodhost.com/backend/database.js

# 4. Restart backend service
systemctl restart finance-manager.service
```

### Live Site URLs

| Service | URL |
|---------|-----|
| Frontend | https://finance-manager.clodhost.com |
| Backend API | https://finance-manager.clodhost.com/api |
| Health Check | https://finance-manager.clodhost.com/api/health |
| API Docs | https://finance-manager.clodhost.com/api/docs |

The backend runs via systemd as `finance-manager.service` listening on port 3847, served through Apache reverse proxy.
