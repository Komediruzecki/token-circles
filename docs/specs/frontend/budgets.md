# Budgets Specification (Frontend)

**Module:** Budgets (UI)
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

The Budgets module provides a complete interface for creating, viewing, editing, and managing spending budgets for categories and time periods.

## 2. Functional Requirements

### 2.1. Budget List

| ID | Description | Type |
|----|-------------|------|
| BU-001 | Budget list must display all budgets | Must |
| BU-002 | List must show category, amount, current spending, remaining | Must |
| BU-003 | List must show progress bar or percentage | Must |
| BU-004 | List must support filtering by period | Must |
| BU-005 | List must support filtering by status | Should |
| BU-006 | Loading state must display while fetching | Must |
| BU-007 | Empty state must display when no budgets exist | Must |

### 2.2. Budget Display

| ID | Description | Type |
|----|-------------|------|
| BU-010 | Each budget must show category name, budgeted amount, current spending | Must |
| BU-011 | Remaining amount must be calculated | Must |
| BU-012 | Progress percentage must be calculated | Must |
| BU-013 | Budget must show category icon and color | Should |
| BU-014 | Over-budget indicator must be visible | Must |
| BU-015 | Budget must show period (month/year) | Must |

### 2.3. Create Budget

| ID | Description | Type |
|----|-------------|------|
| BU-020 | Add budget button must be visible | Must |
| BU-021 | Create budget form must accept all fields | Must |
| BU-022 | Form must include category, amount, period | Must |
| BU-023 | Form must support period selection (month, year) | Must |
| BU-024 | Form must support custom period dates | Should |
| BU-025 | Form validation must prevent errors | Must |
| BU-026 | Budget must be created successfully | Must |
| BU-027 | Success message must display after creation | Must |
| BU-028 | Current spending must be pre-calculated | Must |

### 2.4. Edit Budget

| ID | Description | Type |
|----|-------------|------|
| BU-030 | Budget must be editable | Must |
| BU-031 | Edit button must be visible on each budget | Must |
| BU-032 | Edit form must pre-fill existing values | Must |
| BU-033 | Changes must update the budget | Must |
| BU-034 | Success message must display after update | Must |

### 2.5. Delete Budget

| ID | Description | Type |
|----|-------------|------|
| BU-040 | Delete button must be visible on each budget | Must |
| BU-041 | Delete must require confirmation | Must |
| BU-042 | Budget must be deleted on confirmation | Must |
| BU-043 | Success message must display after deletion | Must |

### 2.6. Budget Alerts

| ID | Description | Type |
|----|-------------|------|
| BU-050 | Over-budget warning must be displayed | Must |
| BU-051 | Budget progress must show red color when over budget | Must |
| BU-052 | Budget progress must show yellow color when near limit | Should |
| BU-053 | Alert threshold must be configurable | Should |

### 2.7. Budget Comparison

| ID | Description | Type |
|----|-------------|------|
| BU-060 | Compare budget to actual must be available | Should |
| BU-061 | Year-over-year comparison must be supported | Should |

### 2.8. Navigation

| ID | Description | Type |
|----|-------------|------|
| BU-080 | Budget list must be accessible from sidebar | Must |
| BU-081 | Navigation must update URL hash | Must |
| BU-082 | Browser back/forward must work | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | List load must complete within 100ms | 100ms |
| NFR-002 | Budget creation must complete within 100ms | 100ms |

### 3.2. Usability

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-003 | Form must be mobile-responsive | Always |
| NFR-004 | Progress bars must be readable | Always |
| NFR-005 | Over-budget indicators must be clear | Must |

### 3.3. Accessibility

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-006 | Progress bars must have accessible labels | Should |
| NFR-007 | Keyboard navigation must be supported | Always |

## 4. UI Components

### 4.1. Budget Cards

- Category name with icon and color
- Budgeted amount
- Current spending
- Remaining amount
- Progress bar
- Edit and Delete buttons

### 4.2. Budget Form Modal

- Category dropdown with search
- Amount input
- Period dropdown (month, year)
- Custom dates (if custom period)
- Submit and Cancel buttons

### 4.3. Budget Summary

- Total budgeted amount
- Total spent
- Remaining balance
- Summary bar

### 4.4. Budget Alerts

- Badge indicating over budget
- Warning color
- Alert message

## 5. User Flows

### 5.1. View Budgets

1. User clicks "Budgets" in sidebar
2. System loads budget list for current period
3. System displays budget cards
4. System shows budget summary

### 5.2. Create Budget

1. User clicks "Add Budget" button
2. System opens creation modal
3. User selects category and enters amount
4. User selects period
5. User clicks "Save"
6. System validates and saves
7. System closes modal and shows success
8. Budget appears in list

### 5.3. View Budget Progress

1. User views budget card
2. System shows progress bar
3. System shows current vs budgeted amount
4. System shows remaining amount

### 5.4. Edit Budget

1. User clicks "Edit" on budget
2. System opens edit modal with existing values
3. User modifies fields
4. User clicks "Save"
5. System validates and updates
6. System shows success message

### 5.5. Delete Budget

1. User clicks "Delete" on budget
2. User confirms deletion
3. System deletes budget
4. System shows success message

## 6. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| API returns error | System shows error message |
| Form validation fails | System highlights errors |
| API is unavailable | System shows offline message |
| No budgets exist | System shows empty state with create button |
| Budget already exists for category and period | System shows error message |

## 7. Open/Closed Questions

1. Should budgets support category overrides?
2. Should budgets support roll-over to next period?
3. Should budgets sync with transaction updates?
4. Should budgets support budget adjustments?

## 8. Acceptance Criteria

- [ ] User can view all budgets
- [ ] User can create budgets
- [ ] User can edit budgets
- [ ] User can delete budgets
- [ ] Budgets show correct progress
- [ ] Over-budget indicators are visible
- [ ] Budgets load quickly
- [ ] Mobile responsive
- [ ] Unique budget check is enforced

## 9. Integration Points

| Module | Purpose |
|--------|---------|
| Backend /api/budgets | Data source |
| Backend /api/categories | Category dropdown |
| Backend /api/transactions | Current spending calculation |

## 10. Period Types

- Month
- Year
- Custom (start/end dates)