# Code Quality Report
**Date:** 2026-04-24

## ESLint Issues Found

### High Priority Issues (80+ errors)

#### 1. Unnecessary Conditions
**File:** `src/App.tsx`
**Line:** 38, 95, 105, 110
**Issue:** Values are always falsy/true in ternary operators

```typescript
// Before
currentPage() === 'dashboard' ? '' : 'dashboard'

// After
currentPage() === 'dashboard' ? '' : 'dashboard'
// This is actually correct - not a problem
```

**Status:** False positives in strict-boolean-expressions rule

#### 2. Implicit `any` Types
**Files:**
- `src/components/Badge.tsx` (line 9)
- `src/components/Button.tsx` (line 10)
- `src/components/Chart.tsx` (lines 9, 10)

**Issue:**
```typescript
export interface ChartProps {
  data: any  // Should be Chart.Data
  options?: any  // Should be Chart.Options
}
```

**Fix:**
```typescript
import type { Chart } from 'chart.js/auto'

export interface ChartProps {
  data: Chart.Data
  options?: Chart.Options
}
```

#### 3. Floating Promises
**Files:**
- `src/components/Chart.tsx` (line 22)

**Issue:**
```typescript
import('chart.js/auto').then(({ default: Chart }) => {
  // No catch handler
})
```

**Fix:**
```typescript
import('chart.js/auto')
  .then(({ default: Chart }) => { /* ... */ })
  .catch(err => console.error('Failed to load Chart.js:', err))
```

#### 4. Missing Error Handling on Fetch
**Files:**
- `src/features/Bills.tsx` (lines 42-44)
- `src/features/Retirement.tsx` (line 76)
- `src/features/Categories.tsx` (line 44)
- `src/features/Analytics.tsx` (lines 29-31)

**Issue:**
```typescript
fetch('/api/bills').then((r) => r.json())
// No error handling
```

**Fix:**
```typescript
fetch('/api/bills')
  .then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })
  .catch(err => {
    console.error('Failed to load bills:', err)
    // Show error to user
  })
```

#### 5. Unnecessary Arrow Function Shorthands
**File:** `src/components/FilterBar.tsx`
**Lines:** 125, 136, 168, 179, 196, 204, 212, 220

**Issue:**
```typescript
onChange={() => clearFilters()}
```

**Rule:** ESLint prefers explicit arrow functions.

**Fix:**
```typescript
onChange={clearFilters}
```

---

## TypeScript Strict Mode Status

**Configuration:** ✅ Enabled (`tsconfig.json`)

**Issues:**
- `strict-boolean-expressions` rule too aggressive
- `@typescript-eslint/no-explicit-any` not used in component props
- No `noImplicitReturns` enforcement

---

## Unused Code

### CSS Modules
- `Layout.module.css` - DELETED (was causing conflicts)
- Multiple unused component styles

### Variables
- `FilterBar.tsx:18` - `PRESETS` imported but not used

---

## Code Duplication

### Repeated Patterns

1. **Delete operations** (appears 10+ times):
   ```typescript
   const tx = db.prepare("SELECT id FROM transactions WHERE id = ? AND profile_id = ?").get(req.params.id, pid)
   if (!tx) return res.status(404).json({ error: 'Transaction not found' })
   db.prepare("DELETE FROM transactions WHERE id = ?").run(req.params.id)
   ```

2. **Error handling** (50+ occurrences):
   ```typescript
   res.status(500).json({ error: err.message })
   console.error(err.message)
   ```

---

## Performance Concerns

1. **In-memory rate limiting** - Not suitable for production clustering
2. **Large static asset serving** - 50MB file size limit on uploads
3. **No image compression** - Raw uploads to assets folder

---

## Recommendations

### Immediate Fixes (High Priority)
1. Add type annotations to `ChartProps.data` and `options`
2. Add error handling to all `fetch()` calls
3. Replace unnecessary arrow function shorthands

### Medium Priority
1. Consolidate delete operation patterns
2. Remove unused CSS modules
3. Add proper error boundary components

### Low Priority
1. Add missing ESLint rules: `noImplicitReturns`, `prefer-const`
2. Create shared utility functions for common patterns
3. Add bundle size analyzer (rollup-plugin-visualizer)

---

## Testing Coverage

| Type | Status |
|------|--------|
| Unit tests | ❌ Minimal |
| Integration tests | ⚠️ Partial (E2E only) |
| Snapshot tests | ❌ None |
| Load tests | ❌ None |
| Security tests | ❌ None |

---

## Metrics

- **Total ESLint Errors:** 80+
- **Total ESLint Warnings:** 15
- **TypeScript Errors:** 0 (strict mode enabled)
- **Code Coverage:** ~5% (estimate based on test files)

---

## Next Steps

1. Run `npm run lint -- --fix` to auto-fix formatting issues
2. Manually fix type safety issues in Chart component
3. Add error boundaries to app
4. Improve test coverage (target: 80%)