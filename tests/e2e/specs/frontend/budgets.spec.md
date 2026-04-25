# E2E Test Specification - Budgets Module

**Module:** Budgets
**Test Suite:** Frontend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Budgets module, covering budget creation, tracking, and alerts.

## 2. Test Scenarios

### 2.1. View Budgets

**ID:** T-001
**Priority:** Must
**Type:** Smoke

#### Steps
1. Navigate to "Budgets" module
2. Verify budget list displays
3. Verify summary cards

#### Validation
- [ ] Budget list renders
- [ ] Summary cards visible
- [ ] Period selector visible

#### Expected Result
User sees budgets with summary.

### 2.2. Create Budget

**ID:** T-002
**Priority:** Must
**Type:** Positive

#### Steps
1. Click "Add Budget" button
2. Select category
3. Enter amount
4. Select period
5. Save
6. Verify success message
7. Verify budget appears

#### Validation
- [ ] Modal opens
- [ ] Category search works
- [ ] Budget created
- [ ] Progress bar visible

#### Expected Result
Budget is created successfully.

### 2.3. Edit Budget

**ID:** T-003
**Priority:** Must
**Type:** Positive

#### Steps
1. Edit budget amount
2. Save
3. Verify updates

#### Validation
- [ ] Edit modal opens
- [ ] Budget amount updated
- [ ] Progress recalculated

#### Expected Result
Budget is updated.

### 2.4. Delete Budget

**ID:** T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Delete budget
2. Confirm
3. Verify removed

#### Validation
- [ ] Confirmation modal appears
- [ ] Budget deleted
- [ ] Success message

#### Expected Result
Budget is deleted.

### 2.5. Filter Budgets by Period

**ID:** T-005
**Priority:** Must
**Type:** Positive

#### Steps
1. Select "This Month"
2. Verify filtered budgets

#### Validation
- [ ] Period filter works
- [ ] Only current period budgets shown
- [ ] Summary shows correct totals

#### Expected Result
Budgets filtered by period.

### 2.6. View Budget Progress

**ID:** T-006
**Priority:** Must
**Type:** Positive

#### Steps
1. View budget card
2. Verify progress bar
3. Verify percentage
4. Verify remaining

#### Validation
- [ ] Progress bar visible
- [ ] Percentage calculated
- [ ] Remaining amount shown
- [ ] Current spending shown

#### Expected Result
Budget progress is displayed.

### 2.7. Over-Budget Alert

**ID:** T-007
**Priority:** Must
**Type:** Positive

#### Steps
1. Create budget with low amount
2. Create transactions exceeding budget
3. Verify over-budget indicator

#### Validation
- [ ] Over-budget badge visible
- [ ] Progress bar turns red
- [ ] Alert message shown
- [ ] Dashboard warning

#### Expected Result
Over-budget is highlighted.

### 2.8. Near-Budget Alert

**ID:** T-008
**Priority:** Should
**Type:** Positive

#### Steps
1. Set budget to close to spending
2. Verify near-limit warning

#### Validation
- [ ] Warning indicator shown
- [ ] Color change on progress bar

#### Expected Result
Near-limit warnings work.

### 2.9. Change Budget Period

**ID:** T-009
**Priority:** Should
**Type:** Positive

#### Steps
1. Change period to next month
2. Verify budgets reset
3. Verify new spending

#### Validation
- [ ] Period selector works
- [ ] New period budgets shown
- [ ] Current spending calculated

#### Expected Result
Period changes work.

### 2.10. Unique Budget Check

**ID:** T-010
**Priority:** Must
**Type:** Positive

#### Steps
1. Try to create duplicate budget
2. Verify error message

#### Validation
- [ ] Duplicate check works
- [ ] Error message shown
- [ ] Can't create duplicate

#### Expected Result
Duplicate budgets prevented.

### 2.11. Mobile Responsive

**ID:** T-011
**Priority:** Must
**Type:** Visual

#### Steps
1. Resize to mobile
2. Navigate to Budgets
3. Verify layout

#### Validation
- [ ] Layout responsive
- [ ] Cards are readable
- [ ] Progress bars visible

#### Expected Result
Budgets work on mobile.

### 2.12. Export Budgets

**ID:** T-012
**Priority:** Should
**Type:** Positive

#### Steps
1. Click export button
2. Verify download

#### Validation
- [ ] Export options visible
- [ ] File downloads
- [ ] File contains budget data

#### Expected Result
Budgets exported successfully.

### 2.13. Toast Notifications

**ID:** T-013
**Priority:** Must
**Type:** Visual

#### Steps
1. Create/edit/delete budget
2. Verify toast

#### Validation
- [ ] Toast appears
- [ ] Success message
- [ ] Auto-dismisses

#### Expected Result
Toast notification displayed.

## 3. Negative Test Scenarios

### 3.1. Invalid Budget Amount

**ID:** T-N001
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to create budget with 0 amount
2. Try negative amount
3. Verify error

#### Expected Result
Validation error shown.

### 3.2. Invalid Category

**ID:** T-N002
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to select non-existent category
2. Verify error

#### Expected Result
Error for invalid category.

### 3.3. No Transactions

**ID:** T-N003
**Priority:** Should
**Type:** Negative

#### Steps
1. Create budget for uncategorized category
2. Verify 0 spending shown

#### Expected Result
Spending shows as 0.

### 3.4. Network Error

**ID:** T-N004
**Priority:** Should
**Type:** Negative

#### Steps
1. Simulate network failure
2. Try to create budget
3. Verify error

#### Expected Result
Error displayed.

## 4. Integration Tests

### 4.1. Budget and Transactions

**ID:** T-I001
**Priority:** Must
**Type:** Integration

#### Steps
1. Create budget
2. Create transaction in category
3. Verify budget updated
4. Create more transactions
5. Verify progress

#### Validation
- [ ] Budget spending updates
- [ ] Progress bar updates
- [ ] Remaining decreases

#### Expected Result
Budget tracks spending correctly.

### 4.2. Budget and Analytics

**ID:** T-I002
**Priority:** Should
**Type:** Integration

#### Steps
1. Create budgets and transactions
2. View analytics
3. Verify budget progress in charts

#### Validation
- [ ] Analytics includes budget data
- [ ] Charts show progress
- [ ] Summary accurate

#### Expected Result
Analytics includes budgets.

### 4.3. Budget and Dashboard

**ID:** T-I003
**Priority:** Should
**Type:** Integration

#### Steps
1. Create budgets
2. View Dashboard
3. Verify budget warnings

#### Validation
- [ ] Budget warnings shown
- [ ] Over-budget highlighted

#### Expected Result
Dashboard shows budget status.

### 4.4. Budget Roll-over

**ID:** T-I004
**Priority:** Should
**Type:** Integration

#### Steps
1. Set up year budget
2. Track through months
3. Verify rollover

#### Validation
- [ ] Yearly budget persists
- [ ] Monthly breakdown works
- [ ] Total calculation accurate

#### Expected Result
Year budget functionality works.

## 5. Performance Tests

### 5.1. Load Speed

**ID:** T-P001
**Priority:** Must
**Type:** Performance

#### Steps
1. Navigate to Budgets
2. Measure load time
3. Verify meets 2s threshold

#### Expected Result
Page loads within 2 seconds.

### 5.2. Filter Performance

**ID:** T-P002
**Priority:** Should
**Type:** Performance

#### Steps
1. Apply period filter
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

### 6.2. Progress Bar Accessibility

**ID:** T-A002
**Priority:** Should
**Type:** Accessibility

#### Steps
1. Test progress bar with screen reader
2. Verify announced

#### Validation
- [ ] Progress announced
- [ ] Percentage announced
- [ ] Status announced

#### Expected Result
Progress bar is accessible.

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

- Test with different budget periods
- Verify budget spending updates in real-time
- Test with many transactions

## 10. Dependencies

- Backend /api/budgets must be operational
- Backend /api/transactions must provide spending data
- Auth system must be functional