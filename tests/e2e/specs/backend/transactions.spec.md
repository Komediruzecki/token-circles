# E2E Test Specification - Transactions Module

**Module:** Transactions
**Test Suite:** Backend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Transactions module backend, covering transaction CRUD operations, balance updates, categorization, recurring transaction creation, and batch operations.

## 2. Transaction CRUD Tests

### 2.1. Create Transaction

**ID:** BE-T-001
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send POST to `/api/transactions` with transaction data
3. Verify response 201 Created
4. Verify transaction in database
5. Verify account balance updated

#### Validation
- [ ] Response status 201
- [ ] Transaction created
- [ ] Account balance adjusted
- [ ] Transaction assigned to category

#### Expected Result
Transaction created successfully.

### 2.2. Create Transaction Without Auth

**ID:** BE-T-002
**Priority:** Must
**Type:** Negative

#### Steps
1. Send POST to `/api/transactions` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.3. Create Transaction Negative Balance

**ID:** BE-T-003
**Priority:** Must
**Type:** Negative

#### Steps
1. Create transaction exceeding account balance
2. Verify response 400 Bad Request
3. Verify balance unchanged

#### Validation
- [ ] Response status 400
- [ ] Balance unchanged
- [ ] Error message present

#### Expected Result
Negative balance prevented.

### 2.4. Get All Transactions

**ID:** BE-T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/transactions`
3. Verify response 200 OK
4. Verify user's transactions returned
5. Verify no other user's transactions

#### Validation
- [ ] Response status 200
- [ ] All user transactions returned
- [ ] No cross-user data
- [ ] Total count correct

#### Expected Result
User's transactions retrieved successfully.

### 2.5. Get All Transactions Without Auth

**ID:** BE-T-005
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/transactions` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.6. Get Transaction by ID

**ID:** BE-T-006
**Priority:** Must
**Type:** Positive

#### Steps
1. Create transaction
2. Get transaction ID
3. Send GET to `/api/transactions/:id`
4. Verify response 200 OK
5. Verify transaction data
6. Verify transaction belongs to user

#### Validation
- [ ] Response status 200
- [ ] Transaction data correct
- [ ] Transaction belongs to user
- [ ] No cross-user data

#### Expected Result
Transaction retrieved successfully.

### 2.7. Get Transaction by ID Without Auth

**ID:** BE-T-007
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/transactions/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.8. Get Another User's Transaction

**ID:** BE-T-008
**Priority:** Must
**Type:** Negative

#### Steps
1. Create transaction for user A
2. Login as user B
3. Try to get user A's transaction
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user access blocked

#### Expected Result
Cross-user access blocked.

### 2.9. Update Transaction

**ID:** BE-T-009
**Priority:** Must
**Type:** Positive

#### Steps
1. Create transaction
2. Send PUT to `/api/transactions/:id` with updates
3. Verify response 200 OK
4. Verify changes persisted
5. Verify other fields unchanged
6. Verify balance updated correctly

#### Validation
- [ ] Response status 200
- [ ] Changes persisted
- [ ] Other fields unchanged
- [ ] Balance updated
- [ ] Only owner can update

#### Expected Result
Transaction updated successfully.

### 2.10. Update Transaction Without Auth

**ID:** BE-T-010
**Priority:** Must
**Type:** Negative

#### Steps
1. Send PUT to `/api/transactions/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.11. Update Another User's Transaction

**ID:** BE-T-011
**Priority:** Must
**Type:** Negative

#### Steps
1. Create transaction for user A
2. Login as user B
3. Try to update user A's transaction
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user updates blocked

#### Expected Result
Cross-user updates blocked.

### 2.12. Delete Transaction

**ID:** BE-T-012
**Priority:** Must
**Type:** Positive

#### Steps
1. Create transaction
2. Send DELETE to `/api/transactions/:id`
3. Verify response 200 OK
4. Verify transaction deleted
5. Verify balance restored

#### Validation
- [ ] Response status 200
- [ ] Transaction deleted
- [ ] Balance restored correctly
- [ ] Only owner can delete

#### Expected Result
Transaction deleted successfully.

### 2.13. Delete Transaction Without Auth

**ID:** BE-T-013
**Priority:** Must
**Type:** Negative

#### Steps
1. Send DELETE to `/api/transactions/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.14. Delete Another User's Transaction

**ID:** BE-T-014
**Priority:** Must
**Type:** Negative

#### Steps
1. Create transaction for user A
2. Login as user B
3. Try to delete user A's transaction
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user deletes blocked

#### Expected Result
Cross-user deletes blocked.

## 3. Transaction Data Validation

### 3.1. Invalid Transaction Data

**ID:** BE-T-015
**Priority:** Must
**Type:** Negative

#### Steps
1. Create transaction with invalid data
2. Verify response 400 Bad Request
3. Verify validation errors
4. Verify no transaction created

#### Validation
- [ ] Response status 400
- [ ] Validation errors present
- [ ] No transaction created

#### Expected Result
Invalid transaction data rejected.

### 3.2. Missing Required Fields

**ID:** BE-T-016
**Priority:** Must
**Type:** Negative

#### Steps
1. Create transaction missing required field
2. Verify response 400 Bad Request
3. Verify error message

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Missing required fields prevented.

### 3.3. Invalid Amount

**ID:** BE-T-017
**Priority:** Must
**Type:** Negative

#### Steps
1. Create transaction with negative amount
2. Verify response 400 Bad Request
3. Verify error message

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Negative amounts prevented.

### 3.4. Invalid Date

**ID:** BE-T-018
**Priority:** Must
**Type:** Negative

#### Steps
1. Create transaction with future date
2. Verify response 400 Bad Request
3. Verify error message

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid dates prevented.

## 4. Balance Management Tests

### 4.1. Balance Updates on Transaction

**ID:** BE-T-019
**Priority:** Must
**Type:** Positive

#### Steps
1. Create account with balance $1000
2. Create expense transaction -$100
3. Verify balance $900
4. Create income transaction +$200
5. Verify balance $1100

#### Validation
- [ ] Balance updates correctly
- [ ] Expense subtracts
- [ ] Income adds
- [ ] Balance accurate

#### Expected Result
Balance management works correctly.

### 4.2. Balance Updates on Delete

**ID:** BE-T-020
**Priority:** Must
**Type:** Positive

#### Steps
1. Create transaction
2. Verify balance updated
3. Delete transaction
4. Verify balance restored

#### Validation
- [ ] Balance updated on create
- [ ] Balance restored on delete
- [ ] Restored to original value

#### Expected Result
Balance restoration works correctly.

### 4.3. Balance Updates on Update

**ID:** BE-T-021
**Priority:** Should
**Type:** Positive

#### Steps
1. Create transaction
2. Update to different amount
3. Verify balance updated

#### Validation
- [ ] Balance reflects new amount
- [ ] Previous value not carried over

#### Expected Result
Balance updates on modification.

## 5. Categorization Tests

### 5.1. Transaction Category Assignment

**ID:** BE-T-022
**Priority:** Must
**Type:** Positive

#### Steps
1. Create transaction without category
2. Verify category null
3. Assign category
4. Verify category assigned

#### Validation
- [ ] Category field nullable
- [ ] Category assigned successfully
- [ ] Associated with user's category

#### Expected Result
Category assignment works.

### 5.2. Non-existent Category

**ID:** BE-T-023
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to assign non-existent category
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid category rejected.

### 5.3. Cross-user Category Access

**ID:** BE-T-024
**Priority:** Must
**Type:** Negative

#### Steps
1. Create category for user A
2. Login as user B
3. Try to assign user A's category
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Cross-user categories inaccessible

#### Expected Result
Category ownership enforced.

## 6. Recurring Transaction Tests

### 6.1. Create Recurring Transaction

**ID:** BE-T-025
**Priority:** Must
**Type:** Positive

#### Steps
1. Create recurring transaction
2. Verify response 201 Created
3. Verify recurrence settings saved

#### Validation
- [ ] Response status 201
- [ ] Recurrence settings present
- [ ] Next occurrence calculated

#### Expected Result
Recurring transaction created.

### 6.2. Generate Recurring Instances

**ID:** BE-T-026
**Priority:** Must
**Type:** Positive

#### Steps
1. Create recurring transaction
2. Wait 30 days
3. Check for generated instance
4. Verify instance created

#### Validation
- [ ] Instance created on schedule
- [ ] Duplicate instances prevented
- [ ] Data matches recurrence

#### Expected Result
Recurring instances generate correctly.

### 6.3. Disable Recurring

**ID:** BE-T-027
**Priority:** Must
**Type:** Positive

#### Steps
1. Create recurring transaction
2. Disable recurrence
3. Verify recurrence disabled
4. Verify no further instances

#### Validation
- [ ] Recurrence flag updated
- [ ] No more instances created

#### Expected Result
Recurrence can be disabled.

### 6.4. Modify Recurring Transaction

**ID:** BE-T-028
**Priority:** Should
**Type:** Positive

#### Steps
1. Create recurring transaction
2. Modify amount
3. Verify future instances updated
4. Verify past instances unchanged

#### Validation
- [ ] Future instances use new amount
- [ ] Historical instances unchanged
- [ ] Settings updated

#### Expected Result
Modifications apply correctly.

## 7. Batch Operations Tests

### 7.1. Create Multiple Transactions

**ID:** BE-T-029
**Priority:** Should
**Type:** Positive

#### Steps
1. Send POST to `/api/transactions/batch`
2. Include 10 transactions
3. Verify response 201 Created
4. Verify all transactions created
5. Verify balances updated

#### Validation
- [ ] All transactions created
- [ ] Balance updated for all
- [ ] Response contains all IDs

#### Expected Result
Batch creation works.

### 7.2. Batch Validation

**ID:** BE-T-030
**Priority:** Must
**Type:** Negative

#### Steps
1. Send batch with invalid transactions
2. Verify response 400 Bad Request
3. Verify partial creation
4. Verify validation errors

#### Validation
- [ ] Response status 400
- [ ] Partial creation stops early
- [ ] Errors for invalid entries

#### Expected Result
Batch validation works.

## 8. Search and Filter Tests

### 8.1. Search by Description

**ID:** BE-T-031
**Priority:** Must
**Type:** Positive

#### Steps
1. Create transactions with different descriptions
2. Search with keyword
3. Verify matching transactions returned
4. Verify no non-matching returned

#### Validation
- [ ] Search returns correct results
- [ ] Partial matches work
- [ ] Case insensitive

#### Expected Result
Search functionality works.

### 8.2. Filter by Date Range

**ID:** BE-T-032
**Priority:** Must
**Type:** Positive

#### Steps
1. Create transactions spanning 6 months
2. Filter by last 3 months
3. Verify correct transactions returned
4. Verify date boundaries respected

#### Validation
- [ ] Correct transactions returned
- [ ] Date boundaries honored
- [ ] Empty result for no matches

#### Expected Result
Date filtering works.

### 8.3. Filter by Category

**ID:** BE-T-033
**Priority:** Must
**Type:** Positive

#### Steps
1. Create transactions with different categories
2. Filter by category
3. Verify only matching transactions returned
4. Verify category access restricted

#### Validation
- [ ] Correct transactions returned
- [ ] Category filtering works
- [ ] Cross-user categories blocked

#### Expected Result
Category filtering works.

### 8.4. Filter by Account

**ID:** BE-T-034
**Priority:** Must
**Type:** Positive

#### Steps
1. Create transactions for multiple accounts
2. Filter by account
3. Verify correct transactions returned
4. Verify cross-user accounts blocked

#### Validation
- [ ] Correct transactions returned
- [ ] Account filtering works
- [ ] Cross-user accounts blocked

#### Expected Result
Account filtering works.

### 8.5. Complex Filter

**ID:** BE-T-035
**Priority:** Should
**Type:** Positive

#### Steps
1. Create varied transactions
2. Filter by date range, category, type
3. Verify combined filtering works

#### Validation
- [ ] Multiple filters work together
- [ ] Correct intersection of results
- [ ] Performance acceptable

#### Expected Result
Complex filtering works.

## 9. Transaction Type Tests

### 9.1. Expense Type

**ID:** BE-T-036
**Priority:** Must
**Type:** Positive

#### Steps
1. Create expense transaction
2. Verify type 'expense'
3. Verify balance decreased
4. Verify categorization

#### Validation
- [ ] Type set correctly
- [ ] Balance decreased
- [ ] Expense category applicable

#### Expected Result
Expense transactions work correctly.

### 9.2. Income Type

**ID:** BE-T-037
**Priority:** Must
**Type:** Positive

#### Steps
1. Create income transaction
2. Verify type 'income'
3. Verify balance increased
4. Verify categorization

#### Validation
- [ ] Type set correctly
- [ ] Balance increased
- [ ] Income category applicable

#### Expected Result
Income transactions work correctly.

### 9.3. Transfer Type

**ID:** BE-T-038
**Priority:** Must
**Type:** Positive

#### Steps
1. Create transfer between accounts
2. Verify type 'transfer'
3. Verify source balance decreased
4. Verify destination balance increased
5. Verify equal amounts

#### Validation
- [ ] Type set correctly
- [ ] Source balance adjusted
- [ ] Destination balance adjusted
- [ ] Amounts equal and opposite

#### Expected Result
Transfer transactions work correctly.

## 10. Performance Tests

### 10.1. List Transactions Performance

**ID:** BE-T-039
**Priority:** Must
**Type:** Performance

#### Steps
1. Send GET to `/api/transactions`
2. Measure response time
3. Verify meets 100ms threshold

#### Validation
- [ ] Response < 100ms
- [ ] Proper indexing
- [ ] Efficient queries

#### Expected Result
Transaction listing is fast.

### 10.2. Create Transaction Performance

**ID:** BE-T-040
**Priority:** Must
**Type:** Performance

#### Steps
1. Send POST to `/api/transactions`
2. Measure response time
3. Verify meets 100ms threshold

#### Validation
- [ ] Response < 100ms
- [ ] Balance update efficient

#### Expected Result
Transaction creation is fast.

### 10.3. Batch Create Performance

**ID:** BE-T-041
**Priority:** Should
**Type:** Performance

#### Steps
1. Create 100 transactions
2. Measure time
3. Verify acceptable performance

#### Validation
- [ ] Processing time reasonable
- [ ] All balances updated

#### Expected Result
Batch processing is efficient.

## 11. Error Handling Tests

### 11.1. Error Messages

**ID:** BE-T-042
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

### 11.2. Duplicate Transaction IDs

**ID:** BE-T-043
**Priority:** Should
**Type:** Negative

#### Steps
1. Create transaction
2. Create transaction with same data
3. Verify no duplicate created
4. Verify error response

#### Validation
- [ ] No duplicate allowed
- [ ] Error response clear

#### Expected Result
Duplicate prevention works.

## 12. Integration Tests

### 12.1. Transaction Affects Analytics

**ID:** BE-T-044
**Priority:** Should
**Type:** Integration

#### Steps
1. Create transaction
2. Verify analytics updated
3. Verify dashboard reflects change

#### Validation
- [ ] Analytics recalculate
- [ ] Dashboard shows correct data

#### Expected Result
Transaction impacts analytics.

### 12.2. Transaction Affects Budget

**ID:** BE-T-045
**Priority:** Should
**Type:** Integration

#### Steps
1. Set budget
2. Create expense within budget
3. Verify remaining budget reduced
4. Create expense over budget
5. Verify warning

#### Validation
- [ ] Budget tracking works
- [ ] Remaining budget accurate
- [ ] Overspend warning works

#### Expected Result
Transaction affects budget.

## 13. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] Balance management correct
- [ ] Cross-user data isolation working
- [ ] Recurring transactions work
- [ ] No critical bugs

## 14. Test Execution Notes

- Test with various transaction types
- Verify balance calculations precise
- Test recurring instances generation
- Test batch operations
- Verify search/filter combinations
- Test date handling edge cases

## 15. Dependencies

- Database with transactions table
- Account balance tracking
- Category ownership
- Recurring transaction logic
- Search/indexing
- Analytics integration