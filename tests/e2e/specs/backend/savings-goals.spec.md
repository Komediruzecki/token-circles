# E2E Test Specification - Savings Goals Module

**Module:** Savings Goals
**Test Suite:** Backend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Savings Goals module backend, covering goal creation, progress tracking, contributions, withdrawals, target achievement, and goal visualization.

## 2. Savings Goal CRUD Tests

### 2.1. Create Savings Goal

**ID:** BE-T-001
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send POST to `/api/savings-goals` with goal data
3. Verify response 201 Created
4. Verify goal in database
5. Verify goal belongs to user

#### Validation
- [ ] Response status 201
- [ ] Goal created
- [ ] Goal assigned to user
- [ ] Target date calculated

#### Expected Result
Savings goal created successfully.

### 2.2. Create Savings Goal Without Auth

**ID:** BE-T-002
**Priority:** Must
**Type:** Negative

#### Steps
1. Send POST to `/api/savings-goals` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.3. Create Duplicate Goal

**ID:** BE-T-003
**Priority:** Must
**Type:** Negative

#### Steps
1. Create goal with same name and target
2. Try to create another
3. Verify response 409 Conflict
4. Verify error message

#### Validation
- [ ] Response status 409
- [ ] Error message present
- [ ] No duplicate created

#### Expected Result
Duplicate goals prevented.

### 2.4. Get All Savings Goals

**ID:** BE-T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/savings-goals`
3. Verify response 200 OK
4. Verify all user's goals returned
5. Verify no other user's goals

#### Validation
- [ ] Response status 200
- [ ] All user goals returned
- [ ] No cross-user data
- [ ] Total count correct

#### Expected Result
User's savings goals retrieved successfully.

### 2.5. Get All Savings Goals Without Auth

**ID:** BE-T-005
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/savings-goals` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.6. Get Savings Goal by ID

**ID:** BE-T-006
**Priority:** Must
**Type:** Positive

#### Steps
1. Create savings goal
2. Get goal ID
3. Send GET to `/api/savings-goals/:id`
4. Verify response 200 OK
5. Verify goal data
6. Verify goal belongs to user

#### Validation
- [ ] Response status 200
- [ ] Goal data correct
- [ ] Goal belongs to user
- [ ] No cross-user data

#### Expected Result
Savings goal retrieved successfully.

### 2.7. Get Savings Goal by ID Without Auth

**ID:** BE-T-007
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/savings-goals/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.8. Get Another User's Savings Goal

**ID:** BE-T-008
**Priority:** Must
**Type:** Negative

#### Steps
1. Create savings goal for user A
2. Login as user B
3. Try to get user A's goal
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user access blocked

#### Expected Result
Cross-user access blocked.

### 2.9. Update Savings Goal

**ID:** BE-T-009
**Priority:** Must
**Type:** Positive

#### Steps
1. Create savings goal
2. Send PUT to `/api/savings-goals/:id` with updates
3. Verify response 200 OK
4. Verify changes persisted
5. Verify other fields unchanged

#### Validation
- [ ] Response status 200
- [ ] Changes persisted
- [ ] Other fields unchanged
- [ ] Only owner can update

#### Expected Result
Savings goal updated successfully.

### 2.10. Update Savings Goal Without Auth

**ID:** BE-T-010
**Priority:** Must
**Type:** Negative

#### Steps
1. Send PUT to `/api/savings-goals/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.11. Update Another User's Savings Goal

**ID:** BE-T-011
**Priority:** Must
**Type:** Negative

#### Steps
1. Create savings goal for user A
2. Login as user B
3. Try to update user A's goal
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user updates blocked

#### Expected Result
Cross-user updates blocked.

### 2.12. Delete Savings Goal

**ID:** BE-T-012
**Priority:** Must
**Type:** Positive

#### Steps
1. Create savings goal
2. Send DELETE to `/api/savings-goals/:id`
3. Verify response 200 OK
4. Verify goal deleted

#### Validation
- [ ] Response status 200
- [ ] Goal deleted
- [ ] Only owner can delete

#### Expected Result
Savings goal deleted successfully.

### 2.13. Delete Savings Goal Without Auth

**ID:** BE-T-013
**Priority:** Must
**Type:** Negative

#### Steps
1. Send DELETE to `/api/savings-goals/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.14. Delete Another User's Savings Goal

**ID:** BE-T-014
**Priority:** Must
**Type:** Negative

#### Steps
1. Create savings goal for user A
2. Login as user B
3. Try to delete user A's goal
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user deletes blocked

#### Expected Result
Cross-user deletes blocked.

## 3. Savings Goal Data Validation

### 3.1. Invalid Savings Goal Data

**ID:** BE-T-015
**Priority:** Must
**Type:** Negative

#### Steps
1. Create savings goal with invalid data
2. Verify response 400 Bad Request
3. Verify validation errors

#### Validation
- [ ] Response status 400
- [ ] Validation errors present
- [ ] No goal created

#### Expected Result
Invalid savings goal data rejected.

### 3.2. Missing Name

**ID:** BE-T-016
**Priority:** Must
**Type:** Negative

#### Steps
1. Create savings goal without name
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Missing name prevented.

### 3.3. Missing Target Amount

**ID:** BE-T-017
**Priority:** Must
**Type:** Negative

#### Steps
1. Create savings goal without target amount
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Missing target amount prevented.

### 3.4. Missing Target Date

**ID:** BE-T-018
**Priority:** Must
**Type:** Negative

#### Steps
1. Create savings goal without target date
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Missing target date prevented.

## 4. Savings Goal Tracking Tests

### 4.1. Track Savings Goal Contribution

**ID:** BE-T-019
**Priority:** Must
**Type:** Positive

#### Steps
1. Create savings goal with target $5000
2. Make contribution of $500
3. Verify current amount updated
4. Verify progress updated

#### Validation
- [ ] Current amount increased
- [ ] Progress calculated correctly
- [ ] Percentage updated

#### Expected Result
Savings contributions tracked correctly.

### 4.2. Get Savings Goal Progress

**ID:** BE-T-020
**Priority:** Must
**Type:** Positive

#### Steps
1. Create savings goal
2. Make multiple contributions
3. Get goal progress
4. Verify calculations accurate

#### Validation
- [ ] Total contributed correct
- [ ] Remaining correct
- [ ] Percentage calculated correctly
- [ ] Status accurate

#### Expected Result
Savings goal progress calculation works.

### 4.3. Get Savings Goal Breakdown

**ID:** BE-T-021
**Priority:** Must
**Type:** Positive

#### Steps
1. Create savings goal
2. Make multiple contributions
3. Get goal breakdown
4. Verify timeline

#### Validation
- [ ] Timeline includes all contributions
- [ ] Totals accurate
- [ ] Visual representation accurate

#### Expected Result
Savings goal breakdown works.

### 4.4. Savings Goal Achievement Detection

**ID:** BE-T-022
**Priority:** Must
**Type:** Positive

#### Steps
1. Create savings goal with target $1000
2. Make contributions totaling $1000
3. Verify goal achieved flag set
4. Verify achievement date recorded

#### Validation
- [ ] Achievement detected
- [ ] Date recorded
- [ ] Status updated

#### Expected Result
Goal achievement detection works.

### 4.5. Savings Goal Near Completion

**ID:** BE-T-023
**Priority:** Should
**Type:** Positive

#### Steps
1. Create savings goal with target $1000
2. Make contribution of $950
3. Verify near-completion alert
4. Verify percentage

#### Validation
- [ ] Near-completion flagged
- [ ] Percentage accurate
- [ ] Alert generated

#### Expected Result
Near-completion detection works.

### 4.6. Get Savings Goal Contributions

**ID:** BE-T-024
**Priority:** Should
**Type:** Positive

#### Steps
1. Create savings goal
2. Make multiple contributions
3. Get contributions
4. Verify all contributions returned

#### Validation
- [ ] All contributions returned
- [ ] Timeline accurate
- [ ] Totals match

#### Expected Result
Contributions retrieval works.

## 5. Withdrawal Tests

### 5.1. Withdraw from Savings Goal

**ID:** BE-T-025
**Priority:** Must
**Type:** Positive

#### Steps
1. Create savings goal
2. Make contributions
3. Withdraw amount
4. Verify current amount decreased
5. Verify withdrawal recorded

#### Validation
- [ ] Current amount decreased
- [ ] Withdrawal recorded
- [ ] Withdrawal amount correct

#### Expected Result
Withdrawals work correctly.

### 5.2. Withdraw Below Current Amount

**ID:** BE-T-026
**Priority:** Must
**Type:** Negative

#### Steps
1. Create savings goal
2. Make contributions totaling less than withdrawal
3. Verify withdrawal blocked
4. Verify error message

#### Validation
- [ ] Withdrawal blocked
- [ ] Error message present
- [ ] No funds deducted

#### Expected Result
Withdrawal below balance prevented.

### 5.3. Withdraw from Achieved Goal

**ID:** BE-T-027
**Priority:** Should
**Type:** Positive

#### Steps
1. Create savings goal and achieve it
2. Verify goal achieved
3. Withdraw from goal
4. Verify withdrawal works
5. Verify remaining goal

#### Validation
- [ ] Withdrawal works after achievement
- [ ] Remaining goal updated

#### Expected Result
Withdrawals from achieved goals work.

## 6. Savings Goal Visualization Tests

### 7.1. Get Savings Goal Timeline

**ID:** BE-T-028
**Priority:** Must
**Type:** Positive

#### Steps
1. Create savings goal
2. Make contributions over time
3. Get timeline
4. Verify timeline points

#### Validation
- [ ] Timeline includes all contributions
- [ ] Dates accurate
- [ ] Values correct

#### Expected Result
Savings goal timeline works.

### 7.2. Get Savings Goal Summary

**ID:** BE-T-029
**Priority:** Must
**Type:** Positive

#### Steps
1. Create multiple savings goals
2. Get summary
3. Verify totals
4. Verify per-goal data

#### Validation
- [ ] Total contributed correct
- [ ] Total remaining correct
- [ ] Goal-level data accurate

#### Expected Result
Savings goal summary works.

### 7.3. Get Savings Goal Statistics

**ID:** BE-T-030
**Priority:** Must
**Type:** Positive

#### Steps
1. Create savings goals
2. Get statistics
3. Verify calculations

#### Validation
- [ ] Statistics accurate
- [ ] Goals tracked separately
- [ ] Totals correct

#### Expected Result
Savings goal statistics work.

## 8. Savings Goal Priority Tests

### 8.1. Set Goal Priority

**ID:** BE-T-031
**Priority:** Must
**Type:** Positive

#### Steps
1. Create multiple savings goals
2. Set priority for each
3. Verify priority saved
4. Verify priority sorting

#### Validation
- [ ] Priorities saved
- [ ] Goals sorted correctly
- [ ] Priority can be changed

#### Expected Result
Goal priorities work.

### 8.2. Get Goals by Priority

**ID:** BE-T-032
**Priority:** Should
**Type:** Positive

#### Steps
1. Create savings goals with priorities
2. Get goals ordered by priority
3. Verify correct order

#### Validation
- [ ] Goals returned in priority order
- [ ] Ties handled consistently

#### Expected Result
Priority ordering works.

## 9. Goal Categories

### 9.1. Associate Goal with Category

**ID:** BE-T-033
**Priority:** Should
**Type:** Positive

#### Steps
1. Create savings goal
2. Associate with category
3. Verify association saved
4. Verify category retrieval

#### Validation
- [ ] Association saved
- [ ] Category accessible

#### Expected Result
Goal categories work.

### 9.2. Get Goals by Category

**ID:** BE-T-034
**Priority:** Should
**Type:** Positive

#### Steps
1. Create goals in multiple categories
2. Get goals by category
3. Verify correct goals returned

#### Validation
- [ ] Correct goals returned
- [ ] Filtering works

#### Expected Result
Category filtering works.

## 10. Performance Tests

### 10.1. Get Savings Goals Performance

**ID:** BE-T-035
**Priority:** Must
**Type:** Performance

#### Steps
1. Send GET to `/api/savings-goals`
2. Measure response time
3. Verify meets 100ms threshold

#### Validation
- [ ] Response < 100ms
- [ ] Proper indexing
- [ ] Efficient queries

#### Expected Result
Savings goals retrieval is fast.

### 10.2. Get Savings Goal Progress Performance

**ID:** BE-T-036
**Priority:** Must
**Type:** Performance

#### Steps
1. Send GET to `/api/savings-goals/:id/progress`
2. Measure response time
3. Verify meets 50ms threshold

#### Validation
- [ ] Response < 50ms
- [ ] Efficient calculations

#### Expected Result
Savings goal progress calculation is fast.

### 10.3. Get Contributions Performance

**ID:** BE-T-037
**Priority:** Should
**Type:** Performance

#### Steps
1. Send GET to `/api/savings-goals/:id/contributions`
2. Measure response time
3. Verify acceptable performance

#### Validation
- [ ] Response reasonable
- [ ] Efficient querying

#### Expected Result
Contributions retrieval is efficient.

## 11. Error Handling Tests

### 11.1. Error Messages

**ID:** BE-T-038
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

### 11.2. Invalid Target Date

**ID:** BE-T-039
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to create savings goal with past target date
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid target date prevented.

### 11.3. Negative Contribution

**ID:** BE-T-040
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to make negative contribution
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Negative contributions prevented.

## 12. Integration Tests

### 12.1. Savings Goal Affects Account Balance

**ID:** BE-T-041
**Priority:** Must
**Type:** Integration

#### Steps
1. Create savings goal
2. Make contribution
3. Verify account balance decreased
4. Verify goal progress updated

#### Validation
- [ ] Balance updated
- [ ] Goal progress updated
- [ ] Data synchronized

#### Expected Result
Savings goals sync with accounts.

### 12.2. Savings Goal Affects Analytics

**ID:** BE-T-042
**Priority:** Should
**Type:** Integration

#### Steps
1. Create savings goal
2. Make contributions
3. Verify analytics updated
4. Verify dashboard reflects progress

#### Validation
- [ ] Analytics updated
- [ ] Dashboard accurate

#### Expected Result
Savings goals integrate with analytics.

### 12.3. Savings Goal Affects Transactions

**ID:** BE-T-043
**Priority:** Should
**Type:** Integration

#### Steps
1. Create savings goal
2. Make contribution
3. Verify transaction created
4. Verify transaction categorized

#### Validation
- [ ] Transaction created
- [ ] Categorized correctly

#### Expected Result
Savings goals create transactions.

## 13. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] Goal tracking accurate
- [ ] Withdrawals working
- [ ] Cross-user data isolation working
- [ ] Goal achievements detected

## 14. Test Execution Notes

- Test with large target amounts
- Verify contribution timeline
- Test withdrawal scenarios
- Verify goal achievements
- Test near-completion alerts
- Verify category associations

## 15. Dependencies

- Database with savings goals table
- Account balance tracking
- Contribution tracking
- Withdrawal logic
- Analytics integration
- Transaction integration