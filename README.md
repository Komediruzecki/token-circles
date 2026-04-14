# Finance Manager

A personal finance tracking web application with transaction management, budgeting, loan amortization calculations, and data import/export capabilities.

## Tech Stack

- **Frontend**: Vanilla JavaScript SPA served as static files
- **Backend**: Node.js + Express REST API
- **Database**: SQLite (better-sqlite3)
- **Charts**: Chart.js
- **Data Import**: XLSX (Excel) and Google Sheets

## Project Structure

```
/
├── frontend/          # Static HTML/JS/CSS served by Apache
│   ├── index.html     # Single-page application
│   └── assets/        # Static assets (served via Apache)
├── backend/           # Express API server
│   ├── index.js       # API routes and server setup
│   ├── database.js    # SQLite schema and initialization
│   └── models/        # Business logic (e.g., loan calculator)
├── db/                # SQLite database files (created on first run)
├── assets/            # User-uploaded assets
├── deploy.sh          # Server deployment script
└── package.json       # Node.js dependencies
```

## Setup

### Prerequisites

- Node.js 18+
- npm
- Apache2 (for production deployment)

### Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the backend server:**
   ```bash
   cd backend
   NODE_PATH=../node_modules node index.js
   ```
   The server runs on `http://localhost:3847` by default. Set `PORT` env var to change.

3. **Serve the frontend:**
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

3. Run the deployment script:
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

6. Reload Apache:
   ```bash
   sudo systemctl reload apache2
   ```

## Features

### Profiles
- Multiple user profiles with isolated data
- Switch between profiles via dropdown

### Transactions
- Add/edit/delete income and expense transactions
- Assign categories to transactions
- Monthly budget tracking

### Categories
- Custom income/expense categories with colors
- Budget limits per category

### Loan Calculator
- Track multiple loans with variable interest rate periods
- Amortization schedule with prepayment modeling
- Chart visualization of principal vs interest over time

### Data Import
- Import transactions from Excel (.xlsx, .xls)
- Google Sheets integration
- Automatic category color mapping on re-import

### Analytics
- Monthly/yearly summaries
- Category spending trends
- Spending distribution charts

## API

The backend exposes a REST API. All endpoints require an `X-Profile-Id` header (integer profile ID).

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/profiles` | List all profiles |
| POST | `/api/profiles` | Create profile |
| DELETE | `/api/profiles/:id` | Delete profile |
| GET | `/api/settings` | Get profile settings |
| PUT | `/api/settings` | Update settings |
| GET | `/api/categories` | List categories |
| POST | `/api/categories` | Create category |
| PUT | `/api/categories/:id` | Update category |
| DELETE | `/api/categories/:id` | Delete category |
| DELETE | `/api/categories` | Delete all categories |
| GET | `/api/transactions` | List transactions |
| POST | `/api/transactions` | Create transaction |
| PUT | `/api/transactions/:id` | Update transaction |
| DELETE | `/api/transactions/:id` | Delete transaction |
| GET | `/api/budgets` | List budgets |
| POST | `/api/budgets` | Create/update budgets |
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
