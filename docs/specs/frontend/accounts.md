# Accounts Specification (Frontend)

**Module:** Accounts (UI)
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

The Accounts module provides a complete interface for managing financial accounts including creating, editing, deleting, and viewing account details.

## 2. Functional Requirements

### 2.1. Account List

| ID | Description | Type |
|----|-------------|------|
| AC-001 | Account list must display all accounts | Must |
| AC-002 | List must show account name, balance, type, icon | Must |
| AC-003 | Balance must be color-coded by currency | Should |
| AC-004 | List must support sorting | Should |
| AC-005 | Loading state must display while fetching | Must |
| AC-006 | Empty state must display when no accounts exist | Must |

### 2.2. Account Display

| ID | Description | Type |
|----|-------------|------|
| AC-010 | Each account must show name, balance, type, icon | Must |
| AC-011 | Balance must be formatted according to currency | Must |
| AC-012 | Account type must be indicated | Must |
| AC-013 | Account must show account icon | Should |
| AC-014 | Account must show transaction count | Should |

### 2.3. Create Account

| ID | Description | Type |
|----|-------------|------|
| AC-020 | Add account button must be visible | Must |
| AC-021 | Create account form must accept all fields | Must |
| AC-022 | Form must include name, type, initial balance | Must |
| AC-023 | Form must support icon selection | Should |
| AC-024 | Form must support currency selection | Should |
| AC-025 | Form must support notes field | Should |
| AC-026 | Form validation must prevent errors | Must |
| AC-027 | Account must be created successfully | Must |
| AC-028 | Success message must display after creation | Must |

### 2.4. Edit Account

| ID | Description | Type |
|----|-------------|------|
| AC-030 | Account must be editable | Must |
| AC-031 | Edit button must be visible on each account | Must |
| AC-032 | Edit form must pre-fill existing values | Must |
| AC-033 | Changes must update the account | Must |
| AC-034 | Success message must display after update | Must |

### 2.5. Delete Account

| ID | Description | Type |
|----|-------------|------|
| AC-040 | Delete button must be visible on each account | Must |
| AC-041 | Delete must require confirmation | Must |
| AC-042 | Account must be deleted on confirmation | Must |
| AC-043 | Success message must display after deletion | Must |
| AC-044 | All associated transactions must remain | Should |

### 2.6. Account Details

| ID | Description | Type |
|----|-------------|------|
| AC-050 | Clicking account must open details modal | Must |
| AC-051 | Details modal must show balance history | Must |
| AC-052 | Details modal must show transactions | Must |
| AC-053 | Details modal must show account info | Must |

### 2.7. Balance History

| ID | Description | Type |
|----|-------------|------|
| AC-060 | Account must show transaction history | Must |
| AC-061 | History must show date, description, amount, balance | Must |
| AC-062 | History must be sorted by date (newest first) | Must |
| AC-063 | History must be paginated | Must |

### 2.8. Navigation

| ID | Description | Type |
|----|-------------|------|
| AC-080 | Account list must be accessible from sidebar | Must |
| AC-081 | Navigation must update URL hash | Must |
| AC-082 | Browser back/forward must work | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | List load must complete within 200ms | 200ms |
| NFR-002 | Account creation must complete within 100ms | 100ms |

### 3.2. Usability

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-003 | Form must be mobile-responsive | Always |
| NFR-004 | List must be touch-friendly on mobile | Always |
| NFR-005 | Account cards must be readable at small sizes | Should |

### 3.3. Accessibility

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-006 | All inputs must have labels | Always |
| NFR-007 | Keyboard navigation must be supported | Always |
| NFR-008 | Account cards must be clickable with keyboard | Should |

## 4. UI Components

### 4.1. Account Cards

- Name, type icon, balance
- Color-coded by account type
- Edit and Delete buttons
- Hover effects

### 4.2. Account Form Modal

- Name input
- Type dropdown (checking, savings, credit, investment, cash, other)
- Initial balance input
- Currency dropdown
- Icon picker
- Notes textarea
- Submit and Cancel buttons

### 4.3. Account Details Modal

- Account information (name, type, balance, currency)
- Balance history timeline
- Transaction list
- Edit and Delete buttons
- Close button

## 5. User Flows

### 5.1. View Accounts

1. User clicks "Accounts" in sidebar
2. System loads account list
3. System displays account cards
4. System shows total balance across all accounts

### 5.2. Create Account

1. User clicks "Add Account" button
2. System opens creation modal
3. User fills in form
4. User clicks "Save"
5. System validates and saves
6. System closes modal and shows success
7. Account appears in list

### 5.3. View Account Details

1. User clicks on account card
2. System opens details modal
3. System displays account info
4. System displays balance history
5. System displays transactions

### 5.4. Edit Account

1. User clicks "Edit" on account
2. System opens edit modal with existing values
3. User modifies fields
4. User clicks "Save"
5. System validates and updates
6. System shows success message

### 5.5. Delete Account

1. User clicks "Delete" on account
2. User confirms deletion
3. System deletes account
4. System shows success message

## 6. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| API returns error | System shows error message |
| Form validation fails | System highlights errors |
| API is unavailable | System shows offline message |
| No accounts exist | System shows empty state with create button |

## 7. Open/Closed Questions

1. Should users be able to reorder accounts?
2. Should accounts have icons from a predefined set?
3. Should accounts support custom types?
4. Should account totals be displayed prominently?

## 8. Acceptance Criteria

- [ ] User can view all accounts
- [ ] User can create accounts
- [ ] User can edit accounts
- [ ] User can delete accounts
- [ ] Account list loads quickly
- [ ] Balance history displays correctly
- [ ] Mobile responsive
- [ ] All validations are enforced

## 9. Integration Points

| Module | Purpose |
|--------|---------|
| Backend /api/accounts | Data source |
| Backend /api/transactions | Transaction history |
| Backend /api/categories | Category reference |

## 10. Account Types

- Checking
- Savings
- Credit Card
- Investment
- Cash
- Other