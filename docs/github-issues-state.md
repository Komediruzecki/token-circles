---
name: github-issues
description: GitHub issues and assessment - track issues to fix, their state, and current progress
type: project
---

# GitHub Issues Status

## Issues to Track

### 🔴 Critical Issues

1. **Issue 153 - Runtime issue on live site** (IN PROGRESS)
   - Service worker `import.meta` error in sw.js (UNKNOWN - appears to be from older build)
   - `getCurrentProfileId is not defined` in localStorageAdapter.ts (REVIEWED - method exists, may be from older build)
   - Google fonts loading issue in Firefox (FIXED - added proper `<link>` tag to index.html)
   - **Status:** Google fonts fixed, other issues reviewed but may be environment-specific
   - **Plan:** Deploy and verify fonts fix, investigate if other errors persist

### 🟡 High Priority Issues

2. **Issue 168 - Fix css** (OPEN)
   - CSS cleanup, kebab-case naming convention
   - Module CSS usage verification
   - **Status:** NOT STARTED
   - **Plan:** Create CSS audit report, fix naming, remove duplicates

3. **Issue 161 - Check refactor made by porting all js/css/html** (OPEN)
   - Comprehensive migration audit
   - SolidJS anti-pattern detection
   - **Status:** NOT STARTED
   - **Plan:** Run ESLint/Prettier/TypeScript, create audit report

4. **Issue 164 - SolidJS migration** (OPEN)
   - Missing HTML/CSS port
   - Legacy window.* code cleanup
   - **Status:** NOT STARTED
   - **Plan:** Extract window globals, port missing features

5. **Issue 160 - Actually port all HTML from index.html** (OPEN)
   - Complete HTML migration verification
   - **Status:** NOT STARTED
   - **Plan:** Compare index.html with SolidJS app, port missing sections

6. **Issue 163 - Next steps** (OPEN)
   - PWA service worker refactor
   - Verify on live site
   - **Status:** PARTIALLY COMPLETE
   - **Plan:** Update service worker, test on deployment

### 🟢 Medium Priority Issues

7. **Issue 159 - Install solid-dev-tools** (OPEN)
   - Developer tooling setup
   - **Status:** NOT STARTED
   - **Plan:** Install and configure

8. **Issue 158 - inser-bills-api.js syntax** (OPEN)
   - Syntax validation
   - **Status:** NOT STARTED
   - **Plan:** Validate and fix

9. **Issue 155 - Advice Section Feature** (OPEN)
   - New feature (not migration)
   - **Status:** NOT STARTED
   - **Plan:** Implement backend + frontend

## Current Completed Work

- **Issue 163 (partial):** Accounts E2E tests now passing (26/26 tests)
- **Issue 163 (partial):** Removed legacy build.mjs
- **Branch created:** `fix/accounts-e2e-tests` (pushed to origin)

## Migration Progress

- **Estimated completion:** 60-70%
- **Files fully migrated:** Unknown until Issue 161 audit
- **Critical blockers:** Runtime errors (Issue 153)
- **CSS issues:** Naming conventions, module usage (Issue 168)

**Why:** The migration is progressing well but lacks comprehensive auditing. CSS and runtime issues are blocking full production deployment.