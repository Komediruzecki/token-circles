# Profiles Specification

**Module:** Profiles
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

Profiles represent user financial data containers, allowing users to manage multiple financial scenarios (e.g., household, business, investment portfolio).

## 2. Functional Requirements

### 2.1. CRUD Operations

| ID | Description | Type |
|----|-------------|------|
| P-001 | Get all profiles must return list of user profiles | Must |
| P-002 | Get single profile by ID must return profile data | Must |
| P-003 | Create profile must validate required fields | Must |
| P-004 | Create profile must return newly created profile | Must |
| P-005 | Update profile must allow updating profile data | Must |
| P-006 | Update profile must return updated profile | Must |
| P-007 | Delete profile must remove profile and all data | Must |
| P-008 | Delete profile must require authentication | Must |

### 2.2. Profile Management

| ID | Description | Type |
|----|-------------|------|
| P-010 | Profile must have unique name across user | Must |
| P-011 | Profile must have default currency setting | Must |
| P-012 | Profile must support multiple currencies | Must |
| P-013 | Profile must have active/inactive status | Should |
| P-014 | User can have unlimited profiles | Should |

### 2.3. Profile Data

| ID | Description | Type |
|----|-------------|------|
| P-020 | Profile must store basic metadata (name, currency, icon) | Must |
| P-021 | Profile must support profile icon selection | Should |
| P-022 | Profile must support profile description | Should |
| P-023 | Profile data must be isolated per profile | Must |

### 2.4. Bulk Operations

| ID | Description | Type |
|----|-------------|------|
| P-030 | Bulk delete must remove multiple profiles | Should |
| P-031 | Bulk import must support profile data import | Should |
| P-032 | Bulk export must support profile data export | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | Get all profiles must complete within 200ms | 200ms |
| NFR-002 | Create profile must complete within 100ms | 100ms |
| NFR-003 | Delete profile must complete within 500ms | 500ms |

### 3.2. Data Consistency

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-004 | Profile data changes must be atomic | Always |
| NFR-005 | Deleted profile data must be permanently removed | Always |

### 3.3. Security

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-006 | Profile access must be scoped to user | Always |
| NFR-007 | Profile data encryption must be optional | Should |

## 4. API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/profiles` | GET | Get all profiles |
| `/api/profiles` | POST | Create new profile |
| `/api/profiles/:id` | GET | Get single profile |
| `/api/profiles/:id` | PUT | Update profile |
| `/api/profiles/:id` | DELETE | Delete profile |
| `/api/profile/data` | DELETE | Delete all profile data |

## 5. Data Models

**Profile:**
- `id: string` - Profile UUID
- `name: string` - Profile name
- `currency: string` - Default currency code
- `icon: string` - Profile icon emoji/identifier
- `description: string` - Profile description
- `createdAt: ISO8601` - Profile creation timestamp
- `updatedAt: ISO8601` - Profile last update timestamp

**CreateProfileRequest:**
- `name: string` (required) - Profile name
- `currency: string` (optional) - Currency code, defaults to user default
- `icon: string` (optional) - Profile icon
- `description: string` (optional) - Profile description

## 6. User Flows

### 6.1. Create Profile

1. User clicks "Create Profile"
2. Modal displays profile creation form
3. User enters name and optional details
4. System validates required fields
5. System creates profile with default currency
6. System returns profile to user

### 6.2. Delete Profile

1. User selects profile to delete
2. User confirms deletion
3. System validates no active transactions exist (optional)
4. System deletes profile and all associated data
5. System returns success confirmation

## 7. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| Profile name already exists | Return 400 with error message |
| Profile ID not found | Return 404 Not Found |
| User cannot access profile | Return 403 Forbidden |
| No profiles exist | Return empty array |

## 8. Open/Closed Questions

1. Should profiles support templates?
2. Should users be able to switch profile context?
3. Should profiles support privacy/visibility settings?

## 9. Acceptance Criteria

- [ ] User can create multiple profiles
- [ ] User can view all their profiles
- [ ] User can update profile details
- [ ] User can delete profiles
- [ ] Profile deletion removes all associated data
- [ ] Profile names must be unique per user
- [ ] Profile data is isolated between profiles