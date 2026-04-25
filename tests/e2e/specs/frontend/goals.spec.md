# E2E Test Specification - Savings Goals Module

**Module:** Savings Goals
**Test Suite:** Frontend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Savings Goals module, covering goal creation, progress tracking, and contribution management.

## 2. Test Scenarios

### 2.1. View Goals

**ID:** T-001
**Priority:** Must
**Type:** Smoke

#### Steps
1. Navigate to "Savings Goals" module
2. Verify goal list displays
3. Verify goal cards

#### Validation
- [ ] Goals list renders
- [ ] Goal cards visible
- [ ] Summary visible

#### Expected Result
User sees goals with progress.

### 2.2. Create Goal

**ID:** T-002
**Priority:** Must
**Type:** Positive

#### Steps
1. Click "Add Goal" button
2. Enter goal details:
   - Name: "Emergency Fund"
   - Target Amount: $10000
   - Current Amount: $5000
   - Target Date: 12 months from now
   - Category: Emergency
4. Save
5. Verify success message
6. Verify goal appears

#### Validation
- [ ] Modal opens
- [ ] Form fields visible
- [ ] Goal created
- [ ] Progress calculated
- [ ] Progress bar visible

#### Expected Result
Goal is created successfully.

### 2.3. Edit Goal

**ID:** T-003
**Priority:** Must
**Type:** Positive

#### Steps
1. Edit goal target amount
2. Save
3. Verify updates
4. Verify progress recalculates

#### Validation
- [ ] Edit modal opens
- [ ] Values pre-filled
- [ ] Progress recalculated
- [ ] Success message

#### Expected Result
Goal is updated.

### 2.4. Delete Goal

**ID:** T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Delete goal
2. Confirm
3. Verify removed

#### Validation
- [ ] Confirmation modal
- [ ] Goal deleted
- [ ] Success message

#### Expected Result
Goal is deleted.

### 2.5. Contribute to Goal

**ID:** T-005
**Priority:** Must
**Type:** Positive

#### Steps
1. Click "Contribute" on goal
2. Enter contribution amount
3. Confirm
4. Verify progress updates
5. Verify current amount increases

#### Validation
- [ ] Contribution modal opens
- [ ] Contribution recorded
- [ ] Progress updated
- [ ] Current amount increased
- [ ] Success message

#### Expected Result
Contribution recorded and progress updated.

### 2.6. View Goal Progress

**ID:** T-006
**Priority:** Must
**Type:** Positive

#### Steps
1. View goal card
2. Verify progress bar
3. Verify percentage
4. Verify remaining

#### Validation
- [ ] Progress bar visible
- [ ] Percentage calculated
- [ ] Remaining shown
- [ ] Current vs target shown

#### Expected Result
Goal progress displayed.

### 2.7. Filter Goals

**ID:** T-007
**Priority:** Must
**Type:** Positive

#### Steps
1. Click category filter
2. Select "Emergency"
3. Verify filtered goals

#### Validation
- [ ] Filter works
- [ ] Only selected category goals shown
- [ ] All categories listed

#### Expected Result
Goals filtered by category.

### 2.8. Goal Completion

**ID:** T-008
**Priority:** Must
**Type:** Visual

#### Steps
1. Set current amount to equal target
2. Verify completion indicator
3. Verify celebration (if enabled)

#### Validation
- [ ] Completion badge visible
- [ ] Goal marked completed
- [ ] Celebration animation

#### Expected Result
Completed goals are highlighted.

### 2.9. Mobile Responsive

**ID:** T-009
**Priority:** Must
**Type:** Visual

#### Steps
1. Resize to mobile
2. Navigate to Goals
3. Verify layout

#### Validation
- [ ] Layout responsive
- [ ] Cards readable
- [ ] Progress bars visible
- [ ] Buttons accessible

#### Expected Result
Goals work on mobile.

### 2.10. Toast Notifications

**ID:** T-010
**Priority:** Must
**Type:** Visual

#### Steps
1. Create/edit/delete goal
2. Contribute to goal
3. Verify toast

#### Validation
- [ ] Toast appears
- [ ] Success message
- [ ] Auto-dismisses

#### Expected Result
Toast notification displayed.

## 3. Negative Test Scenarios

### 3.1. Invalid Target Amount

**ID:** T-N001
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to create goal with 0 target
2. Try negative target
3. Verify error

#### Expected Result
Validation error shown.

### 3.2. Target Less Than Current

**ID:** T-N002
**Priority:** Must
**Type:** Negative

#### Steps
1. Set target less than current
2. Verify error/warning

#### Expected Result
Invalid combination prevented.

### 3.3. Invalid Date

**ID:** T-N003
**Priority:** Should
**Type:** Negative

#### Steps
1. Try past date
2. Verify warning

#### Expected Result
Warning for invalid date.

### 3.4. Payment Exceeds Remaining

**ID:** T-N004
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to contribute more than needed
2. Verify error

#### Expected Result
Excess contribution prevented.

### 3.5. Network Error

**ID:** T-N005
**Priority:** Should
**Type:** Negative

#### Steps
1. Simulate network failure
2. Try to create goal
3. Verify error

#### Expected Result
Error displayed.

## 4. Integration Tests

### 4.1. Goal and Transactions

**ID:** T-I001
**Priority:** Must
**Type:** Integration

#### Steps
1. Create goal
2. Create contribution transaction
3. Verify progress updated
4. Verify transaction linked to goal

#### Validation
- [ ] Contribution recorded
- [ ] Goal progress updated
- [ ] Transaction details show goal

#### Expected Result
Goal contributions tracked.

### 4.2. Goal and Accounts

**ID:** T-I002
**Priority:** Should
**Type:** Integration

#### Steps
1. Create goal
2. Contribute from account
3. Verify account balance

#### Validation
- [ ] Account balance updated
- [ ] Contribution deducted from account
- [ ] Transaction recorded

#### Expected Result
Goal contributions affect accounts.

### 4.3. Goal and Analytics

**ID:** T-I003
**Priority:** Should
**Type:** Integration

#### Steps
1. Create goals
2. View analytics
3. Verify savings progress shown

#### Validation
- [ ] Analytics shows goals
- [ ] Savings tracked
- [ ] Charts include goal data

#### Expected Result
Analytics includes goals.

### 4.4. Goal and Budget

**ID:** T-I004
**Priority:** Should
**Type:** Integration

#### Steps
1. Set budget for savings
2. Create transactions
3. Verify budget tracking

#### Validation
- [ ] Budget updates with savings
- [ ] Spending affects budget
- [ ] Progress shown

#### Expected Result
Budget tracks savings.

### 4.5. Goal Completion Alert

**ID:** T-I005
**Priority:** Should
**Type:** Integration

#### Steps
1. Complete goal
2. Verify alert/notification
3. Verify celebration

#### Validation
- [ ] Completion notification
- [ ] Celebration animation
- [ ] Achievement logged

#### Expected Result
Completion is celebrated.

## 5. Performance Tests

### 5.1. Load Speed

**ID:** T-P001
**Priority:** Must
**Type:** Performance

#### Steps
1. Navigate to Goals
2. Measure load time
3. Verify meets 2s threshold

#### Expected Result
Page loads within 2 seconds.

### 5.2. Progress Calculation

**ID:** T-P002
**Priority:** Must
**Type:** Performance

#### Steps
1. Add contribution
2. Measure response
3. Verify meets 200ms

#### Expected Result
Progress updates are fast.

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
2. Verify announcements

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
- [ ] Animations work

#### Expected Result
Works across browsers.

## 8. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] No critical bugs
- [ ] Progress calculations accurate

## 9. Test Execution Notes

- Test with various goal types
- Verify contribution limits
- Test goal completion celebration
- Verify account linking

## 10. Dependencies

- Backend /api/savings-goals must be operational
- Backend /api/transactions for contributions
- Auth system must be functional