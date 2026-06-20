# Dashboard Specification

**Module:** Dashboard
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

The Dashboard provides a comprehensive financial overview by aggregating key metrics, recent transactions, and upcoming bills. It serves as the central landing page for users to quickly assess their financial health and make informed decisions.

## 2. Functional Requirements

### 2.1. Core Display

| ID | Description | Type |
|----|-------------|------|
| D-001 | Dashboard must display total income for the current year | Must |
| D-002 | Dashboard must display total expenses for the current year | Must |
| D-003 | Dashboard must display total balance across all accounts | Must |
| D-004 | Dashboard must display recent transactions (most recent 10) | Must |
| D-005 | Dashboard must display upcoming bills (next 30 days) | Must |
| D-006 | Dashboard must display expense breakdown by category in a doughnut chart | Should |
| D-007 | Dashboard must display income vs expenses comparison chart | Should |
| D-008 | Dashboard must display spending by category in bar chart | Could |

### 2.2. Data Aggregation

| ID | Description | Type |
|----|-------------|------|
| D-010 | Dashboard must aggregate data across all selected profiles | Must |
| D-011 | Dashboard must use user's local currency setting | Must |
| D-012 | Dashboard must use "amount" field from transactions (falls back to "amount_local") | Must |
| D-013 | Dashboard must exclude pending transactions (based on transaction type) | Must |
| D-014 | Dashboard must exclude transfer transactions from expenses/income totals | Must |

### 2.3. Account Balances

| ID | Description | Type |
|----|-------------|------|
| D-020 | Dashboard must sum balances from all accounts | Must |
| D-021 | Dashboard must display individual account breakdown in charts | Should |
| D-022 | Dashboard must track balance changes over time | Could |

### 2.4. Recent Transactions Display

| ID | Description | Type |
|----|-------------|------|
| D-030 | Recent transactions must display description, date, category, and amount | Must |
| D-031 | Recent transactions must show transaction type (income/expense) | Must |
| D-032 | Recent transactions must show category color | Should |
| D-033 | Recent transactions must show category icon | Should |

### 2.5. Upcoming Bills Display

| ID | Description | Type |
|----|-------------|------|
| D-040 | Upcoming bills must display name, due date, amount, and status | Must |
| D-041 | Upcoming bills must be sorted by due date (ASC) | Must |
| D-042 | Upcoming bills must show days until due | Could |
| D-043 | Upcoming bills must show profile name for multi-profile users | Should |

### 2.6. Refresh and Settings

| ID | Description | Type |
|----|-------------|------|
| D-050 | Dashboard must support manual refresh of data | Must |
| D-051 | Dashboard must display loading state during data refresh | Must |
| D-052 | Dashboard must show error message if data refresh fails | Must |
| D-053 | Dashboard must support configuring visible widgets (Settings modal) | Should |
| D-054 | Dashboard must save widget preferences to localStorage | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | Dashboard page must load within 2 seconds on average connection | 2s |
| NFR-002 | Dashboard data refresh must complete within 1 second | 1s |

### 3.2. Data Consistency

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-003 | Dashboard must always display current data based on current date | Real-time |
| NFR-004 | Dashboard must correctly handle profile switching | Always |

### 3.3. Accessibility

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-005 | All metrics must be screen reader accessible | WCAG 2.1 AA |
| NFR-006 | Charts must have aria-labels for screen readers | WCAG 2.1 AA |

## 4. Integration Requirements

### 4.1. API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dashboard` | GET | Aggregated dashboard metrics for current period |
| `/api/dashboard/summary` | GET | Detailed summary with period filtering |

### 4.2. Dependencies

| Component | Purpose |
|-----------|---------|
| Accounts | Balance aggregation |
| Transactions | Income/expense/recent data |
| Categories | Category names and colors |
| Bills | Upcoming bill display |
| Settings | Currency and local currency |

### 4.3. Data Models

**DashboardMetrics:**
- `totalIncome: number` - Sum of all income transactions in current year
- `totalExpenses: number` - Sum of all expense transactions in current year
- `balance: number` - Total account balances
- `incomeByCategory: CategoryBalance[]` - Income breakdown by category
- `expenseByCategory: CategoryBalance[]` - Expense breakdown by category
- `recentTransactions: Transaction[]` - Last 10 transactions
- `upcomingBills: Bill[]` - Bills due in next 30 days

## 5. User Flows

### 5.1. Initial Load

1. User navigates to Dashboard
2. System loads current year's data by default
3. System displays loading state
4. System displays metrics, charts, recent transactions, and upcoming bills
5. System displays Settings and Refresh buttons

### 5.2. Manual Refresh

1. User clicks Refresh button
2. System displays loading state
3. System fetches updated data from API
4. System updates all displays with new data
5. System removes loading state

### 5.3. Settings Modal

1. User clicks Settings button
2. Settings modal displays all available widgets
3. User toggles widget visibility
4. User clicks Save Settings
5. System saves preferences to localStorage
6. System hides modal and displays saved widgets

### 5.4. Multi-Profile View

1. User selects multiple profiles
2. System displays combined data from all selected profiles
3. System sums balances and transactions across profiles
4. System displays "X profiles combined" indicator

## 6. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| No transactions in current year | Display zeros for income/expense |
| No categories configured | Display empty expense breakdown |
| No recent transactions | Display "No transactions found" message |
| No upcoming bills | Display "No upcoming bills" message |
| API fails to respond | Display error message and retry button |
| No data in database | Display empty state with instructions |

## 7. Open/Closed Questions

1. Should dashboard support date range filtering (not just year)?
2. Should dashboard display budget alerts when over budget?
3. Should dashboard display savings rate percentage?
4. Should dashboard show projected monthly spending?
5. Should dashboard support dark mode preference display?

## 8. Acceptance Criteria

- [ ] User can view total income, expenses, and balance at a glance
- [ ] User can see recent transactions sorted by date (newest first)
- [ ] User can see upcoming bills sorted by due date
- [ ] User can manually refresh dashboard data
- [ ] User can configure which widgets are displayed in Settings
- [ ] Dashboard correctly aggregates data across multiple profiles
- [ ] Dashboard displays appropriate messages when no data exists
- [ ] Dashboard handles API failures gracefully
