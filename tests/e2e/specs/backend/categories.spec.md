# E2E Test Specification - Categories Module

**Module:** Categories
**Test Suite:** Backend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Categories module backend, covering category CRUD operations, hierarchy management, parent-child relationships, and category usage validation.

## 2. Category CRUD Tests

### 2.1. Create Category

**ID:** BE-T-001
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send POST to `/api/categories` with category data
3. Verify response 201 Created
4. Verify category in database
5. Verify category belongs to user

#### Validation
- [ ] Response status 201
- [ ] Category created
- [ ] Category assigned to user
- [ ] Parent category set if appropriate

#### Expected Result
Category created successfully.

### 2.2. Create Category Without Auth

**ID:** BE-T-002
**Priority:** Must
**Type:** Negative

#### Steps
1. Send POST to `/api/categories` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.3. Create Duplicate Category Name

**ID:** BE-T-003
**Priority:** Must
**Type:** Negative

#### Steps
1. Create category with name
2. Try to create another with same name
3. Verify response 409 Conflict
4. Verify error message

#### Validation
- [ ] Response status 409
- [ ] Error message present
- [ ] No duplicate created

#### Expected Result
Duplicate category names prevented.

### 2.4. Get All Categories

**ID:** BE-T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/categories`
3. Verify response 200 OK
4. Verify all user's categories returned
5. Verify no other user's categories

#### Validation
- [ ] Response status 200
- [ ] All user categories returned
- [ ] No cross-user data
- [ ] Total count correct

#### Expected Result
User's categories retrieved successfully.

### 2.5. Get All Categories Without Auth

**ID:** BE-T-005
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/categories` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.6. Get Category by ID

**ID:** BE-T-006
**Priority:** Must
**Type:** Positive

#### Steps
1. Create category
2. Get category ID
3. Send GET to `/api/categories/:id`
4. Verify response 200 OK
5. Verify category data
6. Verify category belongs to user

#### Validation
- [ ] Response status 200
- [ ] Category data correct
- [ ] Category belongs to user
- [ ] No cross-user data

#### Expected Result
Category retrieved successfully.

### 2.7. Get Category by ID Without Auth

**ID:** BE-T-007
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/categories/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.8. Get Another User's Category

**ID:** BE-T-008
**Priority:** Must
**Type:** Negative

#### Steps
1. Create category for user A
2. Login as user B
3. Try to get user A's category
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user access blocked

#### Expected Result
Cross-user access blocked.

### 2.9. Update Category

**ID:** BE-T-009
**Priority:** Must
**Type:** Positive

#### Steps
1. Create category
2. Send PUT to `/api/categories/:id` with updates
3. Verify response 200 OK
4. Verify changes persisted
5. Verify other fields unchanged

#### Validation
- [ ] Response status 200
- [ ] Changes persisted
- [ ] Other fields unchanged
- [ ] Only owner can update

#### Expected Result
Category updated successfully.

### 2.10. Update Category Without Auth

**ID:** BE-T-010
**Priority:** Must
**Type:** Negative

#### Steps
1. Send PUT to `/api/categories/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.11. Update Another User's Category

**ID:** BE-T-011
**Priority:** Must
**Type:** Negative

#### Steps
1. Create category for user A
2. Login as user B
3. Try to update user A's category
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user updates blocked

#### Expected Result
Cross-user updates blocked.

### 2.12. Delete Category

**ID:** BE-T-012
**Priority:** Must
**Type:** Positive

#### Steps
1. Create category
2. Verify no transactions using category
3. Send DELETE to `/api/categories/:id`
4. Verify response 200 OK
5. Verify category deleted

#### Validation
- [ ] Response status 200
- [ ] Category deleted
- [ ] Only owner can delete
- [ ] No orphaned references

#### Expected Result
Category deleted successfully.

### 2.13. Delete Category With Transactions

**ID:** BE-T-013
**Priority:** Must
**Type:** Negative

#### Steps
1. Create category
2. Create transaction with category
3. Try to delete category
4. Verify response 400 Bad Request
5. Verify category not deleted

#### Validation
- [ ] Response status 400
- [ ] Category not deleted
- [ ] Error message present

#### Expected Result
Deletion blocked when used.

### 2.14. Delete Category Without Auth

**ID:** BE-T-014
**Priority:** Must
**Type:** Negative

#### Steps
1. Send DELETE to `/api/categories/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.15. Delete Another User's Category

**ID:** BE-T-015
**Priority:** Must
**Type:** Negative

#### Steps
1. Create category for user A
2. Login as user B
3. Try to delete user A's category
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user deletes blocked

#### Expected Result
Cross-user deletes blocked.

## 3. Category Hierarchy Tests

### 3.1. Create Parent Category

**ID:** BE-T-016
**Priority:** Must
**Type:** Positive

#### Steps
1. Create parent category
2. Verify response 201 Created
3. Verify parent category saved
4. Verify no parent ID set

#### Validation
- [ ] Response status 201
- [ ] Parent created
- [ ] No parent reference

#### Expected Result
Parent category created.

### 3.2. Create Child Category

**ID:** BE-T-017
**Priority:** Must
**Type:** Positive

#### Steps
1. Create parent category
2. Create child category
3. Set child's parent to parent
4. Verify parent-child relationship
5. Verify hierarchy depth

#### Validation
- [ ] Parent-child relationship established
- [ ] Hierarchy accessible
- [ ] Depth tracked correctly

#### Expected Result
Child category created with parent.

### 3.3. Get Category Hierarchy

**ID:** BE-T-018
**Priority:** Must
**Type:** Positive

#### Steps
1. Create multiple levels of categories
2. Send GET to `/api/categories/hierarchy`
3. Verify tree structure
4. Verify all levels returned

#### Validation
- [ ] Tree structure correct
- [ ] All levels included
- [ ] No cycles detected

#### Expected Result
Category hierarchy retrieved.

### 3.4. Get Subcategories

**ID:** BE-T-019
**Priority:** Must
**Type:** Positive

#### Steps
1. Create parent with multiple children
2. Get subcategories of parent
3. Verify all children returned
4. Verify depth limited correctly

#### Validation
- [ ] All subcategories returned
- [ ] Correct depth
- [ ] No self-reference

#### Expected Result
Subcategories retrieval works.

### 3.5. Get Ancestors

**ID:** BE-T-020
**Priority:** Should
**Type:** Positive

#### Steps
1. Create multi-level hierarchy
2. Get ancestors of leaf category
3. Verify all ancestors returned
4. Verify order correct

#### Validation
- [ ] All ancestors returned
- [ ] Order from root to leaf

#### Expected Result
Ancestors retrieval works.

### 3.6. Move Category

**ID:** BE-T-021
**Priority:** Should
**Type:** Positive

#### Steps
1. Create categories in hierarchy
2. Move category to new parent
3. Verify move successful
4. Verify no cycles

#### Validation
- [ ] Move successful
- [ ] Hierarchy updated
- [ ] No cycles created

#### Expected Result
Category can be moved.

### 3.7. Circular Reference Prevention

**ID:** BE-T-022
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to set category as its own parent
2. Try to create cycle
3. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Cycle prevented

#### Expected Result
Circular references blocked.

## 4. Category Type Tests

### 4.1. Income Category

**ID:** BE-T-023
**Priority:** Must
**Type:** Positive

#### Steps
1. Create income category
2. Verify type 'income'
3. Verify income transactions can use it

#### Validation
- [ ] Type set correctly
- [ ] Type-specific usage allowed

#### Expected Result
Income categories work.

### 4.2. Expense Category

**ID:** BE-T-024
**Priority:** Must
**Type:** Positive

#### Steps
1. Create expense category
2. Verify type 'expense'
3. Verify expense transactions can use it

#### Validation
- [ ] Type set correctly
- [ ] Type-specific usage allowed

#### Expected Result
Expense categories work.

### 4.3. Transfer Category

**ID:** BE-T-025
**Priority:** Must
**Type:** Positive

#### Steps
1. Create transfer category
2. Verify type 'transfer'
3. Verify transfer transactions can use it

#### Validation
- [ ] Type set correctly
- [ ] Type-specific usage allowed

#### Expected Result
Transfer categories work.

## 5. Category Usage Validation Tests

### 5.1. Get Category Stats

**ID:** BE-T-026
**Priority:** Must
**Type:** Positive

#### Steps
1. Create category
2. Create transactions with category
3. Send GET to `/api/categories/:id/stats`
4. Verify statistics

#### Validation
- [ ] Statistics include count
- [ ] Statistics include total
- [ ] Statistics accurate

#### Expected Result
Category statistics work.

### 5.2. Get Category Usage Report

**ID:** BE-T-027
**Priority:** Should
**Type:** Positive

#### Steps
1. Create categories and transactions
2. Get usage report
3. Verify categories with transactions highlighted
4. Verify statistics

#### Validation
- [ ] Usage report includes all categories
- [ ] Categories with usage marked
- [ ] Statistics accurate

#### Expected Result
Usage report works.

### 5.3. Get Unused Categories

**ID:** BE-T-028
**Priority:** Should
**Type:** Positive

#### Steps
1. Create categories
2. Create transactions using some
3. Get unused categories
4. Verify only unused categories returned

#### Validation
- [ ] Unused categories identified
- [ ] Used categories excluded
- [ ] Filter accurate

#### Expected Result
Unused categories can be identified.

### 5.4. Category Weight

**ID:** BE-T-029
**Priority:** Should
**Type:** Positive

#### Steps
1. Create category with weight
2. Create transactions
3. Verify weighted totals
4. Verify weights used correctly

#### Validation
- [ ] Weights stored
- [ ] Weighted calculations correct
- [ ] Used in aggregations

#### Expected Result
Category weights work.

## 6. Default Category Tests

### 6.1. Set Default Category

**ID:** BE-T-030
**Priority:** Must
**Type:** Positive

#### Steps
1. Create category
2. Set as default for transactions
3. Verify default category saved
4. Verify default used for new transactions

#### Validation
- [ ] Default category set
- [ ] Default category persisted
- [ ] Default applied to new transactions

#### Expected Result
Default category works.

### 6.2. Default Category Per Type

**ID:** BE-T-031
**Priority:** Must
**Type:** Positive

#### Steps
1. Set default for income
2. Set default for expense
3. Create income transaction
4. Create expense transaction
5. Verify correct defaults used

#### Validation
- [ ] Default per type
- [ ] Types use correct defaults
- [ ] Defaults not mixed

#### Expected Result
Default categories per type work.

## 7. Custom Fields Tests

### 7.1. Add Custom Field

**ID:** BE-T-032
**Priority:** Should
**Type:** Positive

#### Steps
1. Create custom field definition
2. Assign to category
3. Verify custom field on category

#### Validation
- [ ] Custom field created
- [ ] Field assigned to category

#### Expected Result
Custom fields can be added.

### 7.2. Use Custom Field in Transaction

**ID:** BE-T-033
**Priority:** Should
**Type:** Integration

#### Steps
1. Add custom field to category
2. Create transaction with custom field value
3. Verify value stored
4. Verify value retrieved

#### Validation
- [ ] Custom field value stored
- [ ] Value accessible

#### Expected Result
Custom field values work in transactions.

## 8. Performance Tests

### 8.1. List Categories Performance

**ID:** BE-T-034
**Priority:** Must
**Type:** Performance

#### Steps
1. Send GET to `/api/categories`
2. Measure response time
3. Verify meets 100ms threshold

#### Validation
- [ ] Response < 100ms
- [ ] Proper indexing
- [ ] Efficient queries

#### Expected Result
Category listing is fast.

### 8.2. Get Hierarchy Performance

**ID:** BE-T-035
**Priority:** Should
**Type:** Performance

#### Steps
1. Send GET to `/api/categories/hierarchy`
2. Measure response time
3. Verify acceptable performance

#### Validation
- [ ] Response reasonable
- [ ] Hierarchy traversed efficiently

#### Expected Result
Hierarchy retrieval is efficient.

## 9. Error Handling Tests

### 9.1. Error Messages

**ID:** BE-T-036
**Priority:** Must
**Type:** Positive

#### Steps
1. Trigger various errors
2. Inspect error responses
3. Verify error messages
4. Verify error codes

#### Validation
- [ ] Appropriate error codes
- [ ] Clear error messages
- [ ] No sensitive data

#### Expected Result
Error messages are clear and secure.

### 9.2. Invalid Parent Category

**ID:** BE-T-037
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to create category with non-existent parent
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid parent prevented.

## 10. Integration Tests

### 10.1. Transaction Categorization

**ID:** BE-T-038
**Priority:** Must
**Type:** Integration

#### Steps
1. Create category
2. Create transaction with category
3. Verify transaction linked to category
4. Verify category stats updated

#### Validation
- [ ] Transaction linked correctly
- [ ] Category stats accurate
- [ ] Analytics updated

#### Expected Result
Transactions properly categorized.

### 10.2. Budget Category Link

**ID:** BE-T-039
**Priority:** Should
**Type:** Integration

#### Steps
1. Create category
2. Set budget for category
3. Create transactions in category
4. Verify budget tracking

#### Validation
- [ ] Category-budget link works
- [ ] Budget tracking accurate
- [ ] Spending calculations correct

#### Expected Result
Budget category linking works.

## 11. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] Hierarchy management working
- [ ] Category types correct
- [ ] No orphaned references
- [ ] Cross-user data isolation working

## 12. Test Execution Notes

- Test category hierarchy deep nesting
- Verify no circular references
- Test with many categories
- Verify category usage stats
- Test custom fields
- Verify default categories

## 13. Dependencies

- Database with categories table
- Hierarchy management
- Transaction-category relationship
- Custom fields system
- Budget integration