# Calculator Specification

**Module:** Calculator
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

Calculator module provides financial calculations for loans, retirement, compound interest, and emergency funds.

## 2. Functional Requirements

### 2.1. Calculator Types

| ID | Description | Type |
|----|-------------|------|
| C-001 | Compound Interest calculator must be supported | Must |
| C-002 | Retirement calculator must be supported | Must |
| C-003 | Emergency Fund calculator must be supported | Must |

### 2.2. Compound Interest Calculator

| ID | Description | Type |
|----|-------------|------|
| CC-001 | Calculate compound interest must return summary | Must |
| CC-002 | Input must include principal, rate, time, compounding | Must |
| CC-003 | Output must show total amount, interest earned | Must |
| CC-004 | Output must show year-by-year breakdown | Must |
| CC-005 | Output must show chart data | Should |

### 2.3. Retirement Calculator

| ID | Description | Type |
|----|-------------|------|
| CR-001 | Calculate retirement must return summary | Must |
| CR-002 | Input must include savings rate, current balance, age, retirement age | Must |
| CR-003 | Output must show projected balance | Must |
| CR-004 | Output must show monthly contribution | Must |
| CR-005 | Output must show years to retirement | Must |
| CR-006 | Output must show what if scenarios | Should |

### 2.4. Emergency Fund Calculator

| ID | Description | Type |
| ---- |------------- |------ |
| CE-001 | Calculate emergency fund must return requirements | Must |
| CE-002 | Input must include monthly expenses | Must |
| CE-003 | Output must show recommended fund amount | Must |
| CE-004 | Output must show monthly savings needed | Must |
| CE-005 | Output must show timeline to reach goal | Should |

### 2.5. Results

| ID | Description | Type |
|----|-------------|------|
| C-050 | Results must be returned as JSON | Must |
| C-051 | Results must include visualizations | Should |
| C-052 | Results must support comparison | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | Calculate must complete within 100ms | 100ms |
| NFR-002 | Year-by-year breakdown must complete within 200ms | 200ms |

### 3.2. Data Consistency

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-003 | Calculations must be accurate | Always |

### 3.3. Security

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-004 | Calculator access must not require authentication | Always |

## 4. API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/calculator/compound-interest` | POST | Calculate compound interest |
| `/api/calculator/retire` | POST | Calculate retirement |
| `/api/calculator/emergency-fund` | POST | Calculate emergency fund |

## 5. Data Models

**CompoundInterestInput:**
- `principal: number` - Initial investment
- `monthlyContribution: number` - Monthly contribution (optional)
- `annualRate: number` - Annual interest rate (percentage)
- `years: number` - Investment period in years

**CompoundInterestResult:**
- `totalAmount: number` - Final amount
- `totalInterest: number` - Total interest earned
- `principal: number` - Principal amount
- `monthlyContribution: number` - Total contributions
- `breakdown: YearBreakdown[]` - Year-by-year breakdown

**YearBreakdown:**
- `year: number` - Year number
- `total: number` - Total amount
- `interest: number` - Interest earned
- `contribution: number` - Total contributions

**RetirementInput:**
- `currentAge: number` - Current age
- `retirementAge: number` - Target retirement age
- `currentBalance: number` - Current savings balance
- `monthlyContribution: number` - Monthly savings amount
- `annualReturn: number` - Expected annual return (percentage)

**RetirementResult:**
- `retirementAge: number` - Retirement age
- `retirementDate: ISO8601` - Retirement date
- `finalBalance: number` - Projected balance at retirement
- `totalContributions: number` - Total contributions made
- `totalInterest: number` - Total interest earned
- `yearsToRetire: number` - Years until retirement
- `monthlyContribution: number` - Required monthly contribution
- `scenarios: RetirementScenario[]` - Alternative scenarios (optional)

**RetirementScenario:**
- `monthlyContribution: number` - Scenario contribution
- `annualReturn: number` - Scenario return rate
- `finalBalance: number` - Final balance
- `totalContributions: number` - Total contributions

**EmergencyFundInput:**
- `monthlyExpenses: number[]` - Monthly expenses array
- `monthsToCover: number` - Months to cover (default: 6)
- `savingsRate: number` - Savings rate (percentage)

**EmergencyFundResult:**
- `recommendedAmount: number` - Recommended fund amount
- `monthlyExpenses: number` - Monthly expenses
- `monthsToCover: number` - Months covered
- `monthlySavingsNeeded: number` - Monthly savings required
- `timeline: number[]` - Months to reach goal

## 6. User Flows

### 6.1. Calculate Compound Interest

1. User opens Compound Interest page
2. User enters principal, monthly contribution, rate, years
3. User clicks "Calculate" button
4. System validates input
5. System calculates compound interest
6. System displays results
7. System shows chart

### 6.2. Calculate Retirement

1. User opens Retirement calculator
2. User enters current age, retirement age, current balance, monthly contribution
3. User clicks "Calculate" button
4. System validates input
5. System calculates retirement projection
6. System displays results
7. System shows timeline

### 6.3. Calculate Emergency Fund

1. User opens Emergency Fund calculator
2. User enters monthly expenses and months to cover
3. User clicks "Calculate" button
4. System validates input
5. System calculates recommended amount
6. System displays results
7. System shows savings timeline

### 6.4. Compare Scenarios

1. User views retirement results
2. User clicks "What If" scenarios
3. User modifies contribution or return rate
4. System recalculates
5. System compares scenarios

## 7. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| Invalid input values | Return 400 with error message |
| Negative values | Return 400 with error message |
| Missing required fields | Return 400 with error message |

## 8. Open/Closed Questions

1. Should calculators support more complex scenarios?
2. Should calculators save calculations to history?
3. Should calculators support exports?
4. Should calculators support multiple profiles?

## 9. Acceptance Criteria

- [ ] Compound Interest calculator works correctly
- [ ] Retirement calculator works correctly
- [ ] Emergency Fund calculator works correctly
- [ ] Calculations are accurate
- [ ] Results are displayed clearly
- [ ] Charts display correctly
- [ ] Invalid input is rejected

## 10. Dependencies

| Module | Purpose |
|--------|---------|
| None | Standalone calculations |