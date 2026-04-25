# E2E Test Specification - Housing Module

**Module:** Housing
**Test Suite:** Backend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Housing module backend, covering property tracking, mortgage details, rent payments, maintenance tracking, tax calculations, and property value tracking.

## 2. Housing Property CRUD Tests

### 2.1. Create Property

**ID:** BE-T-001
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send POST to `/api/housing/properties` with property data
3. Verify response 201 Created
4. Verify property in database
5. Verify property belongs to user

#### Validation
- [ ] Response status 201
- [ ] Property created
- [ ] Property assigned to user
- [ ] Address saved

#### Expected Result
Property created successfully.

### 2.2. Create Property Without Auth

**ID:** BE-T-002
**Priority:** Must
**Type:** Negative

#### Steps
1. Send POST to `/api/housing/properties` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.3. Create Duplicate Property

**ID:** BE-T-003
**Priority:** Must
**Type:** Negative

#### Steps
1. Create property with address
2. Try to create another with same address
3. Verify response 409 Conflict
4. Verify error message

#### Validation
- [ ] Response status 409
- [ ] Error message present
- [ ] No duplicate created

#### Expected Result
Duplicate properties prevented.

### 2.4. Get All Properties

**ID:** BE-T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/housing/properties`
3. Verify response 200 OK
4. Verify all user's properties returned
5. Verify no other user's properties

#### Validation
- [ ] Response status 200
- [ ] All user properties returned
- [ ] No cross-user data
- [ ] Total count correct

#### Expected Result
User's properties retrieved successfully.

### 2.5. Get All Properties Without Auth

**ID:** BE-T-005
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/housing/properties` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.6. Get Property by ID

**ID:** BE-T-006
**Priority:** Must
**Type:** Positive

#### Steps
1. Create property
2. Get property ID
3. Send GET to `/api/housing/properties/:id`
4. Verify response 200 OK
5. Verify property data
6. Verify property belongs to user

#### Validation
- [ ] Response status 200
- [ ] Property data correct
- [ ] Property belongs to user
- [ ] No cross-user data

#### Expected Result
Property retrieved successfully.

### 2.7. Get Property by ID Without Auth

**ID:** BE-T-007
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/housing/properties/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.8. Get Another User's Property

**ID:** BE-T-008
**Priority:** Must
**Type:** Negative

#### Steps
1. Create property for user A
2. Login as user B
3. Try to get user A's property
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user access blocked

#### Expected Result
Cross-user access blocked.

### 2.9. Update Property

**ID:** BE-T-009
**Priority:** Must
**Type:** Positive

#### Steps
1. Create property
2. Send PUT to `/api/housing/properties/:id` with updates
3. Verify response 200 OK
4. Verify changes persisted
5. Verify other fields unchanged

#### Validation
- [ ] Response status 200
- [ ] Changes persisted
- [ ] Other fields unchanged
- [ ] Only owner can update

#### Expected Result
Property updated successfully.

### 2.10. Update Property Without Auth

**ID:** BE-T-010
**Priority:** Must
**Type:** Negative

#### Steps
1. Send PUT to `/api/housing/properties/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.11. Update Another User's Property

**ID:** BE-T-011
**Priority:** Must
**Type:** Negative

#### Steps
1. Create property for user A
2. Login as user B
3. Try to update user A's property
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user updates blocked

#### Expected Result
Cross-user updates blocked.

### 2.12. Delete Property

**ID:** BE-T-012
**Priority:** Must
**Type:** Positive

#### Steps
1. Create property
2. Send DELETE to `/api/housing/properties/:id`
3. Verify response 200 OK
4. Verify property deleted

#### Validation
- [ ] Response status 200
- [ ] Property deleted
- [ ] Only owner can delete

#### Expected Result
Property deleted successfully.

### 2.13. Delete Property Without Auth

**ID:** BE-T-013
**Priority:** Must
**Type:** Negative

#### Steps
1. Send DELETE to `/api/housing/properties/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.14. Delete Another User's Property

**ID:** BE-T-014
**Priority:** Must
**Type:** Negative

#### Steps
1. Create property for user A
2. Login as user B
3. Try to delete user A's property
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user deletes blocked

#### Expected Result
Cross-user deletes blocked.

## 3. Housing Property Data Validation

### 3.1. Invalid Property Data

**ID:** BE-T-015
**Priority:** Must
**Type:** Negative

#### Steps
1. Create property with invalid data
2. Verify response 400 Bad Request
3. Verify validation errors

#### Validation
- [ ] Response status 400
- [ ] Validation errors present
- [ ] No property created

#### Expected Result
Invalid property data rejected.

### 3.2. Missing Address

**ID:** BE-T-016
**Priority:** Must
**Type:** Negative

#### Steps
1. Create property without address
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Missing address prevented.

### 3.3. Invalid Property Type

**ID:** BE-T-017
**Priority:** Must
**Type:** Negative

#### Steps
1. Create property with invalid type
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid type prevented.

## 4. Mortgage Tracking Tests

### 4.1. Track Mortgage

**ID:** BE-T-018
**Priority:** Must
**Type:** Positive

#### Steps
1. Create property
2. Create mortgage details
3. Verify mortgage saved
4. Verify payment tracking

#### Validation
- [ ] Mortgage saved
- [ ] Monthly payment calculated
- [ ] Balance tracked

#### Expected Result
Mortgage tracking works.

### 4.2. Track Mortgage Payment

**ID:** BE-T-019
**Priority:** Must
**Type:** Integration

#### Steps
1. Create mortgage
2. Make payment
3. Verify principal reduced
4. Verify interest applied
5. Verify new balance

#### Validation
- [ ] Principal reduced
- [ ] Interest calculated
- [ ] Balance updated correctly
- [ ] Payment recorded

#### Expected Result
Mortgage payments tracked correctly.

### 4.3. Get Mortgage Details

**ID:** BE-T-020
**Priority:** Must
**Type:** Positive

#### Steps
1. Create mortgage
2. Get mortgage details
3. Verify all details accurate

#### Validation
- [ ] Principal accurate
- [ ] Interest rate accurate
- [ ] Term accurate
- [ ] Monthly payment accurate
- [ ] Payoff date calculated

#### Expected Result
Mortgage details work.

### 4.4. Calculate Mortgage Payoff

**ID:** BE-T-021
**Priority:** Must
**Type:** Positive

#### Steps
1. Create mortgage
2. Calculate payoff date
3. Verify accurate

#### Validation
- [ ] Payoff date calculated
- [ ] Based on current balance
- [ ] Correct with current payments

#### Expected Result
Mortgage payoff calculation works.

### 4.5. Track Mortgage Extra Payments

**ID:** BE-T-022
**Priority:** Should
**Type:** Positive

#### Steps
1. Create mortgage
2. Make extra payments
3. Verify faster payoff
4. Verify interest saved

#### Validation
- [ ] Faster payoff than standard
- [ ] Interest saved calculated
- [ ] Term reduced

#### Expected Result
Extra payments speed up payoff.

## 5. Rent Tracking Tests

### 5.1. Track Monthly Rent

**ID:** BE-T-023
**Priority:** Must
**Type:** Positive

#### Steps
1. Create rent property
2. Set monthly rent
3. Verify rent tracked
4. Verify rent payment records

#### Validation
- [ ] Monthly rent saved
- [ ] Rent tracking active
- [ ] Payment records available

#### Expected Result
Rent tracking works.

### 5.2. Track Rent Payments

**ID:** BE-T-024
**Priority:** Must
**Type:** Integration

#### Steps
1. Create rent property
2. Make rent payment
3. Verify payment recorded
4. Verify payment amount matches rent

#### Validation
- [ ] Payment recorded
- [ ] Amount matches
- [ ] Transaction created

#### Expected Result
Rent payments tracked.

### 5.3. Track Rent Increases

**ID:** BE-T-025
**Priority:** Should
**Type:** Positive

#### Steps
1. Create rent property
2. Set rent increase date
3. Verify new rent amount
4. Verify payments after increase

#### Validation
- [ ] Increase recorded
- [ ] New rent amount applied
- [ ] Historical payments unchanged

#### Expected Result
Rent increases tracked.

### 5.4. Calculate Monthly Rent Total

**ID:** BE-T-026
**Priority:** Must
**Type:** Positive

#### Steps
1. Create rent property
2. Get monthly rent total
3. Verify accuracy

#### Validation
- [ ] Rent amount accurate
- [ ] Includes rent
- [ ] Matches input

#### Expected Result
Rent total calculation works.

## 6. Maintenance Tracking Tests

### 6.1. Track Maintenance Costs

**ID:** BE-T-027
**Priority:** Must
**Type:** Positive

#### Steps
1. Create property
2. Add maintenance cost
3. Verify cost tracked
4. Verify cost associated with property

#### Validation
- [ ] Cost saved
- [ ] Linked to property
- [ ] Cost details included

#### Expected Result
Maintenance costs tracked.

### 6.2. Track Maintenance Type

**ID:** BE-T-028
**Priority:** Must
**Type:** Positive

#### Steps
1. Create property
2. Add maintenance with type
3. Verify type tracked
4. Verify type filtering

#### Validation
- [ ] Type saved
- [ ] Type filtering works
- [ ] Categorized maintenance

#### Expected Result
Maintenance types tracked.

### 6.3. Track Maintenance Cost History

**ID:** BE-T-029
**Priority:** Should
**Type:** Positive

#### Steps
1. Create property
2. Add multiple maintenance costs
3. Get cost history
4. Verify timeline

#### Validation
- [ ] History includes all costs
- [ ] Dates accurate
- [ ] Values correct

#### Expected Result
Maintenance cost history works.

### 6.4. Calculate Annual Maintenance Cost

**ID:** BE-T-030
**Priority:** Should
**Type:** Positive

#### Steps
1. Create property
2. Add maintenance costs
3. Calculate annual cost
4. Verify accuracy

#### Validation
- [ ] Annual total accurate
- [ ] Sum of monthly/maintenance
- [ ] Year-over-year comparison

#### Expected Result
Annual maintenance calculation works.

## 7. Property Tax Tracking Tests

### 7.1. Track Property Tax

**ID:** BE-T-031
**Priority:** Must
**Type:** Positive

#### Steps
1. Create property
2. Set property tax details
3. Verify tax tracked
4. Verify tax calculations

#### Validation
- [ ] Tax details saved
- [ ] Tax calculated correctly
- [ ] Tax payments recorded

#### Expected Result
Property tax tracking works.

### 7.2. Calculate Property Tax

**ID:** BE-T-032
**Priority:** Must
**Type:** Positive

#### Steps
1. Create property
2. Calculate property tax
3. Verify calculation

#### Validation
- [ ] Tax accurate
- [ ] Rate applied correctly
- [ ] Value multiplied by rate

#### Expected Result
Property tax calculation works.

### 7.3. Track Property Tax Payments

**ID:** BE-T-033
**Priority:** Must
**Type:** Integration

#### Steps
1. Create property tax
2. Make tax payment
3. Verify payment recorded
4. Verify payment amount

#### Validation
- [ ] Payment recorded
- [ ] Amount correct
- [ ] Transaction created

#### Expected Result
Tax payments tracked.

### 7.4. Track Tax Deduction

**ID:** BE-T-034
**Priority:** Should
**Type:** Positive

#### Steps
1. Create property with tax
2. Set as tax deductible
3. Verify deduction tracked
4. Verify tax impact

#### Validation
- [ ] Deduction flag set
- [ ] Deduction calculated correctly
- [ ] Impact on taxes

#### Expected Result
Tax deductions tracked.

## 8. Property Value Tracking Tests

### 8.1. Track Property Value

**ID:** BE-T-035
**Priority:** Must
**Type:** Positive

#### Steps
1. Create property
2. Track property value over time
3. Verify value history
4. Verify appreciation

#### Validation
- [ ] Value history saved
- [ ] Appreciation calculated
- [ ] Value trend visible

#### Expected Result
Property value tracking works.

### 8.2. Calculate Property Appreciation

**ID:** BE-T-036
**Priority:** Should
**Type:** Positive

#### Steps
1. Create property
2. Track values over time
3. Calculate appreciation
4. Verify accuracy

#### Validation
- [ ] Appreciation calculated
- [ ] Rate correct
- [ ] Time period accounted

#### Expected Result
Property appreciation calculation works.

### 8.3. Get Property Value Trends

**ID:** BE-T-037
**Priority:** Should
**Type:** Positive

#### Steps
1. Create property
2. Add value entries
3. Get value trends
4. Verify visualization data

#### Validation
- [ ] Trends include all values
- [ ] Dates accurate
- [ ] Values correct

#### Expected Result
Property value trends work.

## 9. Cost Calculation Tests

### 9.1. Calculate Total Monthly Cost

**ID:** BE-T-038
**Priority:** Must
**Type:** Positive

#### Steps
1. Create property with mortgage, rent, tax, maintenance
2. Calculate total monthly cost
3. Verify sum

#### Validation
- [ ] Total accurate
- [ ] Includes all costs
- [ ] Calculations correct

#### Expected Result
Total monthly cost calculation works.

### 9.2. Calculate Total Annual Cost

**ID:** BE-T-039
**Priority:** Must
**Type:** Positive

#### Steps
1. Create property
2. Calculate total annual cost
3. Verify accuracy

#### Validation
- [ ] Annual total accurate
- [ ] Monthly * 12 + one-time costs
- [ ] Correct sum

#### Expected Result
Total annual cost calculation works.

### 9.3. Calculate Cost Breakdown

**ID:** BE-T-040
**Priority:** Must
**Type:** Positive

#### Steps
1. Create property with various costs
2. Get cost breakdown
3. Verify each cost component

#### Validation
- [ ] Breakdown includes all components
- [ ] Amounts correct
- [ ] Percentages accurate

#### Expected Result
Cost breakdown works.

## 10. Performance Tests

### 10.1. Get Property Performance

**ID:** BE-T-041
**Priority:** Must
**Type:** Performance

#### Steps
1. Send GET to `/api/housing/properties`
2. Measure response time
3. Verify meets 100ms threshold

#### Validation
- [ ] Response < 100ms
- [ ] Proper indexing
- [ ] Efficient queries

#### Expected Result
Properties retrieval is fast.

### 10.2. Calculate Costs Performance

**ID:** BE-T-042
**Priority:** Must
**Type:** Performance

#### Steps
1. Calculate total costs
2. Measure response time
3. Verify meets 50ms threshold

#### Validation
- [ ] Response < 50ms
- [ ] Efficient calculations

#### Expected Result
Cost calculation is fast.

## 11. Error Handling Tests

### 11.1. Error Messages

**ID:** BE-T-043
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

### 11.2. Negative Property Value

**ID:** BE-T-044
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to set negative property value
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Negative property values prevented.

### 11.3. Negative Maintenance Cost

**ID:** BE-T-045
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to set negative maintenance cost
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Negative maintenance costs prevented.

## 12. Integration Tests

### 12.1. Property Costs Affect Balance

**ID:** BE-T-046
**Priority:** Should
**Type:** Integration

#### Steps
1. Create property with costs
2. Make payments
3. Verify balance updated

#### Validation
- [ ] Balance updated with payments
- [ ] Transaction created for each

#### Expected Result
Property payments update balance.

### 12.2. Property Costs Affect Analytics

**ID:** BE-T-047
**Priority:** Should
**Type:** Integration

#### Steps
1. Make property payment
2. Verify analytics updated
3. Verify dashboard reflects cost

#### Validation
- [ ] Analytics updated
- [ ] Dashboard accurate

#### Expected Result
Property costs update analytics.

## 13. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] Mortgage tracking accurate
- [ ] Rent tracking working
- [ ] Maintenance tracking working
- [ ] Property tax calculations accurate
- [ ] Cross-user data isolation working

## 14. Test Execution Notes

- Test property types (rental, own)
- Verify mortgage amortization
- Test maintenance cost types
- Verify tax calculations
- Test property value tracking
- Verify cost breakdown accuracy

## 15. Dependencies

- Database with housing properties table
- Mortgage tracking system
- Payment processing
- Maintenance tracking
- Tax calculations
- Analytics integration