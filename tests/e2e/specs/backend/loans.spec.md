# E2E Test Specification - Loans Module

**Module:** Loans
**Test Suite:** Backend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Loans module backend, covering loan creation, balance tracking, payments, amortization calculation, payoff estimation, and loan progress tracking.

## 2. Loan CRUD Tests

### 2.1. Create Loan

**ID:** BE-T-001
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send POST to `/api/loans` with loan data
3. Verify response 201 Created
4. Verify loan in database
5. Verify loan belongs to user

#### Validation
- [ ] Response status 201
- [ ] Loan created
- [ ] Loan assigned to user
- [ ] Balance calculated correctly

#### Expected Result
Loan created successfully.

### 2.2. Create Loan Without Auth

**ID:** BE-T-002
**Priority:** Must
**Type:** Negative

#### Steps
1. Send POST to `/api/loans` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.3. Create Duplicate Loan

**ID:** BE-T-003
**Priority:** Must
**Type:** Negative

#### Steps
1. Create loan with same name and balance
2. Try to create another
3. Verify response 409 Conflict
4. Verify error message

#### Validation
- [ ] Response status 409
- [ ] Error message present
- [ ] No duplicate created

#### Expected Result
Duplicate loans prevented.

### 2.4. Get All Loans

**ID:** BE-T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/loans`
3. Verify response 200 OK
4. Verify all user's loans returned
5. Verify no other user's loans

#### Validation
- [ ] Response status 200
- [ ] All user loans returned
- [ ] No cross-user data
- [ ] Total count correct

#### Expected Result
User's loans retrieved successfully.

### 2.5. Get All Loans Without Auth

**ID:** BE-T-005
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/loans` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.6. Get Loan by ID

**ID:** BE-T-006
**Priority:** Must
**Type:** Positive

#### Steps
1. Create loan
2. Get loan ID
3. Send GET to `/api/loans/:id`
4. Verify response 200 OK
5. Verify loan data
6. Verify loan belongs to user

#### Validation
- [ ] Response status 200
- [ ] Loan data correct
- [ ] Loan belongs to user
- [ ] No cross-user data

#### Expected Result
Loan retrieved successfully.

### 2.7. Get Loan by ID Without Auth

**ID:** BE-T-007
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/loans/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.8. Get Another User's Loan

**ID:** BE-T-008
**Priority:** Must
**Type:** Negative

#### Steps
1. Create loan for user A
2. Login as user B
3. Try to get user A's loan
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user access blocked

#### Expected Result
Cross-user access blocked.

### 2.9. Update Loan

**ID:** BE-T-009
**Priority:** Must
**Type:** Positive

#### Steps
1. Create loan
2. Send PUT to `/api/loans/:id` with updates
3. Verify response 200 OK
4. Verify changes persisted
5. Verify other fields unchanged

#### Validation
- [ ] Response status 200
- [ ] Changes persisted
- [ ] Other fields unchanged
- [ ] Only owner can update

#### Expected Result
Loan updated successfully.

### 2.10. Update Loan Without Auth

**ID:** BE-T-010
**Priority:** Must
**Type:** Negative

#### Steps
1. Send PUT to `/api/loans/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.11. Update Another User's Loan

**ID:** BE-T-011
**Priority:** Must
**Type:** Negative

#### Steps
1. Create loan for user A
2. Login as user B
3. Try to update user A's loan
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user updates blocked

#### Expected Result
Cross-user updates blocked.

### 2.12. Delete Loan

**ID:** BE-T-012
**Priority:** Must
**Type:** Positive

#### Steps
1. Create loan
2. Send DELETE to `/api/loans/:id`
3. Verify response 200 OK
4. Verify loan deleted

#### Validation
- [ ] Response status 200
- [ ] Loan deleted
- [ ] Only owner can delete

#### Expected Result
Loan deleted successfully.

### 2.13. Delete Loan Without Auth

**ID:** BE-T-013
**Priority:** Must
**Type:** Negative

#### Steps
1. Send DELETE to `/api/loans/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.14. Delete Another User's Loan

**ID:** BE-T-014
**Priority:** Must
**Type:** Negative

#### Steps
1. Create loan for user A
2. Login as user B
3. Try to delete user A's loan
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user deletes blocked

#### Expected Result
Cross-user deletes blocked.

## 3. Loan Data Validation

### 3.1. Invalid Loan Data

**ID:** BE-T-015
**Priority:** Must
**Type:** Negative

#### Steps
1. Create loan with invalid data
2. Verify response 400 Bad Request
3. Verify validation errors

#### Validation
- [ ] Response status 400
- [ ] Validation errors present
- [ ] No loan created

#### Expected Result
Invalid loan data rejected.

### 3.2. Missing Balance

**ID:** BE-T-016
**Priority:** Must
**Type:** Negative

#### Steps
1. Create loan without balance
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Missing balance prevented.

### 3.3. Missing Interest Rate

**ID:** BE-T-017
**Priority:** Must
**Type:** Negative

#### Steps
1. Create loan without interest rate
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Missing interest rate prevented.

### 3.4. Invalid Interest Rate

**ID:** BE-T-018
**Priority:** Must
**Type:** Negative

#### Steps
1. Create loan with negative interest rate
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Negative interest rate prevented.

## 4. Loan Balance Tracking Tests

### 4.1. Track Loan Payments

**ID:** BE-T-019
**Priority:** Must
**Type:** Positive

#### Steps
1. Create loan with balance $10000
2. Make payment of $500
3. Verify balance decreased
4. Verify payments recorded

#### Validation
- [ ] Balance decreased correctly
- [ ] Payment recorded
- [ ] Payment amount correct

#### Expected Result
Loan payments tracked correctly.

### 4.2. Get Loan Balance

**ID:** BE-T-020
**Priority:** Must
**Type:** Positive

#### Steps
1. Create loan
2. Make payments
3. Get loan balance
4. Verify calculation accurate

#### Validation
- [ ] Balance accurate
- [ ] Initial - payments
- [ ] No manual error

#### Expected Result
Loan balance calculation works.

### 4.3. Get Loan Balance History

**ID:** BE-T-021
**Priority:** Should
**Type:** Positive

#### Steps
1. Create loan
2. Make multiple payments
3. Get balance history
4. Verify timeline

#### Validation
- [ ] History includes all payments
- [ ] Dates accurate
- [ ] Values correct

#### Expected Result
Loan balance history works.

### 4.4. Loan Overpayment

**ID:** BE-T-022
**Priority:** Should
**Type:** Positive

#### Steps
1. Create loan
2. Make payment exceeding balance
3. Verify balance becomes negative
4. Verify overpayment recorded

#### Validation
- [ ] Negative balance allowed
- [ ] Overpayment recorded
- [ ] Next payment applies to negative

#### Expected Result
Overpayments tracked correctly.

## 5. Amortization Tests

### 5.1. Calculate Amortization Schedule

**ID:** BE-T-023
**Priority:** Must
**Type:** Positive

#### Steps
1. Create loan with term and rate
2. Request amortization schedule
3. Verify schedule generated
4. Verify accuracy

#### Validation
- [ ] Schedule generated
- [ ] All payments calculated
- [ ] Interest/principal correct
- [ ] Total matches

#### Expected Result
Amortization schedule works.

### 5.2. Get Payment Amount

**ID:** BE-T-024
**Priority:** Must
**Type:** Positive

#### Steps
1. Create loan
2. Get payment amount
3. Verify calculation accurate

#### Validation
- [ ] Payment amount correct
- [ ] Formula applied correctly
- [ ] Consistent with amortization

#### Expected Result
Payment amount calculation works.

### 5.3. Calculate Remaining Principal

**ID:** BE-T-025
**Priority:** Must
**Type:** Positive

#### Steps
1. Create loan
2. Make payments
3. Calculate remaining principal
4. Verify accuracy

#### Validation
- [ ] Remaining principal accurate
- [ ] Initial - principal paid
- [ ] Correct balance

#### Expected Result
Remaining principal calculation works.

### 5.4. Get Interest Paid

**ID:** BE-T-026
**Priority:** Should
**Type:** Positive

#### Steps
1. Create loan
2. Make payments
3. Get interest paid
4. Verify accuracy

#### Validation
- [ ] Interest paid accurate
- [ ] Against outstanding balance
- [ ] Total correct

#### Expected Result
Interest paid calculation works.

### 5.5. Get Principal Paid

**ID:** BE-T-027
**Priority:** Should
**Type:** Positive

#### Steps
1. Create loan
2. Make payments
3. Get principal paid
4. Verify accuracy

#### Validation
- [ ] Principal paid accurate
- [ ] Payments - interest
- [ ] Total correct

#### Expected Result
Principal paid calculation works.

## 6. Payoff Estimation Tests

### 6.1. Calculate Payoff Date

**ID:** BE-T-028
**Priority:** Must
**Type:** Positive

#### Steps
1. Create loan
2. Calculate payoff date
3. Verify date accurate

#### Validation
- [ ] Payoff date calculated
- [ ] Based on current balance
- [ ] Correct with current payments

#### Expected Result
Payoff date calculation works.

### 6.2. Calculate Payoff Amount

**ID:** BE-T-029
**Priority:** Must
**Type:** Positive

#### Steps
1. Create loan
2. Calculate payoff amount
3. Verify amount accurate

#### Validation
- [ ] Payoff amount correct
- [ ] Includes accrued interest
- [ ] Matches schedule

#### Expected Result
Payoff amount calculation works.

### 6.3. Calculate Bi-Weekly Payoff

**ID:** BE-T-030
**Priority:** Should
**Type:** Positive

#### Steps
1. Create loan
2. Calculate bi-weekly payoff
3. Verify faster payoff
4. Compare with monthly

#### Validation
- [ ] Faster payoff than monthly
- [ ] Correct calculation
- [ ] Saves time

#### Expected Result
Bi-weekly payoff saves time.

### 6.4. Calculate Lump Sum Payoff

**ID:** BE-T-031
**Priority:** Should
**Type:** Positive

#### Steps
1. Create loan
2. Calculate lump sum payoff
3. Verify amount
4. Compare to remaining

#### Validation
- [ ] Payoff amount correct
- [ ] Includes interest
- [ ] Saves overall interest

#### Expected Result
Lump sum payoff calculated correctly.

### 6.5. Calculate Extra Payment Impact

**ID:** BE-T-032
**Priority:** Should
**Type:** Positive

#### Steps
1. Create loan
2. Calculate with extra payment monthly
3. Verify faster payoff
4. Verify interest saved

#### Validation
- [ ] Faster than standard
- [ ] Interest saved calculated
- [ ] Term reduced

#### Expected Result
Extra payment impact calculated.

## 7. Loan Progress Tests

### 7.1. Get Loan Progress

**ID:** BE-T-033
**Priority:** Must
**Type:** Positive

#### Steps
1. Create loan
2. Make payments
3. Get loan progress
4. Verify accuracy

#### Validation
- [ ] Total paid correct
- [ ] Remaining correct
- [ ] Percentage accurate
- [ ] Time remaining accurate

#### Expected Result
Loan progress calculation works.

### 7.2. Get Loan Completion Status

**ID:** BE-T-034
**Priority:** Must
**Type:** Positive

#### Steps
1. Create loan
2. Make payments
3. Get completion status
4. Verify flag set when complete

#### Validation
- [ ] Status accurate
- [ ] Complete flag set when paid off
- [ ] In-progress when active

#### Expected Result
Loan completion status works.

### 7.3. Get Loan Statistics

**ID:** BE-T-035
**Priority:** Must
**Type:** Positive

#### Steps
1. Create loan
2. Get statistics
3. Verify all metrics

#### Validation
- [ ] Statistics accurate
- [ ] Monthly payment
- [ ] Total interest
- [ ] Total paid
- [ ] Payoff date

#### Expected Result
Loan statistics work.

## 8. Loan Type Tests

### 8.1. Fixed Rate Loan

**ID:** BE-T-036
**Priority:** Must
**Type:** Positive

#### Steps
1. Create fixed rate loan
2. Verify rate is fixed
3. Verify amortization matches standard

#### Validation
- [ ] Rate remains constant
- [ ] Schedule accurate
- [ ] Predictable payments

#### Expected Result
Fixed rate loans work.

### 8.2. Variable Rate Loan

**ID:** BE-T-037
**Priority:** Must
**Type:** Positive

#### Steps
1. Create variable rate loan
2. Update interest rate
3. Verify amortization updates
4. Verify remaining balance unaffected

#### Validation
- [ ] Rate can change
- [ ] Schedule recalculates
- [ ] Existing balance unchanged

#### Expected Result
Variable rate loans work.

### 8.3. Interest-Only Loan

**ID:** BE-T-038
**Priority:** Should
**Type:** Positive

#### Steps
1. Create interest-only loan
2. Make interest-only payments
3. Verify principal unchanged
4. Switch to full payments
5. Verify principal reduced

#### Validation
- [ ] Interest-only phase works
- [ ] Principal unchanged during interest-only
- [ ] Full payments reduce principal

#### Expected Result
Interest-only loans work.

### 8.4. Balloon Payment Loan

**ID:** BE-T-039
**Priority:** Should
**Type:** Positive

#### Steps
1. Create balloon payment loan
2. Verify small payments
3. Verify balloon payment large
4. Verify remaining after balloon

#### Validation
- [ ] Small payments early
- [ ] Large balloon payment
- [ ] Loan paid off after balloon

#### Expected Result
Balloon payment loans work.

## 9. Performance Tests

### 9.1. Get Loan Progress Performance

**ID:** BE-T-040
**Priority:** Must
**Type:** Performance

#### Steps
1. Send GET to `/api/loans/:id/progress`
2. Measure response time
3. Verify meets 100ms threshold

#### Validation
- [ ] Response < 100ms
- [ ] Efficient calculations

#### Expected Result
Loan progress calculation is fast.

### 9.2. Calculate Amortization Performance

**ID:** BE-T-041
**Priority:** Must
**Type:** Performance

#### Steps
1. Request amortization schedule
2. Measure response time
3. Verify meets 500ms threshold

#### Validation
- [ ] Response < 500ms
- [ ] Efficient calculation
- [ ] Sufficient for reasonable term

#### Expected Result
Amortization calculation is fast enough.

### 9.3. Get Loan List Performance

**ID:** BE-T-042
**Priority:** Should
**Type:** Performance

#### Steps
1. Send GET to `/api/loans`
2. Measure response time
3. Verify acceptable performance

#### Validation
- [ ] Response reasonable
- [ ] Efficient queries

#### Expected Result
Loan list retrieval is efficient.

## 10. Error Handling Tests

### 10.1. Error Messages

**ID:** BE-T-043
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

### 10.2. Negative Payment

**ID:** BE-T-044
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to make negative payment
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Negative payments prevented.

### 10.3. Payment Exceeding Balance

**ID:** BE-T-045
**Priority:** Should
**Type:** Negative

#### Steps
1. Try to make payment exceeding balance
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Payments exceeding balance prevented.

## 11. Integration Tests

### 11.1. Loan Payment Affects Account Balance

**ID:** BE-T-046
**Priority:** Must
**Type:** Integration

#### Steps
1. Create loan
2. Make payment
3. Verify account balance decreased
4. Verify payment recorded

#### Validation
- [ ] Balance updated
- [ ] Payment recorded
- [ ] Amount correct

#### Expected Result
Loan payments update balance.

### 11.2. Loan Payment Affects Analytics

**ID:** BE-T-047
**Priority:** Should
**Type:** Integration

#### Steps
1. Make loan payment
2. Verify analytics updated
3. Verify dashboard reflects payment

#### Validation
- [ ] Analytics updated
- [ ] Dashboard accurate

#### Expected Result
Loan payments update analytics.

### 11.3. Loan Payment Affects Transactions

**ID:** BE-T-048
**Priority:** Should
**Type:** Integration

#### Steps
1. Make loan payment
2. Verify transaction created
3. Verify transaction categorized

#### Validation
- [ ] Transaction created
- [ ] Categorized correctly
- [ ] Transaction type tracked

#### Expected Result
Loan payments create transactions.

## 12. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] Balance tracking accurate
- [ ] Amortization correct
- [ ] Payoff calculations accurate
- [ ] Cross-user data isolation working

## 13. Test Execution Notes

- Test with various loan terms
- Verify amortization accuracy
- Test extra payment scenarios
- Test variable rate changes
- Verify payoff calculations
- Test loan types (fixed, variable, interest-only)

## 14. Dependencies

- Database with loans table
- Balance tracking system
- Payment processing
- Amortization calculation
- Payoff estimation
- Analytics integration
- Transaction integration