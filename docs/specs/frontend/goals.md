# Savings Goals Specification (Frontend)

**Module:** Savings Goals (UI)
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

The Savings Goals module provides a complete interface for setting financial goals and tracking progress toward them.

## 2. Functional Requirements

### 2.1. Goal List

| ID | Description | Type |
|----|-------------|------|
| SG-001 | Goal list must display all savings goals | Must |
| SG-002 | List must show name, target amount, current amount | Must |
| SG-003 | List must show progress percentage | Must |
| SG-004 | List must show remaining amount | Must |
| SG-005 | List must support filtering | Should |
| SG-006 | Loading state must display while fetching | Must |
| SG-007 | Empty state must display when no goals exist | Must |

### 2.2. Goal Display

| ID | Description | Type |
|----|-------------|------|
| SG-010 | Each goal must show name, target amount, current amount | Must |
| SG-011 | Goal must show progress bar | Must |
| SG-012 | Goal must show remaining amount | Must |
| SG-013 | Goal must show percentage | Must |
| SG-014 | Goal must show target date | Should |
| SG-015 | Goal must show category | Should |
| SG-016 | Goal must show icon | Should |
| SG-017 | Completed goals must be highlighted | Should |

### 2.3. Create Goal

| ID | Description | Type |
|----|-------------|------|
| SG-020 | Add goal button must be visible | Must |
| SG-021 | Create goal form must accept all fields | Must |
| SG-022 | Form must include name, target amount | Must |
| SG-023 | Form must support current amount | Should |
| SG-024 | Form must support target date | Should |
| SG-025 | Form must support category | Should |
| SG-026 | Form must support icon | Should |
| SG-027 | Form must support notes | Should |
| SG-028 | Form validation must prevent errors | Must |
| SG-029 | Goal must be created successfully | Must |
| SG-030 | Success message must display after creation | Must |

### 2.4. Edit Goal

| ID | Description | Type |
|----|-------------|------|
| SG-040 | Goal must be editable | Must |
| SG-041 | Edit button must be visible on each goal | Must |
| SG-042 | Edit form must pre-fill existing values | Must |
| SG-043 | Changes must update the goal | Must |
| SG-044 | Success message must display after update | Must |

### 2.5. Contribute to Goal

| ID | Description | Type |
|----|-------------|------|
| SG-050 | Contribute button must be visible | Must |
| SG-051 | Contribution must update goal amount | Must |
| SG-052 | Contribution must update progress | Must |
| SG-053 | Contribution must show confirmation | Must |
| SG-054 | Contribution must be recorded | Must |

### 2.6. Delete Goal

| ID | Description | Type |
|----|-------------|------|
| SG-060 | Delete button must be visible on each goal | Must |
| SG-061 | Delete must require confirmation | Must |
| SG-062 | Goal must be deleted on confirmation | Must |
| SG-063 | Success message must display after deletion | Must |

### 2.7. Goal Completion

| ID | Description | Type |
|----|-------------|------|
| SG-070 | Completed goals must be marked | Must |
| SG-071 | Completion must show celebration | Should |
| SG-072 | Completion must show time saved/made | Should |

### 2.8. Navigation

| ID | Description | Type |
|----|-------------|------|
| SG-080 | Goal list must be accessible from sidebar | Must |
| SG-081 | Navigation must update URL hash | Must |
| SG-082 | Browser back/forward must work | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | List load must complete within 100ms | 100ms |
| NFR-002 | Goal creation must complete within 50ms | 50ms |

### 3.2. Usability

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-003 | Form must be mobile-responsive | Always |
| NFR-004 | Progress bars must be readable | Always |
| NFR-005 | Contribution input must be prominent | Should |

### 3.3. Accessibility

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-006 | Progress bars must have accessible labels | Should |
| NFR-007 | Keyboard navigation must be supported | Always |

## 4. UI Components

### 4.1. Goal Cards

- Name, target amount, current amount
- Progress bar
- Remaining amount
- Percentage
- Target date (if set)
- Category and icon
- Edit, Contribute, Delete buttons

### 4.2. Goal Form Modal

- Name input
- Target amount input
- Current amount input (optional)
- Target date picker (optional)
- Category dropdown (optional)
- Icon picker (optional)
- Notes textarea (optional)
- Submit and Cancel buttons

### 4.3. Contribution Input

- Amount input
- Account selection (optional)
- Date picker
- Contribute button

### 4.4. Progress Bars

- Color-coded by progress
- Green: close to target
- Yellow: in progress
- Red: far from target

## 5. User Flows

### 5.1. View Goals

1. User clicks "Savings Goals" in sidebar
2. System loads goal list
3. System displays goal cards
4. System shows total progress

### 5.2. Create Goal

1. User clicks "Add Goal" button
2. System opens creation modal
3. User fills in form
4. User clicks "Save"
5. System validates and saves
6. System closes modal and shows success
7. Goal appears in list

### 5.3. Contribute to Goal

1. User opens goal details
2. User clicks "Contribute" button
3. User enters contribution amount
4. User confirms contribution
5. System updates goal amount
6. System updates progress
7. System shows success message

### 5.4. View Goal Progress

1. User views goal card
2. System shows progress bar
3. System shows current vs target amounts
4. System shows remaining amount
5. System shows percentage

### 5.5. Edit Goal

1. User clicks "Edit" on goal
2. System opens edit modal with existing values
3. User modifies fields
4. User clicks "Save"
5. System validates and updates
6. System shows success message

### 5.6. Delete Goal

1. User clicks "Delete" on goal
2. User confirms deletion
3. System deletes goal
4. System shows success message

## 6. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| API returns error | System shows error message |
| Form validation fails | System highlights errors |
| API is unavailable | System shows offline message |
| No goals exist | System shows empty state with create button |
| Target amount cannot be less than current | System shows error message |

## 7. Open/Closed Questions

1. Should goals support milestones?
2. Should goals support automatic contributions?
3. Should goals show investment projections?
4. Should goals be shared?

## 8. Acceptance Criteria

- [ ] User can view all goals
- [ ] User can create goals
- [ ] User can edit goals
- [ ] User can delete goals
- [ ] User can contribute to goals
- [ ] Progress updates correctly
- [ ] Goals load quickly
- [ ] Mobile responsive
- [ ] Contribution input works correctly

## 9. Integration Points

| Module | Purpose |
|--------|---------|
| Backend /api/savings-goals | Data source |
| Backend /api/transactions | Contribution tracking |

## 10. Goal Types

- Emergency Fund
- Vacation
- New Car
- Home Down Payment
- Retirement
- Education
- Other