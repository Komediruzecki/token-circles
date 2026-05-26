# Frontend Architectural Refactor: Migrate Data Fetching to `createResource`

## Background

The frontend currently handles asynchronous data fetching (calling APIs) using a combination of `createSignal` for tracking data, `loading`, and `error` states, plus `onMount` and `createEffect` to manually trigger async functions.

While this works, it requires excessive boilerplate and is prone to race conditions (e.g., if a user switches profiles or months rapidly, older async responses could overwrite newer ones).

SolidJS provides `createResource` specifically for this purpose.

## Will this improve the frontend codebase?

**Yes, significantly!**
1. **Less Boilerplate:** Removes the need to manually create and toggle `loading` and `error` signals. The resource accessor (e.g. `data.loading`, `data.error`) handles this out of the box.
2. **Race Condition Prevention:** SolidJS manages the async lifecycle natively. When the source signals change (e.g. `month()` or `state.profileVersion`), `createResource` ignores stale fetch results.
3. **Declarative Fetching:** Instead of writing manual `createEffect` hooks that run fetch functions, you just pass your reactive dependencies to `createResource`. It automatically refetches when they change.
4. **Suspense Ready:** This is a key building block if we ever want to implement true SSR or visual `<Suspense>` boundaries.

## Proposed Changes

We will refactor the feature pages to use `createResource`. The files to update include:

### 1. `features/Analytics.tsx`
- **Current:** Manual `loadData`, `loadYears`, `loadHeatmapData`, `loadStackedData` driven by `onMount` and `createEffect`.
- **New:**
  - `const [analytics, { mutate }] = createResource(sourceSignal, fetchAnalytics)`
  - Replaces internal `data()`, `setData`, `loading()`, `setLoading()`.

### 2. `features/Budgets.tsx`
- **Current:** Uses `loadData()`, `loadCategories()`, `loadImprovements()`.
- **New:** Consolidate these into appropriate `createResource` declarations, tracking `month()` and `state.profileVersion`.

### 3. `features/Categories.tsx`
- **Current:** `loadCategories()` called in `onMount` and `createEffect`.
- **New:** Use `createResource` tracking `state.profileVersion`.

### 4. `features/Accounts.tsx` & `features/Bills.tsx`
- Migrate local `loading` / `data` signals to `createResource`.

### 5. `components/DashboardSettings.tsx`, `Dashboard/BudgetAlertsCard.tsx`, etc.
- Standardize data fetching using `createResource`.

## Rollout Strategy

Because this is a massive refactoring affecting the data flow of the entire application, it is recommended to rollout the pattern piece by piece, starting with an isolated page (e.g., `Budgets.tsx` or `Analytics.tsx`), ensuring stability, and then propagating the standard.
