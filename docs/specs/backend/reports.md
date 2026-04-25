# Reports Specification

**Module:** Reports
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

Reports module provides financial reports with export capabilities and summaries.

## 2. Functional Requirements

### 2.1. Report Types

| ID | Description | Type |
|----|-------------|------|
| R-001 | Financial summary report must be supported | Must |
| R-002 | Annual PDF report must be supported | Must |
| R-003 | Monthly PDF report must be supported | Must |
| R-004 | Profit/Loss summary must be supported | Must |
| R-005 | Tax summary must be supported | Must |

### 2.2. Report Data

| ID | Description | Type |
|----|-------------|------|
| R-010 | Report must support date range | Must |
| R-011 | Report must support period selection | Must |
| R-012 | Report must support profile selection | Must |

### 2.3. Summary Report

| ID | Description | Type |
|----|-------------|------|
| R-020 | Summary must show total income | Must |
| R-021 | Summary must show total expenses | Must |
| R-022 | Summary must show net income/loss | Must |
| R-023 | Summary must show transaction count | Must |
| R-024 | Summary must show average daily spending | Should |

### 2.4. Profit/Loss Report

| ID | Description | Type |
|----|-------------|------|
| R-030 | PL summary must show income vs expenses | Must |
| R-031 | PL summary must show by category | Should |
| R-032 | PL summary must show net position | Must |

### 2.5. Tax Report

| ID | Description | Type |
|----|-------------|------|
| R-040 | Tax summary must show deductible expenses | Should |
| R-041 | Tax summary must support custom categories | Should |
| R-042 | Tax report must be year-based | Should |

### 2.6. PDF Export

| ID | Description | Type |
|----|-------------|------|
| R-050 | Annual PDF must generate downloadable PDF | Must |
| R-051 | Monthly PDF must generate downloadable PDF | Must |
| R-052 | PL summary PDF must generate downloadable PDF | Must |
| R-053 | Tax summary PDF must generate downloadable PDF | Must |

### 2.7. CSV Export

| ID | Description | Type |
|----|-------------|------|
| R-060 | CSV export must support transactions | Must |
| R-061 | CSV export must support categories | Should |
| R-062 | CSV export must support date filtering | Must |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | Get report must complete within 200ms | 200ms |
| NFR-002 | Generate PDF must complete within 5s | 5s |
| NFR-003 | Generate CSV must complete within 500ms | 500ms |

### 3.2. Data Consistency

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-003 | Reports must reflect current data | Always |

### 3.3. Security

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-004 | Report access must be scoped to user | Always |

## 4. API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/reports/pl-summary` | GET | Get Profit/Loss summary |
| `/api/reports/tax-summary` | GET | Get Tax summary |
| `/api/reports/monthly-pdf` | GET | Generate Monthly PDF |
| `/api/reports/annual-pdf` | GET | Generate Annual PDF |
| `/api/reports/pl-summary-pdf` | GET | Get PL summary PDF |
| `/api/reports/tax-summary-pdf` | GET | Get Tax summary PDF |
| `/api/export` | GET | Export data |
| `/api/export/:type` | GET | Export specific type |

## 5. Data Models

**PLSummary:**
- `totalIncome: number` - Total income
- `totalExpenses: number` - Total expenses
- `netIncome: number` - Net income/loss
- `transactionCount: number` - Total transactions
- `incomeByCategory: CategoryBalance[]` - Income by category
- `expenseByCategory: CategoryBalance[]` - Expenses by category
- `period: string` - Report period

**TaxSummary:**
- `totalDeductions: number` - Total deductible expenses
- `income: number` - Total income
- `taxableIncome: number` - Taxable income
- `estimatedTax: number` - Estimated tax
- `year: number` - Tax year

**ExportOptions:**
- `type: string` - Export type (transactions, categories, etc.)
- `format: string` - Export format (csv, pdf)
- `startDate: ISO8601` - Start date (optional)
- `endDate: ISO8601` - End date (optional)

## 6. User Flows

### 6.1. View PL Summary

1. User opens Reports page
2. User selects date range
3. System loads PL summary
4. System displays income, expenses, net income
5. System shows breakdown by category

### 6.2. View Tax Summary

1. User opens Reports page
2. User selects year
3. System loads tax summary
4. System displays deductible expenses
5. System shows estimated tax

### 6.3. Export PDF

1. User selects report type
2. User selects date range/year
3. User clicks "Export PDF" button
4. System generates PDF
5. System downloads PDF file
6. System returns success

### 6.4. Export CSV

1. User selects export type
2. User selects date range
3. User clicks "Export CSV" button
4. System generates CSV
5. System downloads CSV file
6. System returns success

## 7. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| Invalid date range | Return 400 with error message |
| No data for period | Return empty results |
| Report generation fails | Return 500 with error message |
| User not authenticated | Return 401 Unauthorized |

## 8. Open/Closed Questions

1. Should reports support custom templates?
2. Should reports support multiple export formats?
3. Should reports support email delivery?
4. Should reports support scheduled generation?

## 9. Acceptance Criteria

- [ ] User can view PL summary
- [ ] User can view tax summary
- [ ] User can export PDF reports
- [ ] User can export CSV files
- [ ] Reports support date range filtering
- [ ] Reports are scoped to user
- [ ] PDF generation works correctly
- [ ] CSV export works correctly

## 10. Dependencies

| Data | Source |
|------|--------|
| Transactions | Transaction data |
| Categories | Category data |
| Accounts | Account data |
| Profiles | Profile selection |