# Compound Interest Calculator Specification (Frontend)

**Module:** Compound Interest Calculator (UI)
**Version:** 2.0
**Status:** Active
**Priority:** Should

## 1. Overview

The Compound Interest Calculator allows users to project investment growth over time based on principal, interest rate, and contribution frequency.

## 2. Functional Requirements

### 2.1. Calculator Display

| ID | Description | Type |
|----|-------------|------|
| CIC-001 | Calculator interface must be accessible | Must |
| CIC-002 | Calculator must show input fields | Must |
| CIC-003 | Calculator must show result display | Must |
| CIC-004 | Calculator must show amortization chart | Must |
| CIC-005 | Calculator must show contribution schedule | Should |

### 2.2. Input Fields

| ID | Description | Type |
|----|-------------|------|
| CIC-010 | Principal amount input must be available | Must |
| CIC-011 | Annual interest rate input must be available | Must |
| CIC-012 | Monthly contribution input must be available | Must |
| CIC-013 | Contribution frequency must be selectable | Must |
| CIC-014 | Investment duration (years) input must be available | Must |
| CIC-015 | Contribution frequency options: Weekly, Biweekly, Monthly, Quarterly, Annually | Must |
| CIC-016 | Contribution type must be selectable (Fixed vs Variable) | Should |

### 2.3. Result Display

| ID | Description | Type |
|----|-------------|------|
| CIC-020 | Final amount must be displayed prominently | Must |
| CIC-021 | Total principal must be displayed | Must |
| CIC-022 | Total interest earned must be displayed | Must |
| CIC-023 | Total contributions must be displayed | Must |
| CIC-024 | Year-by-year breakdown must be shown | Should |
| CIC-025 | Growth percentage must be shown | Should |

### 2.4. Charts

| ID | Description | Type |
|----|-------------|------|
| CIC-030 | Growth chart must be displayed | Must |
| CIC-031 | Growth chart must be interactive | Must |
| CIC-032 | Chart must show principal curve and total curve | Must |
| CIC-033 | Chart must be responsive | Must |
| CIC-034 | Chart must support date range hover | Must |

### 2.5. Compare Scenarios

| ID | Description | Type |
|----|-------------|------|
| CIC-040 | Compare scenario button must be available | Should |
| CIC-041 | Compare must allow saving multiple scenarios | Should |
| CIC-042 | Compare must show side-by-side results | Should |
| CIC-043 | Compare must support comparing 2-3 scenarios | Should |

### 2.6. Reset

| ID | Description | Type |
|----|-------------|------|
| CIC-050 | Reset button must restore defaults | Must |

### 2.7. Navigation

| ID | Description | Type |
|----|-------------|------|
| CIC-080 | Calculator must be accessible from sidebar | Must |
| CIC-081 | Navigation must update URL hash | Must |
| CIC-082 | Browser back/forward must work | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | Calculation must complete within 50ms | 50ms |
| NFR-002 | Chart rendering must complete within 200ms | 200ms |

### 3.2. Usability

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-003 | Input validation must show clear errors | Must |
| NFR-004 | Results must be formatted clearly | Always |
| NFR-005 | Charts must be readable | Always |

### 3.3. Accessibility

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-006 | Charts must have accessible labels | Should |
| NFR-007 | Keyboard navigation must be supported | Always |

## 4. UI Components

### 4.1. Input Form

- Principal amount input (with currency picker)
- Annual interest rate input (with percentage)
- Monthly contribution input (with currency picker)
- Contribution frequency dropdown
- Duration (years) input
- Contribution type selector

### 4.2. Results Display

- Final amount (large, prominent)
- Total principal (formatted)
- Total interest earned (formatted)
- Total contributions (formatted)
- Growth percentage (formatted)
- Key metrics cards

### 4.3. Growth Chart

- Line chart showing growth over time
- Principal line (blue)
- Total value line (green)
- Interactive tooltips
- Responsive design

### 4.4. Comparison Panel

- Scenario list
- Toggle for showing/hiding scenarios
- Side-by-side view
- Merge scenarios button

### 4.5. Contribution Schedule

- Monthly table showing breakdown
- Principal, Interest, Total columns
- Scrollable container

## 5. User Flows

### 5.1. Calculate Growth

1. User enters principal amount
2. User enters annual interest rate
3. User enters monthly contribution
4. User selects contribution frequency
5. User enters investment duration
6. User clicks "Calculate"
7. System validates inputs
8. System calculates compound interest
9. System displays results
10. System renders growth chart

### 5.2. Compare Scenarios

1. User clicks "Compare Scenarios"
2. User enters parameters for first scenario
3. User saves scenario
4. User enters parameters for second scenario
5. User saves scenario
6. System displays comparison
7. System shows differences

### 5.3. Reset Calculator

1. User clicks "Reset" button
2. System restores default values
3. System recalculates with defaults

### 5.4. View Detailed Breakdown

1. User clicks "View Breakdown"
2. System shows monthly contribution schedule
3. System displays year-by-year growth
4. User can scroll through all data

## 6. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| Invalid input | System highlights errors |
| No contributions for period | System shows 0 contribution |
| Negative principal | System shows error |

## 7. Open/Closed Questions

1. Should calculator support variable contribution rates?
2. Should calculator support tax considerations?
3. Should calculator support inflation adjustment?
4. Should calculator support monthly vs annual compounding?

## 8. Acceptance Criteria

- [ ] User can calculate compound interest
- [ ] User can input all required parameters
- [ ] Results display correctly
- [ ] Charts render properly
- [ ] Input validation works
- [ ] Calculator loads quickly
- [ ] Mobile responsive

## 9. Integration Points

| Module | Purpose |
|--------|---------|
| Backend /api/calculator/compound-interest | Calculation API (optional, can be client-side) |

## 10. Standard Values

### Default Inputs

- Principal: $10,000
- Interest Rate: 7%
- Monthly Contribution: $100
- Frequency: Monthly
- Duration: 10 years

### Input Constraints

- Principal: $0 to $1,000,000
- Interest Rate: 0% to 30%
- Monthly Contribution: $0 to $10,000
- Duration: 1 to 50 years