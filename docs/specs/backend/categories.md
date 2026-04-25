# Categories Specification

**Module:** Categories
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

Categories organize transactions into meaningful groups for better financial tracking and reporting.

## 2. Functional Requirements

### 2.1. CRUD Operations

| ID | Description | Type |
|----|-------------|------|
| C-001 | Get all categories must return list of categories | Must |
| C-002 | Get category by ID must return category data | Must |
| C-003 | Create category must validate required fields | Must |
| C-004 | Create category must return newly created category | Must |
| C-005 | Update category must allow updating category data | Must |
| C-006 | Update category must return updated category | Must |
| C-007 | Delete category must remove category | Must |

### 2.2. Category Data

| ID | Description | Type |
|----|-------------|------|
| C-010 | Category must have required fields (name, color) | Must |
| C-011 | Category must have unique name per user | Must |
| C-012 | Category must have color for visual identification | Must |
| C-013 | Category must have icon | Should |
| C-014 | Category must support description | Should |
| C-015 | Category must have transaction type (income/expense/both) | Must |

### 2.3. Category Hierarchy

| ID | Description | Type |
|----|-------------|------|
| C-020 | Categories must support subcategories | Should |
| C-021 | Parent-child relationship must be tracked | Should |
| C-022 | Parent category color should inherit to children | Should |

### 2.4. Category Mappings

| ID | Description | Type |
|----|-------------|------|
| C-030 | Categories must support mapping from external sources | Should |
| C-031 | Category mappings must be configurable | Should |
| C-032 | Auto-mapping feature must be available | Should |

### 2.5. Bulk Operations

| ID | Description | Type |
|----|-------------|------|
| C-040 | Bulk import must support categories | Should |
| C-041 | Bulk export must include categories | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | Get all categories must complete within 50ms | 50ms |
| NFR-002 | Create category must complete within 50ms | 50ms |
| NFR-003 | Update category must complete within 50ms | 50ms |

### 3.2. Data Consistency

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-004 | Category name must be unique per user | Always |
| NFR-005 | Category operations must be atomic | Always |

### 3.3. Security

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-006 | Category access must be scoped to user | Always |

## 4. API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/categories` | GET | Get all categories |
| `/api/categories` | POST | Create new category |
| `/api/categories/:id` | GET | Get single category |
| `/api/categories/:id` | PUT | Update category |
| `/api/categories/:id` | DELETE | Delete category |
| `/api/categories/mappings` | GET | Get category mappings |
| `/api/categories/mappings` | POST | Create category mapping |
| `/api/categories/auto-map` | POST | Auto-map categories |
| `/api/categories/apply-mappings` | POST | Apply category mappings |

## 5. Data Models

**Category:**
- `id: string` - Category UUID
- `name: string` - Category name
- `color: string` - Category color (hex or rgba)
- `icon: string` - Category icon (emoji or font icon)
- `description: string` - Category description
- `type: string` - 'income', 'expense', or 'both'
- `parentId: string` - Parent category ID (for subcategories)
- `createdAt: ISO8601` - Creation timestamp
- `updatedAt: ISO8601` - Last update timestamp

**CategoryMapping:**
- `id: string` - Mapping UUID
- `externalSource: string` - Source system (e.g., 'bank', 'accounting')
- `externalCategory: string` - External category name
- `internalCategory: string` - Internal category name
- `internalCategoryId: string` - Internal category ID

**CategoryBalance:**
- `categoryName: string` - Category name
- `categoryColor: string` - Category color
- `total: number` - Total amount for category
- `count: number` - Transaction count

## 6. User Flows

### 6.1. Create Category

1. User opens Categories page
2. User clicks "Add Category" button
3. Modal displays category creation form
4. User enters required fields (name, color)
5. User selects optional fields (type, icon, description)
6. User can optionally set as parent for subcategories
7. System validates input
8. System creates category
9. System returns category with confirmation

### 6.2. Edit Category

1. User selects category to edit
2. User modifies category details
3. System updates category
4. System returns updated category

### 6.3. Delete Category

1. User selects category to delete
2. User confirms deletion
3. System validates no transactions use category
4. System deletes category
5. System returns success confirmation

## 7. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| Category name already exists | Return 400 with error message |
| Category ID not found | Return 404 Not Found |
| Category has associated transactions | Return 400 with warning |
| Invalid color format | Return 400 with error message |

## 8. Open/Closed Questions

1. Should users customize category ordering?
2. Should categories be pre-populated with common financial categories?
3. Should category search be supported?
4. Should category usage statistics be tracked?

## 9. Acceptance Criteria

- [ ] User can create multiple categories
- [ ] User can view all categories
- [ ] User can update category details
- [ ] User can delete categories
- [ ] Category names must be unique per user
- [ ] Categories support color and icon
- [ ] Categories support income and expense types
- [ ] Categories are scoped to user
- [ ] Categories can be mapped from external sources