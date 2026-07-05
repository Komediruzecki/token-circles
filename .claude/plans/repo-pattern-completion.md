# Repository Pattern Completion Plan

## Goal
Replace all raw `db.prepare(...)` calls in route files with repository method calls. 13 routes currently bypass the repository layer.

## Current State
- 18 repos exist (all table domains covered)
- 13 of 27 route files use raw `db` instead of repos
- ~100 raw db calls across these routes

---

## Phase 1: Routes Where Repos Already Have Methods (low-risk, mechanical)

These routes just need `db.prepare(...)` → `req.repos.X.method()` substitution.

| Route | Raw db ops | Repo | Status |
|-------|-----------|------|--------|
| `auth.js` | 3 | usersRepo (getByUsername, getById, updatePassword) | Already exists |
| `settings.js` | 1 | settingsRepo (upsert) | Already exists |
| `storageMode.js` | 2 | settingsRepo (getValue, upsert) | Already exists |
| `notifications.js` | 5 | usersRepo + settingsRepo | Already exists |
| `savingsGoals.js` | 1 | goalsRepo (updateAmount) | Already exists |
| `budgets.js` | 2 | budgetsRepo (bulkCreateMonthly, duplicateLast) | Already exists |

**Approach**: Mechanical substitution. Each `db.prepare(sql).run/get/all(...)` → equivalent repo call.

---

## Phase 2: Routes Needing Minor Repo Additions

### `profiles.js` (3 db ops)
- 2 users queries → usersRepo (already exists)
- 1 `db.seedThreeTierProfiles()` → add `seed()` to profilesRepo

### `categories.js` (5 db ops)  
- `category_mappings` operations → add to categoriesRepo:
  - `getMapping(profileId, pattern)` 
  - `upsertMapping(id, profileId, pattern, categoryId, confidence)`
  - `insertMapping(profileId, pattern, categoryId, confidence)`
- Bulk recategorize → `updateTransactionsCategory(categoryId, newCategoryId, profileId)`
- List categories → already in categoriesRepo.list()

### `tax.js` (2 db ops)
- Tax-deductible expenses query → add `getTaxDeductibleExpenses(profileId, startDate, endDate)` to transactionsRepo
- Income query → add `getIncomeInRange(profileId, startDate, endDate)` to transactionsRepo

### `reports.js` (1 db op)
- Transaction count → use baseRepo.count() or add to transactionsRepo

---

## Phase 3: Complex Routes (surgical extraction)

### `transactions.js` (41 db ops)
This is the hardest. Operations fall into these categories:
1. **List/filter transactions** → extends transactionsRepo.list() with dynamic query building
2. **Tag management** → tagsRepo.setTransactionTags() already exists
3. **Account balance updates** → accountsRepo
4. **Goal amount updates** → goalsRepo.updateAmount() already exists
5. **Bulk delete/update/reconcile** → add to transactionsRepo
6. **Dynamic SQL building** → move query-building logic into repo, keep param validation in route

**Strategy**: Move SQL generation into transactionsRepo methods, keep route-level validation. Add:
- `listFiltered(params)` — handles pagination, search, category/type/reconciled/tag/date filters
- `countFiltered(params)` — count version of above
- `getByIdJoins(id, profileId)` — transaction with joins
- `bulkDelete(ids, profileId)`
- `bulkUpdateCategory(ids, categoryId, profileId)`
- `bulkReconcile(ids, reconciled, profileId)`
- `updateWithGoalSync(id, profileId, data)` — handles side effects
- `deleteWithGoalSync(id, profileId)` — handles side effects

### `exportRoutes.js` (26 db ops)
Import/export operations. Most are bulk inserts across all tables. These can use:
- Existing repo `create()` methods for single inserts
- New repo methods for bulk operations
- `db.transaction()` wrapping stays in route or moves to repo
- `clearAllData(profileId)` → new method that wraps all DELETE statements

### `importRoutes.js` (7 db ops)
Similar to exportRoutes — import operations. Uses `db.transaction()` for bulk inserts.
- Move import logic to a dedicated import service that uses repos
- `db.transaction()` wrapping moves to repo or service

---

## Phase 4: Issue Cleanup

### #154 — Close as duplicate
#155 has more detailed requirements. Close #154.

### #186 — Research & Plan comment
The issue explicitly says: "Plan this feature and add a comment on this GH issue about what you found and how this can be implemented."
- Research free/Proton mail sending options
- Write implementation plan comment on the issue
- Do NOT implement yet — this is research phase

### #155 — Advice Section (stretch goal)
If time permits after repo pattern is done. Full feature with backend API + frontend UI.

---

## Execution Order
1. Close #154 (1 min)
2. Research & comment on #186 (~30 min)
3. Phase 1: Easy repo swaps (6 routes, ~1 hr)
4. Phase 2: Minor repo additions (4 routes, ~1.5 hr)  
5. Phase 3: Complex routes (3 routes, ~2-3 hr)
6. Full test suite after each phase

## Verification
- `grep -l "db\.prepare\|db\.exec\|db\.run\|db\.get\|db\.all" backend/routes/*.js` should return empty
- All 458 E2E tests + 70 unit tests pass
- No behavior changes — pure refactoring
