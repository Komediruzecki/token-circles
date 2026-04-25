# E2E Test Specification - Emergency Fund Calculator

**Module:** Emergency Fund Calculator
**Test Suite:** Frontend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Emergency Fund Calculator, helping users determine emergency fund targets and track progress.

## 2. Test Scenarios

### 2.1. View Calculator

**ID:** T-001
**Priority:** Must
**Type:** Smoke

#### Steps
1. Navigate to "Emergency Fund" module
2. Verify calculator interface
3. Verify input fields

#### Validation
- [ ] Calculator page renders
- [ ] Input fields visible
- [ ] Results display visible
- [ ] Progress visualization visible

#### Expected Result
User sees emergency fund calculator.

### 2.2. Calculate Emergency Fund

**ID:** T-002
**Priority:** Must
**Type:** Positive

#### Steps
1. Enter monthly expenses: $2000
2. Select comfort level: 6 months
3. Enter current savings: $5000
4. Enter monthly savings rate: $800
5. Click "Calculate"
6. Verify results
7. Verify progress bar
8. Verify timeline

#### Validation
- [ ] Calculator responds
- [ ] Target amount calculated
- [ ] Amount needed shown
- [ ] Time to reach target shown
- [ ] Progress bar visible
- [ ] Timeline visible

#### Expected Result
Emergency fund target calculated and displayed.

### 2.3. Auto-Import Expenses

**ID:** T-003
**Priority:** Should
**Type:** Positive

#### Steps
1. Click "Import Expenses"
2. Verify import dialog
3. Select transaction source
4. Confirm import
5. Verify monthly expenses populated

#### Validation
- [ ] Import button works
- [ ] Transaction data imported
- [ ] Monthly expenses calculated
- [ ] Fields updated

#### Expected Result
Expenses auto-imported.

### 2.4. Auto-Import Current Savings

**ID:** T-004
**Priority:** Should
**Type:** Positive

#### Steps
1. Click "Import Savings"
2. Verify import dialog
3. Select account
4. Confirm import
5. Verify current savings populated

#### Validation
- [ ] Import button works
- [ ] Account data imported
- [ ] Current savings calculated
- [ ] Fields updated

#### Expected Result
Savings auto-imported.

### 2.5. Change Comfort Level

**ID:** T-005
**Priority:** Must
**Type:** Positive

#### Steps
1. Change from 3 months to 6 months
2. Verify target updates
3. Verify time to reach updates

#### Validation
- [ ] Comfort level dropdown works
- [ ] Target amount recalculated
- [ ] Timeline updates
- [ ] Monthly savings needed updates

#### Expected Result
Comfort level changes affect target.

### 2.6. Adjust Monthly Savings

**ID:** T-006
**Priority:** Must
**Type:** Positive

#### Steps
1. Modify monthly savings rate
2. Verify time to reach updates
3. Verify timeline updates

#### Validation
- [ ] Input field updates
- [ ] Time to reach recalculated
- [ ] Timeline updates
- [ ] Visual feedback

#### Expected Result
Savings rate changes affect timeline.

### 2.7. View Progress Visualization

**ID:** T-007
**Priority:** Must
**Type:** Positive

#### Steps
1. View progress bar
2. Verify milestone indicators
3. Verify progress percentage
4. Verify remaining amount

#### Validation
- [ ] Progress bar visible
- [ ] Milestones shown
- [ ] Percentage calculated
- [ ] Remaining amount shown
- [ ] Color-coded stages

#### Expected Result
Progress visualization displays correctly.

### 2.8. View Timeline

**ID:** T-008
**Priority:** Must
**Type:** Positive

#### Steps
1. View timeline
2. Verify expected completion date
3. Verify monthly savings target
4. Verify interactive details

#### Validation
- [ ] Timeline visible
- [ ] Completion date shown
- [ ] Monthly target shown
- [ ] Interactive hover details

#### Expected Result
Timeline displays correctly.

### 2.9. Reset Calculator

**ID:** T-009
**Priority:** Must
**Type:** Positive

#### Steps
1. Modify inputs
2. Click "Reset"
3. Verify defaults restored
4. Recalculate

#### Validation
- [ ] Reset button works
- [ ] Defaults restored
- [ ] Results update

#### Expected Result
Calculator resets to defaults.

### 2.10. Mobile Responsive

**ID:** T-010
**Priority:** Must
**Type:** Visual

#### Steps
1. Resize to mobile
2. Navigate to Calculator
3. Verify layout

#### Validation
- [ ] Layout responsive
- [ ] Inputs readable
- [ ] Progress bar visible
- [ ] Timeline accessible
- [ ] Buttons accessible

#### Expected Result
Calculator works on mobile.

### 2.11. Toast Notifications

**ID:** T-011
**Priority:** Must
**Type:** Visual

#### Steps
1. Import expenses
2. Verify toast

#### Validation
- [ ] Toast appears
- [ ] Success message
- [ ] Auto-dismisses

#### Expected Result
Toast notification displayed.

## 3. Negative Test Scenarios

### 3.1. Negative Current Savings

**ID:** T-N001
**Priority:** Should
**Type:** Negative

#### Steps
1. Enter negative current savings
2. Verify warning

#### Expected Result
Warning shown for negative savings.

### 3.2. Insufficient Time to Complete

**ID:** T-N002
**Priority:** Should
**Type:** Negative

#### Steps
1. Set monthly savings very low
2. Verify warning about long timeline

#### Expected Result
Warning for long timeline.

### 3.3. No Expenses Data

**ID:** T-N003
**Priority:** Should
**Type:** Negative

#### Steps
1. Try to import without transactions
2. Verify prompt for manual entry

#### Expected Result
Prompt for manual entry if no data.

### 3.4. No Savings Data

**ID:** T-N004
**Priority:** Should
**Type:** Negative

#### Steps
1. Try to import without accounts
2. Verify prompt for manual entry

#### Expected Result
Prompt for manual entry if no data.

### 3.5. Network Error

**ID:** T-N005
**Priority:** Should
**Type:** Negative

#### Steps
1. Simulate network failure
2. Try to import data
3. Verify error

#### Expected Result
Error displayed.

## 4. Integration Tests

### 4.1. Calculator and Accounts

**ID:** T-I001
**Priority:** Should
**Type:** Integration

#### Steps
1. Import current savings from account
2. Verify savings amount
3. Create contribution
4. Verify progress updates
5. Verify account balance

#### Validation
- [ ] Import works
- [ ] Savings calculated correctly
- [ ] Contributions affect account
- [ ] Progress updated

#### Expected Result
Calculator integrated with accounts.

### 4.2. Calculator and Transactions

**ID:** T-I002
**Priority:** Should
**Type:** Integration

#### Steps
1. Import expenses from transactions
2. Verify monthly expenses
3. Create transactions
4. Verify expenses updated

#### Validation
- [ ] Import works
- [ ] Expenses calculated correctly
- [ ] Transactions affect expenses
- [ ] Summary updated

#### Expected Result
Calculator integrated with transactions.

### 4.3. Calculator and Settings

**ID:** T-I003
**Priority:** Should
**Type:** Integration

#### Steps
1. Change currency in settings
2. Verify calculator uses currency
3. Change number format
4. Verify display

#### Validation
- [ ] Currency applied
- [ ] Number format applied
- [ ] Consistent with settings

#### Expected Result
Calculator respects settings.

### 4.4. Calculator and Budgets

**ID:** T-I004
**Priority:** Should
**Type:** Integration

#### Steps
1. Set up savings budget
2. Create contributions
3. Verify budget tracking
4. Verify over-budget warning

#### Validation
- [ ] Budget linked to goal
- [ ] Spending tracked
- [ ] Over-budget indicators

#### Expected Result
Calculator integrated with budgets.

### 4.5. Calculator and Dashboard

**ID:** T-I005
**Priority:** Should
**Type:** Integration

#### Steps
1. View Dashboard
2. Verify emergency fund summary
3. Verify progress

#### Validation
- [ ] Dashboard shows goals
- [ ] Progress indicators
- [ ] Account balances shown

#### Expected Result
Dashboard includes emergency fund info.

## 5. Performance Tests

### 5.1. Load Speed

**ID:** T-P001
**Priority:** Must
**Type:** Performance

#### Steps
1. Navigate to Calculator
2. Measure load time
3. Verify meets 2s threshold

#### Expected Result
Page loads within 2 seconds.

### 5.2. Calculation Speed

**ID:** T-P002
**Priority:** Must
**Type:** Performance

#### Steps
1. Click Calculate
2. Measure response
3. Verify meets 50ms

#### Expected Result
Calculation is fast.

### 5.3. Import Speed

**ID:** T-P003
**Priority:** Should
**Type:** Performance

#### Steps
1. Import expenses
2. Measure response
3. Verify meets 500ms

#### Expected Result
Import is fast.

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
- [ ] Inputs accessible
- [ ] Buttons accessible

#### Expected Result
Full keyboard navigation.

### 6.2. Progress Bar Accessibility

**ID:** T-A002
**Priority:** Should
**Type:** Accessibility

#### Steps
1. Test with screen reader
2. Verify progress announced

#### Validation
- [ ] Progress announced
- [ ] Percentage announced
- [ ] Stage announced

#### Expected Result
Progress bar is accessible.

### 6.3. Form Accessibility

**ID:** T-A003
**Priority:** Must
**Type:** Accessibility

#### Steps
1. Test with screen reader
2. Verify labels
3. Verify error messages

#### Validation
- [ ] Labels visible
- [ ] Errors announced
- [ ] Required fields marked

#### Expected Result
Form is accessible.

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
- [ ] Calculations accurate

#### Expected Result
Works across browsers.

## 8. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] Accessibility requirements met
- [ ] No critical bugs
- [ ] Calculations are accurate

## 9. Test Execution Notes

- Test with different comfort levels
- Verify auto-import functionality
- Test timeline visualization
- Test progress bar milestones

## 10. Dependencies

- Backend /api/transactions for expense import
- Backend /api/accounts for savings import
- Backend /api/calculator/emergency-fund may be used
- Auth system must be functional