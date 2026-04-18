# Finance Manager

A personal finance tracking web application with transaction management, budgeting, loan amortization calculations, and data import/export capabilities.

## Tech Stack

- **Frontend**: Vanilla JavaScript SPA served as static files (modular architecture)
- **Backend**: Node.js + Express REST API
- **Database**: SQLite (better-sqlite3) with WAL mode
- **Charts**: Chart.js
- **PDF Generation**: PDFKit (fallback) and Puppeteer (charts)
- **Data Import**: XLSX (Excel) and Google Sheets

## Project Structure

```
/
├── frontend/          # Static HTML/JS/CSS served by Apache
│   ├── index.html     # Combined SPA output (all modules included)
│   ├── css/           # Modular stylesheets
│   │   ├── base.css       # Reset, variables, theme, layout, cards, forms, tables
│   │   └── components.css # Modal, tabs, filters, pagination, toasts, toggles
│   ├── js/            # Modular JavaScript
│   │   ├── core/           # api(), auth, router, theme, modal helpers
│   │   ├── features/       # dashboard, transactions, budgets, loans, analytics, etc.
│   │   └── app.js          # Bootstrap/initialization
│   └── templates/     # HTML fragments (sidebar, modals, page sections)
├── backend/           # Express API server
│   ├── index.js       # API routes and server setup
│   └── database.js    # SQLite schema, migrations, and seed data
├── db/                # SQLite database files (created on first run)
├── assets/            # User-uploaded assets
├── test/              # Jest test suites
├── deploy.sh          # Server deployment script
└── package.json       # Node.js dependencies
```

## Setup

### Prerequisites

- Node.js 20+
- npm
- Apache2 (for production deployment)

### Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build the frontend:**
   ```bash
   npm run build
   ```
   This bundles all JS/CSS modules into `frontend/index.html` using esbuild. Re-run after making frontend changes.

3. **Start the backend server:**
   ```bash
   npm start
   ```
   The server runs on `http://localhost:3847` by default. Set `PORT` env var to change.

4. **Serve the frontend:**
   The frontend is a static SPA. For local development, you can:
   - Open `frontend/index.html` directly in a browser, or
   - Use any static file server:
     ```bash
     npx serve frontend
     ```

   Note: When serving locally (not through Apache), update the `API` constant in `frontend/index.html` to point to your backend URL:
   ```javascript
   const API = 'http://localhost:3847/api/';
   ```

### Production Deployment

1. Clone the repository on the server:
   ```bash
   git clone https://github.com/Komediruzecki/finance-manager.git
   cd finance-manager
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the frontend:
   ```bash
   npm run build
   ```

4. Run the deployment script:
   ```bash
   ./deploy.sh
   ```

4. Configure Apache to proxy API requests and serve static files. Example config:
   ```apache
   <VirtualHost *:443>
       ServerName your-domain.com
       DocumentRoot /path/to/finance-manager/frontend

       # Proxy API to Node backend
       ProxyPreserveHost On
       ProxyPass /api/ http://127.0.0.1:3847/api/
       ProxyPassReverse /api/ http://127.0.0.1:3847/api/

       <Directory /path/to/finance-manager/frontend>
           Options Indexes FollowSymLinks
           AllowOverride All
           Require all granted
       </Directory>
   </VirtualHost>
   ```

5. Start the backend:
   ```bash
   cd backend && NODE_PATH=../node_modules node index.js &
   ```

5. Reload Apache:
   ```bash
   sudo systemctl reload apache2
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
