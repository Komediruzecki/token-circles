# Plan: Mobile Layout Fixes + Feature Parity Gaps

## Context

The old JS app (`origin/special/old-js-app-fixed`) was fully ported to SolidJS, but three categories of issues remain:

1. **Mobile is broken** — no hamburger, sidebar scrolls both directions, main content scrolls horizontally, missing small-phone breakpoints
2. **Feature parity gaps** — Savings Rate dashboard card is a static placeholder, chart export is buggy/missing, D3 heatmap has no export
3. **HTML export templates** — Old app had `export.html` and `export-monthly.html` (Chart.js-based standalone report pages); need to verify if new app handles these

## Phase 1: Mobile Responsive Layout Fixes

### 1A: Restore Mobile Sidebar Behavior (matching old app)
**File**: `src/components/Layout.module.css`

The old app uses a proper mobile pattern:
- Sidebar collapses to `transform: translateX(-100%)` (off-screen), not `left: -240px`
- A `.mobile-overlay` appears with `rgba(0,0,0,0.5)` background, clicking it closes sidebar
- A `.hamburger-btn` inside the sidebar header toggles it open/closed
- At ≤768px, the sidebar is fully hidden by default (not 60px icon-only)

**Current new app** has an icon-only 60px sidebar at ≤768px with a `.mobile-toggle` button — this causes horizontal scroll and no way to read nav labels. The old app hides the sidebar entirely and shows a hamburger.

**Fixes needed:**
- Add `overflow-x: hidden` to body/html and `.main` content area
- Replace icon-only 60px sidebar with fully hidden sidebar + hamburger toggle (matching old app's `.sidebar.collapsed` pattern using `transform: translateX(-100%)`)
- Move hamburger button to top-left corner (fixed position, high z-index)
- Add proper mobile overlay with click-to-close
- Keep sidebar nav labels visible when sidebar is expanded on mobile (labels, not icon-only)
- Add mobile header area inside sidebar with hamburger for closing

### 1B: Add Small Phone Breakpoint (≤380px)
**File**: `src/components/Layout.module.css`

Old app has `@media (max-width: 380px)` with:
```css
.main { padding: 12px 8px; }
.stat-card { padding: 14px; }
.stat-card-value { font-size: 20px; }
.page-header h2 { font-size: 20px; }
.btn { padding: 6px 12px; font-size: 13px; }
```

Add equivalent breakpoint to new CSS.

### 1C: Add Component-Specific Mobile Overrides
**Files**: Various CSS module files

Old app mobile overrides to port:
- `.page-header` flex-direction column at mobile
- `.page-header-actions` full-width at mobile
- `.month-nav` flex-wrap at mobile
- `.form-row` single column at mobile
- `.table-wrap` smaller font at mobile (12px)
- `.modal` full-width at mobile
- `.toast-container` repositioned at mobile (bottom: 80px, inset left/right)
- Retirement layout single column
- Sankey chart height reduction
- Goals grid single column
- Compound interest layout single column

### 1D: Fix Sidebar Scroll Issues
**File**: `src/components/Layout.module.css`

- Sidebar should only scroll vertically (`overflow-y: auto`, `overflow-x: hidden`)
- Main content should not scroll horizontally (`overflow-x: hidden`)
- Add `-webkit-overflow-scrolling: touch` for smooth iOS scroll

## Phase 2: Feature Parity Fixes

### 2A: Wire SavingsRateCard with Real Data
**File**: `src/components/Dashboard/SavingsRateCard.tsx`

Currently a static placeholder showing `EUR 0.00`. Fix:
- Pass `savingsRate` and `monthlySavings` as props from Dashboard.tsx
- Calculate savings rate from dashboard data (income - expense) / income
- Show percentage with color coding (≥20% green, ≥10% yellow, <10% red)
- Add configurable goal input + Set Goal button (matching old app pattern)
- Store goal in localStorage per profile

### 2B: Fix Chart Export on Dashboard
**File**: `src/components/ChartWrapper.tsx`

Chart export button exists but `chart={undefined}` is passed (line 134 of ChartWrapper). The chart reference is stored in a signal but never handed to ExportChartButton. Fix:
- Store the chart instance ref and pass it to `<ExportChartButton chart={chartRef()} />`

### 2C: Add Chart Export to Analytics Page
**File**: `src/features/Analytics.tsx`

Analytics has 6 chart tabs (category, stacked, monthly, savings, sankey, heatmap) but zero export buttons. Fix:
- Add ExportChartButton to each chart tab that uses Chart.js (category, stacked, monthly, savings)
- Wrap each chart canvas with ChartWrapper or add ExportChartButton inline
- For D3-based charts (sankey, heatmap): add PNG export via canvas snapshot

### 2D: Add D3 Heatmap Export
**File**: `src/components/D3HeatmapChart.tsx`

D3 renders to SVG which needs special export handling. Fix:
- Add export button that serializes the SVG to a blob and downloads as PNG/SVG
- Use existing `chartExport.ts` utilities or add SVG-to-canvas conversion

## Phase 3: Verify HTML Export Templates

### 3A: Check if export.html / export-monthly.html are still served
- Old app had two static HTML files: `frontend/export.html` (Annual Report) and `frontend/export-monthly.html` (Monthly Report)
- These use Chart.js CDN to render rich financial reports client-side
- Check if these exist in the new app's dist or static files
- If missing, port them into the new build output (copy to `frontend/` and ensure Vite includes them in dist)
- Wire links in Settings page to open these templates

## Phase 4: PDF Export Fixes + Retirement Layout

### 4A: Fix PDF Multi-Profile Selection (Issue #225)

**Root Cause**: `downloadReport()` in `src/features/Settings.tsx:58-75` calls `apiFetch(endpoint, {credentials: 'include'})` without any profile headers. The backend's `getProfileIds(req)` reads `X-Profile-Ids` header but gets nothing, so PDFs always use the single fallback profile (ID 1), ignoring the user's household/profile selection.

**Fix**:
- In `downloadReport()`, read `selectedProfileIds` from localStorage (`JSON.parse(localStorage.getItem('selectedProfileIds') || '[]')`)
- Read `currentProfileId` from localStorage
- Build headers object: `X-Profile-Id` always, plus `X-Profile-Ids` (JSON array) when `selectedProfileIds.length > 1`
- Pass headers to `apiFetch(endpoint, {credentials: 'include', headers: {...}})`
- Also add `profile_id` query param to the URL as a fallback for the backend

### 4B: Investigate & Fix PDF Chart Rendering (Issue #224)

**Investigation results**:
- Chromium IS installed via Puppeteer cache (`/root/.cache/puppeteer/chrome/linux-147.0.7727.56`)
- Puppeteer CAN launch browser and navigate successfully (verified with test script)
- Export templates exist in dist: `export.html`, `export-monthly.html`, `chart.umd.min.js`
- The "not available" message may come from `localHandlers.ts:2656` (serverless mode returns 501)
- The "could not be rendered" message comes from backend `index.js:8111` (Puppeteer catch block fallback)

**Fix**:
- Start the backend server and run an end-to-end test of the PDF endpoint using curl
- Check server logs for specific Puppeteer errors
- If the error is about missing shared libraries in production, install them (e.g., `libnss3`, `libnspr4`, `libatk-1.0-0`, etc.)
- If it's a `waitForFunction` timeout, check the export template rendering at the URL Puppeteer uses
- Add better error logging in the backend catch block (currently just `console.error('Puppeteer render failed:', puppeteerErr.message)`)

### 4C: Fix Retirement Page Layout (Issue #226)

**Investigation results**: No `max-width` constraint found on Retirement page or its parent containers. CSS grids use `repeat(auto-fit, minmax(200px, 1fr))` which should fill available space. The page already uses `flex: 1` via the Layout `.main` container.

**Fix**:
- Add `display: block` to `.retirement-page` class (matching HousingPage pattern at `HousingPage.module.css:510`)
- Ensure the projection chart uses `width: 100%` (already does, verify)
- If user reports specific elements feeling squished, adjust individual component widths

## Verification

1. `npm run build` — must pass with zero errors
2. `npm run lint` — must pass clean
3. Manual mobile testing:
   - Resize browser to 375px (iPhone SE), 390px (iPhone 14), 768px (iPad)
   - Verify hamburger shows, sidebar opens/closes cleanly, no horizontal scroll
   - Verify main content scrolls vertically only
   - Verify all pages render correctly at mobile widths
4. Feature testing:
   - Dashboard: Savings Rate card shows real data + goal input works
   - Dashboard: Chart export downloads valid PNG/SVG
   - Analytics: Chart export button exists on each tab
   - Heatmap: Export works
5. PDF testing:
   - Select multiple profiles in Settings → download PDF → verify PDF includes data from all selected profiles
   - Download annual PDF → verify charts render (not fallback text)
   - Download monthly PDF → verify charts render
6. Retirement page: verify layout fills available width (no squished appearance)
7. `git commit` + push to `fix/migration-full-plan`
