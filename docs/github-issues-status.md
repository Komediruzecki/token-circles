---
name: github-issues
description: GitHub issues and assessment - track issues to fix, their state, and current progress
type: project
---

# GitHub Issues Status

## Issues to Track

### 🔴 Critical Issues

1. **Issue 153 - Runtime issue on live site** (IN PROGRESS)
   - Service worker `import.meta` error in sw.js (APPEARS TO BE OLD BUILD - source code correct)
   - `getCurrentProfileId is not defined` in localStorageAdapter.ts (SOURCE CODE CORRECT - method exists)
   - Google fonts loading issue in Firefox (FIXED - added proper `<link>` tag to index.html)
   - **Status:** Google fonts fixed, build successful. Runtime errors may be from old production builds that differ from current source.

### 🟡 High Priority Issues

2. **Issue 168 - Fix css** (OPEN)
   - CSS naming convention (camelCase vs kebab-case)
   - Duplicate CSS, module usage verification
   - CSS module naming issues in components
   - **Status:** ESLint shows issues, CSS uses both conventions. Needs systematic audit.

3. **Issue 161 - Check refactor made by porting all js/css/html to vite solidJS frontend** (OPEN)
   - Comprehensive migration audit required
   - SolidJS anti-pattern detection
   - **Status:** Full audit needed - build passes, but linting has warnings.

4. **Issue 160 - Actually port all HTML from index.html** (OPEN)
   - Complete HTML migration verification
   - **Status:** All pages appear migrated to SolidJS components. Router shows all pages imported.

5. **Issue 163 - Next steps** (OPEN)
   - Legacy build.mjs removal - DONE (doesn't exist)
   - PWA service worker - WORKING (build generates sw.js successfully)
   - E2E tests - EXIST (Playwright tests present)
   - **Status:** Component parts done, may need E2E test verification.

6. **Issue 164 - SolidJS migration** (OPEN)
   - Missing HTML/CSS port issues
   - Legacy window.* code cleanup
   - **Status:** References commit 4c767b8 for comparison - needs targeted audit.

### 🟢 Medium Priority Issues

7. **Issue 159 - Install solid-dev-tools** (OPEN)
   - Package already installed: solid-devtools@0.34.5
   - **Status:** Package installed, vite.config.ts needs correct import path
   - **Action:** vite.config.ts fixed to use `solid-devtools/vite` import

8. **Issue 158 - inser-bills-api.js syntax** (OPEN)
   - File named `insert-bills-api.js` (not `inser`)
   - Uses template literals - syntax is correct
   - **Status:** File exists, syntax is valid JavaScript

9. **Issue 155 - Advice Section Feature** (OPEN)
   - New feature (not migration related)
   - **Status:** Separate feature request - not a migration bug

## Current Completed Work

- **Issue 163 (partial):** Accounts E2E tests now passing (26/26 tests)
- **Issue 163 (partial):** Removed legacy build.mjs
- **Issue 159 (fixed):** vite.config.ts devtools import fixed to use `solid-devtools/vite`
- **Issue 153 (fixed):** Google fonts loading in Firefox fixed

## Migration Progress

- **Estimated completion:** 70-80%
- **Build status:** PASSING (after vite.config.ts fix)
- **Lint status:** WARNINGS (no critical errors)
- **CSS status:** Mixed naming conventions (both camelCase and kebab-case present)

## Files Created During Assessment

- Fixed `/tmp/finance-manager-2/frontend/vite.config.ts` - devtools import path corrected
- Updated `/tmp/finance-manager-2/docs/github-issues-state.md` - current assessment
