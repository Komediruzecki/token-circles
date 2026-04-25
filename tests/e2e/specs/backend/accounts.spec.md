# E2E Test Specification - Accounts Module

**Module:** Accounts
**Test Suite:** Backend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Accounts module backend, covering account CRUD operations, balance management, currency handling, and account grouping.

## 2. Account CRUD Tests

### 2.1. Create Account

**ID:** BE-T-001
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send POST to `/api/accounts` with account data
3. Verify response 201 Created
4. Verify account in database
5. Verify account belongs to user

#### Validation
- [ ] Response status 201
- [ ] Account created
- [ ] Account assigned to user
- [ ] Initial balance set

#### Expected Result
Account created successfully.

### 2.2. Create Account Without Auth

**ID:** BE-T-002
**Priority:** Must
**Type:** Negative

#### Steps
1. Send POST to `/api/accounts` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.3. Create Account Duplicate Name

**ID:** BE-T-003
**Priority:** Must
**Type:** Negative

#### Steps
1. Create account with name
2. Try to create another with same name
3. Verify response 409 Conflict
4. Verify error message

#### Validation
- [ ] Response status 409
- [ ] Error message present
- [ ] No duplicate created

#### Expected Result
Duplicate account names prevented.

### 2.4. Get All Accounts

**ID:** BE-T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/accounts`
3. Verify response 200 OK
4. Verify all user's accounts returned
5. Verify no other user's accounts

#### Validation
- [ ] Response status 200
- [ ] All user accounts returned
- [ ] No cross-user data
- [ ] Total count correct

#### Expected Result
User's accounts retrieved successfully.

### 2.5. Get All Accounts Without Auth

**ID:** BE-T-005
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/accounts` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.6. Get Account by ID

**ID:** BE-T-006
**Priority:** Must
**Type:** Positive

#### Steps
1. Create account
2. Get account ID
3. Send GET to `/api/accounts/:id`
4. Verify response 200 OK
5. Verify account data
6. Verify account belongs to user

#### Validation
- [ ] Response status 200
- [ ] Account data correct
- [ ] Account belongs to user
- [ ] No cross-user data

#### Expected Result
Account retrieved successfully.

### 2.7. Get Account by ID Without Auth

**ID:** BE-T-007
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/accounts/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.8. Get Another User's Account

**ID:** BE-T-008
**Priority:** Must
**Type:** Negative

#### Steps
1. Create account for user A
2. Login as user B
3. Try to get user A's account
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user access blocked

#### Expected Result
Cross-user access blocked.

### 2.9. Update Account

**ID:** BE-T-009
**Priority:** Must
**Type:** Positive

#### Steps
1. Create account
2. Send PUT to `/api/accounts/:id` with updates
3. Verify response 200 OK
4. Verify changes persisted
5. Verify other fields unchanged

#### Validation
- [ ] Response status 200
- [ ] Changes persisted
- [ ] Other fields unchanged
- [ ] Only owner can update

#### Expected Result
Account updated successfully.

### 2.10. Update Account Without Auth

**ID:** BE-T-010
**Priority:** Must
**Type:** Negative

#### Steps
1. Send PUT to `/api/accounts/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.11. Update Another User's Account

**ID:** BE-T-011
**Priority:** Must
**Type:** Negative

#### Steps
1. Create account for user A
2. Login as user B
3. Try to update user A's account
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user updates blocked

#### Expected Result
Cross-user updates blocked.

### 2.12. Delete Account

**ID:** BE-T-012
**Priority:** Must
**Type:** Positive

#### Steps
1. Create account with balance
2. Send DELETE to `/api/accounts/:id`
3. Verify response 200 OK
4. Verify account deleted
5. Verify transactions still accessible

#### Validation
- [ ] Response status 200
- [ ] Account deleted
- [ ] Transactions preserved
- [ ] Only owner can delete

#### Expected Result
Account deleted successfully.

### 2.13. Delete Account Without Auth

**ID:** BE-T-013
**Priority:** Must
**Type:** Negative

#### Steps
1. Send DELETE to `/api/accounts/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.14. Delete Another User's Account

**ID:** BE-T-014
**Priority:** Must
**Type:** Negative

#### Steps
1. Create account for user A
2. Login as user B
3. Try to delete user A's account
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user deletes blocked

#### Expected Result
Cross-user deletes blocked.

### 2.15. Delete Account with Transactions

**ID:** BE-T-015
**Priority:** Must
**Type:** Positive

#### Steps
1. Create account with transactions
2. Delete account
3. Verify account deleted
4. Verify transactions remain
5. Verify transactions accessible via API

#### Validation
- [ ] Account deleted
- [ ] Transactions preserved
- [ ] Transactions accessible

#### Expected Result
Account deletion preserves transactions.

### 2.16. Delete Account with Negative Balance

**ID:** BE-T-016
**Priority:** Must
**Type:** Negative

#### Steps
1. Create account with negative balance
2. Try to delete account
3. Verify response 400 Bad Request
4. Verify account not deleted

#### Validation
- [ ] Response status 400
- [ ] Account not deleted
- [ ] Error message present

#### Expected Result
Deletion blocked with negative balance.

## 3. Account Data Validation

### 3.1. Invalid Account Data

**ID:** BE-T-017
**Priority:** Must
**Type:** Negative

#### Steps
1. Create account with invalid data
2. Verify response 400 Bad Request
3. Verify validation errors
4. Verify no account created

#### Validation
- [ ] Response status 400
- [ ] Validation errors present
- [ ] No account created

#### Expected Result
Invalid account data rejected.

### 3.2. Empty Account Name

**ID:** BE-T-018
**Priority:** Must
**Type:** Negative

#### Steps
1. Create account without name
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Empty names prevented.

### 3.3. Invalid Balance

**ID:** BE-T-019
**Priority:** Must
**Type:** Negative

#### Steps
1. Create account with negative balance
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Negative balances prevented.

### 3.4. Invalid Currency

**ID:** BE-T-020
**Priority:** Must
**Type:** Negative

#### Steps
1. Create account with invalid currency
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid currency rejected.

## 4. Balance Management Tests

### 4.1. Balance Updates on Create

**ID:** BE-T-021
**Priority:** Must
**Type:** Positive

#### Steps
1. Create account with initial balance
2. Verify balance stored correctly

#### Validation
- [ ] Initial balance saved
- [ ] Balance accurate

#### Expected Result
Initial balance set correctly.

### 4.2. Balance Updates on Transaction

**ID:** BE-T-022
**Priority:** Must
**Type:** Integration

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

### 4.3. Balance Calculations

**ID:** BE-T-023
**Priority:** Must
**Type:** Positive

#### Steps
1. Create account with balance
2. Add multiple transactions
3. Verify running balance
4. Verify total balance correct

#### Validation
- [ ] Running balance accurate
- [ ] Total balance correct
- [ ] No rounding errors

#### Expected Result
Balances calculated correctly.

## 5. Currency Tests

### 5.1. Multi-Currency Accounts

**ID:** BE-T-024
**Priority:** Must
**Type:** Positive

#### Steps
1. Create account in USD
2. Create account in EUR
3. Verify currencies saved
4. Verify balances in correct currency

#### Validation
- [ ] Multiple currencies supported
- [ ] Balance stored with currency
- [ ] Currency preserved

#### Expected Result
Multi-currency accounts work.

### 5.2. Currency Conversions

**ID:** BE-T-025
**Priority:** Should
**Type:** Integration

#### Steps
1. Create accounts in different currencies
2. View summary with converted values
3. Verify conversion rate used
4. Verify results accurate

#### Validation
- [ ] Conversion works
- [ ] Rates applied correctly
- [ ] Results reasonable

#### Expected Result
Currency conversions work.

### 5.3. Default Currency

**ID:** BE-T-026
**Priority:** Must
**Type:** Positive

#### Steps
1. Set default currency in settings
2. Create new account
3. Verify default currency used
4. Verify balance in default currency

#### Validation
- [ ] Default currency respected
- [ ] Account created with default

#### Expected Result
Default currency applied.

## 6. Account Grouping Tests

### 6.1. Create Account Group

**ID:** BE-T-027
**Priority:** Must
**Type:** Positive

#### Steps
1. Create account group
2. Verify response 201 Created
3. Verify group saved

#### Validation
- [ ] Response status 201
- [ ] Group created
- [ ] Group metadata saved

#### Expected Result
Account group created.

### 6.2. Assign Account to Group

**ID:** BE-T-028
**Priority:** Must
**Type:** Positive

#### Steps
1. Create account
2. Create group
3. Assign account to group
4. Verify assignment

#### Validation
- [ ] Account linked to group
- [ ] Group membership updated

#### Expected Result
Account-group relationship works.

### 6.3. View Grouped Accounts

**ID:** BE-T-029
**Priority:** Must
**Type:** Positive

#### Steps
1. Create multiple accounts
2. Create group
3. Assign all to group
4. Get group details
5. Verify accounts in group

#### Validation
- [ ] All accounts in group
- [ ] Group query works
- [ ] Accounts accessible

#### Expected Result
Grouped accounts viewable.

### 6.4. Delete Group

**ID:** BE-T-030
**Priority:** Must
**Type:** Positive

#### Steps
1. Create group with accounts
2. Delete group
3. Verify group deleted
4. Verify accounts remain

#### Validation
- [ ] Group deleted
- [ ] Accounts still exist
- [ ] No orphaned relationships

#### Expected Result
Group deletion preserves accounts.

### 6.5. Cross-User Group Access

**ID:** BE-T-031
**Priority:** Must
**Type:** Negative

#### Steps
1. Create group for user A
2. Login as user B
3. Try to get user A's group
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Cross-user access blocked

#### Expected Result
Group ownership enforced.

## 7. Account Type Tests

### 7.1. Checking Account

**ID:** BE-T-032
**Priority:** Must
**Type:** Positive

#### Steps
1. Create checking account
2. Verify type 'checking'
3. Verify account type settings

#### Validation
- [ ] Type set correctly
- [ ] Type-specific settings accessible

#### Expected Result
Checking accounts work.

### 7.2. Savings Account

**ID:** BE-T-033
**Priority:** Must
**Type:** Positive

#### Steps
1. Create savings account
2. Verify type 'savings'
3. Verify account type settings

#### Validation
- [ ] Type set correctly
- [ ] Type-specific settings accessible

#### Expected Result
Savings accounts work.

### 7.3. Credit Account

**ID:** BE-T-034
**Priority:** Must
**Type:** Positive

#### Steps
1. Create credit account
2. Verify type 'credit'
3. Verify balance handling (negative means owed)

#### Validation
- [ ] Type set correctly
- [ ] Balance semantics correct

#### Expected Result
Credit accounts work.

## 8. Summary and Analytics Tests

### 8.1. Account Summary

**ID:** BE-T-035
**Priority:** Must
**Type:** Positive

#### Steps
1. Create multiple accounts
2. Send GET to `/api/accounts/summary`
3. Verify summary data
4. Verify totals correct

#### Validation
- [ ] Summary includes all accounts
- [ ] Totals accurate
- [ ] Currency handling correct

#### Expected Result
Account summary works.

### 8.2. Account Aggregates

**ID:** BE-T-036
**Priority:** Must
**Type:** Positive

#### Steps
1. Create accounts with transactions
2. Get account aggregates
3. Verify totals match transactions

#### Validation
- [ ] Aggregates accurate
- [ ] Transaction totals match
- [ ] Calculations correct

#### Expected Result
Account aggregates work.

## 9. Performance Tests

### 9.1. List Accounts Performance

**ID:** BE-T-037
**Priority:** Must
**Type:** Performance

#### Steps
1. Send GET to `/api/accounts`
2. Measure response time
3. Verify meets 100ms threshold

#### Validation
- [ ] Response < 100ms
- [ ] Proper indexing
- [ ] Efficient queries

#### Expected Result
Account listing is fast.

### 9.2. Create Account Performance

**ID:** BE-T-038
**Priority:** Must
**Type:** Performance

#### Steps
1. Send POST to `/api/accounts`
2. Measure response time
3. Verify meets 50ms threshold

#### Validation
- [ ] Response < 50ms
- [ ] Efficient creation

#### Expected Result
Account creation is fast.

## 10. Error Handling Tests

### 10.1. Error Messages

**ID:** BE-T-039
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

## 11. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] Balance management correct
- [ ] Multi-currency support working
- [ ] Cross-user data isolation working
- [ ] No critical bugs

## 12. Test Execution Notes

- Test with various account types
- Verify balance calculations with multi-currency
- Test account-group relationships
- Test with many accounts
- Verify transaction balance updates
- Test edge cases with credit accounts

## 13. Dependencies

- Database with accounts table
- Balance tracking system
- Currency handling
- Grouping functionality
- Transaction integration
- Summary aggregation