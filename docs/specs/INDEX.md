# Finance Manager - EARS Requirement Specifications

This directory contains all EARS (Exactly As Required Specification) requirement specifications for the Finance Manager application.

## Structure

```
specs/
├── frontend/           # Frontend feature specifications
├── backend/            # Backend API specifications
└── INDEX.md           # Module mapping
```

## Frontend Modules

| Module            | File                                                  | Status         |
| ----------------- | ----------------------------------------------------- | -------------- |
| Dashboard         | [dashboard.md](frontend/dashboard.md)                 | ✅ Active      |
| Transactions      | [transactions.md](frontend/transactions.md)           | 🔄 In Progress |
| Accounts          | [accounts.md](frontend/accounts.md)                   | 🔄 In Progress |
| Categories        | [categories.md](frontend/categories.md)               | 🔄 In Progress |
| Budgets           | [budgets.md](frontend/budgets.md)                     | 🔄 In Progress |
| Goals             | [goals.md](frontend/goals.md)                         | 🔄 In Progress |
| Loans             | [loans.md](frontend/loans.md)                         | 🔄 In Progress |
| Bills             | [bills.md](frontend/bills.md)                         | 🔄 In Progress |
| Housing           | [housing.md](frontend/housing.md)                     | 🔄 In Progress |
| Retirement        | [retirement.md](frontend/retirement.md)               | 🔄 In Progress |
| Compound Interest | [compound-interest.md](frontend/compound-interest.md) | 🔄 In Progress |
| Emergency Fund    | [emergency-fund.md](frontend/emergency-fund.md)       | 🔄 In Progress |
| Analytics         | [analytics.md](frontend/analytics.md)                 | 🔄 In Progress |
| Import            | [import.md](frontend/import.md)                       | 🔄 In Progress |
| Onboarding        | [onboarding.md](frontend/onboarding.md)               | ✅ Active      |
| Settings          | [settings.md](frontend/settings.md)                   | 🔄 In Progress |
| Rent vs Buy       | [rent-buy.md](frontend/rent-buy.md)                   | 🔄 In Progress |

## Backend API Modules

| Module         | File                                         | Status         |
| -------------- | -------------------------------------------- | -------------- |
| Authentication | [auth.md](backend/auth.md)                   | 🔄 In Progress |
| Profiles       | [profiles.md](backend/profiles.md)           | 🔄 In Progress |
| Transactions   | [transactions.md](backend/transactions.md)   | 🔄 In Progress |
| Accounts       | [accounts.md](backend/accounts.md)           | 🔄 In Progress |
| Categories     | [categories.md](backend/categories.md)       | 🔄 In Progress |
| Tags           | [tags.md](backend/tags.md)                   | 🔄 In Progress |
| Receipts       | [receipts.md](backend/receipts.md)           | 🔄 In Progress |
| Bills          | [bills.md](backend/bills.md)                 | 🔄 In Progress |
| Budgets        | [budgets.md](backend/budgets.md)             | 🔄 In Progress |
| Savings Goals  | [savings-goals.md](backend/savings-goals.md) | 🔄 In Progress |
| Loans          | [loans.md](backend/loans.md)                 | 🔄 In Progress |
| Housing        | [housing.md](backend/housing.md)             | 🔄 In Progress |
| Recurring      | [recurring.md](backend/recurring.md)         | 🔄 In Progress |
| Analytics      | [analytics.md](backend/analytics.md)         | 🔄 In Progress |
| Reports        | [reports.md](backend/reports.md)             | 🔄 In Progress |
| Calculator     | [calculator.md](backend/calculator.md)       | 🔄 In Progress |
| Settings       | [settings.md](backend/settings.md)           | 🔄 In Progress |
| Health & Logs  | [health.md](backend/health.md)               | 🔄 In Progress |

## E2E Test Specifications

E2E test specifications follow each feature specification and define automated test cases for critical user journeys.

- Located in: `../e2e/specs/`
- Follow the same module naming convention
- Test scenarios derived from EARS requirements
