# E2E Test Specification - Accounts Module

**Module:** Accounts
**Test Suite:** Frontend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Accounts module, covering account management, balance tracking, and reporting.

## 2. Test Scenarios

### 2.1. View Accounts

**ID:** T-001
**Priority:** Must
**Type:** Smoke

#### Setup
- User is logged in
- User navigates to "Accounts" module

#### Steps
1. Click on "Accounts" navigation item
2. Verify accounts list is displayed
3. Verify account cards are visible

#### Validation
- [ ] Accounts list renders
- [ ] Header is visible
- [ ] Filter controls are visible

#### Expected Result
User sees the accounts list with all accounts displayed.

### 2.2. Add Account

**ID:** T-002
**Priority:** Must
**Type:** Positive

#### Steps
1. Click "Add Account" button
2. Fill in account details:
   - Name: "Checking Account"
   - Type: Checking
   - Initial Balance: $1000
   - Currency: USD
3. Click "Save"
4. Verify success message
5. Verify account appears in list

#### Validation
- [ ] Modal opens
- [ ] Form fields are visible
- [ ] Success message displays
- [ ] Account appears in list

#### Expected Result
Account is created and appears in the list.

### 2.3. Edit Account

**ID:** T-003
**Priority:** Must
**Type:** Positive

#### Steps
1. Locate account in list
2. Click "Edit" button
3. Modify balance to $1500
4. Click "Save"
5. Verify success message
6. Verify balance is updated

#### Validation
- [ ] Edit modal opens
- [ ] Values are pre-filled
- [ ] Success message displays
- [ ] Balance is updated

#### Expected Result
Account is updated with success message.

### 2.4. Delete Account

**ID:** T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Locate account in list
2. Click "Delete" button
3. Confirm deletion
4. Verify success message
5. Verify account is removed from list

#### Validation
- [ ] Delete confirmation appears
- [ ] Success message displays
- [ ] Account is removed

#### Expected Result
Account is deleted with confirmation.

### 2.5. Filter Accounts

**ID:** T-005
**Priority:** Must
**Type:** Positive

#### Steps
1. Click filter dropdown
2. Select "By Type: Checking"
3. Verify list is filtered

#### Validation
- [ ] Filter dropdown is visible
- [ ] List is filtered to show only selected type
- [ ] Filter is active

#### Expected Result
Accounts list is filtered by type.

### 2.6. View Account Balance History

**ID:** T-006
**Priority:** Should
**Type:** Positive

#### Steps
1. Click on account in list
2. Verify balance history is displayed
3. Verify chart renders

#### Validation
- [ ] Details modal opens
- [ ] Balance history is visible
- [ ] Chart renders correctly

#### Expected Result
Account balance history is displayed.

### 2.7. Add Account Transaction

**ID:** T-007
**Priority:** Must
**Type:** Integration

#### Steps
1. Create expense transaction for account
2. Verify account balance updates
3. Verify transaction appears on account

#### Validation
- [ ] Account balance decreases
- [ ] Transaction is associated with account
- [ ] Totals are correct

#### Expected Result
Account balance and transactions are updated.

### 2.8. Change Account Icon

**ID:** T-008
**Priority:** Should
**Type:** Positive

#### Steps
1. Click on account
2. Change account icon
3. Click "Save"
4. Verify icon updates

#### Validation
- [ ] Icon picker is visible
- [ ] Icon is updated
- [ ] Modal closes

#### Expected Result
Account icon is changed.

### 2.9. Set Default Account

**ID:** T-009
**Priority:** Should
**Type:** Positive

#### Steps
1. Click on account
2. Set as default account
3. Verify default indicator

#### Validation
- [ ] Default option is visible
- [ ] Default indicator appears
- [ ] Other accounts lose default status

#### Expected Result
Account is marked as default.

### 2.10. Set Account Currency

**ID:** T-010
**Priority:** Should
**Type:** Positive

#### Steps
1. Edit account
2. Change currency to EUR
3. Save
4. Verify balance converts

#### Validation
- [ ] Currency dropdown is visible
- [ ] Balance displays in new currency
- [ ] Conversion is accurate

#### Expected Result
Account currency is changed.

### 2.11. Export Account Data

**ID:** T-011
**Priority:** Should
**Type:** Positive

#### Steps
1. Click "Export" button
2. Select format
3. Verify download

#### Validation
- [ ] Export options are visible
- [ ] File downloads
- [ ] File is valid

#### Expected Result
Account data is exported.

### 2.12. Account Search

**ID:** T-012
**Priority:** Should
**Type:** Positive

#### Steps
1. Click search input
2. Type account name
3. Verify filtered results

#### Validation
- [ ] Search accepts input
- [ ] Results show matching accounts
- [ ] Empty state if no matches

#### Expected Result
Search returns matching accounts.

### 2.13. Mobile Responsive

**ID:** T-013
**Priority:** Must
**Type:** Visual

#### Steps
1. Resize to mobile width
2. Navigate to Accounts page
3. Verify layout adapts

#### Validation
- [ ] Layout is responsive
- [ ] Buttons are touch-friendly
- [ ] Filters accessible

#### Expected Result
Page works on mobile devices.

### 2.14. Empty State

**ID:** T-014
**Priority:** Must
**Type:** Visual

#### Steps
1. Navigate to Accounts page with no accounts
2. Verify empty state

#### Validation
- [ ] Empty state message visible
- [ ] "Add Account" button visible
- [ ] Illustration present

#### Expected Result
Empty state displays appropriately.

### 2.15. Toast Notifications

**ID:** T-015
**Priority:** Must
**Type:** Visual

#### Steps
1. Add account
2. Verify toast notification

#### Validation
- [ ] Toast appears
- [ ] Shows success message
- [ ] Auto-dismisses

#### Expected Result
Toast notification is displayed.

## 3. Negative Test Scenarios

### 3.1. Invalid Initial Balance

**ID:** T-N001
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to create account with negative balance
2. Try to create account with 0 balance
3. Verify error message

#### Expected Result
Form shows validation error.

### 3.2. Duplicate Account Name

**ID:** T-N002
**Priority:** Must
**Type:** Negative

#### Steps
1. Create account named "Test"
2. Try to create another account with same name
3. Verify error message

#### Expected Result
Error shown for duplicate name.

### 3.3. Negative Balance Warning

**ID:** T-N003
**Priority:** Should
**Type:** Negative

#### Steps
1. Create account with negative starting balance
2. Verify warning message

#### Expected Result
Warning displayed for negative balance.

### 3.4. Network Error

**ID:** T-N004
**Priority:** Should
**Type:** Negative

#### Steps
1. Simulate network failure
2. Try to create account
3. Verify error message

#### Expected Result
Error message displayed.

## 4. Integration Tests

### 4.1. Account Total Balance

**ID:** T-I001
**Priority:** Must
**Type:** Integration

#### Steps
1. Create multiple accounts with balances
2. Verify total balance calculation
3. Verify total includes all accounts

#### Validation
- [ ] Total balance shown
- [ ] Total includes all accounts
- [ ] Totals match sum

#### Expected Result
Total balance is accurate.

### 4.2. Account in Transactions

**ID:** T-I002
**Priority:** Must
**Type:** Integration

#### Steps
1. Create transaction on account
2. Verify account in transaction details
3. Verify account balance updated

#### Validation
- [ ] Account link works
- [ ] Balance updated correctly

#### Expected Result
Transactions properly link to accounts.

### 4.3. Account in Budget

**ID:** T-I003
**Priority:** Should
**Type:** Integration

#### Steps
1. Set account as expense account
2. Create expense transaction
3. Verify budget uses correct account

#### Validation
- [ ] Budget calculation uses account
- [ ] Spending tracked correctly

#### Expected Result
Budget integration works.

### 4.4. Account in Reports

**ID:** T-I004
**Priority:** Should
**Type:** Integration

#### Steps
1. Create transactions on account
2. Generate report
3. Verify account appears in report

#### Validation
- [ ] Account included in report
- [ ] Data accurate

#### Expected Result
Reports include account data.

### 4.5. Account in Dashboard

**ID:** T-I005
**Priority:** Should
**Type:** Integration

#### Steps
1. Create accounts and transactions
2. View Dashboard
3. Verify account totals shown

#### Validation
- [ ] Account balance shown
- [ ] Recent transactions shown

#### Expected Result
Dashboard reflects accounts.

## 5. Performance Tests

### 5.1. Load Speed

**ID:** T-P001
**Priority:** Must
**Type:** Performance

#### Steps
1. Navigate to Accounts page
2. Measure load time
3. Verify meets 2s threshold

#### Expected Result
Page loads within 2 seconds.

### 5.2. Filter Performance

**ID:** T-P002
**Priority:** Should
**Type:** Performance

#### Steps
1. Apply filter
2. Measure response time
3. Verify meets 500ms threshold

#### Expected Result
Filter responds within 500ms.

## 6. Accessibility Tests

### 6.1. Keyboard Navigation

**ID:** T-A001
**Priority:** Must
**Type:** Accessibility

#### Steps
1. Navigate with Tab key
2. Verify focus management
3. Test keyboard shortcuts

#### Validation
- [ ] Tab moves through controls
- [ ] Enter activates buttons
- [ ] Escape closes modals

#### Expected Result
Full keyboard navigation works.

### 6.2. Screen Reader Support

**ID:** T-A002
**Priority:** Should
**Type:** Accessibility

#### Steps
1. Test with screen reader
2. Verify announcements

#### Validation
- [ ] Screen reader announces page
- [ ] Account list is readable
- [ ] Modals announced

#### Expected Result
Screen reader support works.

## 7. Cross-Browser Tests

### 7.1. Browser Compatibility

**ID:** T-C001
**Priority:** Must
**Type:** Cross-Browser

#### Steps
1. Test in Chrome, Firefox, Safari, Edge
2. Verify consistent behavior

#### Validation
- [ ] All browsers work
- [ ] No console errors
- [ ] Features functional

#### Expected Result
Works across all major browsers.

## 8. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] Accessibility requirements met
- [ ] No critical bugs

## 9. Test Execution Notes

- Run on staging environment
- Use test data cleanup
- Test with different account types
- Verify currency conversion

## 10. Dependencies

- Backend /api/accounts must be operational
- Auth system must be functional
- Currency conversion API must be available