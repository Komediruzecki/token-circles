# Savings Goals Specification

**Module:** Savings Goals
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

Savings goals help users track progress towards financial milestones like emergencies, vacations, or major purchases.

## 2. Functional Requirements

### 2.1. CRUD Operations

| ID | Description | Type |
|----|-------------|------|
| SG-001 | Get all savings goals must return list of goals | Must |
| SG-002 | Get single goal by ID must return goal data | Must |
| SG-003 | Create goal must validate required fields | Must |
| SG-004 | Create goal must return newly created goal | Must |
| SG-005 | Update goal must allow updating goal data | Must |
| SG-006 | Update goal must return updated goal | Must |
| SG-007 | Delete goal must remove goal | Must |

### 2.2. Goal Data

| ID | Description | Type |
|----|-------------|------|
| SG-010 | Goal must have required fields (name, targetAmount) | Must |
| SG-011 | Goal must have unique name per user | Must |
| SG-012 | Goal must have target amount | Must |
| SG-013 | Goal must have current amount | Must |
| SG-014 | Goal must have icon | Should |
| SG-015 | Goal must have target date | Should |
| SG-016 | Goal must have category | Should |
| SG-017 | Goal must support notes | Should |
| SG-018 | Goal must support currency | Must |

### 2.3. Goal Progress

| ID | Description | Type |
|----|-------------|------|
| SG-020 | Progress percentage must be calculated automatically | Must |
| SG-021 | Remaining amount must be displayed | Must |
| SG-022 | Completion date must be tracked | Should |
| SG-023 | Progress bars must be visualized | Should |

### 2.4. Goal Completion

| ID | Description | Type |
|----|-------------|------|
| SG-030 | Completed goals must be marked | Should |
| SG-031 | Completion must record actual vs target comparison | Should |
| SG-032 | Celebration should be shown on completion | Should |

### 2.5. Contributing Transactions

| ID | Description | Type |
|----|-------------|------|
| SG-040 | Goals can be linked to specific accounts | Must |
| SG-041 | Contribute to goal must update goal amount | Must |
| SG-042 | Transactions can be tagged as contributions | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | Get all savings goals must complete within 100ms | 100ms |
| NFR-002 | Create goal must complete within 50ms | 50ms |

### 3.2. Data Consistency

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-003 | Goal calculations must be accurate | Always |
| NFR-004 | Progress updates must be atomic | Always |

### 3.3. Security

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-005 | Goal access must be scoped to user | Always |

## 4. API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/savings-goals` | GET | Get all savings goals |
| `/api/savings-goals` | POST | Create new goal |
| `/api/savings-goals/:id` | GET | Get single goal |
| `/api/savings-goals/:id` | PUT | Update goal |
| `/api/savings-goals/:id` | DELETE | Delete goal |

## 5. Data Models

**SavingsGoal:**
- `id: string` - Goal UUID
- `name: string` - Goal name
- `targetAmount: number` - Target amount
- `currentAmount: number` - Current amount
- `remainingAmount: number` - Remaining amount
- `progressPercentage: number` - Progress percentage (0-100)
- `targetDate: ISO8601` - Target date (optional)
- `category: string` - Category (optional)
- `icon: string` - Goal icon (optional)
- `notes: string` - Goal notes (optional)
- `currency: string` - Currency code
- `status: string` - Status (active, completed)
- `createdAt: ISO8601` - Creation timestamp
- `updatedAt: ISO8601` - Last update timestamp

## 6. User Flows

### 6.1. Create Savings Goal

1. User opens Savings Goals page
2. User clicks "Add Goal" button
3. Modal displays goal creation form
4. User enters required fields (name, target amount)
5. User selects optional fields (target date, category, icon, notes)
6. System validates input
7. System creates goal with current amount 0
8. System returns goal with confirmation

### 6.2. Contribute to Goal

1. User opens goal detail
2. User enters contribution amount
3. User selects account (optional)
4. User confirms contribution
5. System updates goal current amount
6. System updates progress percentage
7. System returns updated goal

### 6.3. View Goal Progress

1. User opens goal
2. System displays goal details
3. System shows progress bar
4. System shows current vs target amounts
5. System shows remaining amount

### 6.4. Delete Goal

1. User selects goal to delete
2. User confirms deletion
3. System deletes goal
4. System returns success confirmation

## 7. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| Goal name already exists | Return 400 with error message |
| Goal ID not found | Return 404 Not Found |
| Target amount cannot be less than current amount | Return 400 with error message |
| Current amount cannot exceed target amount | Return 400 with error message |

## 8. Open/Closed Questions

1. Should goals support milestones/tiers?
2. Should goals support automatic contributions?
3. Should goals support investment growth projections?
4. Should goals support shared goals?

## 9. Acceptance Criteria

- [ ] User can create multiple savings goals
- [ ] User can view all savings goals
- [ ] User can update goal details
- [ ] User can delete goals
- [ ] Progress percentage is calculated correctly
- [ ] Remaining amount is calculated correctly
- [ ] Goals are scoped to user
- [ ] Goal contributions update progress
- [ ] Goals can have target dates
- [ ] Goals can be categorized