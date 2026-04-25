# Budgets Specification

**Module:** Budgets
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

Budgets define spending limits for categories within specific time periods.

## 2. Functional Requirements

### 2.1. CRUD Operations

| ID | Description | Type |
|----|-------------|------|
| BU-001 | Get all budgets must return list of budgets | Must |
| BU-002 | Get single budget by ID must return budget data | Must |
| BU-003 | Create budget must validate required fields | Must |
| BU-004 | Create budget must return newly created budget | Must |
| BU-005 | Update budget must allow updating budget data | Must |
| BU-006 | Update budget must return updated budget | Must |
| BU-007 | Delete budget must remove budget | Must |

### 2.2. Budget Data

| ID | Description | Type |
|----|-------------|------|
| BU-010 | Budget must have required fields (categoryId, amount, period) | Must |
| BU-011 | Budget must have category | Must |
| BU-012 | Budget must have spending limit amount | Must |
| BU-013 | Budget must have time period | Must |
| BU-014 | Budget must have current spending amount | Must |
| BU-015 | Budget must show remaining amount | Must |
| BU-016 | Budget must show budget used percentage | Should |
| BU-017 | Budget must have name/label | Should |

### 2.3. Budget Periods

| ID | Description | Type |
|----|-------------|------|
| BU-020 | Period must support month, year, custom | Must |
| BU-021 | Custom period must have start and end dates | Must |
| BU-022 | Period must be calendar-based | Must |

### 2.4. Budget Alerts

| ID | Description | Type |
|----|-------------|------|
| BU-030 | Budget alerts must notify when spending exceeds threshold | Must |
| BU-031 | Alert thresholds must be configurable | Should |
| BU-032 | Over-budget indicators must be visible | Should |
| BU-033 | Alerts must show amount exceeded | Should |

### 2.5. Budget Analysis

| ID | Description | Type |
|----|-------------|------|
| BU-040 | Budget forecast must project spending | Should |
| BU-041 | Zero-based budget support must be available | Should |
| BU-042 | Budget improvements suggestions must be provided | Should |
| BU-043 | Historical budget data must be available | Should |

### 2.6. Budget Management

| ID | Description | Type |
|----|-------------|------|
| BU-050 | Create budget from existing expenses must be supported | Should |
| BU-051 | Duplicate last budget must be supported | Should |
| BU-052 | Allocate remaining budget must be supported | Should |

### 2.7. Budget Comparison

| ID | Description | Type |
|----|-------------|------|
| BU-060 | Compare budgets across periods must be supported | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | Get all budgets must complete within 100ms | 100ms |
| NFR-002 | Get budget alerts must complete within 100ms | 100ms |
| NFR-003 | Create budget must complete within 50ms | 50ms |

### 3.2. Data Consistency

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-004 | Budget calculations must be accurate | Always |
| NFR-005 | Budget period boundaries must be respected | Always |

### 3.3. Security

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-006 | Budget access must be scoped to user | Always |

## 4. API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/budgets` | GET | Get all budgets |
| `/api/budgets` | POST | Create new budget |
| `/api/budgets/:id` | GET | Get single budget |
| `/api/budgets/:id` | PUT | Update budget |
| `/api/budgets/:id` | DELETE | Delete budget |
| `/api/budgets/alerts` | GET | Get budget alerts |
| `/api/budgets/history` | GET | Get budget history |
| `/api/budgets/forecast` | GET | Get budget forecast |
| `/api/budgets/summary` | GET | Get budget summary |
| `/api/budgets/zero-based` | GET | Get zero-based budgets |
| `/api/budgets/zero-based/summary` | GET | Get zero-based budget summary |
| `/api/budgets/improvements` | GET | Get budget improvement suggestions |
| `/api/budgets/from-expenses` | POST | Create budget from expenses |
| `/api/budgets/duplicate-last` | POST | Duplicate last budget |
| `/api/budgets/allocate` | POST | Allocate remaining budget |

## 5. Data Models

**Budget:**
- `id: string` - Budget UUID
- `categoryId: string` - Category ID
- `categoryName: string` - Category name
- `amount: number` - Budgeted amount
- `currentSpending: number` - Current spending
- `remaining: number` - Remaining amount
- `period: string` - Period type (month, year, custom)
- `periodStart: ISO8601` - Period start date
- `periodEnd: ISO8601` - Period end date
- `usedPercentage: number` - Percentage used (0-100)
- `status: string` - Status (active, closed)
- `createdAt: ISO8601` - Creation timestamp
- `updatedAt: ISO8601` - Last update timestamp

**BudgetAlert:**
- `id: string` - Alert UUID
- `budgetId: string` - Associated budget ID
- `categoryId: string` - Category ID
- `categoryName: string` - Category name
- `alertType: string` - Alert type (warning, critical, exceeded)
- `currentSpending: number` - Current spending
- `budgetAmount: number` - Budget amount
- `exceededAmount: number` - Amount exceeded
- `threshold: number` - Alert threshold (percentage)
- `createdAt: ISO8601` - Alert created timestamp

## 6. User Flows

### 6.1. Create Budget

1. User opens Budgets page
2. User clicks "Add Budget" button
3. Modal displays budget creation form
4. User selects category and enters amount
5. User selects period (month or year)
6. User can optionally set alert threshold
7. System validates input
8. System calculates current spending from transactions
9. System creates budget
10. System returns budget with confirmation

### 6.2. View Budget Alerts

1. User opens Dashboard
2. System loads budget alerts
3. System displays alerts sorted by severity
4. System shows exceeded amounts

### 6.3. Delete Budget

1. User selects budget to delete
2. User confirms deletion
3. System deletes budget
4. System returns success confirmation

### 6.4. Create Budget from Expenses

1. User opens Budgets page
2. User clicks "Create from Expenses" button
3. System loads historical spending by category
4. User selects categories and amounts
5. System creates budget
6. System returns created budgets

## 7. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| Category already has budget for period | Return 400 with error message |
| Budget ID not found | Return 404 Not Found |
| Invalid period dates | Return 400 with error message |
| Amount cannot be negative | Return 400 with error message |

## 8. Open/Closed Questions

1. Should budgets support category overrides?
2. Should budgets support roll-over to next period?
3. Should budgets sync with transaction updates automatically?
4. Should budgets support global vs category-specific alerts?

## 9. Acceptance Criteria

- [ ] User can create budgets for categories
- [ ] User can set budget amounts
- [ ] User can select budget period (month/year)
- [ ] Current spending is calculated correctly
- [ ] Remaining amount is calculated correctly
- [ ] Over-budget indicators are visible
- [ ] Budget alerts notify when threshold exceeded
- [ ] User can update budget details
- [ ] User can delete budgets
- [ ] User can create budgets from expenses
- [ ] Budgets are scoped to user