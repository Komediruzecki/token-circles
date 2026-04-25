# E2E Test Specification - Compound Interest Calculator

**Module:** Compound Interest Calculator
**Test Suite:** Frontend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Compound Interest Calculator, covering calculations, projections, and scenario comparisons.

## 2. Test Scenarios

### 2.1. View Calculator

**ID:** T-001
**Priority:** Must
**Type:** Smoke

#### Steps
1. Navigate to "Compound Interest" module
2. Verify calculator interface
3. Verify input fields

#### Validation
- [ ] Calculator page renders
- [ ] Input fields visible
- [ ] Result display visible
- [ ] Charts visible

#### Expected Result
User sees compound interest calculator.

### 2.2. Calculate Growth

**ID:** T-002
**Priority:** Must
**Type:** Positive

#### Steps
1. Enter principal: $10000
2. Enter annual interest rate: 7%
3. Enter monthly contribution: $100
4. Select frequency: Monthly
5. Enter duration: 10 years
6. Click "Calculate"
7. Verify results
8. Verify growth chart

#### Validation
- [ ] Calculator responds
- [ ] Results display
- [ ] Final amount correct
- [ ] Charts render
- [ ] Tooltip works

#### Expected Result
Calculation completes and results display.

### 2.3. View Breakdown

**ID:** T-003
**Priority:** Must
**Type:** Positive

#### Steps
1. Click "View Breakdown"
2. Verify monthly table
3. Verify year-by-year data
4. Verify scrollable

#### Validation
- [ ] Breakdown visible
- [ ] Data table renders
- [ ] Scrollable
- [ ] All data shown

#### Expected Result
Breakdown displayed with details.

### 2.4. Compare Scenarios

**ID:** T-004
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

### 2.5. Reset Calculator

**ID:** T-005
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

### 2.6. Change Contribution Frequency

**ID:** T-006
**Priority:** Must
**Type:** Positive

#### Steps
1. Change from monthly to yearly
2. Recalculate
3. Verify results change

#### Validation
- [ ] Frequency dropdown works
- [ ] Results update
- [ ] Formula applied correctly

#### Expected Result
Frequency changes affect results.

### 2.7. View Details on Chart

**ID:** T-007
**Priority:** Should
**Type:** Positive

#### Steps
1. Hover over chart
2. Verify tooltip
3. Click data point
4. Verify details

#### Validation
- [ ] Tooltip shows data
- [ ] Hover works
- [ ] Click shows details

#### Expected Result
Chart interactions work.

### 2.8. Mobile Responsive

**ID:** T-008
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

### 2.9. Empty State

**ID:** T-009
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

### 2.10. Toast Notifications

**ID:** T-010
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

### 3.1. Invalid Principal

**ID:** T-N001
**Priority:** Must
**Type:** Negative

#### Steps
1. Enter negative principal
2. Verify error

#### Expected Result
Negative principal rejected.

### 3.2. Invalid Interest Rate

**ID:** T-N002
**Priority:** Must
**Type:** Negative

#### Steps
1. Enter invalid interest rate
2. Verify error

#### Expected Result
Invalid rate rejected.

### 3.3. Invalid Duration

**ID:** T-N003
**Priority:** Must
**Type:** Negative

#### Steps
1. Enter invalid duration
2. Verify error

#### Expected Result
Invalid duration rejected.

### 3.4. Invalid Contribution

**ID:** T-N004
**Priority:** Must
**Type:** Negative

#### Steps
1. Enter negative contribution
2. Verify error

#### Expected Result
Negative contribution rejected.

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
2. Use as principal
3. Verify calculation

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
1. Import monthly contributions
2. Use as contributions
3. Verify results

#### Validation
- [ ] Import works
- [ ] Data used correctly
- [ ] Total calculated

#### Expected Result
Calculator uses transaction data.

### 4.3. Calculator with Settings

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

### 4.4. Calculator and Export

**ID:** T-I004
**Priority:** Should
**Type:** Integration

#### Steps
1. Calculate results
2. Export as PDF
3. Verify download

#### Validation
- [ ] Export works
- [ ] File contains data
- [ ] Formatting correct

#### Expected Result
Calculator results can be exported.

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

### 5.3. Chart Rendering

**ID:** T-P003
**Priority:** Must
**Type:** Performance

#### Steps
1. Load chart
2. Measure render time
3. Verify meets 200ms

#### Expected Result
Chart renders quickly.

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

## 9. Test Execution Notes

- Test with standard values
- Verify break-down table accuracy
- Test scenario comparison
- Test export functionality

## 10. Dependencies

- Backend /api/calculator/compound-interest may be used
- Auth system must be functional
- Chart library must be working