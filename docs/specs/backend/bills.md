# Bills Specification

**Module:** Bills
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

Bills represent recurring financial obligations with due dates and payment tracking.

## 2. Functional Requirements

### 2.1. CRUD Operations

| ID | Description | Type |
|----|-------------|------|
| B-001 | Get all bills must return list of bills | Must |
| B-002 | Get single bill by ID must return bill data | Must |
| B-003 | Create bill must validate required fields | Must |
| B-004 | Create bill must return newly created bill | Must |
| B-005 | Update bill must allow updating bill data | Must |
| B-006 | Update bill must return updated bill | Must |
| B-007 | Delete bill must remove bill | Must |
| B-008 | Mark bill as paid must update status | Must |

### 2.2. Bill Data

| ID | Description | Type |
|----|-------------|------|
| B-010 | Bill must have required fields (name, amount, dueDate) | Must |
| B-011 | Bill must have unique name per user | Must |
| B-012 | Bill must have amount | Must |
| B-013 | Bill must have due date | Must |
| B-014 | Bill must have account for payment | Must |
| B-015 | Bill must have frequency (daily, weekly, monthly, etc.) | Must |
| B-016 | Bill must have status (upcoming, paid, overdue, canceled) | Must |
| B-017 | Bill must have category | Should |
| B-018 | Bill must have notes | Should |

### 2.3. Bill Frequency

| ID | Description | Type |
|----|-------------|------|
| B-020 | Frequency options must include daily, weekly, biweekly, monthly, quarterly, yearly | Must |
| B-021 | Next due date must be calculated based on frequency | Must |
| B-022 | Recurring bills must generate future occurrences | Should |

### 2.4. Bill Status Tracking

| ID | Description | Type |
|----|-------------|------|
| B-030 | Status must be 'upcoming', 'paid', 'overdue', 'canceled' | Must |
| B-031 | Overdue bills must be flagged | Must |
| B-032 | Paid bills must retain historical record | Must |
| B-033 | Canceled bills should not generate future occurrences | Should |

### 2.5. Upcoming Bills

| ID | Description | Type |
|----|-------------|------|
| B-040 | Get upcoming bills endpoint must return bills due within X days | Must |
| B-041 | Upcoming bills must be sorted by due date (ASC) | Must |
| B-042 | Upcoming bills must show days until due | Should |

### 2.6. Payment Tracking

| ID | Description | Type |
|----|-------------|------|
| B-050 | Paid bills must be marked with payment date | Must |
| B-051 | Payment history must be tracked | Should |
| B-052 | Multiple payments per bill must be supported | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | Get all bills must complete within 100ms | 100ms |
| NFR-002 | Get upcoming bills must complete within 100ms | 100ms |
| NFR-003 | Create bill must complete within 50ms | 50ms |

### 3.2. Data Consistency

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-004 | Bill calculations must be accurate | Always |
| NFR-005 | Next due dates must update correctly on bill changes | Always |

### 3.3. Security

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-006 | Bill access must be scoped to user | Always |

## 4. API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/bills` | GET | Get all bills |
| `/api/bills` | POST | Create new bill |
| `/api/bills/:id` | GET | Get single bill |
| `/api/bills/:id` | PUT | Update bill |
| `/api/bills/:id` | DELETE | Delete bill |
| `/api/bills/:id/mark-paid` | POST | Mark bill as paid |
| `/api/bills/upcoming` | GET | Get upcoming bills |

## 5. Data Models

**Bill:**
- `id: string` - Bill UUID
- `name: string` - Bill name (e.g., "Rent", "Electricity")
- `amount: number` - Bill amount
- `dueDate: ISO8601` - Due date
- `account: string` - Account for payment
- `frequency: string` - Frequency (daily, weekly, biweekly, monthly, quarterly, yearly)
- `status: string` - Status (upcoming, paid, overdue, canceled)
- `category: string` - Category name
- `notes: string` - Bill notes
- `createdAt: ISO8601` - Creation timestamp
- `updatedAt: ISO8601` - Last update timestamp
- `nextDueDate: ISO8601` - Next due date

**BillPayment:**
- `id: string` - Payment UUID
- `billId: string` - Associated bill ID
- `paymentDate: ISO8601` - Payment date
- `amount: number` - Payment amount
- `notes: string` - Payment notes

## 6. User Flows

### 6.1. Create Bill

1. User opens Bills page
2. User clicks "Add Bill" button
3. Modal displays bill creation form
4. User enters required fields (name, amount, due date, account, frequency)
5. User selects optional fields (category, notes)
6. System validates input
7. System creates bill
8. System calculates next due date
9. System returns bill with confirmation

### 6.2. View Upcoming Bills

1. User opens Dashboard or Bills page
2. System loads upcoming bills
3. System displays bills sorted by due date
4. System shows days until due
5. System highlights overdue bills

### 6.3. Mark Bill as Paid

1. User selects upcoming bill
2. User clicks "Mark as Paid" button
3. System updates bill status to 'paid'
4. System records payment date
5. System returns updated bill

### 6.4. Delete Bill

1. User selects bill to delete
2. User confirms deletion
3. System deletes bill
4. System returns success confirmation

## 7. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| Bill name already exists | Return 400 with error message |
| Bill ID not found | Return 404 Not Found |
| Invalid due date format | Return 400 with error message |
| Invalid frequency value | Return 400 with error message |

## 8. Open/Closed Questions

1. Should bills support customization of frequency pattern?
2. Should bills support multiple payments?
3. Should bills generate recurring reminders?
4. Should bills sync with external financial institutions?

## 9. Acceptance Criteria

- [ ] User can create multiple bills
- [ ] User can view all bills
- [ ] User can update bill details
- [ ] User can delete bills
- [ ] User can mark bills as paid
- [ ] User can view upcoming bills
- [ ] Upcoming bills are sorted by due date
- [ ] Overdue bills are flagged
- [ ] Bill names must be unique per user
- [ ] Recurrence patterns are handled correctly