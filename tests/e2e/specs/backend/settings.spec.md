# E2E Test Specification - Settings Module

**Module:** Settings
**Test Suite:** Backend
**Version:** 2.0
**Status:** Active

## 1. Test Overview

This specification defines end-to-end tests for the Settings module backend, covering user settings CRUD, preferences management, notifications configuration, data export controls, and security settings.

## 2. User Settings CRUD Tests

### 2.1. Get User Settings

**ID:** BE-T-001
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send GET to `/api/settings`
3. Verify response 200 OK
4. Verify settings returned
5. Verify settings belong to user

#### Validation
- [ ] Response status 200
- [ ] Settings returned
- [ ] Settings belong to user
- [ ] No cross-user data

#### Expected Result
User settings retrieved successfully.

### 2.2. Get User Settings Without Auth

**ID:** BE-T-002
**Priority:** Must
**Type:** Negative

#### Steps
1. Send GET to `/api/settings` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.3. Get Another User's Settings

**ID:** BE-T-003
**Priority:** Must
**Type:** Negative

#### Steps
1. Create user A
2. Login as user B
3. Try to get user A's settings
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user access blocked

#### Expected Result
Cross-user access blocked.

### 2.4. Update User Settings

**ID:** BE-T-004
**Priority:** Must
**Type:** Positive

#### Steps
1. Login and get token
2. Send PUT to `/api/settings` with updates
3. Verify response 200 OK
4. Verify changes persisted
5. Verify other fields unchanged

#### Validation
- [ ] Response status 200
- [ ] Changes persisted
- [ ] Only owner can update
- [ ] Cross-user updates blocked

#### Expected Result
User settings updated successfully.

### 2.5. Update User Settings Without Auth

**ID:** BE-T-005
**Priority:** Must
**Type:** Negative

#### Steps
1. Send PUT to `/api/settings` without token
2. Verify response 401 Unauthorized

#### Validation
- [ ] Response status 401
- [ ] Error message present

#### Expected Result
Access denied without authentication.

### 2.6. Update Another User's Settings

**ID:** BE-T-006
**Priority:** Must
**Type:** Negative

#### Steps
1. Create user A
2. Login as user B
3. Try to update user A's settings
4. Verify response 403 Forbidden

#### Validation
- [ ] Response status 403
- [ ] Error message present
- [ ] Cross-user updates blocked

#### Expected Result
Cross-user updates blocked.

## 3. Data Validation Tests

### 3.1. Invalid Settings Data

**ID:** BE-T-007
**Priority:** Must
**Type:** Negative

#### Steps
1. Send PUT to `/api/settings` with invalid data
2. Verify response 400 Bad Request
3. Verify validation errors

#### Validation
- [ ] Response status 400
- [ ] Validation errors present
- [ ] Changes not persisted

#### Expected Result
Invalid settings data rejected.

### 3.2. Invalid Notification Settings

**ID:** BE-T-008
**Priority:** Must
**Type:** Negative

#### Steps
1. Send PUT to `/api/settings` with invalid notification settings
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid notification settings prevented.

### 3.3. Invalid Theme Settings

**ID:** BE-T-009
**Priority:** Must
**Type:** Negative

#### Steps
1. Send PUT to `/api/settings` with invalid theme
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid theme prevented.

## 4. General Settings Tests

### 4.1. Currency Settings

**ID:** BE-T-010
**Priority:** Must
**Type:** Positive

#### Steps
1. Get user settings
2. Verify default currency
3. Update currency
4. Verify currency updated
5. Create transaction
6. Verify transaction uses new currency

#### Validation
- [ ] Default currency saved
- [ ] Currency update persists
- [ ] Transactions use new currency

#### Expected Result
Currency settings work correctly.

### 4.2. Date Format Settings

**ID:** BE-T-011
**Priority:** Must
**Type:** Positive

#### Steps
1. Get user settings
2. Verify default date format
3. Update date format
4. Verify format updated
5. View transactions
6. Verify dates use new format

#### Validation
- [ ] Date format saved
- [ ] Format update persists
- [ ] Dates display correctly

#### Expected Result
Date format settings work correctly.

### 4.3. Number Format Settings

**ID:** BE-T-012
**Priority:** Must
**Type:** Positive

#### Steps
1. Get user settings
2. Verify default number format
3. Update number format
4. Verify format updated
5. View transactions
6. Verify numbers use new format

#### Validation
- [ ] Number format saved
- [ ] Format update persists
- [ ] Numbers display correctly

#### Expected Result
Number format settings work correctly.

### 4.4. Timezone Settings

**ID:** BE-T-013
**Priority:** Must
**Type:** Positive

#### Steps
1. Get user settings
2. Verify default timezone
3. Update timezone
4. Verify timezone updated
5. Set transaction date
6. Verify date in new timezone

#### Validation
- [ ] Timezone saved
- [ ] Timezone update persists
- [ ] Dates in correct timezone

#### Expected Result
Timezone settings work correctly.

### 4.5. Language Settings

**ID:** BE-T-014
**Priority:** Should
**Type:** Positive

#### Steps
1. Get user settings
2. Verify default language
3. Update language
4. Verify language updated
5. Verify UI text language

#### Validation
- [ ] Language saved
- [ ] Language update persists
- [ ] UI text reflects new language

#### Expected Result
Language settings work correctly.

### 4.6. Theme Settings

**ID:** BE-T-015
**Priority:** Must
**Type:** Positive

#### Steps
1. Get user settings
2. Verify default theme
3. Update theme
4. Verify theme updated
5. Verify UI theme applied

#### Validation
- [ ] Theme saved
- [ ] Theme update persists
- [ ] UI theme reflects new setting

#### Expected Result
Theme settings work correctly.

## 5. Notification Settings Tests

### 5.1. Email Notification Settings

**ID:** BE-T-016
**Priority:** Must
**Type:** Positive

#### Steps
1. Get user settings
2. Update email notification preferences
3. Verify preferences saved
4. Trigger notification event
5. Verify notification sent

#### Validation
- [ ] Notification preferences saved
- [ ] Notifications sent as configured
- [ ] Preferences persisted

#### Expected Result
Email notifications work correctly.

### 5.2. Push Notification Settings

**ID:** BE-T-017
**Priority:** Must
**Type:** Positive

#### Steps
1. Get user settings
2. Update push notification preferences
3. Verify preferences saved
4. Trigger notification event
5. Verify push sent

#### Validation
- [ ] Notification preferences saved
- [ ] Push notifications sent
- [ ] Preferences persisted

#### Expected Result
Push notifications work correctly.

### 5.3. Notification Types

**ID:** BE-T-018
**Priority:** Must
**Type:** Positive

#### Steps
1. Get notification settings
2. Configure notification types
3. Verify types saved
4. Trigger each type
5. Verify only configured types sent

#### Validation
- [ ] Notification types saved
- [ ] Only configured types sent
- [ ] No unwanted notifications

#### Expected Result
Notification types work correctly.

### 5.4. Notification Frequency

**ID:** BE-T-019
**Priority:** Should
**Type:** Positive

#### Steps
1. Get notification settings
2. Update frequency
3. Verify frequency saved
4. Verify notification timing

#### Validation
- [ ] Frequency saved
- [ ] Notifications sent at correct intervals
- [ ] Frequency persists

#### Expected Result
Notification frequency works correctly.

### 5.5. Notification Batching

**ID:** BE-T-020
**Priority:** Should
**Type:** Positive

#### Steps
1. Configure batching
2. Trigger multiple notifications
3. Verify batching behavior
4. Verify timing

#### Validation
- [ ] Batching config saved
- [ ] Notifications batched as configured
- [ ] Not too frequent

#### Expected Result
Notification batching works correctly.

### 5.6. Manage Notifications

**ID:** BE-T-021
**Priority:** Should
**Type:** Positive

#### Steps
1. Get notification settings
2. Turn off notifications
3. Verify no notifications sent
4. Turn on notifications
5. Verify notifications sent

#### Validation
- [ ] Notifications can be disabled
- [ ] Notifications resume correctly
- [ ] Settings persisted

#### Expected Result
Notifications can be managed.

## 6. Security Settings Tests

### 6.1. Change Password

**ID:** BE-T-022
**Priority:** Must
**Type:** Positive

#### Steps
1. Get authentication
2. Send POST to `/api/settings/password` with old and new password
3. Verify response 200 OK
4. Verify password changed
5. Try login with old password (should fail)
6. Try login with new password (should succeed)

#### Validation
- [ ] Response status 200
- [ ] Password changed successfully
- [ ] Old password no longer works
- [ ] New password works

#### Expected Result
Password change works correctly.

### 6.2. Change Password Without Current Password

**ID:** BE-T-023
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to change password without current password
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Current password verification required.

### 6.3. Password Complexity

**ID:** BE-T-024
**Priority:** Must
**Type:** Positive

#### Steps
1. Set password with required complexity
2. Verify acceptance
3. Try weak password
4. Verify rejection

#### Validation
- [ ] Strong password accepted
- [ ] Weak password rejected
- [ ] Requirements enforced

#### Expected Result
Password complexity enforced.

### 6.4. Two-Factor Authentication

**ID:** BE-T-025
**Priority:** Should
**Type:** Positive

#### Steps
1. Enable 2FA
2. Verify setup
3. Login with 2FA code
4. Verify access
5. Disable 2FA
6. Verify disabled

#### Validation
- [ ] 2FA setup works
- [ ] Login with 2FA works
- [ ] 2FA can be disabled
- [ ] Settings persisted

#### Expected Result
Two-factor authentication works.

### 6.5. Session Management

**ID:** BE-T-026
**Priority:** Should
**Type:** Positive

#### Steps
1. Login and get token
2. Create session
3. Get active sessions
4. Verify session listed
5. Logout
6. Verify session removed

#### Validation
- [ ] Sessions tracked
- [ ] Can list sessions
- [ ] Can logout
- [ ] Session removed

#### Expected Result
Session management works.

### 6.6. Session Timeout

**ID:** BE-T-027
**Priority:** Should
**Type:** Positive

#### Steps
1. Set session timeout
2. Login
3. Wait for timeout
4. Try to use token
5. Verify token invalid

#### Validation
- [ ] Timeout setting works
- [ ] Token expires correctly
- [ ] Must re-login after timeout

#### Expected Result
Session timeout works correctly.

### 6.7. Active Sessions List

**ID:** BE-T-028
**Priority:** Should
**Type:** Positive

#### Steps
1. Login from multiple devices
2. Get active sessions
3. Verify all devices listed
4. Add new session
5. Verify updated list

#### Validation
- [ ] All sessions listed
- [ ] Device information included
- [ ] List updates correctly

#### Expected Result
Active sessions can be managed.

### 6.8. Revoke Session

**ID:** BE-T-029
**Priority:** Should
**Type:** Positive

#### Steps
1. Login from multiple devices
2. Revoke one session
3. Verify session removed
4. Verify revoked session no longer works

#### Validation
- [ ] Session can be revoked
- [ ] Revoked session no longer valid
- [ ] Other sessions unaffected

#### Expected Result
Sessions can be revoked.

### 6.9. Enable/Disable Account

**ID:** BE-T-030
**Priority:** Must
**Type:** Positive

#### Steps
1. Get current user
2. Enable account
3. Verify account active
4. Disable account
5. Verify account disabled
6. Try login with disabled account
7. Verify access denied

#### Validation
- [ ] Account can be enabled/disabled
- [ ] Disabled account cannot login
- [ ] Enabled account can login

#### Expected Result
Account can be enabled/disabled.

### 6.10. Disable Account Requires Reauthentication

**ID:** BE-T-031
**Priority:** Must
**Type:** Positive

#### Steps
1. Disable account
2. Try to disable again without re-auth
3. Verify response

#### Validation
- [ ] Re-authentication required
- [ ] Multiple disables blocked

#### Expected Result
Re-authentication required for sensitive changes.

## 7. Data Settings Tests

### 7.1. Data Export Preferences

**ID:** BE-T-032
**Priority:** Should
**Type:** Positive

#### Steps
1. Get data export settings
2. Update preferences
3. Verify preferences saved
4. Trigger export
5. Verify export respects preferences

#### Validation
- [ ] Preferences saved
- [ ] Export respects preferences
- [ ] User controls export

#### Expected Result
Data export preferences work.

### 7.2. Data Import Preferences

**ID:** BE-T-033
**Priority:** Should
**Type:** Positive

#### Steps
1. Get data import settings
2. Update preferences
3. Verify preferences saved
4. Verify import respects preferences

#### Validation
- [ ] Preferences saved
- [ ] Import behavior correct
- [ ] User controls import

#### Expected Result
Data import preferences work.

### 7.3. Auto Backup Settings

**ID:** BE-T-034
**Priority:** Should
**Type:** Positive

#### Steps
1. Set auto backup preferences
2. Verify settings saved
3. Trigger backup
4. Verify backup runs as configured
5. Verify backup location

#### Validation
- [ ] Settings saved
- [ ] Backup runs correctly
- [ ] Backup location correct

#### Expected Result
Auto backup settings work.

### 7.4. Backup Schedule

**ID:** BE-T-035
**Priority:** Should
**Type:** Positive

#### Steps
1. Set backup schedule
2. Verify schedule saved
3. Wait for scheduled time
4. Verify backup ran
5. Verify backup included

#### Validation
- [ ] Schedule saved
- [ ] Backup runs on schedule
- [ ] Multiple schedules supported

#### Expected Result
Backup schedule works.

### 7.5. Data Retention Settings

**ID:** BE-T-036
**Priority:** Should
**Type:** Positive

#### Steps
1. Set data retention policy
2. Verify settings saved
3. Verify old data handled correctly
4. Verify retention policy enforced

#### Validation
- [ ] Settings saved
- [ ] Data retention working
- [ ] Policy enforced

#### Expected Result
Data retention settings work.

## 8. Privacy Settings Tests

### 8.1. Privacy Mode

**ID:** BE-T-037
**Priority:** Should
**Type:** Positive

#### Steps
1. Enable privacy mode
2. Verify sensitive data obscured
3. Create transaction
4. Verify transaction not visible to others
5. Disable privacy mode
6. Verify visibility restored

#### Validation
- [ ] Privacy mode hides data
- [ ] Data not visible to others
- [ ] Can be disabled

#### Expected Result
Privacy mode works.

### 8.2. Data Visibility Settings

**ID:** BE-T-038
**Priority:** Should
**Type:** Positive

#### Steps
1. Set data visibility preferences
2. Verify settings saved
3. Verify visible/not visible based on preferences

#### Validation
- [ ] Settings saved
- [ ] Visibility respected
- [ ] Granular control

#### Expected Result
Data visibility settings work.

### 8.3. Data Sharing Settings

**ID:** BE-T-039
**Priority:** Should
**Type:** Positive

#### Steps
1. Set data sharing preferences
2. Verify settings saved
3. Verify sharing behavior

#### Validation
- [ ] Settings saved
- [ ] Sharing controlled
- [ ] Privacy protected

#### Expected Result
Data sharing settings work.

## 9. Performance Tests

### 9.1. Get Settings Performance

**ID:** BE-T-040
**Priority:** Must
**Type:** Performance

#### Steps
1. Send GET to `/api/settings`
2. Measure response time
3. Verify meets 50ms threshold

#### Validation
- [ ] Response < 50ms
- [ ] Efficient retrieval

#### Expected Result
Settings retrieval is fast.

### 9.2. Update Settings Performance

**ID:** BE-T-041
**Priority:** Must
**Type:** Performance

#### Steps
1. Send PUT to `/api/settings`
2. Measure response time
3. Verify meets 100ms threshold

#### Validation
- [ ] Response < 100ms
- [ ] Efficient updates

#### Expected Result
Settings updates are fast.

## 10. Error Handling Tests

### 10.1. Error Messages

**ID:** BE-T-042
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

### 10.2. Invalid Password

**ID:** BE-T-043
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to change password to invalid format
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Invalid password prevented.

### 10.3. Weak Password

**ID:** BE-T-044
**Priority:** Must
**Type:** Negative

#### Steps
1. Try to set weak password
2. Verify response 400 Bad Request

#### Validation
- [ ] Response status 400
- [ ] Error message present

#### Expected Result
Weak password prevented.

## 11. Integration Tests

### 11.1. Settings Affect All Modules

**ID:** BE-T-045
**Priority:** Should
**Type:** Integration

#### Steps
1. Update currency setting
2. Create transaction
3. Create budget
4. View all modules
5. Verify currency applied everywhere

#### Validation
- [ ] Currency applied to all modules
- [ ] Settings have global effect
- [ ] Consistent display

#### Expected Result
Settings affect all modules.

### 11.2. Settings Affect Calculations

**ID:** BE-T-046
**Priority:** Should
**Type:** Integration

#### Steps
1. Change number format
2. Get calculations
3. Verify format applied
4. Change date format
5. Verify dates in new format

#### Validation
- [ ] Number format affects calculations
- [ ] Date format affects dates
- [ ] Settings integrated

#### Expected Result
Settings affect calculations.

### 11.3. Settings Affect Notifications

**ID:** BE-T-047
**Priority:** Must
**Type:** Integration

#### Steps
1. Update notification preferences
2. Trigger notification event
3. Verify notification behavior
4. Verify settings respected

#### Validation
- [ ] Notification behavior follows settings
- [ ] Preferences apply immediately
- [ ] Settings persisted

#### Expected Result
Settings affect notifications.

## 12. Acceptance Criteria

- [ ] All Must scenarios pass
- [ ] At least 80% of Should scenarios pass
- [ ] Performance targets met
- [ ] Settings CRUD working
- [ ] Security settings working
- [ ] Cross-user data isolation working
- [ ] Settings apply globally

## 13. Test Execution Notes

- Test all setting types
- Verify persistence across sessions
- Test default settings
- Verify validation rules
- Test error handling
- Test integration with all modules

## 14. Dependencies

- Database with settings table
- Password management
- Notification system
- Session management
- Data export/import
- Multi-module integration