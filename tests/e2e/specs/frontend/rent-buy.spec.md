# E2E Test Specification - Rent vs Buy Calculator

**Module:** Rent vs Buy Calculator
**Test Suite:** Frontend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Rent vs Buy Calculator, comparing housing costs and investment alternatives.

## 2. Test Scenarios

### 2.1. View Calculator

**ID:** T-001
**Priority:** Must
**Type:** Smoke

#### Steps
1. Navigate to "Rent vs Buy" module
2. Verify calculator interface
3. Verify input fields
4. Verify comparison results

#### Validation
- [ ] Calculator page renders
- [ ] Purchase inputs visible
- [ ] Rent inputs visible
- [ ] Results display visible
- [ ] Charts visible

#### Expected Result
User sees rent vs buy calculator.

### 2.2. Run Comparison

**ID:** T-002
**Priority:** Must
**Type:** Positive

#### Steps
1. Enter purchase details:
   - Home price: $300000
   - Down payment: 20%
   - Interest rate: 7%
   - Loan term: 30 years
   - Property tax: 1.2%
   - Insurance: $2000
   - Maintenance: 1%
   - Appreciation: 3%
   - Closing costs: $6000
2. Enter rent details:
   - Monthly rent: $1500
   - Rent increase: 3%
   - Security deposit: $1500
3. Enter time horizon: 5 years
4. Enter investment return: 7%
5. Click "Calculate"
6. Verify results
7. Verify charts

#### Validation
- [ ] Calculator responds
- [ ] Results display
- [ ] Total costs calculated
- [ ] Charts render
- [ ] Break-even shown

#### Expected Result
Comparison calculated successfully.

### 2.3. View Total Costs Chart

**ID:** T-003
**Priority:** Must
**Type:** Positive

#### Steps
1. View total costs chart
2. Verify rent cost line
3. Verify purchase cost line
4. Verify difference

#### Validation
- [ ] Chart visible
- [ ] Rent cost shown
- [ ] Purchase cost shown
- [ ] Difference marked

#### Expected Result
Total costs chart displays correctly.

### 2.4. View Net Worth Comparison

**ID:** T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. View net worth chart
2. Verify home equity line
3. Verify investment line
4. Verify difference

#### Validation
- [ ] Chart visible
- [ ] Equity line correct
- [ ] Investment line correct
- [ ] Net worth shown

#### Expected Result
Net worth chart displays correctly.

### 2.5. View Break-Even Point

**ID:** T-005
**Priority:** Must
**Type:** Positive

#### Steps
1. View results
2. Verify break-even point
3. Verify year indicated
4. Verify details

#### Validation
- [ ] Break-even visible
- [ ] Year indicated
- [ ] Details shown
- [ ] Threshold marked

#### Expected Result
Break-even point displayed.

### 2.6. View Tax Benefits

**ID:** T-006
**Priority:** Should
**Type:** Positive

#### Steps
1. Click "Tax Benefits"
2. Verify property tax deduction
3. Verify mortgage interest deduction
4. Verify total savings

#### Validation
- [ ] Tax benefits visible
- [ ] Deductions calculated
- [ ] Total savings shown
- [ ] Breakdown detailed

#### Expected Result
Tax benefits calculated and displayed.

### 2.7. Compare Scenarios

**ID:** T-007
**Priority:** Should
**Type:** Positive

#### Steps
1. Set parameters for scenario 1
2. Save scenario
3. Set different parameters for scenario 2
4. Save scenario
5. Verify comparison

#### Validation
- [ ] Scenario saving works
- [ ] Comparison displayed
- [ ] Side-by-side results
- [ ] Visual comparison

#### Expected Result
Scenario comparison works.

### 2.8. Analyze Impact

**ID:** T-008
**Priority:** Should
**Type:** Positive

#### Steps
1. Click "Analyze Impact"
2. Adjust home price
3. Verify results update
4. Adjust rent amount
5. Verify results update

#### Validation
- [ ] Impact sliders visible
- [ ] Real-time updates
- [ ] Before/after shown
- [ ] Clear impact displayed

#### Expected Result
Impact analysis works.

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
- [ ] Charts scrollable
- [ ] Buttons accessible

#### Expected Result
Calculator works on mobile.

### 2.11. Empty State

**ID:** T-011
**Priority:** Must
**Type:** Visual

#### Steps
1. Navigate to Calculator
2. Verify initial state

#### Validation
- [ ] Defaults visible
- [ ] Instructions clear
- [ ] Ready to calculate

#### Expected Result
Initial state displays appropriately.

### 2.12. Recommendation Display

**ID:** T-012
**Priority:** Must
**Type:** Visual

#### Steps
1. Calculate with various inputs
2. Verify recommendation
3. Verify reasoning

#### Validation
- [ ] Recommendation shown
- [ ] Clear decision
- [ ] Reasoning explained

#### Expected Result
Recommendation displays correctly.

### 2.13. Toast Notifications

**ID:** T-013
**Priority:** Must
**Type:** Visual

#### Steps
1. Save scenario
2. Verify toast

#### Validation
- [ ] Toast appears
- [ ] Success message
- [ ] Auto-dismisses

#### Expected Result
Toast notification displayed.

## 3. Negative Test Scenarios

### 3.1. Invalid Home Price

**ID:** T-N001
**Priority:** Must
**Type:** Negative

#### Steps
1. Enter invalid home price
2. Verify error

#### Expected Result
Invalid price rejected.

### 3.2. Invalid Interest Rate

**ID:** T-N002
**Priority:** Must
**Type:** Negative

#### Steps
1. Enter invalid interest rate
2. Verify error

#### Expected Result
Invalid rate rejected.

### 3.3. Negative Rent Increase

**ID:** T-N003
**Priority:** Must
**Type:** Negative

#### Steps
1. Enter negative rent increase
2. Verify error

#### Expected Result
Negative increase rejected.

### 3.4. Invalid Time Horizon

**ID:** T-N004
**Priority:** Must
**Type:** Negative

#### Steps
1. Enter invalid time horizon
2. Verify error

#### Expected Result
Invalid horizon rejected.

### 3.5. Network Error

**ID:** T-N005
**Priority:** Should
**Type:** Negative

#### Steps
1. Simulate network failure
2. Try to save scenario
3. Verify error

#### Expected Result
Error displayed.

## 4. Integration Tests

### 4.1. Calculator with Account Data

**ID:** T-I001
**Priority:** Should
**Type:** Integration

#### Steps
1. Import account balances
2. Use as investment base
3. Verify calculation
4. Create transactions
5. Verify updated

#### Validation
- [ ] Import works
- [ ] Data used correctly
- [ ] Results accurate

#### Expected Result
Calculator uses account data.

### 4.2. Calculator with Transaction Data

**ID:** T-I002
**Priority:** Should
**Type:** Integration

#### Steps
1. Import rent expenses
2. Use as rent costs
3. Verify calculation
4. Create transactions
5. Verify updated

#### Validation
- [ ] Import works
- [ ] Data used correctly
- [ ] Total calculated

#### Expected Result
Calculator uses transaction data.

### 4.3. Calculator and Analytics

**ID:** T-I003
**Priority:** Should
**Type:** Integration

#### Steps
1. View analytics
2. Verify housing costs shown
3. Verify investment data

#### Validation
- [ ] Analytics includes housing
- [ ] Data accurate
- [ ] Charts include data

#### Expected Result
Analytics includes housing data.

### 4.4. Calculator and Dashboard

**ID:** T-I004
**Priority:** Should
**Type:** Integration

#### Steps
1. View Dashboard
2. Verify housing summary
3. Verify key metrics

#### Validation
- [ ] Dashboard shows housing info
- [ ] Metrics accurate
- [ ] Real-time updates

#### Expected Result
Dashboard includes housing info.

### 4.5. Tax Benefit Accuracy

**ID:** T-I005
**Priority:** Should
**Type:** Integration

#### Steps
1. View tax benefits
2. Verify calculations
3. Cross-check with standard tax rules

#### Validation
- [ ] Calculations accurate
- [ ] Deductions correct
- [ ] Total savings correct

#### Expected Result
Tax benefits are accurate.

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
3. Verify meets 100ms

#### Expected Result
Calculation is fast.

### 5.3. Chart Rendering

**ID:** T-P003
**Priority:** Must
**Type:** Performance

#### Steps
1. Load charts
2. Measure render time
3. Verify meets 300ms

#### Expected Result
Charts render quickly.

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

### 6.2. Chart Accessibility

**ID:** T-A002
**Priority:** Should
**Type:** Accessibility

#### Steps
1. Test with screen reader
2. Verify chart announced

#### Validation
- [ ] Chart type announced
- [ ] Data announced
- [ ] Tooltips announced

#### Expected Result
Chart is accessible.

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
- [ ] Recommendation is logical

## 9. Test Execution Notes

- Test with different home prices
- Verify tax calculations
- Test break-even point accuracy
- Test scenario comparison

## 10. Dependencies

- Backend /api/calculator/rent-buy may be used
- Auth system must be functional
- Chart library must be working