# E2E Test Specification - Budgets Module

**Module:** Budgets
**Test Suite:** Backend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Budgets module backend, covering budget creation, category allocation, spending tracking, overspend detection, and budget cycle management.

## 2. Budget CRUD Tests

### 2.1. Create Budget

**ID:** BE-T-001
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send POST to `/api/budgets` with budget data
3. Verify response 201 Created
4. Verify budget in database
5. Verify budget belongs to user

#### Validation
- [ ] Response status 201
- [ ] Budget created
- [ ] Budget assigned to user
- [ ] Period set correctly

#### Expected Result
Budget created successfully.

### 2.2. Create Budget Without Auth

**ID:** BE-T-002
**Priority:** Must
**Type:** Negative

#### Steps
1. Send POST to `/api/budgets` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.3. Create Duplicate Budget

**ID:** BE-T-003
**Priority:** Must
**Type:** Negative

#### Steps
1. Create budget with same category and period
2. Try to create another
3. Verify response 409 Conflict
4. Verify error message

#### Validation
- [ ] Response status 409
- [ ] Error message present
- [ ] No duplicate created

#### Expected Result
Duplicate budgets prevented.

### 2.4. Get All Budgets

**ID:** BE-T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/budgets`
3. Verify response 200 OK
4. Verify all user's budgets returned
5. Verify no other user's budgets

#### Validation
- [ ] Response status 200
- [ ] All user budgets returned
- [ ] No cross-user data
- [ ] Total count correct

#### Expected Result
User's budgets retrieved successfully.

### 2.5. Get All Budgets Without Auth

**ID:** BE-T-005
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/budgets` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.6. Get Budget by ID

**ID:** BE-T-006
**Priority:** Must
**Type:** Positive

#### Steps
1. Create budget
2. Get budget ID
3. Send GET to `/api/budgets/:id`
4. Verify response 200 OK
5. Verify budget data
6. Verify budget belongs to user

#### Validation
- [ ] Response status 200
- [ ] Budget data correct
- [ ] Budget belongs to user
- [ ] No cross-user data

#### Expected Result
Budget retrieved successfully.

### 2.7. Get Budget by ID Without Auth

**ID:** BE-T-007
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/budgets/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.8. Get Another User's Budget

**ID:** BE-T-008
**Priority:** Must
**Type:** Negative

#### Steps
1. Create budget for user A
2. Login as user B
3. Try to get user A's budget
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user access blocked

#### Expected Result
Cross-user access blocked.

### 2.9. Update Budget

**ID:** BE-T-009
**Priority:** Must
**Type:** Positive

#### Steps
1. Create budget
2. Send PUT to `/api/budgets/:id` with updates
3. Verify response 200 OK
4. Verify changes persisted
5. Verify other fields unchanged

#### Validation
- [ ] Response status 200
- [ ] Changes persisted
- [ ] Other fields unchanged
- [ ] Only owner can update

#### Expected Result
Budget updated successfully.

### 2.10. Update Budget Without Auth

**ID:** BE-T-010
**Priority:** Must
**Type:** Negative

#### Steps
1. Send PUT to `/api/budgets/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.11. Update Another User's Budget

**ID:** BE-T-011
**Priority:** Must
**Type:** Negative

#### Steps
1. Create budget for user A
2. Login as user B
3. Try to update user A's budget
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user updates blocked

#### Expected Result
Cross-user updates blocked.

### 2.12. Delete Budget

**ID:** BE-T-012
**Priority:** Must
**Type:** Positive

#### Steps
1. Create budget
2. Send DELETE to `/api/budgets/:id`
3. Verify response 200 OK
4. Verify budget deleted

#### Validation
- [ ] Response status 200
- [ ] Budget deleted
- [ ] Only owner can delete

#### Expected Result
Budget deleted successfully.

### 2.13. Delete Budget Without Auth

**ID:** BE-T-013
**Priority:** Must
**Type:** Negative

#### Steps
1. Send DELETE to `/api/budgets/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.14. Delete Another User's Budget

**ID:** BE-T-014
**Priority:** Must
**Type:** Negative

#### Steps
1. Create budget for user A
2. Login as user B
3. Try to delete user A's budget
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user deletes blocked

#### Expected Result
Cross-user deletes blocked.

## 3. Budget Data Validation

### 3.1. Invalid Budget Data

**ID:** BE-T-015
**Priority:** Must
**Type:** Negative

#### Steps
1. Create budget with invalid data
2. Verify response 400 Bad Request
3. Verify validation errors

#### Validation
- [ ] Response status 400
- [ ] Validation errors present
- [ ] No budget created

#### Expected Result
Invalid budget data rejected.

### 3.2. Missing Category

**ID:** BE-T-016
**Priority:** Must
**Type:** Negative

#### Steps
1. Create budget without category
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Missing category prevented.

### 3.3. Missing Amount

**ID:** BE-T-017
**Priority:** Must
**Type:** Negative

#### Steps
1. Create budget without amount
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Missing amount prevented.

### 3.4. Invalid Period

**ID:** BE-T-018
**Priority:** Must
**Type:** Negative

#### Steps
1. Create budget with invalid period
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid period prevented.

## 4. Budget Tracking Tests

### 4.1. Track Budget Spending

**ID:** BE-T-019
**Priority:** Must
**Type:** Positive

#### Steps
1. Create budget with amount $1000
2. Create expense transaction of $200
3. Verify remaining budget updated
4. Verify budget status

#### Validation
- [ ] Remaining budget calculated
- [ ] Budget percentage updated
- [ ] Status reflects progress

#### Expected Result
Budget spending tracking works.

### 4.2. Get Budget Progress

**ID:** BE-T-020
**Priority:** Must
**Type:** Positive

#### Steps
1. Create budget
2. Create various expenses
3. Get budget progress
4. Verify calculations accurate

#### Validation
- [ ] Total spent correct
- [ ] Remaining budget correct
- [ ] Percentage calculated correctly
- [ ] Status accurate

#### Expected Result
Budget progress calculation works.

### 4.3. Get Budget Breakdown

**ID:** BE-T-021
**Priority:** Must
**Type:** Positive

#### Steps
1. Create budget
2. Create expenses
3. Get budget breakdown
4. Verify category-level data

#### Validation
- [ ] Breakdown per category
- [ ] Totals accurate
- [ ] Visual representation accurate

#### Expected Result
Budget breakdown works.

### 4.4. Budget Overspend Detection

**ID:** BE-T-022
**Priority:** Must
**Type:** Positive

#### Steps
1. Create budget with amount $500
2. Create expense of $600
3. Verify overspend flag set
4. Verify alert/notification

#### Validation
- [ ] Overspend detected
- [ ] Flag set correctly
- [ ] Alert generated

#### Expected Result
Overspend detection works.

### 4.5. Budget Near Limit

**ID:** BE-T-023
**Priority:** Should
**Type:** Positive

#### Steps
1. Create budget with amount $100
2. Create expense of $95
3. Verify near-limit alert
4. Verify percentage

#### Validation
- [ ] Near-limit flagged
- [ ] Percentage accurate
- [ ] Alert generated

#### Expected Result
Near-limit detection works.

### 4.6. Get Budget Spending History

**ID:** BE-T-024
**Priority:** Should
**Type:** Positive

#### Steps
1. Create budget
2. Create multiple expenses over time
3. Get spending history
4. Verify timeline

#### Validation
- [ ] History includes all expenses
- [ ] Timeline accurate
- [ ] Totals match

#### Expected Result
Spending history works.

## 5. Budget Period Tests

### 5.1. Current Period Budget

**ID:** BE-T-025
**Priority:** Must
**Type:** Positive

#### Steps
1. Create budget for current month
2. Verify budget is active
3. Get current month budget
4. Verify correct period

#### Validation
- [ ] Active budget for current period
- [ ] Period filtering works

#### Expected Result
Current period budget accessible.

### 5.2. Month-Over-Month Comparison

**ID:** BE-T-026
**Priority:** Should
**Type:** Positive

#### Steps
1. Create budget for January
2. Pay expenses
3. Create budget for February
4. Compare budgets
5. Verify differences

#### Validation
- [ ] Periods compared correctly
- [ ] Changes tracked

#### Expected Result
Month-over-month comparison works.

### 5.3. Yearly Budget

**ID:** BE-T-027
**Priority:** Should
**Type:** Positive

#### Steps
1. Create yearly budget
2. Create monthly budgets
3. Get yearly summary
4. Verify totals

#### Validation
- [ ] Yearly totals accurate
- [ ] Monthly aggregation works

#### Expected Result
Yearly budgets work.

## 6. Multi-Category Budget Tests

### 6.1. Category Allocation

**ID:** BE-T-028
**Priority:** Must
**Type:** Positive

#### Steps
1. Create budget with multiple categories
2. Allocate amounts per category
3. Verify allocations saved
4. Verify allocations sum to total

#### Validation
- [ ] Allocations saved
- [ ] Total equals sum
- [ ] Categories separated

#### Expected Result
Category allocation works.

### 6.2. Get Category Budgets

**ID:** BE-T-029
**Priority:** Must
**Type:** Positive

#### Steps
1. Create budget with categories
2. Get category budgets
3. Verify all categories returned
4. Verify individual amounts

#### Validation
- [ ] All categories included
- [ ] Amounts correct per category

#### Expected Result
Category budgets retrieval works.

### 6.3. Category Budget Progress

**ID:** BE-T-030
**Priority:** Must
**Type:** Positive

#### Steps
1. Create category budget
2. Create expenses in category
3. Get category progress
4. Verify accuracy

#### Validation
- [ ] Progress accurate
- [ ] Per-category tracking works

#### Expected Result
Category budget progress works.

### 6.4. Unallocated Category

**ID:** BE-T-031
**Priority:** Should
**Type:** Positive

#### Steps
1. Create budget for some categories
2. Leave others unallocated
3. Verify unallocated categories tracked
4. Verify summary includes them

#### Validation
- [ ] Unallocated categories included
- [ ] Summary accurate

#### Expected Result
Unallocated categories handled.

## 7. Budget Goals Tests

### 7.1. Set Budget Goal

**ID:** BE-T-032
**Priority:** Should
**Type:** Positive

#### Steps
1. Create budget
2. Set savings goal
3. Verify goal saved
4. Verify goal calculated

#### Validation
- [ ] Goal saved
- [ ] Progress tracked toward goal

#### Expected Result
Budget goals work.

### 7.2. Budget Goal Achievement

**ID:** BE-T-033
**Priority:** Should
**Type:** Positive

#### Steps
1. Set budget goal
2. Spend towards goal
3. Verify progress
4. Verify achievement flag

#### Validation
- [ ] Progress accurate
- [ ] Achievement detected

#### Expected Result
Goal tracking works.

### 7.3. Budget Over Goal

**ID:** BE-T-034
**Priority:** Should
**Type:** Positive

#### Steps
1. Set budget goal
2. Overspend budget
3. Verify over-goal tracking
4. Verify notification

#### Validation
- [ ] Over-goal detected
- [ ] Alert generated

#### Expected Result
Over-goal tracking works.

## 8. Performance Tests

### 8.1. Get Budgets Performance

**ID:** BE-T-035
**Priority:** Must
**Type:** Performance

#### Steps
1. Send GET to `/api/budgets`
2. Measure response time
3. Verify meets 100ms threshold

#### Validation
- [ ] Response < 100ms
- [ ] Proper indexing
- [ ] Efficient queries

#### Expected Result
Budget retrieval is fast.

### 8.2. Get Budget Progress Performance

**ID:** BE-T-036
**Priority:** Must
**Type:** Performance

#### Steps
1. Send GET to `/api/budgets/:id/progress`
2. Measure response time
3. Verify meets 50ms threshold

#### Validation
- [ ] Response < 50ms
- [ ] Efficient calculations

#### Expected Result
Budget progress calculation is fast.

## 9. Error Handling Tests

### 9.1. Error Messages

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

### 9.2. Invalid Category Reference

**ID:** BE-T-038
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to create budget with invalid category
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid category prevented.

### 9.3. Negative Budget Amount

**ID:** BE-T-039
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to create budget with negative amount
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Negative amounts prevented.

## 10. Integration Tests

### 10.1. Budget Affects Account Balance

**ID:** BE-T-040
**Priority:** Should
**Type:** Integration

#### Steps
1. Create budget
2. Create expense
3. Verify account balance updated
4. Verify budget progress updated

#### Validation
- [ ] Balance updated
- [ ] Budget progress updated
- [ ] Data synchronized

#### Expected Result
Budget and balance sync.

### 10.2. Budget Affects Categories

**ID:** BE-T-041
**Priority:** Must
**Type:** Integration

#### Steps
1. Create budget for category
2. Create expenses in category
3. Verify category spending tracked
4. Verify budget tracking accurate

#### Validation
- [ ] Category spending tracked
- [ ] Budget accuracy maintained

#### Expected Result
Budget tracking categories.

### 10.3. Budget and Analytics Integration

**ID:** BE-T-042
**Priority:** Should
**Type:** Integration

#### Steps
1. Create budget
2. Pay expenses
3. Verify analytics updated
4. Verify dashboard reflects budget

#### Validation
- [ ] Analytics updated
- [ ] Dashboard accurate

#### Expected Result
Budget integrates with analytics.

## 11. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] Budget tracking accurate
- [ ] Overspend detection working
- [ ] Cross-user data isolation working
- [ ] Multi-category budgets working

## 12. Test Execution Notes

- Test budget period rollover
- Verify overspend calculations
- Test near-limit alerts
- Verify category allocations
- Test month-over-month comparison
- Verify budget deletions

## 13. Dependencies

- Database with budgets table
- Category tracking
- Transaction integration
- Spending calculation
- Account balance integration
- Analytics integration