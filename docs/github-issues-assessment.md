# GitHub Issues Assessment Report

**Date:** 2026-04-25
**Branch:** main (synced with live site)

## Overview

Total Open Issues: 9
Total Closed Issues: 50+

### Migration Status Summary

The SolidJS migration is **approximately 60-70% complete** with the following areas needing work:

---

## Priority Assessment

### 🔴 Critical (Must Fix Immediately)

| Issue | Title | State | Estimated Complexity | Description |
|-------|-------|-------|---------------------|-------------|
| 153 | Runtime issue on live site | OPEN | Medium | Service worker `import.meta` error, `getCurrentProfileId` undefined, Google fonts loading issue |
| 168 | Fix css | OPEN | High | CSS cleanup, kebab-case naming convention, module CSS usage |

### 🟡 High Priority

| Issue | Title | State | Estimated Complexity | Description |
|-------|-------|-------|---------------------|-------------|
| 161 | Check refactor made by porting all js/css/html | OPEN | High | Comprehensive migration audit required |
| 164 | SolidJS migration | OPEN | High | Missing HTML/CSS port, legacy window.* code cleanup |
| 160 | Actually port all HTML from index.html to SolidJS | OPEN | Medium | Complete HTML migration verification |
| 163 | Next steps | OPEN | Low | Post-migration cleanup (build.mjs, service worker refactor) |

### 🟢 Medium Priority

| Issue | Title | State | Estimated Complexity | Description |
|-------|-------|-------|---------------------|-------------|
| 159 | Install solid-dev-tools and configure it | OPEN | Low | Developer tooling setup |
| 158 | Is inser-bills-api.js correct, syntax? | OPEN | Low | Syntax validation |
| 155 | Advice Section Feature | OPEN | High | New feature (not migration-related) |

---

## Detailed Issue Analysis

### Issue 153: Runtime issue on live site

**Symptoms:**
- `Uncaught SyntaxError: Cannot use 'import.meta' outside a module` in sw.js
- `getCurrentProfileId is not defined` in localStorageAdapter.ts
- Google fonts not loading in Firefox

**Root Cause Analysis:**
1. Service worker file (`sw.js`) likely not properly marked as module or served with correct MIME type
2. `getCurrentProfileId` reference in localStorageAdapter.ts is broken - function doesn't exist
3. Google fonts configuration issue in Firefox

**Fix Plan:**
1. Update `sw.js` to be a proper module: `export const ...` instead of top-level code
2. Check `localStorageAdapter.ts` for missing function definition
3. Review Google fonts configuration (possibly font name or Firefox-specific CSS)

**Estimated Effort:** 2-3 hours

---

### Issue 168: Fix css

**Symptoms:**
- Too much CSS everywhere with duplicates
- CSS uses camelCase instead of kebab-case (`.pageName` vs `.page-name`)
- TypeScript/SolidJS imports use `styles.pageName` but CSS has `pageName`
- Missing CSS module usage in Analytics.tsx, Bills.tsx, Accounts.tsx

**Root Cause Analysis:**
- CSS modules were created but old global selectors remain in TSX files
- Some CSS classes weren't converted to dash-separated naming
- Inconsistent CSS usage across files

**Fix Plan:**
1. Create `docs/css-audit-report.md` with comprehensive file-by-file CSS class inventory
2. For each CSS module: rename classes to kebab-case, update all references in TSX files
3. Remove any duplicate or unused CSS
4. Verify `styles.module.css` files are correctly imported and used

**Files Requiring CSS Audit:**
- Analytics.module.css
- Bills.module.css
- Accounts.module.css
- Settings.module.css
- Dashboard.module.css
- All other *.module.css files

**Estimated Effort:** 8-12 hours

---

### Issue 161: Check refactor made by porting all js/css/html

**This is a comprehensive audit task.** The issue provides a detailed checklist:

1. **Project Structure & Tooling Audit**
   - ✅ Build system: Vite confirmed
   - ✅ SolidJS setup: Confirmed
   - ✅ TypeScript: Enabled
   - ⚠️ ESLint + Prettier: Configured
   - ✅ Scripts: dev, build, lint, format, test all exist

2. **Lint / Format / Type Check Execution**
   - Need to run: ESLint, Prettier, TypeScript
   - Flag errors, warnings, inconsistencies

3. **SolidJS Migration Quality Check**
   - Need to detect anti-patterns (direct DOM manipulation, manual event listeners, etc.)
   - Verify correct Solid usage (createSignal, createEffect, createMemo, JSX)

4. **Reactivity & State Integrity**
   - Check for missing signals, overuse of signals, incorrect destructuring
   - Verify derived values use createMemo

5. **CSS & Styling Migration**
   - Check CSS modules usage
   - Verify naming conventions
   - Identify unused styles

6. **Componentization Audit**
   - Identify monolithic files needing componentization
   - Detect duplicated UI logic

7. **Testing Coverage**
   - Check if tests are present and passing
   - Flag missing tests for critical UI logic

8. **Performance & UX Risks**
   - Detect unnecessary re-renders
   - Identify inefficient computations

9. **Migration Completeness Report**
   - Classify files: ✅ Fully migrated, ⚠️ Partially migrated, ❌ Not migrated

**Fix Plan:**
1. Run all lint/format/type checks
2. Audit each TSX file for SolidJS anti-patterns
3. Create migration completeness report (`docs/migration-audit-report.md`)
4. Flag critical issues requiring immediate fixes

**Estimated Effort:** 6-8 hours

---

### Issue 164: SolidJS migration

**Symptoms:**
- Missing components HTML and CSS from index-old.html or index.html.ref
- `window.handlers` and `window.*` global variables should be refactored to proper TypeScript files
- Inconsistent with migration guidelines in issue #161

**Root Cause Analysis:**
- Partial migration - some HTML/CSS ported, some remains in legacy files
- Window globals still exist (legacy pattern)

**Fix Plan:**
1. Use commit 4c767b822458eaeddb80eb48841d5fdbf6438a0c as reference
2. Clone and compare with feat/fix-app-state branch
3. Identify missing HTML/CSS for each page
4. Identify `window.handlers` and other window globals that need refactoring
5. Port missing features to SolidJS components
6. Move window globals to proper TypeScript modules

**Estimate files needing review:**
- `window.handlers` - needs to be extracted
- `inser-bills-api.js` - needs syntax validation (issue #158)
- All HTML pages not yet migrated to TSX

**Estimated Effort:** 10-15 hours

---

### Issue 160: Actually port all HTML from index.html to SolidJS application

**Symptoms:**
- Some HTML not fully ported from legacy index.html to SolidJS components

**Root Cause Analysis:**
- Incomplete HTML-to-SolidJS conversion
- Some sections still use legacy HTML instead of JSX components

**Fix Plan:**
1. Compare index.html with new SolidJS app
2. Identify unmigrated HTML sections
3. Port to SolidJS components with CSS modules
4. Verify all functionality matches legacy app

**Estimated Effort:** 4-6 hours

---

### Issue 163: Next steps

**Completed items:**
- ✅ Remove legacy build.mjs - DONE in commit e775dcd (merged)
- ✅ Accounts E2E tests passing (26/26) - DONE in current PR

**Remaining items:**
- Refactor service worker for PWA to use normal vite build assets
- Verify PWA works on live site with Playwright tests
- Check migration issues not yet addressed

**Fix Plan:**
1. Update service worker to use Vite's `import.meta.glob` for assets
2. Run full Playwright test suite on deployment
3. Document remaining migration issues

**Estimated Effort:** 3-4 hours

---

### Issue 159: Install solid-dev-tools and configure it

**Simple fix:**
1. Install: `npm install -D @solidjs/start-devtools`
2. Configure in vite.config.ts
3. Verify devtools work

**Estimated Effort:** 30 minutes

---

### Issue 158: Is inser-bills-api.js correct, syntax?

**Simple validation:**
1. Check `inser-bills-api.js` syntax
2. Fix any errors
3. Verify functionality

**Estimated Effort:** 30 minutes

---

### Issue 155: Advice Section Feature

**New feature request (not migration-related):**
- AI-generated financial advice section
- Budget compliance tracking
- Goal progress monitoring
- Anomaly detection
- Expense analysis
- Investment recommendations

**Estimation:** Requires backend API changes + new frontend pages
**Priority:** Low (new feature, not migration work)

**Estimated Effort:** 15-20 hours

---

## Recommended Execution Order

### Phase 1: Critical Fixes (2-3 hours)

1. **Issue 153** - Runtime issues
   - Fix service worker `import.meta` error
   - Fix `getCurrentProfileId` undefined
   - Fix Google fonts loading in Firefox

2. **Issue 159** - solid-dev-tools setup
   - Install and configure

### Phase 2: High Priority (16-25 hours)

3. **Issue 158** - Syntax validation
   - Fix `inser-bills-api.js`

4. **Issue 163** - Service worker refactor
   - Update to use Vite's asset handling
   - Test PWA on live site

5. **Issue 160** - Complete HTML port
   - Port remaining HTML sections to SolidJS

6. **Issue 164** - Legacy code cleanup
   - Extract window globals to proper modules
   - Port missing CSS/HTML

### Phase 3: Medium Priority (14-20 hours)

7. **Issue 161** - Comprehensive migration audit
   - Run all checks
   - Create audit report
   - Document findings

8. **Issue 168** - CSS cleanup
   - Create CSS audit report
   - Fix naming conventions
   - Remove duplicates

### Phase 4: Future Work (15-20 hours)

9. **Issue 155** - Advice Section Feature
   - Implement new feature
   - Requires backend API

---

## Current State Assessment

### ✅ What's Working

- Vite build system configured
- SolidJS + TypeScript migration working
- Accounts page: 26/26 E2E tests passing
- Basic routing working
- CSS modules being used

### ⚠️ What Needs Work

- CSS naming conventions inconsistent
- Legacy window globals still exist
- Some HTML not fully ported
- Service worker needs Vite integration
- Runtime errors on live site
- Missing some CSS module usage in key files

### ❌ Critical Risks

- Runtime errors blocking production
- CSS issues causing visual inconsistencies
- Migration completeness unknown without audit

---

## Next Actions

1. **Immediate:** Fix Issue 153 (runtime issues)
2. **Short-term:** Complete Issues 158, 159, 160, 163
3. **Medium-term:** Conduct Issue 161 audit, then fix Issue 168
4. **Long-term:** Address Issue 164 (legacy cleanup)
5. **Future:** Implement Issue 155 (Advice Section)

---

*Report generated from GitHub issue data via `gh` CLI on 2026-04-25*