# Transactions Specification

**Module:** Transactions
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

Transactions represent individual financial events with income, expenses, transfers, and receipts.

## 2. Functional Requirements

### 2.1. CRUD Operations

| ID | Description | Type |
|----|-------------|------|
| T-001 | Get all transactions must support filtering and pagination | Must |
| T-002 | Get single transaction by ID must return transaction data | Must |
| T-003 | Create transaction must validate required fields | Must |
| T-004 | Create transaction must return newly created transaction | Must |
| T-005 | Update transaction must allow partial updates | Must |
| T-006 | Update transaction must return updated transaction | Must |
| T-007 | Delete transaction must remove transaction | Must |
| T-008 | Bulk delete must remove multiple transactions | Should |
| T-009 | Bulk update must support batch operations | Should |

### 2.2. Transaction Data

| ID | Description | Type |
|----|-------------|------|
| T-010 | Transaction must have required fields (date, amount, type) | Must |
| T-011 | Transaction must have optional fields (description, category) | Must |
| T-012 | Transaction must support multiple tags | Should |
| T-013 | Transaction must have receipt attachment support | Should |
| T-014 | Transaction must have reconciliation status | Should |

### 2.3. Transaction Types

| ID | Description | Type |
|----|-------------|------|
| T-020 | Transaction must support income type | Must |
| T-021 | Transaction must support expense type | Must |
| T-022 | Transaction must support transfer type | Must |
| T-023 | Transfer transactions must update both accounts | Must |
| T-024 | Pending transactions must be flagged | Should |
| T-025 | Recurring transactions must be tracked | Should |

### 2.4. Filtering and Sorting

| ID | Description | Type |
|----|-------------|------|
| T-030 | Filter by date range | Must |
| T-031 | Filter by category | Must |
| T-032 | Filter by type (income/expense/transfer) | Must |
| T-033 | Filter by account | Must |
| T-034 | Sort by date, amount, or name | Must |
| T-035 | Pagination support | Must |
| T-036 | Search by description | Should |

### 2.5. Aggregation

| ID | Description | Type |
|----|-------------|------|
| T-040 | Summary endpoint must return total income | Must |
| T-041 | Summary endpoint must return total expenses | Must |
| T-042 | Summary endpoint must return transaction count | Must |
| T-043 | Summary must support period filtering (day, week, month, year) | Must |
| T-044 | Summary must return transaction by category | Should |

### 2.6. Reconciliation

| ID | Description | Type |
|----|-------------|------|
| T-050 | Reconcile endpoint must mark transactions as reconciled | Should |
| T-051 | Bulk reconcile must support multiple transactions | Should |
| T-052 | Reconcile status must be visible | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | Get transactions with filters must complete within 500ms | 500ms |
| NFR-002 | Create transaction must complete within 100ms | 100ms |
| NFR-003 | Update transaction must complete within 100ms | 100ms |
| NFR-004 | Summary endpoint must complete within 200ms | 200ms |

### 3.2. Data Consistency

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-005 | Transaction updates must be atomic | Always |
| NFR-006 | Account balances must update on transfer transactions | Always |

### 3.3. Security

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-007 | Transaction access must be scoped to user | Always |
| NFR-008 | Receipt data must be accessible only to transaction owner | Always |

## 4. API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/transactions` | GET | Get transactions with filters |
| `/api/transactions` | POST | Create new transaction |
| `/api/transactions/:id` | GET | Get single transaction |
| `/api/transactions/:id` | PUT | Update transaction |
| `/api/transactions/:id` | DELETE | Delete transaction |
| `/api/transactions/bulk` | PUT | Bulk update transactions |
| `/api/transactions` | DELETE | Bulk delete transactions |
| `/api/transactions/summary` | GET | Get transaction summary |
| `/api/transactions/reconcile/summary` | GET | Get reconciliation summary |
| `/api/transactions/:id/tags` | GET | Get transaction tags |
| `/api/transactions/:id/tags` | POST | Add tag to transaction |
| `/api/transactions/:id/tags` | PUT | Update transaction tags |
| `/api/transactions/by-tag/:tagId` | GET | Get transactions by tag |

## 5. Data Models

**Transaction:**
- `id: string` - Transaction UUID
- `date: ISO8601` - Transaction date
- `description: string` - Description
- `amount: number` - Transaction amount
- `type: string` - 'income', 'expense', 'transfer'
- `category: string` - Category name
- `categoryId: string` - Category ID (optional)
- `accountId: string` - Associated account ID
- `notes: string` - Transaction notes
- `tags: string[]` - Array of tag IDs
- `receiptId: string` - Receipt file ID (optional)
- `reconciled: boolean` - Reconciliation status
- `createdAt: ISO8601` - Creation timestamp
- `updatedAt: ISO8601` - Last update timestamp

**TransactionSummary:**
- `totalIncome: number` - Sum of income transactions
- `totalExpenses: number` - Sum of expense transactions
- `incomeByCategory: CategoryBalance[]` - Income by category
- `expenseByCategory: CategoryBalance[]` - Expenses by category
- `transactionCount: number` - Total transaction count
- `period: string` - Summary period (e.g., '2024-01', '2024-01-01 to 2024-01-31')

## 6. User Flows

### 6.1. Create Transaction

1. User opens Transactions page
2. User clicks "Add Transaction" button
3. Modal displays transaction form
4. User enters required fields
5. User selects optional fields
6. System validates input
7. System creates transaction
8. System returns transaction with confirmation

### 6.2. Filter Transactions

1. User selects filter criteria
2. User applies filter (date range, category, etc.)
3. System queries transactions
4. System returns filtered results
5. System updates summary metrics

### 6.3. Reconcile Transaction

1. User selects transaction to reconcile
2. User marks as reconciled
3. System updates reconciliation status
4. System updates account balance

## 7. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| Invalid date format | Return 400 with error message |
| Missing required fields | Return 400 with error message |
| Transaction ID not found | Return 404 Not Found |
| Account ID not found (for transfer) | Return 400 Account not found |
| Insufficient funds (for transfer) | Return 400 Insufficient funds |

## 8. Open/Closed Questions

1. Should transactions support attachments beyond receipts?
2. Should scheduled transactions be supported?
3. Should transaction splitting be supported?
4. Should transaction templates be available?

## 9. Acceptance Criteria

- [ ] User can create, read, update, delete transactions
- [ ] User can filter transactions by date, category, type, account
- [ ] User can sort transactions by date, amount, name
- [ ] User can view transaction summary by period
- [ ] Transfers update both account balances correctly
- [ ] Transactions have unique IDs
- [ ] Transactions are scoped to user's profiles
- [ ] Invalid transactions are rejected with clear errors