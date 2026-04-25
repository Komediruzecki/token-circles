# E2E Test Specification - Recurring Transactions Module

**Module:** Recurring Transactions
**Test Suite:** Backend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Recurring Transactions module backend, covering recurrence pattern creation, transaction generation, rule variation, inactive management, execution history, manual trigger, pause/resume, skip/missed handling, timezone handling, and multiple recurrence patterns.

## 2. Recurrence Pattern Creation Tests

### 2.1. Create Recurrence Pattern

**ID:** BE-T-001
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send POST to `/api/recurring` with recurrence data
3. Verify response 201 Created
4. Verify pattern in database
5. Verify pattern belongs to user

#### Validation
- [ ] Response status 201
- [ ] Pattern created
- [ ] Pattern assigned to user
- [ ] Rules saved

#### Expected Result
Recurrence pattern created successfully.

### 2.2. Create Recurrence Pattern Without Auth

**ID:** BE-T-002
**Priority:** Must
**Type:** Negative

#### Steps
1. Send POST to `/api/recurring` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.3. Create Daily Recurrence

**ID:** BE-T-003
**Priority:** Must
**Type:** Positive

#### Steps
1. Create recurrence with daily pattern
2. Verify pattern created
3. Verify daily execution expected
4. Verify next date calculated

#### Validation
- [ ] Daily pattern created
- [ ] Next date calculated
- [ ] Execution schedule correct

#### Expected Result
Daily recurrence created successfully.

### 2.4. Create Weekly Recurrence

**ID:** BE-T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Create recurrence with weekly pattern
2. Verify pattern created
3. Verify day of week set
4. Verify next date calculated

#### Validation
- [ ] Weekly pattern created
- [ ] Day of week set
- [ ] Next date calculated
- [ ] Correct day selection

#### Expected Result
Weekly recurrence created successfully.

### 2.5. Create Monthly Recurrence

**ID:** BE-T-005
**Priority:** Must
**Type:** Positive

#### Steps
1. Create recurrence with monthly pattern
2. Verify pattern created
3. Verify day of month set
4. Verify next date calculated

#### Validation
- [ ] Monthly pattern created
- [ ] Day of month set
- [ ] Next date calculated
- [ ] Correct day selection

#### Expected Result
Monthly recurrence created successfully.

### 2.6. Create Yearly Recurrence

**ID:** BE-T-006
**Priority:** Must
**Type:** Positive

#### Steps
1. Create recurrence with yearly pattern
2. Verify pattern created
3. Verify month and day set
4. Verify next date calculated

#### Validation
- [ ] Yearly pattern created
- [ ] Month and day set
- [ ] Next date calculated
- [ ] Leap year handled

#### Expected Result
Yearly recurrence created successfully.

### 2.7. Create Custom Recurrence

**ID:** BE-T-007
**Priority:** Should
**Type:** Positive

#### Steps
1. Create recurrence with custom pattern
2. Verify custom rules saved
3. Verify flexible execution
4. Verify complex scheduling works

#### Validation
- [ ] Custom rules saved
- [ ] Flexible execution
- [ ] Complex scheduling works

#### Expected Result
Custom recurrence created successfully.

## 3. Recurrence Pattern Data Validation Tests

### 3.1. Invalid Recurrence Data

**ID:** BE-T-008
**Priority:** Must
**Type:** Negative

#### Steps
1. Create recurrence with invalid data
2. Verify response 400 Bad Request
3. Verify validation errors

#### Validation
- [ ] Response status 400
- [ ] Validation errors present
- [ ] No pattern created

#### Expected Result
Invalid recurrence data rejected.

### 3.2. Missing Title

**ID:** BE-T-009
**Priority:** Must
**Type:** Negative

#### Steps
1. Create recurrence without title
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Missing title prevented.

### 3.3. Missing Amount

**ID:** BE-T-010
**Priority:** Must
**Type:** Negative

#### Steps
1. Create recurrence without amount
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Missing amount prevented.

### 3.4. Missing Recurrence Type

**ID:** BE-T-011
**Priority:** Must
**Type:** Negative

#### Steps
1. Create recurrence without recurrence type
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Missing recurrence type prevented.

### 3.5. Invalid Amount

**ID:** BE-T-012
**Priority:** Must
**Type:** Negative

#### Steps
1. Create recurrence with negative amount
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Negative amount prevented.

### 3.6. Invalid Date

**ID:** BE-T-013
**Priority:** Must
**Type:** Negative

#### Steps
1. Create recurrence with invalid date
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid date prevented.

### 3.7. Invalid Recurrence Type

**ID:** BE-T-014
**Priority:** Must
**Type:** Negative

#### Steps
1. Create recurrence with invalid type
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid recurrence type prevented.

### 3.8. Future Start Date Only

**ID:** BE-T-015
**Priority:** Must
**Type:** Negative

#### Steps
1. Create recurrence with past start date
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Past start date prevented.

## 4. Transaction Generation Tests

### 4.1. Generate Recurring Transaction

**ID:** BE-T-016
**Priority:** Must
**Type:** Integration

#### Steps
1. Create recurrence pattern
2. Trigger transaction generation
3. Verify transaction created
4. Verify transaction date set
5. Verify amount matches

#### Validation
- [ ] Transaction created
- [ ] Date set correctly
- [ ] Amount matches
- [ ] Linked to recurrence

#### Expected Result
Recurring transaction generated successfully.

### 4.2. Generate Multiple Transactions

**ID:** BE-T-017
**Priority:** Must
**Type:** Integration

#### Steps
1. Create recurrence pattern
2. Generate multiple transactions
3. Verify all created
4. Verify chronological order
5. Verify all dates accurate

#### Validation
- [ ] All transactions created
- [ ] Correct count
- [ ] Chronological order
- [ ] Dates accurate

#### Expected Result
Multiple recurring transactions generated successfully.

### 4.3. Generate with Initial Offset

**ID:** BE-T-018
**Priority:** Must
**Type:** Integration

#### Steps
1. Create recurrence with offset days
2. Generate transactions
3. Verify offset applied
4. Verify first transaction date

#### Validation
- [ ] Offset applied
- [ ] First date correct
- [ ] Subsequent dates correct

#### Expected Result
Transactions generated with offset successfully.

### 4.4. Generate with End Date

**ID:** BE-T-019
**Priority:** Should
**Type:** Integration

#### Steps
1. Create recurrence with end date
2. Generate transactions up to end date
3. Verify all created up to end
4. Verify no transactions after end
5. Verify end date respected

#### Validation
- [ ] Transactions up to end
- [ ] No transactions after end
- [ ] End date respected
- [ ] Count accurate

#### Expected Result
Transactions generated up to end date successfully.

## 5. Recurrence Rule Variation Tests

### 5.1. Change Recurrence Day

**ID:** BE-T-020
**Priority:** Must
**Type:** Positive

#### Steps
1. Create weekly recurrence
2. Change day of week
3. Verify pattern updated
4. Verify subsequent dates adjusted
5. Verify existing transactions unchanged

#### Validation
- [ ] Pattern updated
- [ ] Dates adjusted
- [ ] Existing transactions unchanged

#### Expected Result
Recurrence day changed successfully.

### 5.2. Change Recurrence Amount

**ID:** BE-T-021
**Priority:** Must
**Type:** Positive

#### Steps
1. Create recurrence
2. Change amount
3. Verify pattern updated
4. Verify next transaction uses new amount
5. Verify existing transactions unchanged

#### Validation
- [ ] Pattern updated
- [ ] Next amount used
- [ ] Existing transactions unchanged

#### Expected Result
Recurrence amount changed successfully.

### 5.3. Change Recurrence Frequency

**ID:** BE-T-022
**Priority:** Must
**Type:** Positive

#### Steps
1. Create monthly recurrence
2. Change to weekly
3. Verify pattern updated
4. Verify new execution schedule
5. Verify next date calculated

#### Validation
- [ ] Pattern updated
- [ ] New schedule set
- [ ] Next date calculated
- [ ] Existing transactions unchanged

#### Expected Result
Recurrence frequency changed successfully.

### 5.4. Change Recurrence End Date

**ID:** BE-T-023
**Priority:** Must
**Type:** Positive

#### Steps
1. Create recurring with no end date
2. Set end date
3. Verify end date saved
4. Verify transactions stop after end

#### Validation
- [ ] End date saved
- [ ] Transactions stop after end
- [ ] No new transactions

#### Expected Result
Recurrence end date set successfully.

## 6. Inactive Recurrence Management Tests

### 6.1. Deactivate Recurrence

**ID:** BE-T-024
**Priority:** Must
**Type:** Positive

#### Steps
1. Create active recurrence
2. Deactivate pattern
3. Verify pattern inactive
4. Verify no new transactions
5. Verify existing transactions preserved

#### Validation
- [ ] Pattern inactive
- [ ] No new transactions
- [ ] Existing preserved

#### Expected Result
Recurrence deactivated successfully.

### 6.2. Activate Recurrence

**ID:** BE-T-025
**Priority:** Must
**Type:** Positive

#### Steps
1. Deactivate recurrence
2. Reactivate pattern
3. Verify pattern active
4. Verify future transactions generated

#### Validation
- [ ] Pattern active
- [ ] Future transactions generated
- [ ] Reactivation successful

#### Expected Result
Recurrence activated successfully.

### 6.3. Get Inactive Recurrences

**ID:** BE-T-026
**Priority:** Must
**Type:** Positive

#### Steps
1. Create active and inactive recurrences
2. Get inactive list
3. Verify inactive listed
4. Verify active not listed

#### Validation
- [ ] Inactive listed
- [ ] Active not listed
- [ ] Accurate separation

#### Expected Result
Inactive recurrences retrieved successfully.

## 7. Recurrence Execution History Tests

### 7.1. Get Execution History

**ID:** BE-T-027
**Priority:** Must
**Type:** Positive

#### Steps
1. Generate multiple transactions
2. Get execution history
3. Verify chronological order
4. Verify all executions listed
5. Verify pagination works

#### Validation
- [ ] Chronological order
- [ ] All executions listed
- [ ] Pagination functional
- [ ] Efficient query

#### Expected Result
Execution history retrieved successfully.

### 7.2. Get Execution History by Recurrence

**ID:** BE-T-028
**Priority:** Must
**Type:** Positive

#### Steps
1. Create multiple recurrences
2. Get execution history for specific recurrence
3. Verify only that recurrence's history
4. Verify others excluded

#### Validation
- [ ] Correct recurrence's history
- [ ] Others excluded
- [ ] Accurate filtering

#### Expected Result
Execution history by recurrence retrieved successfully.

### 7.3. Execution History Counts

**ID:** BE-T-029
**Priority:** Should
**Type:** Positive

#### Steps
1. Generate multiple transactions
2. Get execution history
3. Verify total count
4. Verify breakdown by type
5. Verify counts accurate

#### Validation
- [ ] Total count accurate
- [ ] Breakdown correct
- [ ] Counts match reality

#### Expected Result
Execution history counts accurate.

## 8. Manual Trigger Tests

### 8.1. Manually Trigger Recurrence

**ID:** BE-T-030
**Priority:** Must
**Type:** Integration

#### Steps
1. Create active recurrence
2. Manually trigger generation
3. Verify transaction created immediately
4. Verify no schedule delay
5. Verify date set correctly

#### Validation
- [ ] Transaction created immediately
- [ ] No schedule delay
- [ ] Date correct
- [ ] Manual trigger works

#### Expected Result
Recurrence manually triggered successfully.

### 8.2. Trigger Before Next Scheduled

**ID:** BE-T-031
**Priority:** Should
**Type:** Integration

#### Steps
1. Create daily recurrence
2. Wait until day
3. Manually trigger
4. Verify transaction created
5. Verify schedule continues

#### Validation
- [ ] Transaction created
- [ ] Schedule continues
- [ ] No duplicate

#### Expected Result
Manual trigger before schedule works.

### 8.3. Trigger After Next Scheduled

**ID:** BE-T-032
**Priority:** Should
**Type:** Integration

#### Steps
1. Create daily recurrence
2. Wait until day
3. Skip execution
4. Manually trigger later
5. Verify transaction created
6. Verify schedule adjusted

#### Validation
- [ ] Transaction created
- [ ] Schedule adjusted
- [ ] No duplicate

#### Expected Result
Manual trigger after schedule works.

## 9. Pause and Resume Tests

### 9.1. Pause Recurrence

**ID:** BE-T-033
**Priority:** Must
**Type:** Positive

#### Steps
1. Create active recurrence
2. Pause pattern
3. Verify pattern paused
4. Verify no new transactions
5. Verify schedule paused

#### Validation
- [ ] Pattern paused
- [ ] No new transactions
- [ ] Schedule paused

#### Expected Result
Recurrence paused successfully.

### 9.2. Resume Recurrence

**ID:** BE-T-034
**Priority:** Must
**Type:** Positive

#### Steps
1. Pause recurrence
2. Resume pattern
3. Verify pattern active
4. Verify future transactions generated

#### Validation
- [ ] Pattern active
- [ ] Future transactions generated
- [ ] Schedule resumed

#### Expected Result
Recurrence resumed successfully.

### 9.3. Pause Without Future Date

**ID:** BE-T-035
**Priority:** Should
**Type:** Positive

#### Steps
1. Pause recurrence
2. Set future resume date
3. Verify pattern paused
4. Verify automatic resume on date

#### Validation
- [ ] Pattern paused
- [ ] Auto-resume works
- [ ] Date respected

#### Expected Result
Recurrence paused with resume date works.

## 10. Skip and Missed Handling Tests

### 10.1. Skip Scheduled Execution

**ID:** BE-T-036
**Priority:** Should
**Type:** Integration

#### Steps
1. Create recurrence
2. Skip scheduled execution
3. Verify transaction not created
4. Verify next execution still scheduled
5. Verify no missed record

#### Validation
- [ ] Transaction not created
- [ ] Next execution scheduled
- [ ] No missed record

#### Expected Result
Scheduled execution skipped successfully.

### 10.2. Mark as Missed

**ID:** BE-T-037
**Priority:** Should
**Type:** Integration

#### Steps
1. Create recurrence
2. Miss execution (no manual skip)
3. Mark as missed
4. Verify missed flag set
5. Verify next execution scheduled

#### Validation
- [ ] Missed flag set
- [ ] Next execution scheduled
- [ ] Miss recorded

#### Expected Result
Missed execution marked successfully.

### 10.3. Automatic Skip on Holiday

**ID:** BE-T-038
**Priority:** Should
**Type:** Integration

#### Steps
1. Create recurrence with holiday schedule
2. Schedule falls on holiday
3. Verify automatic skip
4. Verify next execution on next day

#### Validation
- [ ] Automatic skip
- [ ] Next execution adjusted
- [ ] Holiday respected

#### Expected Result
Holiday skip handled automatically.

## 11. Timezone Handling Tests

### 11.1. Create Recurrence with Timezone

**ID:** BE-T-039
**Priority:** Must
**Type:** Positive

#### Steps
1. Create recurrence with timezone
2. Verify timezone saved
3. Verify next date calculated in timezone
4. Verify execution in correct timezone

#### Validation
- [ ] Timezone saved
- [ ] Next date correct
- [ ] Execution accurate

#### Expected Result
Recurrence with timezone created successfully.

### 11.2. Convert Timezone

**ID:** BE-T-040
**Priority:** Should
**Type:** Positive

#### Steps
1. Create recurrence with timezone
2. Change user timezone
3. Verify next date converted
4. Verify execution adjusted

#### Validation
- [ ] Timezone converted
- [ ] Dates adjusted
- [ ] Execution accurate

#### Expected Result
Recurrence timezone converted successfully.

### 11.3. Daylight Saving Transition

**ID:** BE-T-041
**Priority:** Should
**Type:** Integration

#### Steps
1. Create recurrence
2. Schedule during DST transition
3. Verify execution handles transition
4. Verify no double/missed events

#### Validation
- [ ] Transition handled
- [ ] No double events
- [ ] No missed events

#### Expected Result
Daylight saving handled correctly.

## 12. Multiple Recurrence Patterns Tests

### 12.1. Create Multiple Patterns for One Transaction

**ID:** BE-T-042
**Priority:** Should
**Type:** Integration

#### Steps
1. Create transaction type
2. Create multiple recurrence patterns for it
3. Verify all patterns created
4. Verify all generate transactions

#### Validation
- [ ] All patterns created
- [ ] All generate transactions
- [ ] No conflicts

#### Expected Result
Multiple patterns for one transaction created successfully.

### 12.2. Unique Transaction IDs

**ID:** BE-T-043
**Priority:** Must
**Type:** Integration

#### Steps
1. Create multiple patterns
2. Generate transactions
3. Verify all transactions unique
4. Verify no duplicates

#### Validation
- [ ] All transactions unique
- [ ] No duplicates
- [ ] IDs generated correctly

#### Expected Result
Unique transaction IDs verified.

### 12.3. Common Recurring Items

**ID:** BE-T-044
**Priority:** Should
**Type:** Integration

#### Steps
1. Create multiple recurrence patterns
2. Generate transactions
3. Verify common items tracked
4. Verify grouped correctly

#### Validation
- [ ] Common items tracked
- [ ] Correct grouping
- [ ] Analytics accurate

#### Expected Result
Common recurring items tracked.

## 13. Performance Tests

### 13.1. Generate Recurrences Performance

**ID:** BE-T-045
**Priority:** Must
**Type:** Performance

#### Steps
1. Create recurrence pattern
2. Generate 100 transactions
3. Measure generation time
4. Verify meets 1s threshold

#### Validation
- [ ] Generation time acceptable
- [ ] Efficient processing
- [ ] No blocking

#### Expected Result
Recurrence generation is efficient.

### 13.2. Get Recurrence List Performance

**ID:** BE-T-046
**Priority:** Must
**Type:** Performance

#### Steps
1. Send GET to `/api/recurring`
2. Measure response time
3. Verify meets 50ms threshold

#### Validation
- [ ] Response < 50ms
- [ ] Efficient query
- [ ] No N+1 queries

#### Expected Result
Recurrence list retrieval is fast.

### 13.3. Get Execution History Performance

**ID:** BE-T-047
**Priority:** Should
**Type:** Performance

#### Steps
1. Get execution history
2. Measure response time
3. Verify acceptable performance

#### Validation
- [ ] Response time reasonable
- [ ] Efficient pagination
- [ ] Indexes utilized

#### Expected Result
Execution history retrieval is efficient.

## 14. Error Handling Tests

### 14.1. Error Messages

**ID:** BE-T-048
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

### 14.2. Invalid Transaction Amount

**ID:** BE-T-049
**Priority:** Must
**Type:** Negative

#### Steps
1. Create recurrence with negative amount
2. Generate transaction
3. Verify rejection
4. Verify error

#### Validation
- [ ] Transaction rejected
- [ ] Error message present
- [ ] No transaction created

#### Expected Result
Invalid amount rejected during generation.

### 14.3. Invalid End Date

**ID:** BE-T-050
**Priority:** Must
**Type:** Negative

#### Steps
1. Set end date in past
2. Verify rejection
3. Verify error message

#### Validation
- [ ] End date rejected
- [ ] Error message present
- [ ] Pattern not created/updated

#### Expected Result
Invalid end date rejected.

## 15. Integration Tests

### 15.1. Recurrences Affect Balance

**ID:** BE-T-051
**Priority:** Must
**Type:** Integration

#### Steps
1. Create recurrence
2. Generate transaction
3. Verify balance updated
4. Verify transaction recorded

#### Validation
- [ ] Balance updated
- [ ] Transaction recorded
- [ ] Amount correct

#### Expected Result
Recurrences affect balance.

### 15.2. Recurrences Affect Analytics

**ID:** BE-T-052
**Priority:** Must
**Type:** Integration

#### Steps
1. Generate recurring transactions
2. Get analytics
3. Verify analytics includes recurrences
4. Verify accuracy

#### Validation
- [ ] Analytics includes recurrences
- [ ] Accuracy maintained
- [ ] Totals correct

#### Expected Result
Recurrences affect analytics.

### 15.3. Recurrences Affect Budgets

**ID:** BE-T-053
**Priority:** Should
**Type:** Integration

#### Steps
1. Generate recurring transactions
2. Create budget
3. Get budget
4. Verify budget includes recurring spending

#### Validation
- [ ] Budget includes recurrences
- [ ] Accuracy maintained
- [ ] Spending tracked

#### Expected Result
Recurrences affect budgets.

## 16. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] Recurrence creation working
- [ ] Transaction generation working
- [ ] Rule variation working
- [ ] Pause/resume working
- [ ] Execution history working
- [ ] Timezone handling working

## 17. Test Execution Notes

- Test all recurrence patterns (daily, weekly, monthly, yearly, custom)
- Test transaction generation with various schedules
- Test manual trigger scenarios
- Test pause/resume functionality
- Test holiday handling
- Test timezone conversions
- Test DST transitions
- Verify data integrity across recurrences

## 18. Dependencies

- Database with recurring patterns table
- Transaction generation system
- Transaction integration
- Balance tracking integration
- Analytics integration
- Budget integration
- Timezone handling library