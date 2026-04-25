# Bills Specification (Frontend)

**Module:** Bills (UI)
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

The Bills module provides a complete interface for managing recurring bills with due dates, payment tracking, and status management.

## 2. Functional Requirements

### 2.1. Bill List

| ID | Description | Type |
|----|-------------|------|
| B-001 | Bill list must display all bills | Must |
| B-002 | List must show name, amount, due date, status | Must |
| B-003 | List must support filtering by status | Must |
| B-004 | List must support filtering by due date | Should |
| B-005 | List must support sorting by due date | Must |
| B-006 | Loading state must display while fetching | Must |
| B-007 | Empty state must display when no bills exist | Must |

### 2.2. Bill Display

| ID | Description | Type |
|----|-------------|------|
| B-010 | Each bill must show name, amount, due date | Must |
| B-011 | Bill must show status badge | Must |
| B-012 | Bill must show days until due | Should |
| B-013 | Bill must show overdue indicator | Must |
| B-014 | Bill must show account | Should |
| B-015 | Bill must show frequency | Should |

### 2.3. Create Bill

| ID | Description | Type |
|----|-------------|------|
| B-020 | Add bill button must be visible | Must |
| B-021 | Create bill form must accept all fields | Must |
| B-022 | Form must include name, amount, due date, frequency, account | Must |
| B-023 | Form must support category | Should |
| B-024 | Form must support notes | Should |
| B-025 | Form must support next due date calculation | Must |
| B-026 | Form validation must prevent errors | Must |
| B-027 | Bill must be created successfully | Must |
| B-028 | Success message must display after creation | Must |

### 2.4. Edit Bill

| ID | Description | Type |
|----|-------------|------|
| B-030 | Bill must be editable | Must |
| B-031 | Edit button must be visible on each bill | Must |
| B-032 | Edit form must pre-fill existing values | Must |
| B-033 | Changes must update the bill | Must |
| B-034 | Success message must display after update | Must |
| B-035 | Next due date must recalculate | Must |

### 2.5. Mark Bill as Paid

| ID | Description | Type |
|----|-------------|------|
| B-040 | Mark as paid button must be visible | Must |
| B-041 | Mark as paid must update status | Must |
| B-042 | Paid status must persist | Must |
| B-043 | Success message must display | Must |

### 2.6. Delete Bill

| ID | Description | Type |
|----|-------------|------|
| B-050 | Delete button must be visible on each bill | Must |
| B-051 | Delete must require confirmation | Must |
| B-052 | Bill must be deleted on confirmation | Must |
| B-053 | Success message must display after deletion | Must |

### 2.7. Bill Status

| ID | Description | Type |
|----|-------------|------|
| B-060 | Status must include: upcoming, paid, overdue, canceled | Must |
| B-061 | Upcoming status must be default | Must |
| B-062 | Overdue status must be highlighted | Must |
| B-063 | Paid status must show payment date | Should |

### 2.8. Upcoming Bills

| ID | Description | Type |
|----|-------------|------|
| B-070 | Dashboard must show upcoming bills | Must |
| B-071 | Upcoming bills must be sorted by due date | Must |
| B-072 | Overdue bills must be at the top | Must |

### 2.9. Navigation

| ID | Description | Type |
|----|-------------|------|
| B-080 | Bill list must be accessible from sidebar | Must |
| B-081 | Navigation must update URL hash | Must |
| B-082 | Browser back/forward must work | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | List load must complete within 100ms | 100ms |
| NFR-002 | Bill creation must complete within 50ms | 50ms |

### 3.2. Usability

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-003 | Form must be mobile-responsive | Always |
| NFR-004 | Days until due must be visible | Must |
| NFR-005 | Overdue bills must be clearly marked | Must |

### 3.3. Accessibility

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-006 | Status badges must be accessible | Should |
| NFR-007 | Keyboard navigation must be supported | Always |

## 4. UI Components

### 4.1. Bill Cards

- Name, amount, due date
- Status badge
- Days until due
- Account info
- Edit, Mark Paid, Delete buttons

### 4.2. Bill Form Modal

- Name input
- Amount input
- Due date picker
- Frequency dropdown
- Account dropdown
- Category dropdown
- Notes textarea
- Submit and Cancel buttons

### 4.3. Status Badges

- Upcoming: Blue
- Paid: Green
- Overdue: Red
- Canceled: Gray

### 4.4. Overdue Indicator

- Icon or badge on overdue bills
- "Overdue" label
- "X days overdue" text

## 5. User Flows

### 5.1. View Bills

1. User clicks "Bills" in sidebar
2. System loads bill list
3. System displays bill cards sorted by due date
4. System highlights overdue bills

### 5.2. Create Bill

1. User clicks "Add Bill" button
2. System opens creation modal
3. User fills in form
4. User clicks "Save"
5. System validates and saves
6. System closes modal and shows success
7. Bill appears in list

### 5.3. Mark Bill as Paid

1. User clicks "Mark as Paid" on bill
2. System updates status to "paid"
3. System records payment date
4. System shows success message
5. Bill is hidden from upcoming view

### 5.4. Edit Bill

1. User clicks "Edit" on bill
2. System opens edit modal with existing values
3. User modifies fields
4. User clicks "Save"
5. System validates and updates
6. System shows success message

### 5.5. Delete Bill

1. User clicks "Delete" on bill
2. User confirms deletion
3. System deletes bill
4. System shows success message

## 6. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| API returns error | System shows error message |
| Form validation fails | System highlights errors |
| API is unavailable | System shows offline message |
| No bills exist | System shows empty state with create button |
| Invalid frequency | System shows error message |

## 7. Open/Closed Questions

1. Should bills support multiple payments?
2. Should bills generate reminders?
3. Should bills support automatic payments?
4. Should bills sync with external sources?

## 8. Acceptance Criteria

- [ ] User can view all bills
- [ ] User can create bills
- [ ] User can edit bills
- [ ] User can delete bills
- [ ] User can mark bills as paid
- [ ] Upcoming bills are visible
- [ ] Overdue bills are highlighted
- [ ] Bills load quickly
- [ ] Mobile responsive
- [ ] Unique bill name check is enforced

## 9. Integration Points

| Module | Purpose |
|--------|---------|
| Backend /api/bills | Data source |
| Backend /api/accounts | Account dropdown |
| Backend /api/categories | Category dropdown |
| Dashboard | Upcoming bills display |

## 10. Frequency Types

- Daily
- Weekly
- Biweekly (every 2 weeks)
- Monthly
- Quarterly
- Yearly