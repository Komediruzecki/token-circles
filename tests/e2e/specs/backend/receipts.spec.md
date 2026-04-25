# E2E Test Specification - Receipts Module

**Module:** Receipts
**Test Suite:** Backend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Receipts module backend, covering receipt creation, upload, categorization, line item parsing, receipt splitting, receipt search, receipt history, receipt deletion, receipt sharing, receipt notes, and receipt validation.

## 2. Receipt Creation Tests

### 2.1. Create Receipt

**ID:** BE-T-001
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send POST to `/api/receipts` with receipt data
3. Verify response 201 Created
4. Verify receipt in database
5. Verify receipt belongs to user

#### Validation
- [ ] Response status 201
- [ ] Receipt created
- [ ] Receipt assigned to user
- [ ] Metadata saved

#### Expected Result
Receipt created successfully.

### 2.2. Create Receipt Without Auth

**ID:** BE-T-002
**Priority:** Must
**Type:** Negative

#### Steps
1. Send POST to `/api/receipts` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.3. Create Duplicate Receipt

**ID:** BE-T-003
**Priority:** Must
**Type:** Negative

#### Steps
1. Create receipt with reference
2. Try to create another with same reference
3. Verify response 409 Conflict
4. Verify error message

#### Validation
- [ ] Response status 409
- [ ] Error message present
- [ ] No duplicate created

#### Expected Result
Duplicate receipts prevented.

### 2.4. Create Receipt with Image

**ID:** BE-T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send POST to `/api/receipts` with image data
3. Verify response 201 Created
4. Verify image uploaded
5. Verify image URL generated

#### Validation
- [ ] Response status 201
- [ ] Image uploaded
- [ ] Image URL generated
- [ ] Image accessible

#### Expected Result
Receipt with image created successfully.

### 2.5. Create Receipt Without Image

**ID:** BE-T-005
**Priority:** Must
**Type:** Positive

#### Steps
1. Create receipt without image
2. Verify receipt created
3. Verify no image required
4. Verify metadata still saved

#### Validation
- [ ] Receipt created without image
- [ ] Metadata saved
- [ ] No image required

#### Expected Result
Receipt without image created successfully.

### 2.6. Create Receipt from URL

**ID:** BE-T-006
**Priority:** Should
**Type:** Positive

#### Steps
1. Send POST to `/api/receipts` with image URL
2. Verify response
3. Verify image fetched
4. Verify processing completed

#### Validation
- [ ] Image fetched successfully
- [ ] Processing completed
- [ ] Receipt created

#### Expected Result
Receipt created from image URL successfully.

## 3. Receipt Data Validation Tests

### 3.1. Invalid Receipt Data

**ID:** BE-T-007
**Priority:** Must
**Type:** Negative

#### Steps
1. Create receipt with invalid data
2. Verify response 400 Bad Request
3. Verify validation errors

#### Validation
- [ ] Response status 400
- [ ] Validation errors present
- [ ] No receipt created

#### Expected Result
Invalid receipt data rejected.

### 3.2. Missing Store Name

**ID:** BE-T-008
**Priority:** Must
**Type:** Negative

#### Steps
1. Create receipt without store name
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Missing store name prevented.

### 3.3. Missing Date

**ID:** BE-T-009
**Priority:** Must
**Type:** Negative

#### Steps
1. Create receipt without date
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Missing date prevented.

### 3.4. Missing Total

**ID:** BE-T-010
**Priority:** Must
**Type:** Negative

#### Steps
1. Create receipt without total
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Missing total prevented.

### 3.5. Negative Total

**ID:** BE-T-011
**Priority:** Must
**Type:** Negative

#### Steps
1. Create receipt with negative total
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Negative total prevented.

### 3.6. Invalid Date Format

**ID:** BE-T-012
**Priority:** Must
**Type:** Negative

#### Steps
1. Create receipt with invalid date format
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid date format prevented.

### 3.7. Invalid Total Format

**ID:** BE-T-013
**Priority:** Must
**Type:** Negative

#### Steps
1. Create receipt with invalid total format
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid total format prevented.

## 4. Line Item Parsing Tests

### 4.1. Parse Receipt Line Items

**ID:** BE-T-014
**Priority:** Must
**Type:** Positive

#### Steps
1. Create receipt with OCR data
2. Verify line items parsed
3. Verify items listed
4. Verify amounts accurate

#### Validation
- [ ] Line items parsed
- [ ] Items listed
- [ ] Amounts correct
- [ ] Quantities accurate

#### Expected Result
Line items parsed successfully.

### 4.2. Multiple Line Items

**ID:** BE-T-015
**Priority:** Must
**Type:** Positive

#### Steps
1. Create receipt with multiple items
2. Verify all items parsed
3. Verify item count accurate
4. Verify totals match

#### Validation
- [ ] All items parsed
- [ ] Count accurate
- [ ] Subtotal matches total

#### Expected Result
Multiple line items handled successfully.

### 4.3. Line Item with Quantity

**ID:** BE-T-016
**Priority:** Must
**Type:** Positive

#### Steps
1. Create receipt with quantity items
2. Verify quantities parsed
3. Verify quantity multiplication
4. Verify accurate totals

#### Validation
- [ ] Quantities parsed
- [ ] Calculations correct
- [ ] Totals accurate

#### Expected Result
Line items with quantities handled successfully.

### 4.4. Line Item with Tax

**ID:** BE-T-017
**Priority:** Should
**Type:** Positive

#### Steps
1. Create receipt with tax breakdown
2. Verify tax lines parsed
3. Verify tax calculation
4. Verify total includes tax

#### Validation
- [ ] Tax lines parsed
- [ ] Tax calculated correctly
- [ ] Total accurate

#### Expected Result
Line items with tax handled successfully.

### 4.5. Line Item with Discount

**ID:** BE-T-018
**Priority:** Should
**Type:** Positive

#### Steps
1. Create receipt with discounts
2. Verify discount lines parsed
3. Verify discount applied
4. Verify accurate subtotal

#### Validation
- [ ] Discount lines parsed
- [ ] Discount applied
- [ ] Subtotal accurate

#### Expected Result
Line items with discount handled successfully.

### 4.6. Invalid Line Item Data

**ID:** BE-T-019
**Priority:** Must
**Type:** Negative

#### Steps
1. Create receipt with invalid line item data
2. Verify line items rejected or corrected
3. Verify appropriate error

#### Validation
- [ ] Invalid data handled
- [ ] Error message present
- [ ] Processing continues

#### Expected Result
Invalid line item data handled.

## 5. Receipt Categorization Tests

### 5.1. Assign Category to Receipt

**ID:** BE-T-020
**Priority:** Must
**Type:** Integration

#### Steps
1. Create receipt
2. Assign category to receipt
3. Verify category saved
4. Verify receipt has category
5. Verify transactions linked

#### Validation
- [ ] Category assigned
- [ ] Receipt has category
- [ ] Transactions categorized
- [ ] Category syncs to items

#### Expected Result
Receipt categorized successfully.

### 5.2. Auto-Categorize Receipt

**ID:** BE-T-021
**Priority:** Should
**Type:** Positive

#### Steps
1. Create receipt
2. Enable auto-categorization
3. Verify category assigned automatically
4. Verify category based on store

#### Validation
- [ ] Category assigned automatically
- [ ] Category based on store
- [ ] Manual override possible

#### Expected Result
Receipt auto-categorized successfully.

### 5.3. Bulk Categorize Receipts

**ID:** BE-T-022
**Priority:** Should
**Type:** Positive

#### Steps
1. Create multiple receipts
2. Bulk categorize by store
3. Verify all categorized
4. Verify accuracy

#### Validation
- [ ] All receipts categorized
- [ ] Categories accurate
- [ ] Bulk operation efficient

#### Expected Result
Receipts bulk categorized successfully.

## 6. Receipt Split Tests

### 6.1. Split Receipt Across Transactions

**ID:** BE-T-023
**Priority:** Must
**Type:** Integration

#### Steps
1. Create receipt
2. Split receipt into multiple transactions
3. Verify each transaction linked
4. Verify receipt status updated
5. Verify totals distributed

#### Validation
- [ ] Transactions split
- [ ] Each linked to receipt
- [ ] Totals distributed
- [ ] Receipt completed

#### Expected Result
Receipt split successfully.

### 6.2. Split Receipt Line Items

**ID:** BE-T-024
**Priority:** Should
**Type:** Integration

#### Steps
1. Create receipt with multiple items
2. Split items across transactions
3. Verify each transaction has assigned items
4. Verify receipts updated

#### Validation
- [ ] Items split correctly
- [ ] Each transaction linked
- [ ] Receipt status updated
- [ ] Totals accurate

#### Expected Result
Receipt line items split successfully.

### 6.3. Split Without Sharing

**ID:** BE-T-025
**Priority:** Must
**Type:** Integration

#### Steps
1. Create receipt
2. Split without sharing
3. Verify only user has access
4. Verify other users cannot see split

#### Validation
- [ ] Split created successfully
- [ ] Other users cannot access
- [ ] Privacy maintained

#### Expected Result
Split without sharing works correctly.

## 7. Receipt Search Tests

### 7.1. Search Receipts by Store

**ID:** BE-T-026
**Priority:** Must
**Type:** Positive

#### Steps
1. Create multiple receipts
2. Search for receipts by store
3. Verify returned receipts match
4. Verify others excluded

#### Validation
- [ ] Matches found
- [ ] Non-matches excluded
- [ ] Case sensitivity correct

#### Expected Result
Receipts searched by store successfully.

### 7.2. Search Receipts by Date

**ID:** BE-T-027
**Priority:** Must
**Type:** Positive

#### Steps
1. Create receipts over time
2. Search by date range
3. Verify range matches
4. Verify others excluded

#### Validation
- [ ] Range matches
- [ ] Others excluded
- [ ] Date filter accurate

#### Expected Result
Receipts searched by date successfully.

### 7.3. Search Receipts by Amount

**ID:** BE-T-028
**Priority:** Should
**Type:** Positive

#### Steps
1. Create receipts with various amounts
2. Search by amount range
3. Verify matches found
4. Verify range accurate

#### Validation
- [ ] Amount range matches
- [ ] Others excluded
- [ ] Range filter accurate

#### Expected Result
Receipts searched by amount successfully.

### 7.4. Search Receipts by Category

**ID:** BE-T-029
**Priority:** Must
**Type:** Positive

#### Steps
1. Create receipts with categories
2. Search by category
3. Verify matches found
4. Verify others excluded

#### Validation
- [ ] Category matches found
- [ ] Others excluded
- [ ] Category filter accurate

#### Expected Result
Receipts searched by category successfully.

### 7.5. Full Text Search

**ID:** BE-T-030
**Priority:** Should
**Type:** Positive

#### Steps
1. Create receipts with descriptions
2. Perform full text search
3. Verify matches found
4. Verify relevance

#### Validation
- [ ] Matches found
- [ ] Relevance preserved
- [ ] Search efficient

#### Expected Result
Receipts searched by full text successfully.

## 8. Receipt History Tests

### 8.1. Get Receipt History

**ID:** BE-T-031
**Priority:** Must
**Type:** Positive

#### Steps
1. Create multiple receipts
2. Get receipt history
3. Verify chronological order
4. Verify all receipts included
5. Verify pagination works

#### Validation
- [ ] Chronological order
- [ ] All receipts included
- [ ] Pagination functional
- [ ] Efficient query

#### Expected Result
Receipt history retrieved successfully.

### 8.2. Get Receipt History by Period

**ID:** BE-T-032
**Priority:** Must
**Type:** Positive

#### Steps
1. Create receipts over time
2. Get history for period
3. Verify period matches
4. Verify others excluded

#### Validation
- [ ] Period matches
- [ ] Others excluded
- [ ] Range filter accurate

#### Expected Result
Receipt history by period retrieved successfully.

### 8.3. Receipt Activity Log

**ID:** BE-T-033
**Priority:** Should
**Type:** Integration

#### Steps
1. Create receipt
2. Modify receipt
3. Verify activity log updated
4. Verify audit trail

#### Validation
- [ ] Activity logged
- [ ] Timestamp accurate
- [ ] Changes tracked

#### Expected Result
Receipt activity logged successfully.

## 9. Receipt Attachment Tests

### 9.1. Upload Receipt Image

**ID:** BE-T-034
**Priority:** Must
**Type:** Positive

#### Steps
1. Create receipt without image
2. Upload image
3. Verify image uploaded
4. Verify image URL generated
5. Verify image accessible

#### Validation
- [ ] Image uploaded
- [ ] URL generated
- [ ] Image accessible
- [ ] Processing complete

#### Expected Result
Receipt image uploaded successfully.

### 9.2. Update Receipt Image

**ID:** BE-T-035
**Priority:** Must
**Type:** Positive

#### Steps
1. Create receipt with image
2. Upload new image
3. Verify old image deleted
4. Verify new image uploaded
5. Verify URL updated

#### Validation
- [ ] Old image deleted
- [ ] New image uploaded
- [ ] URL updated
- [ ] Processing complete

#### Expected Result
Receipt image updated successfully.

### 9.3. Upload Multiple Images

**ID:** BE-T-036
**Priority:** Should
**Type:** Positive

#### Steps
1. Create receipt
2. Upload multiple images
3. Verify all images uploaded
4. Verify thumbnails created
5. Verify gallery view

#### Validation
- [ ] All images uploaded
- [ ] Thumbnails created
- [ ] Gallery view works
- [ ] Efficient storage

#### Expected Result
Multiple receipt images uploaded successfully.

### 9.4. Upload Large Image

**ID:** BE-T-037
**Priority:** Should
**Type:** Positive

#### Steps
1. Create receipt
2. Upload large image
3. Verify image processed
4. Verify compression applied
5. Verify size reasonable

#### Validation
- [ ] Image processed
- [ ] Compression applied
- [ ] Size reasonable
- [ ] Processing complete

#### Expected Result
Large receipt image processed successfully.

## 10. Receipt Deletion Tests

### 10.1. Delete Receipt

**ID:** BE-T-038
**Priority:** Must
**Type:** Positive

#### Steps
1. Create receipt
2. Delete receipt
3. Verify receipt deleted
4. Verify associated transactions preserved

#### Validation
- [ ] Receipt deleted
- [ ] Transactions preserved
- [ ] No orphaned data

#### Expected Result
Receipt deleted successfully.

### 10.2. Delete Receipt Without Auth

**ID:** BE-T-039
**Priority:** Must
**Type:** Negative

#### Steps
1. Send DELETE to `/api/receipts/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 10.3. Delete Another User's Receipt

**ID:** BE-T-040
**Priority:** Must
**Type:** Negative

#### Steps
1. Create receipt for user A
2. Login as user B
3. Try to delete receipt
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Cross-user deletion blocked

#### Expected Result
Cross-user deletion blocked.

### 10.4. Delete Receipt with Split Transactions

**ID:** BE-T-041
**Priority:** Must
**Type:** Integration

#### Steps
1. Create receipt
2. Split into transactions
3. Delete receipt
4. Verify transactions preserved
5. Verify receipt marked deleted

#### Validation
- [ ] Transactions preserved
- [ ] Receipt marked deleted
- [ ] Data integrity maintained

#### Expected Result
Receipt with splits deleted successfully.

## 11. Receipt Sharing Tests

### 11.1. Share Receipt with User

**ID:** BE-T-042
**Priority:** Should
**Type:** Integration

#### Steps
1. Create receipt
2. Share with another user
3. Verify recipient has access
4. Verify no sensitive data leaked

#### Validation
- [ ] Recipient has access
- [ ] No sensitive data
- [ ] Access granted correctly

#### Expected Result
Receipt shared successfully.

### 11.2. Share Receipt with Group

**ID:** BE-T-043
**Priority:** Should
**Type:** Integration

#### Steps
1. Create receipt
2. Share with group
3. Verify group members have access
4. Verify separate permissions

#### Validation
- [ ] Group has access
- [ ] Members have access
- [ ] Permissions separated

#### Expected Result
Receipt shared with group successfully.

### 11.3. Revoke Receipt Access

**ID:** BE-T-044
**Priority:** Should
**Type:** Integration

#### Steps
1. Share receipt with user
2. Revoke access
3. Verify access removed
4. Verify recipient cannot access

#### Validation
- [ ] Access removed
- [ ] Recipient cannot access
- [ ] Data remains for owner

#### Expected Result
Receipt access revoked successfully.

### 11.4. View Receipt Stats from Shared

**ID:** BE-T-045
**Priority:** Should
**Type:** Integration

#### Steps
1. Share receipt with user
2. Shared user views receipt
3. Verify they can see basic info
4. Verify no ownership changes

#### Validation
- [ ] Basic info visible
- [ ] No ownership changes
- [ ] Read-only access

#### Expected Result
Shared receipt view works correctly.

## 12. Receipt Notes Tests

### 12.1. Add Note to Receipt

**ID:** BE-T-046
**Priority:** Must
**Type:** Positive

#### Steps
1. Create receipt
2. Add note
3. Verify note saved
4. Verify note displayed
5. Verify timestamp recorded

#### Validation
- [ ] Note saved
- [ ] Note displayed
- [ ] Timestamp accurate

#### Expected Result
Receipt note added successfully.

### 12.2. Update Receipt Note

**ID:** BE-T-047
**Priority:** Must
**Type:** Positive

#### Steps
1. Add note to receipt
2. Update note
3. Verify note updated
4. Verify edit history

#### Validation
- [ ] Note updated
- [ ] History maintained
- [ ] Timestamp updated

#### Expected Result
Receipt note updated successfully.

### 12.3. Delete Receipt Note

**ID:** BE-T-048
**Priority:** Should
**Type:** Positive

#### Steps
1. Add note to receipt
2. Delete note
3. Verify note deleted
4. Verify receipt still accessible

#### Validation
- [ ] Note deleted
- [ ] Receipt still accessible
- [ ] No orphaned data

#### Expected Result
Receipt note deleted successfully.

## 13. Performance Tests

### 13.1. Get Receipt List Performance

**ID:** BE-T-049
**Priority:** Must
**Type:** Performance

#### Steps
1. Send GET to `/api/receipts`
2. Measure response time
3. Verify meets 50ms threshold

#### Validation
- [ ] Response < 50ms
- [ ] Efficient query
- [ ] No N+1 queries

#### Expected Result
Receipt list retrieval is fast.

### 13.2. Upload Receipt Performance

**ID:** BE-T-050
**Priority:** Must
**Type:** Performance

#### Steps
1. Upload receipt with image
2. Measure upload time
3. Verify meets 5s threshold

#### Validation
- [ ] Upload time reasonable
- [ ] Compression efficient
- [ ] Storage handled well

#### Expected Result
Receipt upload is efficient.

### 13.3. Search Receipts Performance

**ID:** BE-T-051
**Priority:** Should
**Type:** Performance

#### Steps
1. Perform search query
2. Measure response time
3. Verify acceptable performance

#### Validation
- [ ] Response time reasonable
- [ ] Search efficient
- [ ] Indexes utilized

#### Expected Result
Receipt search is efficient.

## 14. Error Handling Tests

### 14.1. Error Messages

**ID:** BE-T-052
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

### 14.2. Invalid Image Format

**ID:** BE-T-053
**Priority:** Must
**Type:** Negative

#### Steps
1. Upload invalid image format
2. Verify rejection
3. Verify error message

#### Validation
- [ ] Image rejected
- [ ] Error message present
- [ ] Supported formats listed

#### Expected Result
Invalid image format rejected.

### 14.3. Image Too Large

**ID:** BE-T-054
**Priority:** Should
**Type:** Negative

#### Steps
1. Upload image exceeding size limit
2. Verify rejection
3. Verify error message

#### Validation
- [ ] Image rejected
- [ ] Error message present
- [ ] Size limit clear

#### Expected Result
Image too large rejected.

## 15. Integration Tests

### 15.1. Receipts Affect Dashboard

**ID:** BE-T-055
**Priority:** Should
**Type:** Integration

#### Steps
1. Create receipts
2. Get dashboard
3. Verify receipt stats shown
4. Verify spending from receipts included

#### Validation
- [ ] Receipt stats shown
- [ ] Spending included
- [ ] Accuracy maintained

#### Expected Result
Receipts affect dashboard.

### 15.2. Receipts Affect Analytics

**ID:** BE-T-056
**Priority:** Must
**Type:** Integration

#### Steps
1. Create receipts
2. Get analytics
3. Verify receipt data included
4. Verify breakdown accurate

#### Validation
- [ ] Receipt data included
- [ ] Analytics updated
- [ ] Totals correct

#### Expected Result
Receipts affect analytics.

### 15.3. Receipts Affect Budgets

**ID:** BE-T-057
**Priority:** Should
**Type:** Integration

#### Steps
1. Create receipts
2. Create budget
3. Get budget
4. Verify receipt spending included

#### Validation
- [ ] Receipt spending included
- [ ] Budget accurate
- [ ] Tracking works

#### Expected Result
Receipts affect budgets.

## 16. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] Receipt creation working
- [ ] Line item parsing working
- [ ] Receipt categorization working
- [ ] Receipt sharing working
- [ ] Receipt search working
- [ ] Cross-user data isolation working

## 17. Test Execution Notes

- Test receipt upload with various image formats
- Test OCR parsing accuracy
- Test line item calculations
- Test receipt splitting scenarios
- Test receipt search with various filters
- Test receipt sharing permissions
- Test image processing and compression
- Verify receipt data integrity

## 18. Dependencies

- Database with receipts table
- File upload/storage system
- OCR processing service
- Transaction integration
- Category integration
- Analytics integration
- Notification system