# E2E Test Specification - Bills Module

**Module:** Bills
**Test Suite:** Frontend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Bills module, covering bill tracking, payment status, and reminders.

## 2. Test Scenarios

### 2.1. View Bills

**ID:** T-001
**Priority:** Must
**Type:** Smoke

#### Steps
1. Navigate to "Bills" module
2. Verify bills list displays
3. Verify status badges

#### Validation
- [ ] Bills list renders
- [ ] Status badges visible
- [ ] Sort controls visible

#### Expected Result
User sees bills with status indicators.

### 2.2. Create Bill

**ID:** T-002
**Priority:** Must
**Type:** Positive

#### Steps
1. Click "Add Bill" button
2. Enter bill details:
   - Name: "Rent"
   - Amount: $1200
   - Due date: Today
   - Frequency: Monthly
3. Save
4. Verify success message
5. Verify bill appears

#### Validation
- [ ] Modal opens
- [ ] Form fields visible
- [ ] Bill created
- [ ] First due date calculated

#### Expected Result
Bill is created successfully.

### 2.3. Edit Bill

**ID:** T-003
**Priority:** Must
**Type:** Positive

#### Steps
1. Edit bill amount
2. Edit due date
3. Save
4. Verify updates

#### Validation
- [ ] Edit modal opens
- [ ] Values pre-filled
- [ ] Next due date recalculated
- [ ] Success message

#### Expected Result
Bill is updated.

### 2.4. Mark Bill as Paid

**ID:** T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Click "Mark as Paid"
2. Confirm
3. Verify status change
4. Verify date recorded

#### Validation
- [ ] Confirmation modal appears
- [ ] Status changes to paid
- [ ] Payment date recorded
- [ ] Success message

#### Expected Result
Bill marked as paid.

### 2.5. Delete Bill

**ID:** T-005
**Priority:** Must
**Type:** Positive

#### Steps
1. Delete bill
2. Confirm
3. Verify removed

#### Validation
- [ ] Confirmation modal
- [ ] Bill deleted
- [ ] Success message

#### Expected Result
Bill is deleted.

### 2.6. Filter Bills by Status

**ID:** T-006
**Priority:** Must
**Type:** Positive

#### Steps
1. Click status filter
2. Select "Upcoming"
3. Verify filtered bills

#### Validation
- [ ] Filter dropdown works
- [ ] Only upcoming bills shown
- [ ] Paid/overdue hidden

#### Expected Result
Bills filtered by status.

### 2.7. Filter by Due Date

**ID:** T-007
**Priority:** Should
**Type:** Positive

#### Steps
1. Click date filter
2. Select "This Week"
3. Verify filtered bills

#### Validation
- [ ] Date filter works
- [ ] Only bills in period shown
- [ ] Sort by date

#### Expected Result
Bills filtered by date range.

### 2.8. Sort Bills

**ID:** T-008
**Priority:** Must
**Type:** Positive

#### Steps
1. Click date header
2. Verify sorting
3. Verify indicator

#### Validation
- [ ] Sort indicator shown
- [ ] Bills sorted by date
- [ ] Ascending/descending toggle

#### Expected Result
Bills sorted correctly.

### 2.9. Overdue Bill Indicator

**ID:** T-009
**Priority:** Must
**Type:** Visual

#### Steps
1. Set due date to past
2. Verify overdue badge
3. Verify color
4. Verify days overdue shown

#### Validation
- [ ] Overdue badge visible
- [ ] Red color
- [ ] Days count shown

#### Expected Result
Overdue bills highlighted.

### 2.10. Days Until Due

**ID:** T-010
**Priority:** Must
**Type:** Positive

#### Steps
1. View upcoming bill
2. Verify days until due shown
3. Change due date
4. Verify count updates

#### Validation
- [ ] Days count visible
- [ ] Updates correctly
- [ ] Changes reflect

#### Expected Result
Days until due works.

### 2.11. Unique Bill Name

**ID:** T-011
**Priority:** Must
**Type:** Positive

#### Steps
1. Try to create duplicate bill name
2. Verify error

#### Validation
- [ ] Duplicate check works
- [ ] Error message
- [ ] Can't create duplicate

#### Expected Result
Duplicate names prevented.

### 2.12. Frequency Calculation

**ID:** T-012
**Priority:** Should
**Type:** Positive

#### Steps
1. Create bill with monthly frequency
2. Verify first due date
3. Verify recurring due dates

#### Validation
- [ ] First due date calculated
- [ ] Recurring dates correct
- [ ] Next due date updated

#### Expected Result
Frequency calculation works.

### 2.13. Mobile Responsive

**ID:** T-013
**Priority:** Must
**Type:** Visual

#### Steps
1. Resize to mobile
2. Navigate to Bills
3. Verify layout

#### Validation
- [ ] Layout responsive
- [ ] Cards readable
- [ ] Buttons accessible

#### Expected Result
Bills work on mobile.

### 2.14. Toast Notifications

**ID:** T-014
**Priority:** Must
**Type:** Visual

#### Steps
1. Create/edit/delete bill
2. Verify toast

#### Validation
- [ ] Toast appears
- [ ] Success message
- [ ] Auto-dismisses

#### Expected Result
Toast notification displayed.

## 3. Negative Test Scenarios

### 3.1. Invalid Amount

**ID:** T-N001
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to create bill with 0 amount
2. Try negative amount
3. Verify error

#### Expected Result
Validation error shown.

### 3.2. Invalid Due Date

**ID:** T-N002
**Priority:** Must
**Type:** Negative

#### Steps
1. Try future date
2. Verify accepted
3. Try past date
4. Verify warning/allowed

#### Expected Result
Date validation works.

### 3.3. Invalid Frequency

**ID:** T-N003
**Priority:** Must
**Type:** Negative

#### Steps
1. Select invalid frequency
2. Verify error

#### Expected Result
Invalid frequency rejected.

### 3.4. Network Error

**ID:** T-N004
**Priority:** Should
**Type:** Negative

#### Steps
1. Simulate network failure
2. Try to create bill
3. Verify error

#### Expected Result
Error displayed.

## 4. Integration Tests

### 4.1. Bill and Dashboard

**ID:** T-I001
**Priority:** Must
**Type:** Integration

#### Steps
1. Create upcoming bills
2. View Dashboard
3. Verify upcoming bills shown
4. Verify overdue highlighted

#### Validation
- [ ] Dashboard shows upcoming
- [ ] Overdue bills highlighted
- [ ] Payment info shown

#### Expected Result
Dashboard shows bill status.

### 4.2. Bill and Accounts

**ID:** T-I002
**Priority:** Should
**Type:** Integration

#### Steps
1. Assign bill to account
2. Mark bill as paid
3. Verify account balance

#### Validation
- [ ] Bill linked to account
- [ ] Account balance updated
- [ ] Payment recorded

#### Expected Result
Bill payment affects account.

### 4.3. Bill and Analytics

**ID:** T-I003
**Priority:** Should
**Type:** Integration

#### Steps
1. Create bills
2. View analytics
3. Verify recurring expenses shown

#### Validation
- [ ] Analytics includes bills
- [ ] Recurring expenses calculated
- [ ] Charts include bill data

#### Expected Result
Analytics includes bills.

### 4.4. Bill and Reminders

**ID:** T-I004
**Priority:** Should
**Type:** Integration

#### Steps
1. Set reminder days
2. Create bill with future date
3. Verify reminder calculation

#### Validation
- [ ] Reminder dates calculated
- [ ] User can adjust
- [ ] System respects settings

#### Expected Result
Reminders work correctly.

## 5. Performance Tests

### 5.1. Load Speed

**ID:** T-P001
**Priority:** Must
**Type:** Performance

#### Steps
1. Navigate to Bills
2. Measure load time
3. Verify meets 2s threshold

#### Expected Result
Page loads within 2 seconds.

### 5.2. Filter Performance

**ID:** T-P002
**Priority:** Should
**Type:** Performance

#### Steps
1. Apply status filter
2. Measure response
3. Verify meets 500ms

#### Expected Result
Filter responds quickly.

## 6. Accessibility Tests

### 6.1. Keyboard Navigation

**ID:** T-A001
**Priority:** Must
**Type:** Accessibility

#### Steps
1. Navigate with Tab
2. Test controls

#### Validation
- [ ] Tab moves through items
- [ ] Buttons accessible
- [ ] Modals accessible

#### Expected Result
Full keyboard navigation.

### 6.2. Status Badge Accessibility

**ID:** T-A002
**Priority:** Should
**Type:** Accessibility

#### Steps
1. Test status badges with screen reader
2. Verify announcements

#### Validation
- [ ] Status announced
- [ ] Color context announced
- [ ] Badge meaning clear

#### Expected Result
Status badges accessible.

## 7. Cross-Browser Tests

### 7.1. Browser Compatibility

**ID:** T-C001
**Priority:** Must
**Type:** Cross-Browser

#### Steps
1. Test in Chrome, Firefox, Safari, Edge
2. Verify behavior

#### Validation
- [ ] All browsers work
- [ ] No console errors

#### Expected Result
Works across browsers.

## 8. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] No critical bugs

## 9. Test Execution Notes

- Test with different frequency types
- Verify overdue calculations
- Test with past and future dates
- Verify unique name enforcement

## 10. Dependencies

- Backend /api/bills must be operational
- Backend /api/accounts for account dropdown
- Auth system must be functional