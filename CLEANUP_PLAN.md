# Cleanup Plan - Remove Legacy Build Artifacts

## Overview
Remove obsolete legacy files after successful SolidJS migration completion on `feat/fix-app-state` branch.

## Status Check (feat/fix-app-state)

### Files to DELETE
| File | Reason |
|------|--------|
| `frontend/build.mjs` | Obsoleted by Vite build. Old script manually ran `vite build` and generated HTML. Now `package.json` scripts use Vite directly. |
| `frontend/src/styles/legacy.css` | Fallback CSS for E2E test compatibility. All tests pass, no longer needed. |
| `frontend/index.html.ref` | Old HTML reference file, no longer used. |

### Files to UPDATE (remove build.mjs references)
| File | Lines to Modify |
|------|-----------------|
| `docs/cl_workflow.md` | Lines 95, 144, 173 |
| `public/cl_workflow.md` | Lines 95, 144, 173 |

### Documentation Updates Needed
Current references:
- "Frontend: SolidJS SPA (src/, dist/, build.mjs)"
- "Build Command: cd frontend && node build.mjs"

Should become:
- "Frontend: SolidJS SPA (src/, dist/)"
- "Build Command: cd frontend && npm run build"

## Implementation Steps

### Step 1: Verify Current State
```bash
# Check that Vite builds work
cd frontend && npm run build

# Verify E2E tests pass
npm test

# Verify package.json scripts
cat frontend/package.json | grep -A5 '"scripts"'
```

### Step 2: Remove Files
```bash
rm frontend/build.mjs
rm frontend/src/styles/legacy.css
rm frontend/index.html.ref
```

### Step 3: Update Documentation
```bash
# Edit docs/cl_workflow.md
# Lines 95, 144, 173: Remove "build.mjs" references

# Edit public/cl_workflow.md
# Lines 95, 144, 173: Remove "build.mjs" references
```

### Step 4: Verify and Test
```bash
# Build fresh
cd frontend && npm run build

# Check generated dist files
ls -la frontend/dist/

# Run tests
npm test

# Run E2E tests (optional but recommended)
cd frontend && npm run test:e2e
```

### Step 5: Commit and Push
```bash
git add -A
git commit -m "chore: remove legacy build.mjs and legacy.css files"
git push origin feat/cleanup
```

## Expected Changes Summary

**Removed (3 files):**
- `frontend/build.mjs` (~431 lines)
- `frontend/src/styles/legacy.css` (~664 lines)
- `frontend/index.html.ref` (~370 lines)

**Updated (2 files):**
- `docs/cl_workflow.md` - remove build.mjs references
- `public/cl_workflow.md` - remove build.mjs references

**Net change:** ~1,465 lines removed

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Documentation not updated | Low | Medium | Manual review of both docs files before commit |
| Tests fail | Very Low | Low | Run full test suite before pushing |
| Someone still using build.mjs | Low | Low | All references removed from docs |

## Success Criteria

✅ All build commands work: `npm run build`
✅ All tests pass: `npm test`
✅ E2E tests pass
✅ Generated `frontend/dist/` contains valid Vite build output
✅ Documentation updated
✅ No references to removed files remain