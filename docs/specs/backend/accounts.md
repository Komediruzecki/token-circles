# Accounts Specification

**Module:** Accounts
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

Accounts represent financial accounts like checking, savings, credit cards, and investments managed by the user.

## 2. Functional Requirements

### 2.1. CRUD Operations

| ID | Description | Type |
|----|-------------|------|
| AC-001 | Get all accounts must return list of accounts | Must |
| AC-002 | Get single account by ID must return account data | Must |
| AC-003 | Create account must validate required fields | Must |
| AC-004 | Create account must return newly created account | Must |
| AC-005 | Update account must allow updating account data | Must |
| AC-006 | Update account must return updated account | Must |
| AC-007 | Delete account must remove account | Must |

### 2.2. Account Data

| ID | Description | Type |
|----|-------------|------|
| AC-010 | Account must have required fields (name, type, initialBalance) | Must |
| AC-011 | Account must support custom name | Must |
| AC-012 | Account must have account type (checking, savings, credit, investment, etc.) | Must |
| AC-013 | Account must have current balance | Must |
| AC-014 | Account must have icon/symbol | Should |
| AC-015 | Account must support currency | Should |
| AC-016 | Account must support notes | Should |
| AC-017 | Account must have opening balance | Must |

### 2.3. Account History

| ID | Description | Type |
|----|-------------|------|
| AC-020 | Get account history must return balance history | Must |
| AC-021 | Get account timeline must show balance changes over time | Should |
| AC-022 | Get reconciliation summary must show unmatched transactions | Should |

### 2.4. Balance Tracking

| ID | Description | Type |
|----|-------------|------|
| AC-030 | Account balance must be calculated from transactions | Must |
| AC-031 | Balance must update automatically on transaction change | Must |
| AC-032 | Opening balance must be preserved | Must |
| AC-033 | Transactions must be ordered by date for balance calculation | Must |

### 2.5. Multi-Currency

| ID | Description | Type |
|----|-------------|------|
| AC-040 | Accounts can have different currencies | Must |
| AC-041 | Balance must be shown in account's currency | Must |
| AC-042 | Multi-currency conversion must be supported in views | Should |
| AC-043 | Exchange rate for conversions must be updatable | Should |

### 2.6. Bulk Operations

| ID | Description | Type |
|----|-------------|------|
| AC-050 | Bulk import must support CSV file upload | Should |
| AC-051 | Bulk export must support CSV export | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | Get all accounts must complete within 100ms | 100ms |
| NFR-002 | Get account history must complete within 200ms | 200ms |
| NFR-003 | Update account must complete within 100ms | 100ms |

### 3.2. Data Consistency

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-004 | Account balance must always reflect current state | Always |
| NFR-005 | Account balance must update atomically with transactions | Always |

### 3.3. Security

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-006 | Account access must be scoped to user | Always |
| NFR-007 | Sensitive account data (credit numbers) must be encrypted | Should |

## 4. API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/accounts` | GET | Get all accounts |
| `/api/accounts` | POST | Create new account |
| `/api/accounts/:id` | GET | Get single account |
| `/api/accounts/:id` | PUT | Update account |
| `/api/accounts/:id` | DELETE | Delete account |
| `/api/accounts/:id/history` | GET | Get account balance history |
| `/api/accounts/history/timeline` | GET | Get account balance timeline |
| `/api/accounts/:id/reconciliation-summary` | GET | Get reconciliation summary |

## 5. Data Models

**Account:**
- `id: string` - Account UUID
- `name: string` - Account name
- `type: string` - Account type (checking, savings, credit, investment, etc.)
- `icon: string` - Account icon/symbol
- `currency: string` - Currency code
- `balance: number` - Current account balance
- `initialBalance: number` - Opening balance
- `notes: string` - Account notes
- `createdAt: ISO8601` - Creation timestamp
- `updatedAt: ISO8601` - Last update timestamp

**AccountHistoryEntry:**
- `date: ISO8601` - Transaction date
- `type: string` - Transaction type (income, expense, transfer, etc.)
- `amount: number` - Transaction amount
- `balance: number` - Balance after transaction

## 6. User Flows

### 6.1. Create Account

1. User opens Accounts page
2. User clicks "Add Account" button
3. Modal displays account creation form
4. User enters required fields (name, type, initial balance)
5. User enters optional fields (icon, notes, currency)
6. System validates input
7. System creates account
8. System returns account with confirmation

### 6.2. View Account History

1. User selects account
2. User clicks "History" tab
3. System loads balance history
4. System displays timeline of balance changes
5. System shows transactions affecting this account

### 6.3. Delete Account

1. User selects account to delete
2. User confirms deletion
3. System validates no transactions exist (optional)
4. System deletes account
5. System returns success confirmation

## 7. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| Account name already exists | Return 400 with error message |
| Account ID not found | Return 404 Not Found |
| Account has associated transactions | Return 400 with warning (or prevent deletion) |
| Invalid account type | Return 400 with error message |

## 8. Open/Closed Questions

1. Should accounts support multiple ownership?
2. Should accounts have credit limit for credit cards?
3. Should accounts have minimum balance requirements?
4. Should account hierarchy (parent/child accounts) be supported?

## 9. Acceptance Criteria

- [ ] User can create multiple accounts with different types
- [ ] User can view all accounts and their balances
- [ ] Account balances are calculated correctly
- [ ] User can update account details
- [ ] User can delete accounts
- [ ] Account history is available
- [ ] Account data is scoped to user
- [ ] Opening balance is preserved