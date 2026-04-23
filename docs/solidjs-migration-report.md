# SolidJS Migration - Missing Functionality Report

## Executive Summary

**Critical Issues Found:**
1. Transactions page has ONLY the form modal - NO transaction table, filters, pagination
2. Settings page does NOT have storage switching (storage abstraction not connected)
3. Charts missing on many pages (Budgets, Goals, Analytics, Housing, etc.)

## Detailed Findings

### 1. Transactions Page (CRITICAL)

**Old App (`transactions.js` - 1044 lines):**
- ✅ Transaction list table with sorting and pagination
- ✅ Filters: Date range presets (Month, Last Month, Year, Custom), Category multi-select, Tag multi-select
- ✅ Search functionality
- ✅ Pagination controls
- ✅ Bulk selection and edit
- ✅ Recurring transactions display

**New App (`transactions.tsx` - 572 lines):**
- ❌ NO transaction table - only modal form
- ❌ NO filters (date, category, tag)
- ❌ NO search
- ❌ NO pagination
- ❌ NO bulk actions
- ❌ NO recurring view

### 2. Settings Page - Storage Abstraction

**Old App:**
- ✅ Switch between SQLite and PostgreSQL storage backends
- ✅ Storage selection UI in settings

**New App:**
- ❌ No storage switching UI
- ❌ No storage abstraction implementation

### 3. Dashboard Page

**Old App (`dashboard.js` - 26987 bytes):**
- ✅ Summary cards (Income, Expenses, Balance, Net Worth)
- ✅ Spending by category chart
- ✅ Monthly trends chart
- ✅ Recurring insights
- ✅ Recent transactions list

**New App (`dashboard.tsx`):**
- ❌ Summary cards present
- ❌ Charts MISSING - no visualizations

### 4. Analytics Page

**Old App (`analytics.js` - 18137 bytes):**
- ✅ Heatmap visualization
- ✅ Category trends chart
- ✅ Income vs Expense comparison
- ✅ Savings rate calculation
- ✅ Spending by category breakdown

**New App (`Analytics.tsx`):**
- ✅ Basic category bars
- ✅ Monthly trend bars
- ✅ Savings rate chart
- ❌ NO HEATMAP
- ❌ NO income vs expense trend chart
- ❌ Basic bars only, no charts.js integration

### 5. Budgets Page

**Old App (`budgets.js` - 16285 bytes):**
- ✅ Budget creation/edit
- ✅ Budget list with progress bars
- ✅ Budget by category breakdown
- ✅ Over/under budget indicators
- ✅ Spending by category chart

**New App (`BudgetsPage.tsx`):**
- ❌ NO budget creation
- ❌ NO budget list
- ❌ NO progress bars
- ❌ NO charts

### 6. Goals Page

**Old App (`savingsGoals.js` - 8759 bytes):**
- ✅ Goals list with progress bars
- ✅ Target/due date tracking
- ✅ Monthly contribution input
- ✅ Visual progress indicators
- ✅ Goals summary cards

**New App (`GoalsPage.tsx`):**
- ❌ NO goals list
- ❌ NO progress bars
- ❌ NO monthly contributions

### 7. Housing Page

**Old App (`housingCalc.js` - 14480 bytes):**
- ✅ Monthly housing cost calculator
- ✅ Property tax estimate
- ✅ Insurance estimate
- ✅ Utilities estimate
- ✅ HOA fees

**New App (`HousingPage.tsx`):**
- ❌ NO calculator
- ❌ NO cost breakdown

### 8. Loans Page

**Old App (`loans.js` - 37960 bytes):**
- ✅ Loan calculator with amortization table
- ✅ Monthly payment calculation
- ✅ Interest rate tracking
- ✅ Extra payments feature
- ✅ Amortization schedule visualization

**New App (`LoansPage.tsx`):**
- ❌ No calculator present
- ❌ No amortization table
- ❌ No extra payments

### 9. Bills Page

**Old App (`bills.js` - 7840 bytes):**
- ✅ Bills list with due dates
- ✅ Bills from accounts integration
- ✅ Payment history
- ✅ Repeating bills

**New App (`BillsPage.tsx`):**
- ❌ No bills list
- ❌ No due date tracking
- ❌ No payment history

### 10. Categories Page

**Old App (`categories-accounts.js` - 15341 bytes):**
- ✅ Categories with color coding
- ✅ Expense/income type selection
- ✅ Parent category hierarchy
- ✅ Account mapping

**New App (`CategoriesPage.tsx`):**
- ✅ Basic category CRUD
- ❌ NO color picker UI
- ❌ NO type selection
- ❌ NO parent category hierarchy

### 11. Retirement Page

**Old App (`retirement.js` - 13724 bytes):**
- ✅ Retirement calculator
- ✅ Current savings projection
- ✅ Goal-based projection
- ✅ Monthly contribution calculator

**New App (`RetirementPage.tsx`):**
- ❌ No calculator
- ❌ No projections

### 12. CSS Issues

**Problems:**
1. CSS modules using camelCase class names (e.g., `statCard`, `statCardLabel`)
2. Old CSS uses kebab-case (e.g., `.stat-card`, `.stat-card-label`)
3. Components mixing inline styles, CSS modules, and global CSS
4. No unified approach - chunks of inline styles scattered throughout

## Fix Priority

### Priority 1 (CRITICAL):
1. Rebuild Transactions page with full table, filters, pagination
2. Add storage switching to Settings page

### Priority 2 (HIGH):
3. Add charts to Dashboard (use Chart.js)
4. Add charts to Budgets page
5. Restore Heatmap to Analytics
6. Restore Goals progress bars

### Priority 3 (MEDIUM):
7. Restore Housing calculator
8. Restore Loans calculator with amortization table
9. Restore Bills list
10. Restore Categories color picker and hierarchy

### Priority 4 (LOW):
11. Cleanup CSS - standardize to kebab-case, use CSS modules consistently
12. Remove inline styles, convert to CSS modules
13. Consolidate duplicate styles

## Files Needing Creation/Refactoring

**New Components:**
- `TransactionsTable.tsx` - Transaction table with filters
- `TransactionFilters.tsx` - Category/tag/date filters
- `StorageSettings.tsx` - Storage switching UI
- `ChartContainer.tsx` - Chart.js wrapper with theme support

**Existing Files to Fix:**
- `Transactions.tsx` - Add table view, remove inline-only modal
- `SettingsPage.tsx` - Add storage switching section
- `DashboardPage.tsx` - Add charts
- `BudgetsPage.tsx` - Add budget list and charts
- `GoalsPage.tsx` - Add progress bars
- `Analytics.tsx` - Add heatmap
- `HousingPage.tsx` - Add calculator
- `LoansPage.tsx` - Add calculator and amortization
- `BillsPage.tsx` - Add bills list

**CSS Cleanup:**
- Convert all CSS module keys to kebab-case
- Create unified CSS modules for shared components
- Remove inline styles
- Consolidate global CSS into CSS modules where possible