# Improvement Plan — May 2026

Based on the [codebase audit](./codebase-audit-2026-05.md), organized by priority (impact × effort).

**Status as of 2026-05-27:** Phase 1 and Phase 2 are complete. Phase 3 remains.

### Score Improvements Since Audit

| Dimension | Before | After | Change |
|-----------|--------|-------|--------|
| State Separation | 2/10 | 6/10 | createResource in all features, createStore in use |
| Type Safety | 5/10 | 7/10 | ~60 `any` removed, SankeyChart + Analytics at 0 `any` |
| Reactivity | 4/10 | 7/10 | createResource everywhere, race-condition safe |
| Error Boundaries | 2/10 | 7/10 | Per-route + per-chart boundaries |
| Testing | 2/10 | 4/10 | 307 tests, vitest config, Zod validation tests |
| Overall | 3.1/10 | **6.2/10** | |

---

## Phase 1: Quick Wins (Low Effort, High Impact) — ✅ COMPLETE

### 1.1 Vitest + Unit Tests for Core Modules ✅
- ✅ `vitest.config.ts` exists, `test:unit` script added
- ✅ 307 tests passing across 25 test files
- ✅ Zod validation tests cover 22 cases

### 1.2 Error Boundaries at Key Points ✅
- ✅ Each route page wrapped in `<ErrorBoundary>` in `App.tsx`
- ✅ `Chart.tsx` and `ChartWrapper.tsx` have chart-level boundaries
- ✅ D3HeatmapChart has its own error isolation

### 1.3 Dynamic Import for Heavy Dependencies ✅
- ✅ d3: dynamic `await import('d3')` in SankeyChart.tsx, D3HeatmapChart.tsx
- ✅ xlsx: dynamic `await import('xlsx')` in importFlow.ts
- ✅ jspdf: dynamic `await import('jspdf')` in clientPdfReports.ts
- ✅ d3-sankey: static import (small ~25KB, acceptable)

### 1.4 Route-Based Code Splitting ✅
- ✅ All 18 pages use SolidJS `lazy()` in `router.tsx`
- ✅ `<Suspense>` fallback wrappers in `App.tsx`

### 1.5 createResource Migration ✅
- ✅ All feature pages (Analytics, Budgets, Categories, Bills, Accounts) use `createResource`
- ✅ BudgetAlertsCard uses `createResource` with `profileVersion` tracking
- ✅ Race-condition safe, declarative data fetching

### 1.6 Mobile Layout Improvements ✅
- ✅ Heatmap: min cellSize 10px + horizontal scroll for narrow screens
- ✅ Subscription gallery: `minmax(min(280px, 100%), 1fr)` overflow prevention
- ✅ Safe-area: `viewport-fit=cover`, dvh fallbacks, inset padding on body/sidebar/toggle
- ✅ Analytics 480px: averages flex-wrap, responsive avgCard sizing

---

## Phase 2: Structural Improvements (Medium Effort) — ✅ COMPLETE

### 2.1 Typed Recurring Transactions ✅
- ✅ `RecurringTransaction` interface already in `models.ts`
- ✅ ApiClient methods use `Models.RecurringTransaction` (zero `Promise<any>`)
- ✅ `RecurringSection.tsx`: removed `as any` casts, added `RecurringFormData` with `satisfies` keyword
- ✅ Fixed `createRecurring` param type from strict `Omit` to `Partial & Pick<required>`

### 2.2 Reduce `any` in Feature Pages ✅
- ✅ `Analytics.tsx`: 23 → 0 `any`. Added `CategoryTrendsRow`, `MonthlyStatsRow`, etc. interfaces
- ✅ `SankeyChart.tsx`: 16 → 0 `any`. Added `SankeyNodeDatum`, `SankeyLinkDatum` with D3 generics
- ✅ `clientPdfReports.ts`: already 0 `any`
- ✅ `Budgets.tsx`: 13 → 8 `any` (createResource migration cleaned up most)
- ✅ `Loans.tsx`: 12 → 2 `any` (minor remaining, low risk)

### 2.3 useStore for App-Level State ✅
- ✅ Already implemented — `appStore.ts` uses SolidJS `createStore`
- ✅ 13 components import `useAppState()` directly — no prop drilling
- ✅ `App.tsx` has only 1 local signal (`selectedProfileIds`)

### 2.4 Runtime Validation with Zod ✅
- ✅ Zod v4 installed and used in `validation.ts`
- ✅ 27 route patterns covered (was 8): Transactions, Categories, Accounts, Budgets, Bills, Loans, Goals, Recurring, Tags, Portfolio, Settings, Profiles, Housing, Counterparties
- ✅ `localApiRouter.ts` wired with `validateBody()` on all POST/PUT/PATCH
- ✅ Progressive path-ID stripping for nested routes
- ✅ 22 validation test cases, all passing

---

## Phase 3: Backend & Deep Improvements (High Effort)

### 3.1 Backend Repository Layer
**Files:** New `backend/repositories/` directory

- Extract DB access into repository modules: `profilesRepo.js`, `transactionsRepo.js`, etc.
- Each module exports typed query functions — route handlers import from repos instead of writing raw SQL
- Target: move 80% of the 157 `db.prepare()` calls behind repository interfaces

### 3.2 Backend Service Layer
**Files:** New `backend/services/` directory

- Extract external service wrappers: `yahooFinanceService.js`, `pdfReportService.js`, etc.
- Each service wraps the third-party library behind an interface
- Enables mocking in tests, swapping implementations

### 3.3 Web Workers for Heavy Processing
**Files:** New `src/workers/pdf.worker.ts`

- Move `clientPdfReports.ts` chart rendering into a Web Worker
- Worker receives data, generates chart PNGs offscreen, returns to main thread
- Prevents PDF generation from blocking the UI

---

## Verification Checklist

After each phase, verify:
1. `npm run build` passes
2. `npm run lint` passes
3. `npm run test:unit` (once Phase 1 is done)
4. Manual smoke test on dashboard, budgets, analytics, settings pages
5. Bundle size report: `ls -la dist/assets/` — should decrease after Phase 1.3
