# E2E Test Specification - Loans Module

**Module:** Loans
**Test Suite:** Frontend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Loans module, covering loan management, payments, and amortization tracking.

## 2. Test Scenarios

### 2.1. View Loans

**ID:** T-001
**Priority:** Must
**Type:** Smoke

#### Steps
1. Navigate to "Loans" module
2. Verify loans list displays
3. Verify loan cards

#### Validation
- [ ] Loans list renders
- [ ] Loan cards visible
- [ ] Summary cards visible

#### Expected Result
User sees loans with summary.

### 2.2. Create Loan

**ID:** T-002
**Priority:** Must
**Type:** Positive

#### Steps
1. Click "Add Loan" button
2. Enter loan details:
   - Name: "Car Loan"
   - Principal: $15000
   - Annual Interest Rate: 6.5%
   - Monthly Payment: $300
   - Term: 60 months
3. Save
4. Verify success message
5. Verify loan appears

#### Validation
- [ ] Modal opens
- [ ] Form fields visible
- [ ] Loan created
- [ ] Amortization calculated

#### Expected Result
Loan is created successfully.

### 2.3. Edit Loan

**ID:** T-003
**Priority:** Must
**Type:** Positive

#### Steps
1. Edit loan principal
2. Save
3. Verify updates
4. Verify amortization recalculates

#### Validation
- [ ] Edit modal opens
- [ ] Values pre-filled
- [ ] Amortization updated
- [ ] Success message

#### Expected Result
Loan is updated.

### 2.4. Delete Loan

**ID:** T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Delete loan
2. Confirm
3. Verify removed

#### Validation
- [ ] Confirmation modal
- [ ] Loan deleted
- [ ] Success message

#### Expected Result
Loan is deleted.

### 2.5. Add Payment

**ID:** T-005
**Priority:** Must
**Type:** Positive

#### Steps
1. Click "Add Payment"
2. Enter payment details
3. Confirm
4. Verify remaining balance updates
5. Verify payment recorded

#### Validation
- [ ] Payment modal opens
- [ ] Remaining balance updates
- [ ] Payment history shows
- [ ] Success message

#### Expected Result
Payment recorded and balance updated.

### 2.6. View Amortization

**ID:** T-006
**Priority:** Must
**Type:** Positive

#### Steps
1. Click on loan card
2. Verify details modal
3. Verify amortization table

#### Validation
- [ ] Details modal opens
- [ ] Amortization table visible
- [ ] Scrollable
- [ ] All months shown

#### Expected Result
Amortization table displayed.

### 2.7. Filter Loans

**ID:** T-007
**Priority:** Must
**Type:** Positive

#### Steps
1. Click status filter
2. Select "Active"
3. Verify filtered loans

#### Validation
- [ ] Filter dropdown works
- [ ] Only active loans shown
- [ ] Paid off hidden

#### Expected Result
Loans filtered by status.

### 2.8. View Loan Details

**ID:** T-008
**Priority:** Must
**Type:** Positive

#### Steps
1. Click on loan card
2. Verify details displayed
3. Verify summary stats
4. Verify payment history

#### Validation
- [ ] Details modal opens
- [ ] All info visible
- [ ] Stats accurate
- [ ] History shown

#### Expected Result
Loan details displayed.

### 2.9. Loan Status Indicators

**ID:** T-009
**Priority:** Must
**Type:** Visual

#### Steps
1. View active loan
2. Verify status badge
3. View paid off loan
4. Verify paid status
5. Verify completed status

#### Validation
- [ ] Status badges visible
- [ ] Colors correct
- [ ] Status meanings clear

#### Expected Result
Status indicators work.

### 2.10. Mobile Responsive

**ID:** T-010
**Priority:** Must
**Type:** Visual

#### Steps
1. Resize to mobile
2. Navigate to Loans
3. Verify layout

#### Validation
- [ ] Layout responsive
- [ ] Cards readable
- [ ] Amortization scrollable

#### Expected Result
Loans work on mobile.

### 2.11. Toast Notifications

**ID:** T-011
**Priority:** Must
**Type:** Visual

#### Steps
1. Create/edit/delete loan
2. Add payment
3. Verify toast

#### Validation
- [ ] Toast appears
- [ ] Success message
- [ ] Auto-dismisses

#### Expected Result
Toast notification displayed.

## 3. Negative Test Scenarios

### 3.1. Invalid Principal

**ID:** T-N001
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to create loan with 0 principal
2. Try negative principal
3. Verify error

#### Expected Result
Validation error shown.

### 3.2. Invalid Interest Rate

**ID:** T-N002
**Priority:** Must
**Type:** Negative

#### Steps
1. Try invalid interest rate
2. Verify error

#### Expected Result
Invalid rate rejected.

### 3.3. Payment Exceeds Balance

**ID:** T-N003
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to pay more than remaining
2. Verify error

#### Expected Result
Error shown.

### 3.4. Negative Payment Amount

**ID:** T-N004
**Priority:** Must
**Type:** Negative

#### Steps
1. Try negative payment
2. Verify error

#### Expected Result
Negative payment rejected.

### 3.5. Network Error

**ID:** T-N005
**Priority:** Should
**Type:** Negative

#### Steps
1. Simulate network failure
2. Try to create loan
3. Verify error

#### Expected Result
Error displayed.

## 4. Integration Tests

### 4.1. Loan and Accounts

**ID:** T-I001
**Priority:** Should
**Type:** Integration

#### Steps
1. Assign loan to account
2. Add payment
3. Verify account balance

#### Validation
- [ ] Loan linked to account
- [ ] Payment affects balance
- [ ] Transaction recorded

#### Expected Result
Loan payments affect accounts.

### 4.2. Loan and Analytics

**ID:** T-I002
**Priority:** Should
**Type:** Integration

#### Steps
1. Create loans
2. View analytics
3. Verify debt tracking

#### Validation
- [ ] Analytics shows total debt
- [ ] Monthly payment included
- [ ] Charts show trend

#### Expected Result
Analytics tracks loans.

### 4.3. Loan and Budget

**ID:** T-I003
**Priority:** Should
**Type:** Integration

#### Steps
1. Create loan
2. Set monthly payment as expense
3. View budget
4. Verify payment tracked

#### Validation
- [ ] Loan payment in budget
- [ ] Payment affects budget
- [ ] Over-budget warning

#### Expected Result
Budget tracks loan payments.

### 4.4. Loan and Dashboard

**ID:** T-I004
**Priority:** Should
**Type:** Integration

#### Steps
1. Create loans
2. View Dashboard
3. Verify debt summary

#### Validation
- [ ] Dashboard shows debt total
- [ ] Active loans shown
- [ ] Progress indicator

#### Expected Result
Dashboard shows loan summary.

### 4.5. Amortization Accuracy

**ID:** T-I005
**Priority:** Must
**Type:** Integration

#### Steps
1. Create loan
2. View amortization
3. Verify calculations match standard

#### Validation
- [ ] Payments accurate
- [ ] Interest calculated correctly
- [ ] Balance correct
- [ ] Final balance zero

#### Expected Result
Amortization is accurate.

## 5. Performance Tests

### 5.1. Load Speed

**ID:** T-P001
**Priority:** Must
**Type:** Performance

#### Steps
1. Navigate to Loans
2. Measure load time
3. Verify meets 2s threshold

#### Expected Result
Page loads within 2 seconds.

### 5.2. Amortization Calculation

**ID:** T-P002
**Priority:** Must
**Type:** Performance

#### Steps
1. Open amortization table
2. Measure response
3. Verify meets 500ms

#### Expected Result
Amortization calculation is fast.

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

### 6.2. Table Accessibility

**ID:** T-A002
**Priority:** Should
**Type:** Accessibility

#### Steps
1. Test amortization table with screen reader
2. Verify announcements

#### Validation
- [ ] Table structure announced
- [ ] Headers announced
- [ ] Data readable

#### Expected Result
Table is accessible.

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
- [ ] Amortization accurate

#### Expected Result
Works across browsers.

## 8. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] No critical bugs
- [ ] Amortization calculations accurate

## 9. Test Execution Notes

- Verify amortization matches standard calculations
- Test with different loan terms
- Test with varying interest rates
- Verify payment limits

## 10. Dependencies

- Backend /api/loans must be operational
- Backend /api/accounts for account dropdown
- Auth system must be functional