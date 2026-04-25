# E2E Test Specification - Categories Module

**Module:** Categories
**Test Suite:** Frontend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Categories module, covering category hierarchy, management, and transaction filtering.

## 2. Test Scenarios

### 2.1. View Categories

**ID:** T-001
**Priority:** Must
**Type:** Smoke

#### Steps
1. Navigate to "Categories" module
2. Verify category tree is displayed
3. Verify expand/collapse controls

#### Validation
- [ ] Category tree renders
- [ ] Parent categories visible
- [ ] Child categories visible

#### Expected Result
User sees the category hierarchy.

### 2.2. Add Category

**ID:** T-002
**Priority:** Must
**Type:** Positive

#### Steps
1. Click "Add Category" button
2. Fill in category details:
   - Name: "Utilities"
   - Type: Expense
   - Parent: None
   - Color: Blue
   - Icon: Home
3. Click "Save"
4. Verify success message
5. Verify category appears in tree

#### Validation
- [ ] Modal opens
- [ ] Form fields are visible
- [ ] Success message displays
- [ ] Category appears in tree

#### Expected Result
Category is created and appears in tree.

### 2.3. Add Subcategory

**ID:** T-003
**Priority:** Must
**Type:** Positive

#### Steps
1. Click "Add Subcategory" on parent category
2. Fill in category details:
   - Name: "Electricity"
   - Type: Expense
   - Parent: Utilities
3. Click "Save"
4. Verify category is nested correctly

#### Validation
- [ ] Subcategory is nested under parent
- [ ] Parent category shows indicator
- [ ] Tree structure is correct

#### Expected Result
Subcategory is properly nested.

### 2.4. Edit Category

**ID:** T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Edit category name
2. Change color
3. Change icon
4. Save
5. Verify updates

#### Validation
- [ ] Form opens with values
- [ ] Updates are saved
- [ ] Tree reflects changes

#### Expected Result
Category is updated correctly.

### 2.5. Delete Category

**ID:** T-005
**Priority:** Must
**Type:** Positive

#### Steps
1. Delete category with no transactions
2. Verify success message
3. Verify category removed

#### Validation
- [ ] Confirmation appears
- [ ] Category is deleted
- [ ] Success message shows

#### Expected Result
Category is deleted.

### 2.6. Delete Category with Transactions

**ID:** T-006
**Priority:** Must
**Type:** Positive

#### Steps
1. Delete category with existing transactions
2. Verify warning about transactions
3. Verify option to move transactions

#### Validation
- [ ] Warning is displayed
- [ ] Transaction handling options available

#### Expected Result
Warning shown, transactions handled appropriately.

### 2.7. Filter Transactions by Category

**ID:** T-007
**Priority:** Must
**Type:** Positive

#### Steps
1. Select category in filter
2. Verify transactions filtered

#### Validation
- [ ] Filter dropdown is visible
- [ ] Transactions filtered correctly
- [ ] Empty state if no transactions

#### Expected Result
Transactions filtered by category.

### 2.8. Set Default Category

**ID:** T-008
**Priority:** Should
**Type:** Positive

#### Steps
1. Set category as default for new transactions
2. Create transaction
3. Verify default category assigned

#### Validation
- [ ] Default option is visible
- [ ] Default category is used
- [ ] Option to change

#### Expected Result
Default category is set.

### 2.9. Change Category Type

**ID:** T-009
**Priority:** Should
**Type:** Positive

#### Steps
1. Change category type
2. Verify transactions use new type

#### Validation
- [ ] Type dropdown is visible
- [ ] Type change is reflected
- [ ] Integrations work

#### Expected Result
Category type changes work.

### 2.10. Mobile Responsive

**ID:** T-010
**Priority:** Must
**Type:** Visual

#### Steps
1. Resize to mobile
2. Navigate to Categories
3. Verify layout

#### Validation
- [ ] Layout is responsive
- [ ] Tree is scrollable
- [ ] Controls accessible

#### Expected Result
Page works on mobile.

### 2.11. Empty State

**ID:** T-011
**Priority:** Must
**Type:** Visual

#### Steps
1. Navigate with no categories
2. Verify empty state

#### Validation
- [ ] Empty message visible
- [ ] "Add Category" button visible

#### Expected Result
Empty state displayed.

### 2.12. Toast Notifications

**ID:** T-012
**Priority:** Must
**Type:** Visual

#### Steps
1. Add category
2. Verify toast

#### Validation
- [ ] Toast appears
- [ ] Shows success message

#### Expected Result
Toast notification displayed.

## 3. Negative Test Scenarios

### 3.1. Duplicate Category Name

**ID:** T-N001
**Priority:** Must
**Type:** Negative

#### Steps
1. Create category with existing name
2. Verify error message

#### Expected Result
Error for duplicate name.

### 3.2. Invalid Category Name

**ID:** T-N002
**Priority:** Must
**Type:** Negative

#### Steps
1. Create category with empty name
2. Verify validation error

#### Expected Result
Error for invalid name.

### 3.3. Invalid Type

**ID:** T-N003
**Priority:** Should
**Type:** Negative

#### Steps
1. Set invalid category type
2. Verify error

#### Expected Result
Error for invalid type.

### 3.4. Invalid Parent

**ID:** T-N004
**Priority:** Should
**Type:** Negative

#### Steps
1. Set parent as self
2. Verify error

#### Expected Result
Error prevents circular reference.

### 3.5. Network Error

**ID:** T-N005
**Priority:** Should
**Type:** Negative

#### Steps
1. Simulate network failure
2. Try to create category
3. Verify error

#### Expected Result
Error message displayed.

## 4. Integration Tests

### 4.1. Category in Transactions

**ID:** T-I001
**Priority:** Must
**Type:** Integration

#### Steps
1. Create transaction with category
2. Verify category in transaction details
3. Verify category in reports

#### Validation
- [ ] Category linked correctly
- [ ] Reports include category
- [ ] Budgets use category

#### Expected Result
Category integration works.

### 4.2. Category in Budget

**ID:** T-I002
**Priority:** Must
**Type:** Integration

#### Steps
1. Create budget for category
2. Create transaction in category
3. Verify budget progress

#### Validation
- [ ] Budget updates
- [ ] Spending tracked
- [ ] Over-budget warning

#### Expected Result
Budget integration works.

### 4.3. Category in Analytics

**ID:** T-I003
**Priority:** Should
**Type:** Integration

#### Steps
1. Create transactions with categories
2. View analytics
3. Verify spending by category

#### Validation
- [ ] Analytics shows category breakdown
- [ ] Charts include category data

#### Expected Result
Analytics includes category data.

### 4.4. Category in Dashboard

**ID:** T-I004
**Priority:** Should
**Type:** Integration

#### Steps
1. Create transactions with categories
2. View Dashboard
3. Verify spending by category

#### Validation
- [ ] Spending categories shown
- [ ] Recent transactions by category

#### Expected Result
Dashboard shows category breakdown.

### 4.5. Change Parent Category

**ID:** T-I005
**Priority:** Should
**Type:** Integration

#### Steps
1. Move subcategory to new parent
2. Verify transactions still show correct parent
3. Verify reports update

#### Validation
- [ ] Parent change works
- [ ] Category hierarchy updated
- [ ] Data integrity maintained

#### Expected Result
Category hierarchy updates work.

## 5. Performance Tests

### 5.1. Load Speed

**ID:** T-P001
**Priority:** Must
**Type:** Performance

#### Steps
1. Navigate to Categories
2. Measure load time
3. Verify meets 2s threshold

#### Expected Result
Page loads within 2 seconds.

### 5.2. Tree Expand/Collapse

**ID:** T-P002
**Priority:** Should
**Type:** Performance

#### Steps
1. Expand category tree
2. Measure response time
3. Verify meets 200ms threshold

#### Expected Result
Tree operations are fast.

## 6. Accessibility Tests

### 6.1. Keyboard Navigation

**ID:** T-A001
**Priority:** Must
**Type:** Accessibility

#### Steps
1. Navigate with Tab
2. Test keyboard controls

#### Validation
- [ ] Tab moves through items
- [ ] Expand/collapse works
- [ ] Enter activates buttons

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
- [ ] Category tree is announced
- [ ] Modal is announced
- [ ] Errors are announced

#### Expected Result
Screen reader support works.

## 7. Cross-Browser Tests

### 7.1. Browser Compatibility

**ID:** T-C001
**Priority:** Must
**Type:** Cross-Browser

#### Steps
1. Test in Chrome, Firefox, Safari, Edge
2. Verify behavior

#### Validation
- [ ] All browsers work
- [ ] No console errors

#### Expected Result
Works across browsers.

## 8. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] Accessibility requirements met
- [ ] No critical bugs

## 9. Test Execution Notes

- Test with deep category hierarchies
- Verify circular reference prevention
- Test with many transactions per category

## 10. Dependencies

- Backend /api/categories must be operational
- Auth system must be functional