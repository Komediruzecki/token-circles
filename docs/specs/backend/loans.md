# Loans Specification

**Module:** Loans
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

Loans represent debts with interest calculations, payments, and amortization tracking.

## 2. Functional Requirements

### 2.1. CRUD Operations

| ID | Description | Type |
|----|-------------|------|
| L-001 | Get all loans must return list of loans | Must |
| L-002 | Get single loan by ID must return loan data | Must |
| L-003 | Create loan must validate required fields | Must |
| L-004 | Create loan must return newly created loan | Must |
| L-005 | Update loan must allow updating loan data | Must |
| L-006 | Update loan must return updated loan | Must |
| L-007 | Delete loan must remove loan | Must |
| L-008 | Calculate loan amortization must be supported | Must |

### 2.2. Loan Data

| ID | Description | Type |
|----|-------------|------|
| L-010 | Loan must have required fields (name, principal, annualRate) | Must |
| L-011 | Loan must have principal amount | Must |
| L-012 | Loan must have annual interest rate | Must |
| L-013 | Loan must have monthly payment amount | Must |
| L-014 | Loan must have remaining balance | Must |
| L-015 | Loan must have total payments made | Must |
| L-016 | Loan must have total payments remaining | Must |
| L-017 | Loan must have term in months | Must |
| L-018 | Loan must have account for payment | Must |
| L-019 | Loan must have icon | Should |
| L-020 | Loan must support additional payments (prepayments) | Should |
| L-021 | Loan must support interest rate changes | Should |

### 2.3. Loan Calculation

| ID | Description | Type |
|----|-------------|------|
| L-030 | Calculate monthly payment must use standard formula | Must |
| L-031 | Calculate amortization schedule must be supported | Must |
| L-032 | Prepayments must reduce principal and interest | Should |
| L-033 | Rate changes must update calculations | Should |

### 2.4. Loan History

| ID | Description | Type |
|----|-------------|------|
| L-040 | Loan must track payment history | Must |
| L-041 | Payment history must show date, amount, principal, interest | Must |
| L-042 | Amortization table must be available | Must |
| L-043 | Prepayments must be tracked | Should |
| L-044 | Rate changes must be tracked | Should |

### 2.5. Loan Management

| ID | Description | Type |
|----|-------------|------|
| L-050 | Add payment must update loan status | Must |
| L-051 | Add prepayment must reduce balance | Should |
| L-052 | Update rate must recalculate future payments | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | Get all loans must complete within 100ms | 100ms |
| NFR-002 | Calculate loan must complete within 100ms | 100ms |
| NFR-003 | Create loan must complete within 50ms | 50ms |

### 3.2. Data Consistency

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-003 | Loan calculations must be accurate | Always |
| NFR-004 | Payment history must be accurate | Always |

### 3.3. Security

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-005 | Loan access must be scoped to user | Always |

## 4. API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/loans` | GET | Get all loans |
| `/api/loans` | POST | Create new loan |
| `/api/loans/:id` | GET | Get single loan |
| `/api/loans/:id` | PUT | Update loan |
| `/api/loans/:id` | DELETE | Delete loan |
| `/api/loans/:id/calculate` | POST | Calculate loan amortization |
| `/api/loans/:id/prepayments` | POST | Add prepayment |
| `/api/loans/:id/prepayments/:prepayId` | DELETE | Remove prepayment |
| `/api/loans/:id/rates` | POST | Add interest rate change |
| `/api/loans/:id/rates/:rateId` | DELETE | Remove interest rate change |

## 5. Data Models

**Loan:**
- `id: string` - Loan UUID
- `name: string` - Loan name
- `principal: number` - Loan principal amount
- `annualRate: number` - Annual interest rate (percentage)
- `monthlyPayment: number` - Scheduled monthly payment
- `remainingBalance: number` - Remaining principal balance
- `totalPaymentsMade: number` - Number of payments made
- `totalPaymentsRemaining: number` - Number of payments remaining
- `totalPayments: number` - Total payments for loan
- `account: string` - Account for payments
- `icon: string` - Loan icon (optional)
- `notes: string` - Loan notes (optional)
- `createdAt: ISO8601` - Creation timestamp
- `updatedAt: ISO8601` - Last update timestamp

**LoanPayment:**
- `id: string` - Payment UUID
- `loanId: string` - Associated loan ID
- `date: ISO8601` - Payment date
- `amount: number` - Payment amount
- `principal: number` - Principal portion
- `interest: number` - Interest portion

**LoanAmortization:**
- `month: number` - Payment number
- `date: ISO8601` - Scheduled date
- `payment: number` - Payment amount
- `principal: number` - Principal reduction
- `interest: number` - Interest charged
- `balance: number` - Remaining balance

**Prepayment:**
- `id: string` - Prepayment UUID
- `loanId: string` - Associated loan ID
- `date: ISO8601` - Prepayment date
- `amount: number` - Prepayment amount
- `principal: number` - Principal applied

**RateChange:**
- `id: string` - Rate change UUID
- `loanId: string` - Associated loan ID
- `effectiveDate: ISO8601` - Effective date
- `newRate: number` - New interest rate

## 6. User Flows

### 6.1. Create Loan

1. User opens Loans page
2. User clicks "Add Loan" button
3. Modal displays loan creation form
4. User enters required fields (name, principal, annual rate, monthly payment, term in months)
5. User selects optional fields (account, icon, notes)
6. System validates input
7. System calculates amortization schedule
8. System creates loan
9. System returns loan with confirmation

### 6.2. View Loan Amortization

1. User selects loan
2. User clicks "Amortization" tab
3. System displays amortization table
4. System shows monthly breakdown

### 6.3. Add Loan Payment

1. User opens loan details
2. User clicks "Add Payment" button
3. User enters payment amount and date
4. User confirms payment
5. System updates loan
6. System recalculates remaining balance
7. System returns updated loan

### 6.4. Delete Loan

1. User selects loan to delete
2. User confirms deletion
3. System deletes loan
4. System returns success confirmation

## 7. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| Loan name already exists | Return 400 with error message |
| Loan ID not found | Return 404 Not Found |
| Principal cannot be negative | Return 400 with error message |
| Interest rate invalid | Return 400 with error message |
| Payment amount exceeds balance | Return 400 with error message |

## 8. Open/Closed Questions

1. Should loans support refinancing?
2. Should loans support balloon payments?
3. Should loans support payment skipping?
4. Should loans support multiple interest rate types (fixed, variable)?

## 9. Acceptance Criteria

- [ ] User can create multiple loans
- [ ] User can view all loans
- [ ] User can update loan details
- [ ] User can delete loans
- [ ] Loan amortization is calculated correctly
- [ ] Payment history is accurate
- [ ] Prepayments reduce balance correctly
- [ ] Rate changes are handled correctly
- [ ] Loans are scoped to user
- [ ] Loan calculations are accurate