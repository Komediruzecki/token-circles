# Plan: Eliminate Page-Reload UX on Mutations & Navigation

Status: **Phase 1 + 2 implemented** (2026-07-13)

## Problem

Users perceive "page reloads" in two scenarios:

1. **After a mutation** (add transaction, allocate budget, etc.): the entire content area vanishes, a spinner appears, then content reappears. This is `setLoading(true)` → full re-render with spinner → refetch → `setLoading(false)`.

2. **When navigating between pages**: clicking a sidebar item destroys the old page component and creates a new one from scratch. All data is re-fetched, spinner shows, then content appears.

## Root Causes

| #   | Cause                                                                                             | Location                                           | Impact                                     |
| --- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------ |
| 1   | `<Show when={activePage() === name}>` unmounts pages on navigation                                | `App.tsx:987-1009`                                 | Every nav = full page recreation + refetch |
| 2   | `setLoading(true)` before every data fetch replaces content with spinner                          | 17 features (Transactions, Dashboard, Goals, etc.) | Every mutation = content disappears        |
| 3   | No distinction between "initial load" (needs spinner) and "background refresh" (should be silent) | All feature `refresh*` functions                   | Same spinner for both cases                |
| 4   | `bumpProfileVersion()` triggers all mounted features to refetch on any mutation                   | `App.tsx:1041,1071`                                | One mutation = cascade of refetches        |

## Plan

### Phase 1: Eliminate mutation-triggered loading spinners (HIGH IMPACT, LOW RISK)

**Pattern change — every feature's refresh function:**

Current (destructive):

```tsx
const refreshData = async () => {
  setLoading(true); // ← removes all content
  const data = await api.getX();
  setData(data);
  setLoading(false); // ← content reappears
};
```

Target (background refresh):

```tsx
const [initialLoad, setInitialLoad] = createSignal(true);

const refreshData = async () => {
  try {
    const data = await api.getX();
    setData(data);
  } catch {
    /* toast */
  } finally {
    setInitialLoad(false);
  }
};

// Render: only show spinner on first ever load
{
  initialLoad() && !data() ? <Spinner /> : <Content />;
}
```

**Features to convert (priority order):**

1. Transactions.tsx — most-used, most noticeable
2. Dashboard.tsx — landing page, highly visible
3. Goals.tsx
4. Accounts.tsx
5. Portfolio.tsx
6. Loans.tsx
7. Bills.tsx + BillCalendar.tsx
8. Housing.tsx
9. Retirement.tsx
10. Counterparties.tsx
11. Import.tsx (already has partial pattern)

**Features already using createResource (skip or minimal change):**

- Budgets.tsx — `createResource` keeps old data during refetch; only needs `initialLoad` guard
- Analytics.tsx — same pattern
- Categories.tsx — same pattern

### Phase 2: Keep-alive page mounting (MEDIUM IMPACT, MEDIUM RISK)

Replace `<Show>` with CSS visibility:

```tsx
// Current — destroys page on nav away
<Show when={activePage() === name && !_isLoading()}>
  <Dynamic component={page} />
</Show>

// Target — hides page, preserves state
<div style={{ display: activePage() === name ? 'block' : 'none' }}>
  <Dynamic component={page} />
</div>
```

**Considerations:**

- All 18 pages stay mounted; memory impact is low (SolidJS DOM is lightweight, data signals are just references)
- Each page fetches on first mount only; re-visit = instant
- Need to handle `_isLoading()` differently — only show during initial app boot, not per-page
- The `lazy()` imports still work — pages load on first access, then stay in memory

### Phase 3: Optimistic local state updates (LOWER PRIORITY)

After Phase 1 & 2, the remaining "lag" is waiting for the API response. Optimistic updates would make mutations feel instant:

```tsx
const handleCreate = async (payload) => {
  const optimistic = { id: -Date.now(), ...payload }; // temp ID
  setData((prev) => [...prev, optimistic]); // instant UI
  const created = await api.create(payload);
  setData((prev) => prev.map((x) => (x.id === optimistic.id ? created : x))); // reconcile
};
```

## Scope & Sequencing

| Phase | Description                                | Files            | Risk   | Effort |
| ----- | ------------------------------------------ | ---------------- | ------ | ------ |
| 1a    | Transactions background refresh            | 1 file           | Low    | 30 min |
| 1b    | Dashboard background refresh               | 1 file           | Low    | 20 min |
| 1c    | Remaining features (Goals, Accounts, etc.) | 8 files          | Low    | 45 min |
| 2     | Keep-alive page mounting                   | 1 file (App.tsx) | Medium | 30 min |
| 3     | Optimistic updates (optional)              | TBD              | Medium | TBD    |

**Total Phase 1+2: ~2 hours, 12 files changed.**

## Verification

After each phase:

1. `cd frontend && npm run lint && npx tsc --noEmit` — must pass
2. Manual test: add a transaction → content should NOT disappear
3. Manual test: navigate Transactions → Budgets → back → data should be instant, no spinner
4. `npm run build` — must produce valid build
