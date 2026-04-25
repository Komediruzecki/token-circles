# E2E Test Specification - Bills Module

**Module:** Bills
**Test Suite:** Backend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Bills module backend, covering bill creation, tracking, reminders, autopay settings, and payment recording.

## 2. Bill CRUD Tests

### 2.1. Create Bill

**ID:** BE-T-001
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send POST to `/api/bills` with bill data
3. Verify response 201 Created
4. Verify bill in database
5. Verify bill belongs to user

#### Validation
- [ ] Response status 201
- [ ] Bill created
- [ ] Bill assigned to user
- [ ] Next due date calculated

#### Expected Result
Bill created successfully.

### 2.2. Create Bill Without Auth

**ID:** BE-T-002
**Priority:** Must
**Type:** Negative

#### Steps
1. Send POST to `/api/bills` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.3. Create Duplicate Bill

**ID:** BE-T-003
**Priority:** Must
**Type:** Negative

#### Steps
1. Create bill with same provider and amount
2. Try to create another
3. Verify response 409 Conflict
4. Verify error message

#### Validation
- [ ] Response status 409
- [ ] Error message present
- [ ] No duplicate created

#### Expected Result
Duplicate bills prevented.

### 2.4. Get All Bills

**ID:** BE-T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/bills`
3. Verify response 200 OK
4. Verify all user's bills returned
5. Verify no other user's bills

#### Validation
- [ ] Response status 200
- [ ] All user bills returned
- [ ] No cross-user data
- [ ] Total count correct

#### Expected Result
User's bills retrieved successfully.

### 2.5. Get All Bills Without Auth

**ID:** BE-T-005
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/bills` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.6. Get Bill by ID

**ID:** BE-T-006
**Priority:** Must
**Type:** Positive

#### Steps
1. Create bill
2. Get bill ID
3. Send GET to `/api/bills/:id`
4. Verify response 200 OK
5. Verify bill data
6. Verify bill belongs to user

#### Validation
- [ ] Response status 200
- [ ] Bill data correct
- [ ] Bill belongs to user
- [ ] No cross-user data

#### Expected Result
Bill retrieved successfully.

### 2.7. Get Bill by ID Without Auth

**ID:** BE-T-007
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/bills/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.8. Get Another User's Bill

**ID:** BE-T-008
**Priority:** Must
**Type:** Negative

#### Steps
1. Create bill for user A
2. Login as user B
3. Try to get user A's bill
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user access blocked

#### Expected Result
Cross-user access blocked.

### 2.9. Update Bill

**ID:** BE-T-009
**Priority:** Must
**Type:** Positive

#### Steps
1. Create bill
2. Send PUT to `/api/bills/:id` with updates
3. Verify response 200 OK
4. Verify changes persisted
5. Verify other fields unchanged

#### Validation
- [ ] Response status 200
- [ ] Changes persisted
- [ ] Other fields unchanged
- [ ] Only owner can update

#### Expected Result
Bill updated successfully.

### 2.10. Update Bill Without Auth

**ID:** BE-T-010
**Priority:** Must
**Type:** Negative

#### Steps
1. Send PUT to `/api/bills/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.11. Update Another User's Bill

**ID:** BE-T-011
**Priority:** Must
**Type:** Negative

#### Steps
1. Create bill for user A
2. Login as user B
3. Try to update user A's bill
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user updates blocked

#### Expected Result
Cross-user updates blocked.

### 2.12. Delete Bill

**ID:** BE-T-012
**Priority:** Must
**Type:** Positive

#### Steps
1. Create bill
2. Send DELETE to `/api/bills/:id`
3. Verify response 200 OK
4. Verify bill deleted

#### Validation
- [ ] Response status 200
- [ ] Bill deleted
- [ ] Only owner can delete

#### Expected Result
Bill deleted successfully.

### 2.13. Delete Bill Without Auth

**ID:** BE-T-013
**Priority:** Must
**Type:** Negative

#### Steps
1. Send DELETE to `/api/bills/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.14. Delete Another User's Bill

**ID:** BE-T-014
**Priority:** Must
**Type:** Negative

#### Steps
1. Create bill for user A
2. Login as user B
3. Try to delete user A's bill
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user deletes blocked

#### Expected Result
Cross-user deletes blocked.

## 3. Bill Data Validation

### 3.1. Invalid Bill Data

**ID:** BE-T-015
**Priority:** Must
**Type:** Negative

#### Steps
1. Create bill with invalid data
2. Verify response 400 Bad Request
3. Verify validation errors

#### Validation
- [ ] Response status 400
- [ ] Validation errors present
- [ ] No bill created

#### Expected Result
Invalid bill data rejected.

### 3.2. Missing Amount

**ID:** BE-T-016
**Priority:** Must
**Type:** Negative

#### Steps
1. Create bill without amount
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Missing amount prevented.

### 3.3. Missing Due Date

**ID:** BE-T-017
**Priority:** Must
**Type:** Negative

#### Steps
1. Create bill without due date
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Missing due date prevented.

## 4. Bill Tracking Tests

### 4.1. Track Bill Payment

**ID:** BE-T-018
**Priority:** Must
**Type:** Positive

#### Steps
1. Create bill
2. Mark as paid
3. Verify paid flag set
4. Verify payment date recorded
5. Verify balance updated

#### Validation
- [ ] Paid flag set
- [ ] Payment date recorded
- [ ] Account balance updated
- [ ] Transaction created

#### Expected Result
Bill tracking works.

### 4.2. Update Paid Status

**ID:** BE-T-019
**Priority:** Must
**Type:** Positive

#### Steps
1. Create unpaid bill
2. Mark paid
3. Unmark paid
4. Verify status updated

#### Validation
- [ ] Status toggles correctly
- [ ] Dates updated correctly

#### Expected Result
Payment status toggles.

### 4.3. Get Upcoming Bills

**ID:** BE-T-020
**Priority:** Must
**Type:** Positive

#### Steps
1. Create bills with various due dates
2. Get upcoming bills (next 30 days)
3. Verify only future bills returned
4. Verify correct date filtering

#### Validation
- [ ] Only upcoming bills returned
- [ ] Date filtering correct
- [ ] Past bills excluded

#### Expected Result
Upcoming bills retrieval works.

### 4.4. Get Overdue Bills

**ID:** BE-T-021
**Priority:** Must
**Type:** Positive

#### Steps
1. Create bills past due date
2. Get overdue bills
3. Verify only overdue bills returned
4. Verify correct date filtering

#### Validation
- [ ] Only overdue bills returned
- [ ] Date filtering correct

#### Expected Result
Overdue bills retrieval works.

### 4.5. Get Paid Bills

**ID:** BE-T-022
**Priority:** Should
**Type:** Positive

#### Steps
1. Create unpaid and paid bills
2. Get paid bills
3. Verify only paid bills returned

#### Validation
- [ ] Only paid bills returned
- [ ] Filtering correct

#### Expected Result
Paid bills can be filtered.

### 4.6. Bill Status Calculation

**ID:** BE-T-023
**Priority:** Must
**Type:** Positive

#### Steps
1. Create bill with due date
2. Verify status calculated correctly
3. Move due date
4. Verify status updated

#### Validation
- [ ] Status accurate based on due date
- [ ] Status updates with date changes
- [ ] States: Upcoming, Overdue, Paid

#### Expected Result
Bill status calculated correctly.

## 5. Reminder Tests

### 5.1. Create Bill Reminder

**ID:** BE-T-024
**Priority:** Must
**Type:** Positive

#### Steps
1. Create bill with reminder settings
2. Verify reminder settings saved
3. Verify reminder date calculated

#### Validation
- [ ] Reminder settings saved
- [ ] Reminder date set

#### Expected Result
Bill reminder created.

### 5.2. Configure Reminder Frequency

**ID:** BE-T-025
**Priority:** Must
**Type:** Positive

#### Steps
1. Create bill
2. Set reminder frequency (daily, weekly, monthly)
3. Verify frequency saved
4. Verify reminder timeline

#### Validation
- [ ] Frequency saved
- [ ] Timeline updated

#### Expected Result
Reminder frequency configured.

### 5.3. Send Bill Reminder

**ID:** BE-T-026
**Priority:** Should
**Type:** Positive

#### Steps
1. Set bill due tomorrow
2. Trigger reminder
3. Verify reminder sent

#### Validation
- [ ] Reminder generated
- [ ] Sent to correct channel

#### Expected Result
Reminders sent correctly.

### 5.4. Disable Bill Reminder

**ID:** BE-T-027
**Priority:** Must
**Type:** Positive

#### Steps
1. Create bill with reminder
2. Disable reminder
3. Verify reminder disabled
4. Verify no more reminders

#### Validation
- [ ] Reminder disabled
- [ ] No future reminders

#### Expected Result
Reminders can be disabled.

## 6. Autopay Tests

### 6.1. Set Autopay

**ID:** BE-T-028
**Priority:** Must
**Type:** Positive

#### Steps
1. Create bill
2. Set autopay enabled
3. Verify autopay settings saved
4. Verify account linked

#### Validation
- [ ] Autopay settings saved
- [ ] Account linked

#### Expected Result
Autopay configured.

### 6.2. Execute Autopay

**ID:** BE-T-029
**Priority:** Should
**Type:** Integration

#### Steps
1. Set up bill with autopay
2. Run autopay job
3. Verify payment executed
4. Verify bill marked paid

#### Validation
- [ ] Payment executed
- [ ] Bill marked paid
- [ ] Transaction created

#### Expected Result
Autopay executes correctly.

### 6.3. Disable Autopay

**ID:** BE-T-030
**Priority:** Must
**Type:** Positive

#### Steps
1. Create bill with autopay
2. Disable autopay
3. Verify autopay disabled
4. Verify no further autopay

#### Validation
- [ ] Autopay disabled
- [ ] Manual control restored

#### Expected Result
Autopay can be disabled.

### 6.4. Autopay Account Validation

**ID:** BE-T-031
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to set autopay without account
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Autopay requires valid account.

### 6.5. Insufficient Funds Autopay

**ID:** BE-T-032
**Priority:** Should
**Type:** Negative

#### Steps
1. Set autopay with insufficient funds
2. Run autopay
3. Verify failure
4. Verify notification sent

#### Validation
- [ ] Autopay fails with low funds
- [ ] Notification sent

#### Expected Result
Autopay respects balance.

## 7. Bill Frequency Tests

### 7.1. One-Time Bill

**ID:** BE-T-033
**Priority:** Must
**Type:** Positive

#### Steps
1. Create bill with one-time frequency
2. Mark as paid
3. Verify bill not recurring

#### Validation
- [ ] One-time bill not recurring
- [ ] Paid flag persists

#### Expected Result
One-time bills work.

### 7.2. Recurring Monthly Bill

**ID:** BE-T-034
**Priority:** Must
**Type:** Positive

#### Steps
1. Create recurring monthly bill
2. Pay on due date
3. Verify next occurrence scheduled
4. Verify new due date

#### Validation
- [ ] Recurring bill creates new instance
- [ ] Next due date calculated
- [ ] Date increment correct

#### Expected Result
Monthly recurring bills work.

### 7.3. Recurring Weekly Bill

**ID:** BE-T-035
**Priority:** Should
**Type:** Positive

#### Steps
1. Create recurring weekly bill
2. Verify frequency
3. Test payment and recurrence

#### Validation
- [ ] Weekly frequency applied
- [ ] Recurrence works

#### Expected Result
Weekly recurring bills work.

### 7.4. Recurring Daily Bill

**ID:** BE-T-036
**Priority:** Should
**Type:** Positive

#### Steps
1. Create recurring daily bill
2. Verify frequency
3. Test payment and recurrence

#### Validation
- [ ] Daily frequency applied
- [ ] Recurrence works

#### Expected Result
Daily recurring bills work.

### 7.5. Recurring Custom Frequency

**ID:** BE-T-037
**Priority:** Should
**Type:** Positive

#### Steps
1. Create bill with custom frequency
2. Verify recurrence pattern
3. Verify payments on schedule

#### Validation
- [ ] Custom frequency supported
- [ ] Recurrence works correctly

#### Expected Result
Custom frequency bills work.

### 7.6. Modify Recurring Bill

**ID:** BE-T-038
**Priority:** Should
**Type:** Positive

#### Steps
1. Create recurring bill
2. Change amount
3. Verify future instances updated
4. Verify past instances unchanged

#### Validation
- [ ] Future instances use new amount
- [ ] Historical instances unchanged

#### Expected Result
Modifications apply correctly.

## 8. Performance Tests

### 8.1. Get Upcoming Bills Performance

**ID:** BE-T-039
**Priority:** Must
**Type:** Performance

#### Steps
1. Send GET to `/api/bills/upcoming`
2. Measure response time
3. Verify meets 100ms threshold

#### Validation
- [ ] Response < 100ms
- [ ] Proper indexing
- [ ] Efficient queries

#### Expected Result
Upcoming bills retrieval is fast.

### 8.2. Get Overdue Bills Performance

**ID:** BE-T-040
**Priority:** Must
**Type:** Performance

#### Steps
1. Send GET to `/api/bills/overdue`
2. Measure response time
3. Verify meets 100ms threshold

#### Validation
- [ ] Response < 100ms
- [ ] Efficient queries

#### Expected Result
Overdue bills retrieval is fast.

## 9. Error Handling Tests

### 9.1. Error Messages

**ID:** BE-T-041
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

### 9.2. Invalid Autopay Account

**ID:** BE-T-042
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to set autopay with invalid account
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid autopay account prevented.

## 10. Integration Tests

### 10.1. Bill Payment Updates Account Balance

**ID:** BE-T-043
**Priority:** Must
**Type:** Integration

#### Steps
1. Create bill
2. Mark as paid
3. Verify account balance decreased
4. Verify transaction created

#### Validation
- [ ] Balance updated
- [ ] Transaction created
- [ ] Amount correct

#### Expected Result
Bill payments update balance.

### 10.2. Bill Payment Updates Analytics

**ID:** BE-T-044
**Priority:** Should
**Type:** Integration

#### Steps
1. Pay bill
2. Verify analytics updated
3. Verify dashboard reflects payment

#### Validation
- [ ] Analytics recalculate
- [ ] Dashboard shows payment

#### Expected Result
Bill payments update analytics.

### 10.3. Bill Payment Updates Budget

**ID:** BE-T-045
**Priority:** Should
**Type:** Integration

#### Steps
1. Set budget for bill category
2. Pay bill
3. Verify budget tracking updated

#### Validation
- [ ] Budget tracking updated
- [ ] Remaining balance accurate

#### Expected Result
Bill payments update budget.

## 11. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] Recurring bills work correctly
- [ ] Autopay functioning
- [ ] Cross-user data isolation working
- [ ] Reminders working

## 12. Test Execution Notes

- Test recurring bill end dates
- Verify payment date handling
- Test autopay with different accounts
- Test multiple reminder frequencies
- Verify bill status calculations
- Test edge cases with bill amounts

## 13. Dependencies

- Database with bills table
- Account balance tracking
- Recurrence logic
- Reminder system
- Autopay system
- Transaction integration
- Budget integration