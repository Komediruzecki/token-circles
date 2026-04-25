# Tags Specification

**Module:** Tags
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

Tags provide flexible categorization for transactions beyond the predefined categories.

## 2. Functional Requirements

### 2.1. CRUD Operations

| ID | Description | Type |
|----|-------------|------|
| TG-001 | Get all tags must return list of tags | Must |
| TG-002 | Get tag by ID must return tag data | Must |
| TG-003 | Create tag must validate required fields | Must |
| TG-004 | Create tag must return newly created tag | Must |
| TG-005 | Update tag must allow updating tag data | Must |
| TG-006 | Update tag must return updated tag | Must |
| TG-007 | Delete tag must remove tag | Must |

### 2.2. Tag Data

| ID | Description | Type |
|----|-------------|------|
| TG-010 | Tag must have unique name per user | Must |
| TG-011 | Tag must have color for visual identification | Must |
| TG-012 | Tag must have icon | Should |
| TG-013 | Tag must support description | Should |
| TG-014 | Tag must have transaction count | Must |

### 2.3. Tag Operations

| ID | Description | Type |
|----|-------------|------|
| TG-020 | Get transactions by tag must return filtered transactions | Must |
| TG-021 | Add tag to transaction must associate tag | Must |
| TG-022 | Remove tag from transaction must dissociate tag | Must |
| TG-023 | Update transaction tags must replace all tags | Must |

### 2.4. Tag Filtering

| ID | Description | Type |
|----|-------------|------|
| TG-030 | Get transactions by tag must support filtering | Must |
| TG-031 | Get transactions by tag must support date range | Should |
| TG-032 | Get transactions by tag must support category filter | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | Get all tags must complete within 50ms | 50ms |
| NFR-002 | Get transactions by tag must complete within 500ms | 500ms |

### 3.2. Data Consistency

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-003 | Tag transactions must be correctly associated | Always |
| NFR-004 | Tag count must be accurate | Always |

### 3.3. Security

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-005 | Tag access must be scoped to user | Always |
| NFR-006 | Transaction tagging must be scoped to user | Always |

## 4. API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tags` | GET | Get all tags |
| `/api/tags` | POST | Create new tag |
| `/api/tags/:id` | GET | Get single tag |
| `/api/tags/:id` | PUT | Update tag |
| `/api/tags/:id` | DELETE | Delete tag |
| `/api/transactions/:id/tags` | GET | Get transaction tags |
| `/api/transactions/:id/tags` | POST | Add tag to transaction |
| `/api/transactions/:id/tags` | PUT | Update transaction tags |
| `/api/transactions/by-tag/:tagId` | GET | Get transactions by tag |

## 5. Data Models

**Tag:**
- `id: string` - Tag UUID
- `name: string` - Tag name
- `color: string` - Tag color (hex or rgba)
- `icon: string` - Tag icon (emoji or font icon)
- `description: string` - Tag description
- `transactionCount: number` - Number of transactions using this tag
- `createdAt: ISO8601` - Creation timestamp
- `updatedAt: ISO8601` - Last update timestamp

**TransactionTag:**
- `id: string` - Transaction UUID
- `tagId: string` - Tag ID

## 6. User Flows

### 6.1. Create Tag

1. User opens Tags page
2. User clicks "Add Tag" button
3. Modal displays tag creation form
4. User enters tag name and optional details (color, icon, description)
5. System validates input
6. System creates tag
7. System returns tag with confirmation

### 6.2. View Transactions by Tag

1. User selects a tag
2. User clicks "View Transactions" button
3. System loads transactions with this tag
4. System displays filtered results

### 6.3. Add Tag to Transaction

1. User opens transaction detail
2. User clicks "Add Tag" button
3. User selects or creates tag
4. System adds tag to transaction
5. System returns updated transaction

### 6.4. Delete Tag

1. User selects tag to delete
2. User confirms deletion
3. System validates no transactions use tag (or warns)
4. System deletes tag
5. System returns success confirmation

## 7. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| Tag name already exists | Return 400 with error message |
| Tag ID not found | Return 404 Not Found |
| Tag has associated transactions | Return 400 with warning |
| Invalid color format | Return 400 with error message |

## 8. Open/Closed Questions

1. Should tags support nested hierarchy?
2. Should tags support emoji-only display?
3. Should tags be auto-suggested when typing?
4. Should tags support visibility settings?

## 9. Acceptance Criteria

- [ ] User can create multiple tags
- [ ] User can view all tags
- [ ] User can update tag details
- [ ] User can delete tags
- [ ] User can add tags to transactions
- [ ] User can view transactions by tag
- [ ] Tag names must be unique per user
- [ ] Tags support color and icon
- [ ] Tag count is accurate

## 10. Dependencies

| Data | Source |
|------|--------|
| Transactions | Transaction data |
| Categories | Category colors for reference |