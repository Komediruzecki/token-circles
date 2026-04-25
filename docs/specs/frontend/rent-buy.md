# Rent vs Buy Calculator Specification (Frontend)

**Module:** Rent vs Buy Calculator (UI)
**Version:** 2.0
**Status:** Active
**Priority:** Should

## 1. Overview

The Rent vs Buy Calculator compares the financial impact of renting versus buying a home to help users make informed housing decisions.

## 2. Functional Requirements

### 2.1. Calculator Display

| ID | Description | Type |
|----|-------------|------|
| RBC-001 | Calculator interface must be accessible | Must |
| RBC-002 | Calculator must show input fields | Must |
| RBC-003 | Calculator must show comparison results | Must |
| RBC-004 | Calculator must show visual comparison | Must |
| RBC-005 | Calculator must show cash flow comparison | Should |

### 2.2. Home Purchase Inputs

| ID | Description | Type |
|----|-------------|------|
| RBC-010 | Home price input must be available | Must |
| RBC-011 | Down payment percentage input must be available | Must |
| RBC-012 | Down payment amount input must be available | Must |
| RBC-013 | Interest rate input must be available | Must |
| RBC-014 | Loan term input must be available | Must |
| RBC-015 | Property tax rate input must be available | Must |
| RBC-016 | Home insurance input must be available | Must |
| RBC-017 | Home maintenance input must be available | Must |
| RBC-018 | Home value appreciation must be available | Must |
| RBC-019 | Closing costs input must be available | Must |

### 2.3. Renting Inputs

| ID | Description | Type |
|----|-------------|------|
| RBC-020 | Monthly rent input must be available | Must |
| RBC-021 | Rent increase input must be available | Must |
| RBC-022 | Security deposit input must be available | Must |
| RBC-023 | Renter's insurance input must be available | Must |
| RBC-024 | Tax benefits of renting must be calculated | Must |

### 2.4. Time Horizon Inputs

| ID | Description | Type |
|----|-------------|------|
| RBC-030 | Time horizon (years) input must be available | Must |
| RBC-031 | Investment options input must be available | Must |
| RBC-032 | Investment return input must be available | Must |
| RBC-033 | Investment risk tolerance must be available | Must |

### 2.5. Comparison Results

| ID | Description | Type |
|----|-------------|------|
| RBC-040 | Total cost over time must be displayed | Must |
| RBC-041 | Net worth comparison must be displayed | Must |
| RBC-042 | Monthly cash flow comparison must be displayed | Must |
| RBC-043 | Break-even point must be calculated | Must |
| RBC-044 | Total savings (rent vs buy) must be displayed | Must |
| RBC-045 | Monthly payment comparison must be displayed | Must |
| RBC-046 | Lump sum comparison must be displayed | Should |

### 2.6. Visual Comparison

| ID | Description | Type |
|----|-------------|------|
| RBC-050 | Line chart comparing costs over time must be displayed | Must |
| RBC-051 | Bar chart comparing net worth must be displayed | Must |
| RBC-052 | Break-even point must be marked on chart | Must |
| RBC-053 | Charts must be interactive | Must |
| RBC-054 | Charts must be responsive | Must |

### 2.7. Analysis

| ID | Description | Type |
| ---- |-------------| ---- |
| RBC-060 | Scenario summary must be displayed | Must |
| RBC-061 | Recommendation based on criteria must be shown | Must |
| RBC-062 | Tax benefits of buying must be calculated | Must |
| RBC-063 | Property tax deduction must be shown | Should |
| RBC-064 | Mortgage interest deduction must be shown | Should |
| RBC-065 | Opportunity cost analysis must be shown | Should |

### 2.8. Navigation

| ID | Description | Type |
|----|-------------|------|
| RBC-080 | Calculator must be accessible from sidebar | Must |
| RBC-081 | Navigation must update URL hash | Must |
| RBC-082 | Browser back/forward must work | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | Calculation must complete within 100ms | 100ms |
| NFR-002 | Chart rendering must complete within 300ms | 300ms |

### 3.2. Usability

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-003 | Input validation must show clear errors | Must |
| NFR-004 | Results must be formatted clearly | Always |
| NFR-005 | Charts must be readable | Always |
| NFR-006 | Comparison must be easy to understand | Always |

### 3.3. Accessibility

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-007 | Charts must have accessible labels | Should |
| NFR-008 | Keyboard navigation must be supported | Always |

## 4. UI Components

### 4.1. Purchase Tab

- Home price input
- Down payment percentage/input
- Interest rate input
- Loan term dropdown
- Property tax rate
- Home insurance
- Home maintenance
- Home value appreciation
- Closing costs

### 4.2. Rent Tab

- Monthly rent input
- Rent increase percentage
- Security deposit
- Renter's insurance
- Tax benefits display

### 4.3. Investment Tab

- Time horizon input
- Investment options
- Expected return
- Risk tolerance

### 4.4. Results Panel

- Total cost over time (formatted)
- Net worth comparison (formatted)
- Monthly cash flow comparison (formatted)
- Break-even point (formatted)
- Total savings (formatted)
- Recommendation badge
- Key metrics cards

### 4.5. Charts

- Line chart: Total cost comparison over time
- Line chart: Net worth comparison over time
- Bar chart: Monthly payment comparison
- All charts with tooltips

### 4.6. Tax Breakdown

- Property tax deduction amount
- Mortgage interest deduction amount
- Total tax savings
- Tax benefits summary

### 4.7. Breakdown Table

- Year-by-year cost comparison
- Cumulative costs for both options
- Net worth at each year
- Break-even indicator

## 5. User Flows

### 5.1. Run Comparison

1. User switches to Purchase tab
2. User enters home purchase details
3. User switches to Rent tab
4. User enters rent details
5. User switches to Investment tab
6. User enters investment details
7. User clicks "Calculate"
8. System validates inputs
9. System calculates costs over time
10. System calculates net worth
11. System calculates break-even
12. System displays results
13. System renders charts

### 5.2. View Tax Benefits

1. User clicks "Tax Benefits"
2. System shows property tax deduction
3. System shows mortgage interest deduction
4. System calculates total tax savings
5. System updates comparison

### 5.3. View Break-even

1. User views results panel
2. System shows break-even point
3. User clicks for details
4. System shows breakdown

### 5.4. View Detailed Breakdown

1. User clicks "View Breakdown"
2. System shows year-by-year comparison
3. User scrolls through years
4. User sees cumulative costs

### 5.5. Adjust Inputs

1. User modifies input field
2. System recalculates in real-time
3. System updates charts
4. System updates results

## 6. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| Invalid input | System highlights errors |
| Down payment insufficient | System shows error |
| Interest rate too high | System shows warning |
| Break-even beyond time horizon | System shows note |

## 7. Open/Closed Questions

1. Should calculator support custom property taxes?
2. Should calculator account for HOA fees?
3. Should calculator support home improvements?
4. Should calculator account for selling costs?
5. Should calculator support different down payment scenarios?

## 8. Acceptance Criteria

- [ ] User can calculate rent vs buy comparison
- [ ] User can input purchase and rent details
- [ ] User can input investment parameters
- [ ] Results display correctly
- [ ] Charts render properly
- [ ] Tax benefits are calculated
- [ ] Break-even is shown
- [ ] Recommendation is provided
- [ ] Comparison works quickly
- [ ] Mobile responsive

## 9. Integration Points

| Module | Purpose |
|--------|---------|
| Backend /api/calculator/rent-buy | Calculation API (optional) |

## 10. Standard Values

### Default Purchase Inputs

- Home Price: $300,000
- Down Payment: 20%
- Interest Rate: 7.0%
- Loan Term: 30 years
- Property Tax Rate: 1.2%
- Home Insurance: $2,000/year
- Home Maintenance: 1% of home value/year
- Appreciation: 3% annually
- Closing Costs: $6,000

### Default Rent Inputs

- Monthly Rent: $1,500
- Rent Increase: 3% annually
- Security Deposit: $1,500
- Renter's Insurance: $200/year

### Default Investment Inputs

- Time Horizon: 5 years
- Investment Return: 7%
- Risk Tolerance: Moderate

### Common Assumptions

- Rent increases are linear (actual varies by market)
- Home appreciation is compounded annually
- Property tax is proportional to home value
- Mortgage interest deduction has phase-out limits
- Investment returns are compounded annually

## 11. Output Metrics

### Net Worth Comparison

- Home equity (for buying)
- Investments (for renting)
- Rent paid (for renting)
- Tax savings (for buying)

### Key Metrics

- Total cost over time
- Break-even point (years to recoup costs)
- Net savings (rent vs buy)
- Monthly payment difference
- Cash flow impact

### Recommendation Criteria

- **Buy if**: Net savings negative over time horizon, building equity
- **Rent if**: Net savings positive over time horizon, flexibility
- **Neutral if**: Break-even at end of time horizon, similar outcomes

### Tax Considerations

- Property tax deduction (typically 100% deductible)
- Mortgage interest deduction (phase-out at $100,000 income)
- Standard deduction vs itemized deduction

## 12. Common Calculations

### Monthly Mortgage Payment

```
M = P[r(1+r)^n] / [(1+r)^n - 1]
```

Where:
- P = Principal (Home price - Down payment)
- r = Monthly interest rate
- n = Total number of payments

### Total Interest

Sum of all interest payments over loan term

### Monthly Property Tax

Annual property tax / 12

### Monthly Maintenance

Annual maintenance / 12

### Monthly Home Insurance

Annual insurance / 12

### Closing Costs

Non-recoverable costs at purchase

### Rent Increases

Monthly rent × (1 + annual increase)^year