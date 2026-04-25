# E2E Test Specification - Analytics Module

**Module:** Analytics
**Test Suite:** Backend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Analytics module backend, covering expense breakdown, income analysis, spending trends, category analysis, account analysis, savings analysis, and custom report generation.

## 2. Analytics Endpoint Tests

### 2.1. Get Expense Breakdown

**ID:** BE-T-001
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/expenses`
3. Verify response 200 OK
4. Verify expense data returned
5. Verify breakdown by category

#### Validation
- [ ] Response status 200
- [ ] Expense data present
- [ ] Breakdown accurate
- [ ] Categories included

#### Expected Result
Expense breakdown retrieved successfully.

### 2.2. Get Expense Breakdown Without Auth

**ID:** BE-T-002
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/analytics/expenses` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.3. Get Expense Breakdown by Date Range

**ID:** BE-T-003
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/expenses?start=2026-01-01&end=2026-12-31`
3. Verify response 200 OK
4. Verify date-filtered data
5. Verify breakdown accurate

#### Validation
- [ ] Response status 200
- [ ] Date range applied
- [ ] Data accurate for range
- [ ] Other periods excluded

#### Expected Result
Expense breakdown by date range works.

### 2.4. Get Expense Breakdown by Account

**ID:** BE-T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/expenses?accountId=1`
3. Verify response 200 OK
4. Verify account-filtered data
5. Verify breakdown accurate

#### Validation
- [ ] Response status 200
- [ ] Account filter applied
- [ ] Data accurate for account
- [ ] Other accounts excluded

#### Expected Result
Expense breakdown by account works.

### 2.5. Get Expense Breakdown Invalid Date Range

**ID:** BE-T-005
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/analytics/expenses?start=2026-12-31&end=2026-01-01`
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid date range prevented.

## 3. Income Analysis Tests

### 3.1. Get Income Breakdown

**ID:** BE-T-006
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/income`
3. Verify response 200 OK
4. Verify income data returned
5. Verify breakdown by source

#### Validation
- [ ] Response status 200
- [ ] Income data present
- [ ] Breakdown accurate
- [ ] Sources included

#### Expected Result
Income breakdown retrieved successfully.

### 3.2. Get Income by Date Range

**ID:** BE-T-007
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/income?start=2026-01-01&end=2026-12-31`
3. Verify response 200 OK
4. Verify date-filtered income
5. Verify accuracy

#### Validation
- [ ] Response status 200
- [ ] Date range applied
- [ ] Data accurate
- [ ] Other periods excluded

#### Expected Result
Income by date range works.

### 3.3. Get Monthly Income Trend

**ID:** BE-T-008
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/income/trend?period=monthly`
3. Verify response 200 OK
4. Verify monthly trend data
5. Verify accuracy

#### Validation
- [ ] Response status 200
- [ ] Monthly trend data present
- [ ] Data accurate
- [ ] Last 12 months included

#### Expected Result
Monthly income trend works.

## 4. Spending Trend Tests

### 4.1. Get Spending Trend

**ID:** BE-T-009
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/spending/trend?period=monthly`
3. Verify response 200 OK
4. Verify spending trend data
5. Verify accuracy

#### Validation
- [ ] Response status 200
- [ ] Trend data present
- [ ] Data accurate
- [ ] Correct period granularity

#### Expected Result
Spending trend retrieved successfully.

### 4.2. Get Spending Trend Daily

**ID:** BE-T-010
**Priority:** Should
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/spending/trend?period=daily`
3. Verify response 200 OK
4. Verify daily trend data

#### Validation
- [ ] Response status 200
- [ ] Daily trend data present

#### Expected Result
Daily spending trend works.

### 4.3. Get Spending Trend Weekly

**ID:** BE-T-011
**Priority:** Should
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/spending/trend?period=weekly`
3. Verify response 200 OK
4. Verify weekly trend data

#### Validation
- [ ] Response status 200
- [ ] Weekly trend data present

#### Expected Result
Weekly spending trend works.

### 4.4. Spending Trend with Filter

**ID:** BE-T-012
**Priority:** Should
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/spending/trend?period=monthly&accountId=1`
3. Verify response 200 OK
4. Verify filtered trend data

#### Validation
- [ ] Response status 200
- [ ] Filter applied correctly
- [ ] Trend accurate for filter

#### Expected Result
Spending trend with filters works.

## 5. Category Analysis Tests

### 5.1. Get Category Spending

**ID:** BE-T-013
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/categories`
3. Verify response 200 OK
4. Verify category spending data
5. Verify accuracy

#### Validation
- [ ] Response status 200
- [ ] Category data present
- [ ] Data accurate
- [ ] Percentages calculated

#### Expected Result
Category spending retrieved successfully.

### 5.2. Get Category Spending by Date Range

**ID:** BE-T-014
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/categories?start=2026-01-01&end=2026-12-31`
3. Verify response 200 OK
4. Verify date-filtered category data

#### Validation
- [ ] Response status 200
- [ ] Date range applied
- [ ] Data accurate for range

#### Expected Result
Category spending by date range works.

### 5.3. Get Top Spending Categories

**ID:** BE-T-015
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/categories/top?limit=5`
3. Verify response 200 OK
4. Verify top categories returned
5. Verify accuracy

#### Validation
- [ ] Response status 200
- [ ] Top categories returned
- [ ] Correct count
- [ ] Correct ordering

#### Expected Result
Top spending categories retrieved.

### 5.4. Category Spending Distribution

**ID:** BE-T-016
**Priority:** Should
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/categories/distribution`
3. Verify response 200 OK
4. Verify distribution data

#### Validation
- [ ] Response status 200
- [ ] Distribution data present
- [ ] Percentages sum to 100%

#### Expected Result
Category spending distribution works.

## 6. Account Analysis Tests

### 6.1. Get Account Balances

**ID:** BE-T-017
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/accounts/balances`
3. Verify response 200 OK
4. Verify balance data
5. Verify accuracy

#### Validation
- [ ] Response status 200
- [ ] Balance data present
- [ ] Balances accurate
- [ ] Accounts included

#### Expected Result
Account balances retrieved successfully.

### 6.2. Get Account Transactions

**ID:** BE-T-018
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/accounts/transactions?accountId=1`
3. Verify response 200 OK
4. Verify transactions for account
5. Verify accuracy

#### Validation
- [ ] Response status 200
- [ ] Transactions returned
- [ ] Correct account
- [ ] All transactions included

#### Expected Result
Account transactions retrieved successfully.

### 6.3. Get Account Activity Trend

**ID:** BE-T-019
**Priority:** Should
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/accounts/activity?accountId=1&period=monthly`
3. Verify response 200 OK
4. Verify activity trend

#### Validation
- [ ] Response status 200
- [ ] Activity trend data present

#### Expected Result
Account activity trend works.

### 6.4. Get Total Account Value

**ID:** BE-T-020
**Priority:** Should
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/accounts/total`
3. Verify response 200 OK
4. Verify total value
5. Verify accuracy

#### Validation
- [ ] Response status 200
- [ ] Total value accurate
- [ ] All accounts included

#### Expected Result
Total account value works.

## 7. Savings Analysis Tests

### 7.1. Get Savings Progress

**ID:** BE-T-021
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/savings/progress`
3. Verify response 200 OK
4. Verify progress data
5. Verify accuracy

#### Validation
- [ ] Response status 200
- [ ] Progress data present
- [ ] Accuracy maintained

#### Expected Result
Savings progress retrieved successfully.

### 7.2. Get Savings Trend

**ID:** BE-T-022
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/savings/trend?period=monthly`
3. Verify response 200 OK
4. Verify savings trend data

#### Validation
- [ ] Response status 200
- [ ] Trend data present

#### Expected Result
Savings trend works.

### 7.3. Get Savings by Goal

**ID:** BE-T-023
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/savings/goals`
3. Verify response 200 OK
4. Verify goal data
5. Verify accuracy

#### Validation
- [ ] Response status 200
- [ ] Goal data present
- [ ] All goals included

#### Expected Result
Savings by goal retrieved successfully.

### 7.4. Get Savings by Category

**ID:** BE-T-024
**Priority:** Should
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/savings/by-category`
3. Verify response 200 OK
4. Verify category breakdown

#### Validation
- [ ] Response status 200
- [ ] Category breakdown present

#### Expected Result
Savings by category works.

## 8. Custom Report Tests

### 8.1. Create Custom Report

**ID:** BE-T-025
**Priority:** Should
**Type:** Positive

#### Steps
1. Login and get token
2. Send POST to `/api/analytics/reports` with report config
3. Verify response 201 Created
4. Verify report created
5. Verify report belongs to user

#### Validation
- [ ] Response status 201
- [ ] Report created
- [ ] Configuration saved
- [ ] Report in database

#### Expected Result
Custom report created successfully.

### 8.2. Get Custom Reports

**ID:** BE-T-026
**Priority:** Should
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/analytics/reports`
3. Verify response 200 OK
4. Verify reports returned
5. Verify only user's reports

#### Validation
- [ ] Response status 200
- [ ] Reports returned
- [ ] No cross-user data

#### Expected Result
Custom reports retrieved successfully.

### 8.3. Get Custom Report Data

**ID:** BE-T-027
**Priority:** Should
**Type:** Positive

#### Steps
1. Create custom report
2. Get report ID
3. Send GET to `/api/analytics/reports/:id/data`
4. Verify response 200 OK
5. Verify report data

#### Validation
- [ ] Response status 200
- [ ] Data present
- [ ] Data matches configuration

#### Expected Result
Custom report data retrieved.

### 8.4. Update Custom Report

**ID:** BE-T-028
**Priority:** Should
**Type:** Positive

#### Steps
1. Create custom report
2. Send PUT to `/api/analytics/reports/:id` with updates
3. Verify response 200 OK
4. Verify changes persisted

#### Validation
- [ ] Response status 200
- [ ] Changes persisted

#### Expected Result
Custom report updated successfully.

### 8.5. Delete Custom Report

**ID:** BE-T-029
**Priority:** Should
**Type:** Positive

#### Steps
1. Create custom report
2. Send DELETE to `/api/analytics/reports/:id`
3. Verify response 200 OK
4. Verify report deleted

#### Validation
- [ ] Response status 200
- [ ] Report deleted

#### Expected Result
Custom report deleted successfully.

### 8.6. Get Custom Report Preview

**ID:** BE-T-030
**Priority:** Should
**Type:** Positive

#### Steps
1. Create custom report
2. Send GET to `/api/analytics/reports/:id/preview`
3. Verify response 200 OK
4. Verify preview data

#### Validation
- [ ] Response status 200
- [ ] Preview data present

#### Expected Result
Custom report preview works.

### 8.7. Run Custom Report Now

**ID:** BE-T-031
**Priority:** Should
**Type:** Positive

#### Steps
1. Create custom report
2. Send POST to `/api/analytics/reports/:id/run`
3. Verify response 200 OK
4. Verify report executed

#### Validation
- [ ] Response status 200
- [ ] Report executed

#### Expected Result
Custom report execution works.

### 8.8. Scheduled Reports

**ID:** BE-T-032
**Priority:** Should
**Type:** Positive

#### Steps
1. Create custom report with schedule
2. Verify schedule saved
3. Trigger scheduled run
4. Verify report ran
5. Verify email sent

#### Validation
- [ ] Schedule saved
- [ ] Report ran on schedule
- [ ] Email sent correctly

#### Expected Result
Scheduled reports work.

### 8.9. Export Custom Report

**ID:** BE-T-033
**Priority:** Should
**Type:** Positive

#### Steps
1. Create custom report
2. Send GET to `/api/analytics/reports/:id/export`
3. Verify response
4. Verify data exported

#### Validation
- [ ] Export initiated
- [ ] Data exportable

#### Expected Result
Custom report export works.

## 9. Performance Tests

### 9.1. Get Analytics Data Performance

**ID:** BE-T-034
**Priority:** Must
**Type:** Performance

#### Steps
1. Send GET to `/api/analytics/expenses`
2. Measure response time
3. Verify meets 100ms threshold

#### Validation
- [ ] Response < 100ms
- [ ] Efficient queries

#### Expected Result
Analytics data retrieval is fast.

### 9.2. Get Complex Analytics Performance

**ID:** BE-T-035
**Priority:** Should
**Type:** Performance

#### Steps
1. Send GET to `/api/analytics/categories`
2. Measure response time
3. Verify acceptable performance

#### Validation
- [ ] Response reasonable
- [ ] Efficient calculation

#### Expected Result
Complex analytics are efficient.

### 9.3. Custom Report Generation Performance

**ID:** BE-T-036
**Priority:** Should
**Type:** Performance

#### Steps
1. Create and run custom report
2. Measure generation time
3. Verify acceptable performance

#### Validation
- [ ] Generation time reasonable
- [ ] Large datasets handled

#### Expected Result
Custom report generation is efficient.

## 10. Error Handling Tests

### 10.1. Error Messages

**ID:** BE-T-037
**Priority:** Must
**Type:** Positive

#### Steps
1. Trigger various errors
2. Inspect error responses
3. Verify error messages
4. Verify error codes

#### Validation
- [ ] Appropriate error codes
- [ ] Clear error messages
- [ ] No sensitive data

#### Expected Result
Error messages are clear and secure.

### 10.2. Invalid Report Configuration

**ID:** BE-T-038
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to create report with invalid config
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid configuration prevented.

### 10.3. Invalid Analytics Period

**ID:** BE-T-039
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to get trend with invalid period
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid period prevented.

### 10.4. Invalid Date Range

**ID:** BE-T-040
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to get data with invalid date range
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid date range prevented.

## 11. Integration Tests

### 11.1. Analytics Reflects Real Data

**ID:** BE-T-041
**Priority:** Must
**Type:** Integration

#### Steps
1. Create transaction
2. Get analytics
3. Verify analytics includes transaction
4. Verify amounts match

#### Validation
- [ ] Analytics reflects transactions
- [ ] Amounts accurate
- [ ] Real-time updates

#### Expected Result
Analytics reflects real transactions.

### 11.2. Analytics Affects Dashboard

**ID:** BE-T-042
**Priority:** Should
**Type:** Integration

#### Steps
1. Create transactions
2. Get dashboard
3. Verify dashboard shows analytics data
4. Verify accuracy

#### Validation
- [ ] Dashboard accurate
- [ ] Analytics integrated
- [ ] Real-time updates

#### Expected Result
Analytics affects dashboard.

### 11.3. Analytics with Filters

**ID:** BE-T-043
**Priority:** Must
**Type:** Integration

#### Steps
1. Create transactions for multiple accounts
2. Get analytics with account filter
3. Verify only correct transactions included

#### Validation
- [ ] Filter applied correctly
- [ ] Accurate results
- [ ] Performance acceptable

#### Expected Result
Analytics with filters works.

## 12. Cross-User Data Isolation

### 12.1. Cross-User Data Exclusion

**ID:** BE-T-044
**Priority:** Must
**Type:** Positive

#### Steps
1. Create data for user A
2. Login as user B
3. Get analytics
4. Verify only user B's data

#### Validation
- [ ] Only user B's data returned
- [ ] No cross-user data
- [ ] Access control working

#### Expected Result
Cross-user data isolated.

## 13. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] Analytics data accurate
- [ ] Date ranges work correctly
- [ ] Filters work correctly
- [ ] Cross-user data isolated

## 14. Test Execution Notes

- Test with large datasets
- Verify date range calculations
- Test all filter combinations
- Verify custom report configurations
- Test scheduling functionality
- Verify real-time updates

## 15. Dependencies

- Database with analytics tables
- Transaction integration
- Category integration
- Account integration
- Savings integration
- Custom report system