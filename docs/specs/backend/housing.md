# Housing Specification

**Module:** Housing
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

Housing module tracks mortgage/rent properties, payments, and mortgage-specific calculations.

## 2. Functional Requirements

### 2.1. CRUD Operations

| ID | Description | Type |
|----|-------------|------|
| H-001 | Get all housing must return list of housing entries | Must |
| H-002 | Get single housing by ID must return housing data | Must |
| H-003 | Create housing must validate required fields | Must |
| H-004 | Create housing must return newly created housing | Must |
| H-005 | Update housing must allow updating housing data | Must |
| H-006 | Update housing must return updated housing | Must |
| H-007 | Delete housing must remove housing | Must |

### 2.2. Housing Data

| ID | Description | Type |
|----|-------------|------|
| H-010 | Housing must have required fields (name, type) | Must |
| H-011 | Housing type must be 'rent' or 'mortgage' | Must |
| H-012 | Housing must have monthly payment amount | Must |
| H-013 | Housing must have total amount (mortgage principal) | Must |
| H-014 | Housing must have interest rate (mortgage) | Must |
| H-015 | Housing must have down payment (mortgage) | Should |
| H-016 | Housing must have loan term (mortgage) | Should |
| H-017 | Housing must have status (active, paid off, paid ahead) | Should |
| H-018 | Housing must support additional payments | Should |

### 2.3. Mortgage Calculations

| ID | Description | Type |
|----|-------------|------|
| H-030 | Calculate monthly mortgage payment must be supported | Must |
| H-031 | Calculate mortgage amortization must be supported | Must |
| H-032 | Calculate remaining balance must be supported | Must |

### 2.4. Rental Tracking

| ID | Description | Type |
|----|-------------|------|
| H-040 | Rental properties must track monthly rent | Must |
| H-041 | Rental properties must track payment history | Must |
| H-042 | Rental properties must show overdue amounts | Should |

### 2.5. Housing Analysis

| ID | Description | Type |
|----|-------------|------|
| H-050 | Compare monthly housing costs must be supported | Should |
| H-051 | Show housing as percentage of income must be supported | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | Get all housing must complete within 100ms | 100ms |
| NFR-002 | Calculate mortgage must complete within 100ms | 100ms |

### 3.2. Data Consistency

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-003 | Calculations must be accurate | Always |
| NFR-004 | Payment history must be accurate | Always |

### 3.3. Security

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-005 | Housing access must be scoped to user | Always |

## 4. API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/housing` | GET | Get all housing |
| `/api/housing` | POST | Create new housing |
| `/api/housing/:id` | GET | Get single housing |
| `/api/housing/:id` | PUT | Update housing |
| `/api/housing/:id` | DELETE | Delete housing |

## 5. Data Models

**Housing:**
- `id: string` - Housing UUID
- `name: string` - Housing name (e.g., "Main Home")
- `type: string` - Type (rent or mortgage)
- `monthlyPayment: number` - Monthly payment amount
- `totalAmount: number` - Total mortgage principal
- `interestRate: number` - Annual interest rate (percentage)
- `downPayment: number` - Down payment amount
- `loanTermMonths: number` - Mortgage term in months
- `status: string` - Status (active, paid off, paid ahead)
- `currency: string` - Currency code
- `notes: string` - Housing notes
- `createdAt: ISO8601` - Creation timestamp
- `updatedAt: ISO8601` - Last update timestamp

**MortgagePayment:**
- `id: string` - Payment UUID
- `housingId: string` - Associated housing ID
- `date: ISO8601` - Payment date
- `amount: number` - Payment amount
- `principal: number` - Principal portion
- `interest: number` - Interest portion
- `remainingBalance: number` - Remaining balance after payment

## 6. User Flows

### 6.1. Create Housing

1. User opens Housing page
2. User clicks "Add Housing" button
3. Modal displays housing creation form
4. User selects type (rent or mortgage)
5. User enters required fields (name, monthly payment, total amount)
6. If mortgage: user enters interest rate, down payment, loan term
7. User enters optional fields (currency, notes)
8. System validates input
9. System creates housing
10. System returns housing with confirmation

### 6.2. View Mortgage Details

1. User selects mortgage
2. User clicks "Details" tab
3. System displays mortgage breakdown
4. System shows principal, interest, remaining balance

### 6.3. Add Mortgage Payment

1. User opens mortgage details
2. User clicks "Add Payment" button
3. User enters payment amount and date
4. User confirms payment
5. System updates mortgage
6. System recalculates remaining balance
7. System returns updated mortgage

### 6.4. Delete Housing

1. User selects housing to delete
2. User confirms deletion
3. System deletes housing
4. System returns success confirmation

## 7. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| Housing name already exists | Return 400 with error message |
| Housing ID not found | Return 404 Not Found |
| Interest rate invalid | Return 400 with error message |
| Payment exceeds balance | Return 400 with error message |

## 8. Open/Closed Questions

1. Should housing support multiple units per entry?
2. Should housing support rental income tracking?
3. Should housing sync with external property managers?
4. Should housing support property value tracking?

## 9. Acceptance Criteria

- [ ] User can create multiple housing entries
- [ ] User can view all housing
- [ ] User can update housing details
- [ ] User can delete housing
- [ ] Mortgage calculations are accurate
- [ ] Payment history is accurate
- [ ] Housing is scoped to user
- [ ] Both rent and mortgage are supported
- [ ] Additional payments reduce balance correctly