# E2E Test Specification - Tags Module

**Module:** Tags
**Test Suite:** Backend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Tags module backend, covering tag CRUD operations, tag hierarchy, tag assignment to transactions, tag filtering, tag grouping, tag deletion, tag renaming, tag color customization, and tag statistics.

## 2. Tag CRUD Tests

### 2.1. Create Tag

**ID:** BE-T-001
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send POST to `/api/tags` with tag data
3. Verify response 201 Created
4. Verify tag in database
5. Verify tag belongs to user

#### Validation
- [ ] Response status 201
- [ ] Tag created
- [ ] Tag assigned to user
- [ ] Name saved

#### Expected Result
Tag created successfully.

### 2.2. Create Tag Without Auth

**ID:** BE-T-002
**Priority:** Must
**Type:** Negative

#### Steps
1. Send POST to `/api/tags` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.3. Create Duplicate Tag

**ID:** BE-T-003
**Priority:** Must
**Type:** Negative

#### Steps
1. Create tag with name
2. Try to create another with same name
3. Verify response 409 Conflict
4. Verify error message

#### Validation
- [ ] Response status 409
- [ ] Error message present
- [ ] No duplicate created

#### Expected Result
Duplicate tags prevented.

### 2.4. Get All Tags

**ID:** BE-T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/tags`
3. Verify response 200 OK
4. Verify all user's tags returned
5. Verify no other user's tags

#### Validation
- [ ] Response status 200
- [ ] All user tags returned
- [ ] No cross-user data
- [ ] Total count correct

#### Expected Result
User's tags retrieved successfully.

### 2.5. Get All Tags Without Auth

**ID:** BE-T-005
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/tags` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.6. Get Tag by ID

**ID:** BE-T-006
**Priority:** Must
**Type:** Positive

#### Steps
1. Create tag
2. Get tag ID
3. Send GET to `/api/tags/:id`
4. Verify response 200 OK
5. Verify tag data
6. Verify tag belongs to user

#### Validation
- [ ] Response status 200
- [ ] Tag data correct
- [ ] Tag belongs to user
- [ ] No cross-user data

#### Expected Result
Tag retrieved successfully.

### 2.7. Get Tag by ID Without Auth

**ID:** BE-T-007
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/tags/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.8. Get Another User's Tag

**ID:** BE-T-008
**Priority:** Must
**Type:** Negative

#### Steps
1. Create tag for user A
2. Login as user B
3. Try to get user A's tag
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user access blocked

#### Expected Result
Cross-user access blocked.

### 2.9. Update Tag

**ID:** BE-T-009
**Priority:** Must
**Type:** Positive

#### Steps
1. Create tag
2. Send PUT to `/api/tags/:id` with updates
3. Verify response 200 OK
4. Verify changes persisted
5. Verify other fields unchanged

#### Validation
- [ ] Response status 200
- [ ] Changes persisted
- [ ] Other fields unchanged
- [ ] Only owner can update

#### Expected Result
Tag updated successfully.

### 2.10. Update Tag Without Auth

**ID:** BE-T-010
**Priority:** Must
**Type:** Negative

#### Steps
1. Send PUT to `/api/tags/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.11. Update Another User's Tag

**ID:** BE-T-011
**Priority:** Must
**Type:** Negative

#### Steps
1. Create tag for user A
2. Login as user B
3. Try to update user A's tag
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user updates blocked

#### Expected Result
Cross-user updates blocked.

### 2.12. Delete Tag

**ID:** BE-T-012
**Priority:** Must
**Type:** Positive

#### Steps
1. Create tag
2. Send DELETE to `/api/tags/:id`
3. Verify response 200 OK
4. Verify tag deleted

#### Validation
- [ ] Response status 200
- [ ] Tag deleted
- [ ] Only owner can delete

#### Expected Result
Tag deleted successfully.

### 2.13. Delete Tag Without Auth

**ID:** BE-T-013
**Priority:** Must
**Type:** Negative

#### Steps
1. Send DELETE to `/api/tags/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.14. Delete Another User's Tag

**ID:** BE-T-014
**Priority:** Must
**Type:** Negative

#### Steps
1. Create tag for user A
2. Login as user B
3. Try to delete user A's tag
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user deletes blocked

#### Expected Result
Cross-user deletes blocked.

## 3. Tag Data Validation Tests

### 3.1. Invalid Tag Data

**ID:** BE-T-015
**Priority:** Must
**Type:** Negative

#### Steps
1. Create tag with invalid data
2. Verify response 400 Bad Request
3. Verify validation errors

#### Validation
- [ ] Response status 400
- [ ] Validation errors present
- [ ] No tag created

#### Expected Result
Invalid tag data rejected.

### 3.2. Missing Tag Name

**ID:** BE-T-016
**Priority:** Must
**Type:** Negative

#### Steps
1. Create tag without name
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Missing tag name prevented.

### 3.3. Empty Tag Name

**ID:** BE-T-017
**Priority:** Must
**Type:** Negative

#### Steps
1. Create tag with empty name
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Empty tag name prevented.

### 3.4. Tag Name Too Long

**ID:** BE-T-018
**Priority:** Must
**Type:** Negative

#### Steps
1. Create tag with name exceeding max length
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Tag name too long prevented.

### 3.5. Invalid Tag Color

**ID:** BE-T-019
**Priority:** Must
**Type:** Negative

#### Steps
1. Create tag with invalid color format
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid tag color prevented.

## 4. Tag Hierarchy Tests

### 4.1. Create Parent Tag

**ID:** BE-T-020
**Priority:** Must
**Type:** Positive

#### Steps
1. Create parent tag
2. Verify parent tag created
3. Verify parent is a root tag
4. Verify no parent set

#### Validation
- [ ] Parent tag created
- [ ] Parent is root level
- [ ] Parent has no parent

#### Expected Result
Parent tag created successfully.

### 4.2. Create Child Tag

**ID:** BE-T-021
**Priority:** Must
**Type:** Positive

#### Steps
1. Create parent tag
2. Create child tag with parent ID
3. Verify child tag created
4. Verify child has parent
5. Verify parent has child

#### Validation
- [ ] Child tag created
- [ ] Child has parent
- [ ] Parent has child
- [ ] Hierarchy established

#### Expected Result
Child tag created successfully.

### 4.3. Create Grandchild Tag

**ID:** BE-T-022
**Priority:** Must
**Type:** Positive

#### Steps
1. Create parent tag
2. Create child tag
3. Create grandchild tag with child ID
4. Verify grandchild has child
5. Verify child has parent and grandchild

#### Validation
- [ ] Grandchild tag created
- [ ] Grandchild has child
- [ ] Child has parent and grandchild
- [ ] Hierarchy maintained

#### Expected Result
Grandchild tag created successfully.

### 4.4. Create Cycle Reference

**ID:** BE-T-023
**Priority:** Must
**Type:** Negative

#### Steps
1. Create tag A
2. Create tag B with parent A
3. Try to set parent A as child of B
4. Verify response 400 Bad Request
5. Verify no cycle created

#### Validation
- [ ] Response status 400
- [ ] No cycle created
- [ ] Cycle detection works

#### Expected Result
Cycle reference prevented.

### 4.5. Get Tag Hierarchy

**ID:** BE-T-024
**Priority:** Must
**Type:** Positive

#### Steps
1. Create nested tags
2. Get tag hierarchy
3. Verify correct hierarchy structure
4. Verify all tags included

#### Validation
- [ ] Hierarchy structure correct
- [ ] All tags included
- [ ] No orphaned tags

#### Expected Result
Tag hierarchy retrieved successfully.

### 4.6. Flatten Tag Hierarchy

**ID:** BE-T-025
**Priority:** Should
**Type:** Positive

#### Steps
1. Create nested tags
2. Flatten hierarchy
3. Verify all tags in flat list
4. Verify order preserved

#### Validation
- [ ] All tags in flat list
- [ ] Order preserved
- [ ] Children after parents

#### Expected Result
Tag hierarchy flattened successfully.

## 5. Tag Assignment Tests

### 5.1. Assign Tag to Transaction

**ID:** BE-T-026
**Priority:** Must
**Type:** Integration

#### Steps
1. Create tag
2. Create transaction
3. Assign tag to transaction
4. Verify tag associated
5. Verify transaction has tag

#### Validation
- [ ] Tag assigned
- [ ] Transaction has tag
- [ ] Assignment persisted

#### Expected Result
Tag assigned to transaction successfully.

### 5.2. Assign Multiple Tags to Transaction

**ID:** BE-T-027
**Priority:** Must
**Type:** Positive

#### Steps
1. Create multiple tags
2. Create transaction
3. Assign multiple tags to transaction
4. Verify all tags associated
5. Verify no duplicates

#### Validation
- [ ] All tags assigned
- [ ] Multiple tags on transaction
- [ ] No duplicates

#### Expected Result
Multiple tags assigned to transaction successfully.

### 5.3. Remove Tag from Transaction

**ID:** BE-T-028
**Priority:** Must
**Type:** Integration

#### Steps
1. Assign tag to transaction
2. Remove tag from transaction
3. Verify tag removed
4. Verify transaction no longer has tag

#### Validation
- [ ] Tag removed
- [ ] Transaction loses tag
- [ ] Other tags unaffected

#### Expected Result
Tag removed from transaction successfully.

### 5.4. Assign Tag to Account

**ID:** BE-T-029
**Priority:** Should
**Type:** Integration

#### Steps
1. Create tag
2. Create account
3. Assign tag to account
4. Verify tag associated with account
5. Verify transactions on account include tag

#### Validation
- [ ] Tag assigned to account
- [ ] Account has tag
- [ ] Associated transactions use tag

#### Expected Result
Tag assigned to account successfully.

### 5.5. Assign Tag to Budget

**ID:** BE-T-030
**Priority:** Should
**Type:** Integration

#### Steps
1. Create tag
2. Create budget
3. Assign tag to budget
4. Verify tag associated with budget
5. Verify budget filtering includes tag

#### Validation
- [ ] Tag assigned to budget
- [ ] Budget has tag
- [ ] Filtering works with tag

#### Expected Result
Tag assigned to budget successfully.

## 6. Tag Filtering Tests

### 6.1. Filter Tags by Name

**ID:** BE-T-031
**Priority:** Must
**Type:** Positive

#### Steps
1. Create multiple tags with different names
2. Send GET to `/api/tags?name=food`
3. Verify returned tags include match
4. Verify other tags excluded

#### Validation
- [ ] Matches found
- [ ] Non-matches excluded
- [ ] Case sensitivity correct

#### Expected Result
Tags filtered by name successfully.

### 6.2. Filter Tags by Parent

**ID:** BE-T-032
**Priority:** Must
**Type:** Positive

#### Steps
1. Create parent and child tags
2. Send GET to `/api/tags?parentId=1`
3. Verify child tags returned
4. Verify parent not returned

#### Validation
- [ ] Child tags returned
- [ ] Parent excluded
- [ ] Direct children only

#### Expected Result
Tags filtered by parent successfully.

### 6.3. Filter Tags by Usage

**ID:** BE-T-033
**Priority:** Should
**Type:** Positive

#### Steps
1. Create multiple tags
2. Assign some to transactions
3. Send GET to `/api/tags?used=true`
4. Verify used tags returned
5. Verify unused excluded

#### Validation
- [ ] Used tags returned
- [ ] Unused excluded
- [ ] Accurate count

#### Expected Result
Tags filtered by usage status successfully.

### 6.4. Filter Tags by Color

**ID:** BE-T-034
**Priority:** Should
**Type:** Positive

#### Steps
1. Create tags with different colors
2. Send GET to `/api/tags?color=red`
3. Verify red tags returned
4. Verify other colors excluded

#### Validation
- [ ] Correct color tags returned
- [ ] Other colors excluded
- [ ] Case sensitivity correct

#### Expected Result
Tags filtered by color successfully.

## 7. Tag Statistics Tests

### 7.1. Get Tag Usage Statistics

**ID:** BE-T-035
**Priority:** Must
**Type:** Positive

#### Steps
1. Create multiple tags
2. Assign tags to transactions
3. Send GET to `/api/tags/stats`
4. Verify tag usage counts
5. Verify totals accurate

#### Validation
- [ ] Usage counts accurate
- [ ] Total transactions counted
- [ ] Tags with 0 usage included

#### Expected Result
Tag usage statistics retrieved successfully.

### 7.2. Get Tag Spending Statistics

**ID:** BE-T-036
**Priority:** Must
**Type:** Positive

#### Steps
1. Create tags and transactions
2. Send GET to `/api/tags/spending`
3. Verify tag spending amounts
4. Verify totals accurate
5. Verify monthly breakdown

#### Validation
- [ ] Spending amounts accurate
- [ ] Totals correct
- [ ] Time period data included

#### Expected Result
Tag spending statistics retrieved successfully.

### 7.3. Get Tag Balance Statistics

**ID:** BE-T-037
**Priority:** Should
**Type:** Positive

#### Steps
1. Create tags and accounts
2. Send GET to `/api/tags/balances`
3. Verify tag account balances
4. Verify total value accurate

#### Validation
- [ ] Balance data accurate
- [ ] Totals correct
- [ ] Empty balances handled

#### Expected Result
Tag balance statistics retrieved successfully.

### 7.4. Get Tag Trend Statistics

**ID:** BE-T-038
**Priority:** Should
**Type:** Positive

#### Steps
1. Create tags and transactions over time
2. Send GET to `/api/tags/trend?period=monthly`
3. Verify tag spending trends
4. Verify trend data accurate
5. Verify growth calculated

#### Validation
- [ ] Trend data accurate
- [ ] Growth calculated correctly
- [ ] Time series complete

#### Expected Result
Tag trend statistics retrieved successfully.

## 8. Tag Grouping Tests

### 8.1. Group Tags by Parent

**ID:** BE-T-039
**Priority:** Must
**Type:** Positive

#### Steps
1. Create parent and child tags
2. Send GET to `/api/tags/grouped`
3. Verify groups created
4. Verify child tags in parent group

#### Validation
- [ ] Groups formed correctly
- [ ] Child tags associated with parent
- [ ] Orphaned tags grouped separately

#### Expected Result
Tags grouped by parent successfully.

### 8.2. Group Tags by Color

**ID:** BE-T-040
**Priority:** Should
**Type:** Positive

#### Steps
1. Create tags with colors
2. Send GET to `/api/tags/grouped?by=color`
3. Verify color groups
4. Verify tags in correct color group

#### Validation
- [ ] Color groups formed
- [ ] Tags in correct groups
- [ ] Uncolored tags grouped separately

#### Expected Result
Tags grouped by color successfully.

### 8.3. Group Tags by Usage

**ID:** BE-T-041
**Priority:** Should
**Type:** Positive

#### Steps
1. Create tags and assign some
2. Send GET to `/api/tags/grouped?by=usage`
3. Verify usage groups
4. Verify used/unused separation

#### Validation
- [ ] Usage groups formed
- [ ] Used tags together
- [ ] Unused tags together

#### Expected Result
Tags grouped by usage successfully.

## 9. Tag Renaming Tests

### 9.1. Rename Tag

**ID:** BE-T-042
**Priority:** Must
**Type:** Positive

#### Steps
1. Create tag
2. Get tag name
3. Rename tag
4. Verify new name
5. Verify old name not used
6. Verify transactions still use tag

#### Validation
- [ ] New name saved
- [ ] Old name not reused
- [ ] Associated transactions preserved

#### Expected Result
Tag renamed successfully.

### 9.2. Rename to Existing Name

**ID:** BE-T-043
**Priority:** Must
**Type:** Negative

#### Steps
1. Create tag A
2. Create tag B
3. Try to rename tag A to tag B's name
4. Verify response 409 Conflict

#### Validation
- [ ] Response status 409
- [ ] Error message present
- [ ] No duplicate name

#### Expected Result
Tag name conflict prevented.

### 9.3. Rename Without Permission

**ID:** BE-T-044
**Priority:** Must
**Type:** Negative

#### Steps
1. Create tag for user A
2. Login as user B
3. Try to rename tag
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Cross-user rename blocked

#### Expected Result
Cross-user rename blocked.

## 10. Tag Color Customization Tests

### 10.1. Update Tag Color

**ID:** BE-T-045
**Priority:** Must
**Type:** Positive

#### Steps
1. Create tag with default color
2. Update tag color
3. Verify color changed
4. Verify UI reflects new color
5. Verify transactions show new color

#### Validation
- [ ] Color updated
- [ ] UI reflects change
- [ ] Associated transactions updated

#### Expected Result
Tag color updated successfully.

### 10.2. Reset Tag Color

**ID:** BE-T-046
**Priority:** Should
**Type:** Positive

#### Steps
1. Create tag with custom color
2. Reset to default
3. Verify color reset
4. Verify UI shows default color

#### Validation
- [ ] Default color restored
- [ ] UI updated
- [ ] Custom color removed

#### Expected Result
Tag color reset successfully.

### 10.3. Apply Custom Color to All Tags

**ID:** BE-T-047
**Priority:** Should
**Type:** Positive

#### Steps
1. Create multiple tags
2. Apply color to all
3. Verify all tags have color
4. Verify color consistency

#### Validation
- [ ] All tags colored
- [ ] Color uniform
- [ ] Changes applied

#### Expected Result
Custom color applied to all tags.

## 11. Performance Tests

### 11.1. Get Tag List Performance

**ID:** BE-T-048
**Priority:** Must
**Type:** Performance

#### Steps
1. Send GET to `/api/tags`
2. Measure response time
3. Verify meets 50ms threshold

#### Validation
- [ ] Response < 50ms
- [ ] Efficient query
- [ ] No N+1 queries

#### Expected Result
Tag list retrieval is fast.

### 11.2. Get Tag Statistics Performance

**ID:** BE-T-049
**Priority:** Must
**Type:** Performance

#### Steps
1. Send GET to `/api/tags/stats`
2. Measure response time
3. Verify meets 100ms threshold

#### Validation
- [ ] Response < 100ms
- [ ] Efficient aggregation
- [ ] No blocking

#### Expected Result
Tag statistics retrieval is fast.

### 11.3. Get Tag Hierarchy Performance

**ID:** BE-T-050
**Priority:** Should
**Type:** Performance

#### Steps
1. Send GET to `/api/tags/hierarchy`
2. Measure response time
3. Verify acceptable performance

#### Validation
- [ ] Response reasonable
- [ ] Efficient hierarchy building
- [ ] No N+1 queries

#### Expected Result
Tag hierarchy retrieval is efficient.

## 12. Error Handling Tests

### 12.1. Error Messages

**ID:** BE-T-051
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

### 12.2. Delete Tag with Associated Transactions

**ID:** BE-T-052
**Priority:** Must
**Type:** Integration

#### Steps
1. Create tag and assign to transactions
2. Try to delete tag
3. Verify tag cannot be deleted
4. Verify transactions remain

#### Validation
- [ ] Tag deletion prevented
- [ ] Transactions preserved
- [ ] Error message present

#### Expected Result
Tag with associations cannot be deleted.

### 12.3. Delete Tag with Child Tags

**ID:** BE-T-053
**Priority:** Must
**Type:** Integration

#### Steps
1. Create parent and child tags
2. Try to delete parent
3. Verify parent cannot be deleted
4. Verify child tags preserved

#### Validation
- [ ] Parent deletion prevented
- [ ] Child tags preserved
- [ ] Cascade behavior correct

#### Expected Result
Parent tag with children cannot be deleted.

## 13. Integration Tests

### 13.1. Tags Affect Dashboard

**ID:** BE-T-054
**Priority:** Should
**Type:** Integration

#### Steps
1. Create tags and transactions
2. Get dashboard
3. Verify dashboard shows tags
4. Verify tag counts accurate
5. Verify tag colors shown

#### Validation
- [ ] Dashboard shows tags
- [ ] Counts accurate
- [ ] Colors displayed

#### Expected Result
Tags affect dashboard.

### 13.2. Tags Affect Analytics

**ID:** BE-T-055
**Priority:** Must
**Type:** Integration

#### Steps
1. Create tags and assign to transactions
2. Get analytics data
3. Verify analytics includes tags
4. Verify tag breakdown present

#### Validation
- [ ] Analytics includes tags
- [ ] Tag breakdown accurate
- [ ] Totals correct

#### Expected Result
Tags affect analytics.

### 13.3. Tags Affect Budgets

**ID:** BE-T-056
**Priority:** Should
**Type:** Integration

#### Steps
1. Create tags and assign to transactions
2. Create budget with tag
3. Get budget data
4. Verify budget includes tag transactions

#### Validation
- [ ] Budget includes tag
- [ ] Tag transactions counted
- [ ] Spending accurate

#### Expected Result
Tags affect budgets.

## 14. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] Tag CRUD working
- [ ] Tag hierarchy working
- [ ] Tag assignment working
- [ ] Tag filtering working
- [ ] Tag statistics working
- [ ] Cross-user data isolation working

## 15. Test Execution Notes

- Test tag creation with various name formats
- Test tag color customization
- Test tag hierarchy depth
- Test tag assignment to multiple entities
- Test tag deletion with associations
- Verify tag filtering accuracy
- Test tag statistics calculations
- Verify tag grouping functionality

## 16. Dependencies

- Database with tags table
- Transaction integration
- Account integration
- Budget integration
- Analytics integration
- Tag hierarchy system