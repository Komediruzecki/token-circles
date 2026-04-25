# Loans Specification (Frontend)

**Module:** Loans (UI)
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

The Loans module provides a complete interface for managing loans including viewing details, making payments, and tracking amortization.

## 2. Functional Requirements

### 2.1. Loan List

| ID | Description | Type |
|----|-------------|------|
| LO-001 | Loan list must display all loans | Must |
| LO-002 | List must show name, remaining balance, monthly payment | Must |
| LO-003 | List must show interest rate | Must |
| LO-004 | List must show total payments made | Must |
| LO-005 | List must show total payments remaining | Must |
| LO-006 | List must support filtering | Should |
| LO-007 | Loading state must display while fetching | Must |
| LO-008 | Empty state must display when no loans exist | Must |

### 2.2. Loan Display

| ID | Description | Type |
|----|-------------|------|
| LO-010 | Each loan must show name, remaining balance, monthly payment | Must |
| LO-011 | Loan must show interest rate | Must |
| LO-012 | Loan must show status (active, paid off) | Must |
| LO-013 | Loan must show term | Should |
| LO-014 | Loan must show account | Should |
| LO-015 | Loan must show icon | Should |

### 2.3. Create Loan

| ID | Description | Type |
|----|-------------|------|
| LO-020 | Add loan button must be visible | Must |
| LO-021 | Create loan form must accept all fields | Must |
| LO-022 | Form must include name, principal, annual rate, monthly payment, term | Must |
| LO-023 | Form must support account | Should |
| LO-024 | Form must support icon | Should |
| LO-025 | Form must support notes | Should |
| LO-026 | Form validation must prevent errors | Must |
| LO-027 | Loan must be created successfully | Must |
| LO-028 | Success message must display after creation | Must |
| LO-029 | Amortization must be calculated automatically | Must |

### 2.4. Edit Loan

| ID | Description | Type |
|----|-------------|------|
| LO-030 | Loan must be editable | Must |
| LO-031 | Edit button must be visible on each loan | Must |
| LO-032 | Edit form must pre-fill existing values | Must |
| LO-033 | Changes must update the loan | Must |
| LO-034 | Success message must display after update | Must |

### 2.5. Make Loan Payment

| ID | Description | Type |
|----|-------------|------|
| LO-040 | Add payment button must be visible | Must |
| LO-041 | Payment must reduce remaining balance | Must |
| LO-042 | Payment must show principal vs interest breakdown | Must |
| LO-043 | Payment must be recorded in history | Must |
| LO-044 | Success message must display | Must |

### 2.6. View Loan Details

| ID | Description | Type |
|----|-------------|------|
| LO-050 | Clicking loan must open details modal | Must |
| LO-051 | Details must show loan info | Must |
| LO-052 | Details must show amortization table | Must |
| LO-053 | Details must show payment history | Must |
| LO-054 | Details must show summary statistics | Must |

### 2.7. Amortization Table

| ID | Description | Type |
|----|-------------|------|
| LO-060 | Amortization table must show month, payment, interest, principal, balance | Must |
| LO-061 | Table must be scrollable | Must |
| LO-062 | Table must support viewing all months | Must |

### 2.8. Navigation

| ID | Description | Type |
|----|-------------|------|
| LO-080 | Loan list must be accessible from sidebar | Must |
| LO-081 | Navigation must update URL hash | Must |
| LO-082 | Browser back/forward must work | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | List load must complete within 100ms | 100ms |
| NFR-002 | Amortization calculation must complete within 200ms | 200ms |

### 3.2. Usability

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-003 | Form must be mobile-responsive | Always |
| NFR-004 | Amortization table must be readable | Always |
| NFR-005 | Summary stats must be prominent | Should |

### 3.3. Accessibility

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-006 | Tables must have accessible labels | Should |
| NFR-007 | Keyboard navigation must be supported | Always |

## 4. UI Components

### 4.1. Loan Cards

- Name, remaining balance, monthly payment
- Interest rate
- Status badge
- Edit and Delete buttons
- Summary stats on hover

### 4.2. Loan Form Modal

- Name input
- Principal amount input
- Annual interest rate input
- Monthly payment input
- Loan term (months) input
- Account dropdown
- Icon picker
- Notes textarea
- Submit and Cancel buttons

### 4.3. Loan Details Modal

- Loan information
- Summary statistics (total paid, interest paid)
- Amortization table
- Payment history
- Edit and Delete buttons

### 4.4. Amortization Table

- Month column
- Payment amount
- Interest portion
- Principal portion
- Remaining balance
- Scrollable container

## 5. User Flows

### 5.1. View Loans

1. User clicks "Loans" in sidebar
2. System loads loan list
3. System displays loan cards
4. System shows total loan amounts

### 5.2. Create Loan

1. User clicks "Add Loan" button
2. System opens creation modal
3. User fills in form
4. User clicks "Save"
5. System validates and saves
6. System calculates amortization
7. System closes modal and shows success
8. Loan appears in list

### 5.3. Make Payment

1. User opens loan details
2. User clicks "Add Payment" button
3. User enters payment amount and date
4. User confirms payment
5. System updates loan
6. System recalculates remaining balance
7. System shows success message

### 5.4. View Amortization

1. User opens loan details
2. System displays amortization table
3. User scrolls to view all months
4. User sees payment breakdown

### 5.5. Edit Loan

1. User clicks "Edit" on loan
2. System opens edit modal with existing values
3. User modifies fields
4. User clicks "Save"
5. System validates and updates
6. System shows success message

## 6. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| API returns error | System shows error message |
| Form validation fails | System highlights errors |
| API is unavailable | System shows offline message |
| No loans exist | System shows empty state with create button |
| Payment exceeds balance | System shows error message |

## 7. Open/Closed Questions

1. Should loans support refinancing?
2. Should loans support prepayments?
3. Should loans show payoff date?
4. Should loans support variable interest rates?

## 8. Acceptance Criteria

- [ ] User can view all loans
- [ ] User can create loans
- [ ] User can edit loans
- [ ] User can delete loans
- [ ] User can make payments
- [ ] User can view amortization
- [ ] Loans load quickly
- [ ] Mobile responsive
- [ ] Calculations are accurate

## 9. Integration Points

| Module | Purpose |
|--------|---------|
| Backend /api/loans | Data source |
| Backend /api/accounts | Account dropdown |

## 10. Loan Status Types

- Active
- Paid Off