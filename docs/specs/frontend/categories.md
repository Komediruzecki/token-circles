# Categories Specification (Frontend)

**Module:** Categories (UI)
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

The Categories module provides a complete interface for managing financial categories including creating, editing, deleting, and viewing category details.

## 2. Functional Requirements

### 2.1. Category List

| ID | Description | Type |
|----|-------------|------|
| C-001 | Category list must display all categories | Must |
| C-002 | List must show name, color, icon, type, count | Must |
| C-003 | List must support filtering by type (income/expense) | Must |
| C-004 | List must support sorting | Should |
| C-005 | Loading state must display while fetching | Must |
| C-006 | Empty state must display when no categories exist | Must |

### 2.2. Category Display

| ID | Description | Type |
|----|-------------|------|
| C-010 | Each category must show name, color, icon, type, count | Must |
| C-011 | Category name must be clear and concise | Must |
| C-012 | Category color must be visible | Must |
| C-013 | Category icon must be appropriate | Should |
| C-014 | Category must show transaction count | Should |

### 2.3. Create Category

| ID | Description | Type |
|----|-------------|------|
| C-020 | Add category button must be visible | Must |
| C-021 | Create category form must accept all fields | Must |
| C-022 | Form must include name, color, type | Must |
| C-023 | Form must support icon selection | Should |
| C-024 | Form must support description field | Should |
| C-025 | Form must support parent category | Should |
| C-026 | Form validation must prevent errors | Must |
| C-027 | Category must be created successfully | Must |
| C-028 | Success message must display after creation | Must |
| C-029 | Unique name check must be enforced | Must |

### 2.4. Edit Category

| ID | Description | Type |
|----|-------------|------|
| C-030 | Category must be editable | Must |
| C-031 | Edit button must be visible on each category | Must |
| C-032 | Edit form must pre-fill existing values | Must |
| C-033 | Changes must update the category | Must |
| C-034 | Success message must display after update | Must |

### 2.5. Delete Category

| ID | Description | Type |
|----|-------------|------|
| C-040 | Delete button must be visible on each category | Must |
| C-041 | Delete must require confirmation | Must |
| C-042 | Category must be deleted on confirmation | Must |
| C-043 | Success message must display after deletion | Must |
| C-044 | Warning must show if category has transactions | Should |

### 2.6. Category Details

| ID | Description | Type |
|----|-------------|------|
| C-050 | Clicking category must open details modal | Must |
| C-051 | Details modal must show category info | Must |
| C-052 | Details modal must show parent category | Should |
| C-053 | Details modal must show child categories | Should |
| C-054 | Details modal must show transactions | Must |

### 2.7. Category Hierarchy

| ID | Description | Type |
|----|-------------|------|
| C-060 | Categories must support subcategories (hierarchy) | Should |
| C-061 | Parent-child relationship must be visible | Should |
| C-062 | Parent color should inherit to children | Should |

### 2.8. Navigation

| ID | Description | Type |
|----|-------------|------|
| C-080 | Category list must be accessible from sidebar | Must |
| C-081 | Navigation must update URL hash | Must |
| C-082 | Browser back/forward must work | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | List load must complete within 50ms | 50ms |
| NFR-002 | Category creation must complete within 50ms | 50ms |

### 3.2. Usability

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-003 | Form must be mobile-responsive | Always |
| NFR-004 | List must be touch-friendly on mobile | Always |
| NFR-005 | Color picker must be easy to use | Should |

### 3.3. Accessibility

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-006 | All inputs must have labels | Always |
| NFR-007 | Keyboard navigation must be supported | Always |
| NFR-008 | Category cards must be clickable with keyboard | Should |

## 4. UI Components

### 4.1. Category Cards

- Name, color bar, icon, type badge
- Edit and Delete buttons
- Hover effects
- Color bar indicates category color

### 4.2. Category Form Modal

- Name input
- Color picker
- Type dropdown (income, expense, both)
- Icon picker
- Description textarea
- Parent category dropdown
- Submit and Cancel buttons

### 4.3. Category Details Modal

- Category information (name, color, type, description)
- Transaction count
- Parent category
- Child categories
- Edit and Delete buttons
- Close button

### 4.4. Subcategory Tree

- Indented list for nested categories
- Expand/collapse for many items
- Color inheritance indication

## 5. User Flows

### 5.1. View Categories

1. User clicks "Categories" in sidebar
2. System loads category list
3. System displays category cards
4. System applies current filters

### 5.2. Create Category

1. User clicks "Add Category" button
2. System opens creation modal
3. User fills in form
4. User clicks "Save"
5. System validates and saves
6. System closes modal and shows success
7. Category appears in list

### 5.3. View Category Details

1. User clicks on category card
2. System opens details modal
3. System displays category info
4. System displays transactions

### 5.4. Edit Category

1. User clicks "Edit" on category
2. System opens edit modal with existing values
3. User modifies fields
4. User clicks "Save"
5. System validates and updates
6. System shows success message

### 5.5. Delete Category

1. User clicks "Delete" on category
2. User confirms deletion
3. System deletes category
4. System shows success message

## 6. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| API returns error | System shows error message |
| Form validation fails | System highlights errors |
| API is unavailable | System shows offline message |
| No categories exist | System shows empty state with create button |
| Category name already exists | System shows error message |

## 7. Open/Closed Questions

1. Should categories have a predefined set of icons?
2. Should users be able to customize color schemes?
3. Should categories support icons from emoji picker?
4. Should category ordering be customizable?

## 8. Acceptance Criteria

- [ ] User can view all categories
- [ ] User can create categories
- [ ] User can edit categories
- [ ] User can delete categories
- [ ] Category names must be unique
- [ ] Category list loads quickly
- [ ] Mobile responsive
- [ ] Color picker works correctly
- [ ] Unique name check is enforced

## 9. Integration Points

| Module | Purpose |
|--------|---------|
| Backend /api/categories | Data source |
| Backend /api/categories/mappings | External mappings |
| Backend /api/tags | Tag support |

## 10. Category Types

- Income
- Expense
- Both (can be used for both)