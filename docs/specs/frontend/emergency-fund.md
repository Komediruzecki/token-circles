# Emergency Fund Calculator Specification (Frontend)

**Module:** Emergency Fund Calculator (UI)
**Version:** 2.0
**Status:** Active
**Priority:** Should

## 1. Overview

The Emergency Fund Calculator helps users determine their emergency fund target and track progress toward building it.

## 2. Functional Requirements

### 2.1. Calculator Display

| ID | Description | Type |
|----|-------------|------|
| EFC-001 | Calculator interface must be accessible | Must |
| EFC-002 | Calculator must show input fields | Must |
| EFC-003 | Calculator must show result display | Must |
| EFC-004 | Calculator must show progress visualization | Must |
| EFC-005 | Calculator must show savings timeline | Should |

### 2.2. Input Fields

| ID | Description | Type |
|----|-------------|------|
| EFC-010 | Monthly expenses input must be available | Must |
| EFC-011 | Comfort level input must be available | Must |
| EFC-012 | Current emergency fund input must be available | Must |
| EFC-013 | Comfort level options: 3 months, 6 months, 9 months, 12 months, custom | Must |
| EFC-014 | Monthly savings rate input must be available | Must |
| EFC-015 | Current savings rate must be calculated automatically | Must |
| EFC-016 | Account selection must be available | Should |

### 2.3. Result Display

| ID | Description | Type |
|----|-------------|------|
| EFC-020 | Emergency fund target must be displayed | Must |
| EFC-021 | Current savings must be displayed | Must |
| EFC-022 | Amount needed must be displayed | Must |
| EFC-023 | Time to reach target must be calculated | Must |
| EFC-024 | Monthly savings required must be displayed | Must |
| EFC-025 | Progress percentage must be shown | Must |
| EFC-026 | Monthly savings difference must be shown | Should |

### 2.4. Progress Visualization

| ID | Description | Type |
|----|-------------|------|
| EFC-030 | Progress bar must be displayed | Must |
| EFC-031 | Progress bar must be color-coded by stage | Should |
| EFC-032 | Milestone indicators must be shown | Should |
| EFC-033 | Milestones: 1 month, 3 months, 6 months, 9 months, 12 months | Should |

### 2.5. Timeline Display

| ID | Description | Type |
|----|-------------|------|
| EFC-040 | Savings timeline must be displayed | Must |
| EFC-041 | Timeline must show monthly savings target | Must |
| EFC-042 | Timeline must show expected completion date | Must |
| EFC-043 | Timeline must be interactive | Should |

### 2.6. Auto-Import

| ID | Description | Type |
|----|-------------|------|
| EFC-050 | Monthly expenses must be imported from transactions | Should |
| EFC-051 | Current savings must be calculated from accounts | Should |

### 2.7. Navigation

| ID | Description | Type |
|----|-------------|------|
| EFC-080 | Calculator must be accessible from sidebar | Must |
| EFC-081 | Navigation must update URL hash | Must |
| EFC-082 | Browser back/forward must work | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | Calculation must complete within 50ms | 50ms |
| NFR-002 | Progress bar animation must complete within 300ms | 300ms |

### 3.2. Usability

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-003 | Results must be formatted clearly | Always |
| NFR-004 | Timeline must be readable | Always |
| NFR-005 | Progress bar must be prominent | Must |

### 3.3. Accessibility

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-006 | Charts must have accessible labels | Should |
| NFR-007 | Keyboard navigation must be supported | Always |

## 4. UI Components

### 4.1. Input Form

- Monthly expenses input (with currency picker)
- Comfort level dropdown (3, 6, 9, 12 months)
- Current emergency fund input (with currency picker)
- Monthly savings rate input (with currency picker)
- Import transactions button
- Import accounts button

### 4.2. Results Display

- Emergency fund target (large, prominent)
- Current savings (formatted)
- Amount needed (formatted)
- Time to reach target (formatted)
- Monthly savings required (formatted)
- Progress percentage (formatted)
- Key metrics cards

### 4.3. Progress Visualization

- Large progress bar
- Color-coded stages (3-month, 6-month, 9-month, 12-month milestones)
- Percentage display
- Milestone indicators

### 4.4. Timeline

- Visual timeline showing savings progression
- Expected completion date
- Monthly contribution target
- Interactive hover details

### 4.5. Recommendations

- Calculate optimal savings rate
- Show timeline adjustments
- Suggest priority expenses to reduce

## 5. User Flows

### 5.1. Calculate Emergency Fund

1. User enters monthly expenses
2. User selects comfort level (6 months)
3. User enters current savings
4. User enters monthly savings rate
5. System calculates target amount
6. System calculates time to reach target
7. System displays results
8. System renders progress bar
9. System renders timeline

### 5.2. Auto-Import Data

1. User clicks "Import Expenses"
2. System fetches transactions
3. System calculates average monthly expenses
4. System fills monthly expenses input
5. User confirms or adjusts values

### 5.3. View Progress

1. User views progress bar
2. System shows current progress percentage
3. User clicks on milestones for details

### 5.4. Calculate Savings Rate

1. User enters monthly savings rate
2. System compares with required rate
3. System shows recommendation
4. User can adjust savings rate

### 5.5. Customize Target

1. User selects custom comfort level
2. User enters custom months
3. System recalculates target
4. System updates timeline

## 6. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| No expenses data | System prompts user to enter manually |
| Current savings exceeds target | System shows you're fully funded |
| Monthly savings rate negative | System shows error message |

## 7. Open/Closed Questions

1. Should calculator support different account types?
2. Should calculator account for variable income?
3. Should calculator suggest savings strategies?
4. Should calculator show emergency fund vs debt payoff comparison?

## 8. Acceptance Criteria

- [ ] User can calculate emergency fund target
- [ ] User can input all required parameters
- [ ] Results display correctly
- [ ] Progress visualization works
- [ ] Timeline renders properly
- [ ] Auto-import features work
- [ ] Calculator loads quickly
- [ ] Mobile responsive

## 9. Integration Points

| Module | Purpose |
|--------|---------|
| Backend /api/transactions | Expense data import |
| Backend /api/accounts | Current savings calculation |
| Backend /api/calculator/emergency-fund | Calculation API (optional) |

## 10. Standard Values

### Default Inputs

- Comfort Level: 6 months
- Monthly Expenses: Calculated from user's transactions
- Current Emergency Fund: $0
- Monthly Savings Rate: User input

### Comfort Level Options

- 3 months: Basic coverage for minor emergencies
- 6 months: Recommended minimum
- 9 months: Conservative approach
- 12 months: Comprehensive coverage
- Custom: User-defined months