# Recurring Specification

**Module:** Recurring
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

Recurring module handles recurring transactions and transactions for future dates.

## 2. Functional Requirements

### 2.1. CRUD Operations

| ID | Description | Type |
|----|-------------|------|
| R-001 | Get all recurring must return list of recurring | Must |
| R-002 | Get single recurring by ID must return recurring data | Must |
| R-003 | Create recurring must validate required fields | Must |
| R-004 | Create recurring must return newly created recurring | Must |
| R-005 | Update recurring must allow updating recurring data | Must |
| R-006 | Update recurring must return updated recurring | Must |
| R-007 | Delete recurring must remove recurring | Must |
| R-008 | Populate recurring must create future transactions | Must |

### 2.2. Recurring Data

| ID | Description | Type |
|----|-------------|------|
| R-010 | Recurring must have required fields (name, amount, frequency) | Must |
| R-011 | Recurring must have frequency | Must |
| R-012 | Recurring must have next occurrence date | Must |
| R-013 | Recurring must have type (income/expense) | Must |
| R-014 | Recurring must have category | Should |
| R-015 | Recurring must have account | Must |
| R-016 | Recurring must have status (active, paused, canceled) | Must |
| R-017 | Recurring must support notes | Should |

### 2.3. Frequency

| ID | Description | Type |
|----|-------------|------|
| R-020 | Frequency options must include daily, weekly, biweekly, monthly, quarterly, yearly | Must |
| R-021 | Next occurrence date must be calculated based on frequency | Must |

### 2.4. Recurring Management

| ID | Description | Type |
|----|-------------|------|
| R-030 | Populate recurring must create future transactions | Must |
| R-031 | Populate recurring should respect time bounds | Should |
| R-032 | Pause recurring must stop creation of future transactions | Must |
| R-033 | Cancel recurring must stop and remove future | Should |

### 2.5. Upcoming Recurring

| ID | Description | Type |
|----|-------------|------|
| R-040 | Get upcoming recurring must return recurring in future | Must |
| R-041 | Upcoming recurring must be sorted by next date | Must |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | Get all recurring must complete within 100ms | 100ms |
| NFR-002 | Populate recurring must complete within 5s | 5s |
| NFR-003 | Get upcoming recurring must complete within 100ms | 100ms |

### 3.2. Data Consistency

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-003 | Calculations must be accurate | Always |
| NFR-004 | Future transactions must be created correctly | Always |

### 3.3. Security

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-005 | Recurring access must be scoped to user | Always |

## 4. API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/recurring` | GET | Get all recurring |
| `/api/recurring` | POST | Create new recurring |
| `/api/recurring/:id` | GET | Get single recurring |
| `/api/recurring/:id` | PUT | Update recurring |
| `/api/recurring/:id` | DELETE | Delete recurring |
| `/api/recurring/upcoming` | GET | Get upcoming recurring |
| `/api/recurring/:id/populate` | POST | Populate recurring with future transactions |

## 5. Data Models

**Recurring:**
- `id: string` - Recurring UUID
- `name: string` - Name (e.g., "Monthly Rent")
- `amount: number` - Transaction amount
- `frequency: string` - Frequency (daily, weekly, biweekly, monthly, quarterly, yearly)
- `nextDate: ISO8601` - Next occurrence date
- `type: string` - Type (income, expense)
- `category: string` - Category (optional)
- `account: string` - Account (required)
- `status: string` - Status (active, paused, canceled)
- `notes: string` - Notes (optional)
- `createdAt: ISO8601` - Creation timestamp
- `updatedAt: ISO8601` - Last update timestamp

## 6. User Flows

### 6.1. Create Recurring

1. User opens Recurring page
2. User clicks "Add Recurring" button
3. Modal displays recurring creation form
4. User enters required fields (name, amount, frequency, type, account)
5. User enters optional fields (category, notes)
6. System validates input
7. System calculates next date
8. System creates recurring
9. System returns recurring with confirmation

### 6.2. Populate Recurring

1. User clicks "Populate" button on recurring
2. System creates future transactions
3. System shows number of transactions created
4. System returns success

### 6.3. View Upcoming Recurring

1. User opens Dashboard
2. System loads upcoming recurring
3. System displays list
4. System shows next occurrence dates

### 6.4. Delete Recurring

1. User selects recurring to delete
2. User confirms deletion
3. System deletes recurring
4. System returns success confirmation

## 7. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| Recurring name already exists | Return 400 with error message |
| Recurring ID not found | Return 404 Not Found |
| Invalid frequency value | Return 400 with error message |
| Invalid date format | Return 400 with error message |

## 8. Open/Closed Questions

1. Should recurring support variable amounts?
2. Should recurring support one-time exceptions?
3. Should recurring sync with external sources?
4. Should recurring have auto-population on schedule?

## 9. Acceptance Criteria

- [ ] User can create multiple recurring entries
- [ ] User can view all recurring
- [ ] User can update recurring details
- [ ] User can delete recurring
- [ ] Future transactions are created correctly
- [ ] Upcoming recurring are sorted by date
- [ ] Pause and cancel functionality works
- [ ] Recurring are scoped to user
- [ ] Next dates are calculated correctly

## 10. Dependencies

| Data | Source |
|------|--------|
| Transactions | Create recurring transactions |
| Accounts | Account selection |
| Categories | Category selection |