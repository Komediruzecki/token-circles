# E2E Test Specification - Profiles Module

**Module:** User Profiles
**Test Suite:** Backend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the User Profiles module backend, covering profile CRUD operations, profile switching, and data management.

## 2. Profile CRUD Tests

### 2.1. Create Profile

**ID:** BE-T-001
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send POST to `/api/profiles` with profile data
3. Verify response 201 Created
4. Verify profile in database
5. Verify profile belongs to user

#### Validation
- [ ] Response status 201
- [ ] Profile created
- [ ] Profile assigned to user
- [ ] Default profile flag set if appropriate

#### Expected Result
Profile created successfully.

### 2.2. Create Profile Without Auth

**ID:** BE-T-002
**Priority:** Must
**Type:** Negative

#### Steps
1. Send POST to `/api/profiles` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.3. Create Duplicate Profile Name

**ID:** BE-T-003
**Priority:** Must
**Type:** Negative

#### Steps
1. Create profile with name
2. Try to create another with same name
3. Verify response 409 Conflict
4. Verify error message

#### Validation
- [ ] Response status 409
- [ ] Error message present
- [ ] No duplicate created

#### Expected Result
Duplicate profile names prevented.

### 2.4. Get All Profiles

**ID:** BE-T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/profiles`
3. Verify response 200 OK
4. Verify all user's profiles returned
5. Verify no other user's profiles

#### Validation
- [ ] Response status 200
- [ ] All user profiles returned
- [ ] No cross-user data
- [ ] Total count correct

#### Expected Result
User's profiles retrieved successfully.

### 2.5. Get All Profiles Without Auth

**ID:** BE-T-005
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/profiles` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.6. Get Profile by ID

**ID:** BE-T-006
**Priority:** Must
**Type:** Positive

#### Steps
1. Create profile
2. Get profile ID
3. Send GET to `/api/profiles/:id`
4. Verify response 200 OK
5. Verify profile data
6. Verify profile belongs to user

#### Validation
- [ ] Response status 200
- [ ] Profile data correct
- [ ] Profile belongs to user
- [ ] No cross-user data

#### Expected Result
Profile retrieved successfully.

### 2.7. Get Profile by ID Without Auth

**ID:** BE-T-007
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/profiles/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.8. Get Another User's Profile

**ID:** BE-T-008
**Priority:** Must
**Type:** Negative

#### Steps
1. Create profile for user A
2. Login as user B
3. Try to get user A's profile
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user access blocked

#### Expected Result
Cross-user access blocked.

### 2.9. Update Profile

**ID:** BE-T-009
**Priority:** Must
**Type:** Positive

#### Steps
1. Create profile
2. Send PUT to `/api/profiles/:id` with updates
3. Verify response 200 OK
4. Verify changes persisted
5. Verify other fields unchanged

#### Validation
- [ ] Response status 200
- [ ] Changes persisted
- [ ] Other fields unchanged
- [ ] Only owner can update

#### Expected Result
Profile updated successfully.

### 2.10. Update Profile Without Auth

**ID:** BE-T-010
**Priority:** Must
**Type:** Negative

#### Steps
1. Send PUT to `/api/profiles/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.11. Update Another User's Profile

**ID:** BE-T-011
**Priority:** Must
**Type:** Negative

#### Steps
1. Create profile for user A
2. Login as user B
3. Try to update user A's profile
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user update blocked

#### Expected Result
Cross-user updates blocked.

### 2.12. Delete Profile

**ID:** BE-T-012
**Priority:** Must
**Type:** Positive

#### Steps
1. Create profile
2. Send DELETE to `/api/profiles/:id`
3. Verify response 200 OK
4. Verify profile deleted
5. Verify other profiles unchanged

#### Validation
- [ ] Response status 200
- [ ] Profile deleted
- [ ] Other profiles unchanged
- [ ] Only owner can delete

#### Expected Result
Profile deleted successfully.

### 2.13. Delete Profile Without Auth

**ID:** BE-T-013
**Priority:** Must
**Type:** Negative

#### Steps
1. Send DELETE to `/api/profiles/:id` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.14. Delete Another User's Profile

**ID:** BE-T-014
**Priority:** Must
**Type:** Negative

#### Steps
1. Create profile for user A
2. Login as user B
3. Try to delete user A's profile
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user delete blocked

#### Expected Result
Cross-user deletes blocked.

### 2.15. Delete Default Profile

**ID:** BE-T-015
**Priority:** Must
**Type:** Negative

#### Steps
1. Create profile and set as default
2. Try to delete default profile
3. Verify response 400 Bad Request
4. Verify error message

#### Validation
- [ ] Response status 400
- [ ] Cannot delete default
- [ ] Error message clear

#### Expected Result
Default profile cannot be deleted.

### 2.16. Switch Default Profile

**ID:** BE-T-016
**Priority:** Must
**Type:** Positive

#### Steps
1. Create multiple profiles
2. Set one as default
3. Switch to another
4. Verify default changes
5. Verify settings apply to new profile

#### Validation
- [ ] Default updates
- [ ] Settings persist
- [ ] Previous default no longer default

#### Expected Result
Profile switching works correctly.

## 3. Profile Data Validation

### 3.1. Invalid Profile Data

**ID:** BE-T-017
**Priority:** Must
**Type:** Negative

#### Steps
1. Create profile with invalid data
2. Verify response 400 Bad Request
3. Verify validation errors

#### Validation
- [ ] Response status 400
- [ ] Validation errors present
- [ ] No profile created

#### Expected Result
Invalid profile data rejected.

### 3.2. Empty Profile Data

**ID:** BE-T-018
**Priority:** Must
**Type:** Negative

#### Steps
1. Create profile with empty data
2. Verify response 400 Bad Request
3. Verify validation errors

#### Validation
- [ ] Response status 400
- [ ] Validation errors present

#### Expected Result
Empty profile data rejected.

## 4. Profile Settings

### 4.1. Profile Settings Persistence

**ID:** BE-T-019
**Priority:** Should
**Type:** Positive

#### Steps
1. Create profile
2. Set profile settings
3. Switch profiles
4. Verify settings apply
5. Switch back
6. Verify settings still apply

#### Validation
- [ ] Settings persist per profile
- [ ] Settings apply to current profile
- [ ] Settings isolated per profile

#### Expected Result
Profile settings are isolated and persistent.

### 4.2. Default Profile Settings

**ID:** BE-T-020
**Priority:** Should
**Type:** Positive

#### Steps
1. Create profile A (default)
2. Create profile B
3. Set settings in profile A
4. Set settings in profile B
5. Verify both profiles have correct settings

#### Validation
- [ ] Profile A has its settings
- [ ] Profile B has its settings
- [ ] No sharing between profiles

#### Expected Result
Each profile maintains its own settings.

## 5. Performance Tests

### 5.1. Get Profiles Performance

**ID:** BE-T-021
**Priority:** Must
**Type:** Performance

#### Steps
1. Send GET to `/api/profiles`
2. Measure response time
3. Verify meets 100ms threshold

#### Validation
- [ ] Response < 100ms
- [ ] Proper indexing
- [ ] No N+1 queries

#### Expected Result
Profile retrieval is fast.

### 5.2. Create Profile Performance

**ID:** BE-T-022
**Priority:** Must
**Type:** Performance

#### Steps
1. Send POST to `/api/profiles`
2. Measure response time
3. Verify meets 100ms threshold

#### Validation
- [ ] Response < 100ms
- [ ] Efficient insertion

#### Expected Result
Profile creation is fast.

## 6. Error Handling Tests

### 6.1. Error Messages

**ID:** BE-T-023
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

## 7. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] Profile isolation working
- [ ] No critical bugs

## 8. Test Execution Notes

- Test with many profiles
- Verify data integrity
- Test profile switching logic
- Verify settings isolation

## 9. Dependencies

- Database with profiles table
- User ownership relationships
- Settings data model
- Auth middleware