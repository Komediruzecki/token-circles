# Bug Fixes Documentation

## Critical Fixes

### 2026-04-19: Module Script MIME Type Error

**Issue**: Browser error - "Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of 'text/html'"

**Symptoms**:
- Module script loads as HTML instead of JavaScript
- `Cannot read properties of undefined (reading 'includes')` errors in console
- App fails to initialize properly

**Root Cause**:
The Express backend catch-all route (`app.get("*", ...)`) was serving `frontend/index.html` for ALL paths, including `/frontend/dist/assets/index.js`. This caused the browser to receive HTML content for a JavaScript module, violating HTML spec requirements for strict MIME type checking.

**Environment**:
- Apache2 reverse proxy serves frontend files
- Express backend (port 3847) handles `/api/*` routes
- Apache DocumentRoot: `/var/www/finance-manager.clodhost.com/frontend`
- Vite build outputs to `frontend/dist/`

**Solution**:
Modified `/backend/index.js` catch-all route to return 404 for static file paths that should be served by Apache:

```javascript
// Before - serves index.html for ALL paths
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

// After - serves 404 for static paths, index.html for SPA routes
app.get("*", (req, res) => {
  if (req.path.startsWith('/frontend/dist/') || req.path.startsWith('/frontend/css/')) {
    return res.status(404).send('File not found');
  }
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});
```

**Why Apache handles `/dist/` correctly**:
Apache's DocumentRoot is set to `/var/www/finance-manager.clodhost.com/frontend`, so requests like `/dist/assets/index.js` resolve to `/var/www/finance-manager.clodhost.com/frontend/dist/assets/index.js`. The catch-all route should NOT intercept these paths.

**Verification**:
```bash
# Check MIME type from backend
curl -I http://127.0.0.1:3847/frontend/dist/assets/index.js
# Expected: Content-Type: text/javascript

# Check MIME type from HTTPS
curl -I https://finance-manager.clodhost.com/dist/assets/index.js
# Expected: content-type: text/javascript
```

**Files Modified**:
- `/backend/index.js` (line ~5803)

---

### 2026-04-19: LocalStorage Adapter - getCurrentProfileId ReferenceError

**Issue**: Runtime errors during app initialization:
```
Uncaught TypeError: Cannot read properties of undefined (reading 'includes')
    at u (content.js:1:11429)
localStorageAdapter.ts:113 Failed to load data from localStorage: ReferenceError: getCurrentProfileId is not defined
localStorageAdapter.ts:727 Uncaught ReferenceError: getCurrentProfileId is not defined
```

**Root Cause**:
Circular dependency in `localStorageAdapter.ts`:
1. `loadData()` (module-level, sync) called `getCurrentProfileId()` without await/this
2. `createProfileData()` (module-level, sync) called `getCurrentProfileId()` without await/this
3. `createDefaultProfile()` (module-level, async) called `await getCurrentProfileId()` but this wasn't bound to the class
4. Class method `getCurrentProfileId()` called `createProfileData()` which tried to call back to `getCurrentProfileId()`

This created a ReferenceError when `localStorageAdapter.ts` was imported/executed before the class methods were available.

**Solution**:
1. Created `createProfileInternal()` helper function that creates a profile without checking current ID
2. Made `createProfileData()` synchronous (removed `await this.getCurrentProfileId()`)
3. Made `createDefaultProfile()` synchronous
4. Made `loadData()` synchronous (it's module-level)

Updated code:
```typescript
// New helper - creates profile without circular reference
function createProfileInternal(name: string): number {
  const id = profileCounter++;
  const profile: ProfileData = {
    id,
    name,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  data.profiles[id] = profile;
  saveData();
  createDefaultCategories(id);
  return id;
}

// Class method uses internal helper
async getCurrentProfileId(): Promise<number> {
  let idStr = localStorage.getItem(PROFILE_ID_KEY);
  let id = idStr ? parseInt(idStr, 10) : 1;
  if (!getProfile(id)) {
    const profiles = getProfiles();
    if (profiles.length > 0) {
      id = profiles[0].id;
    } else {
      id = createProfileInternal('Main Profile'); // No circular call
    }
    localStorage.setItem(PROFILE_ID_KEY, id.toString());
  }
  return id;
}
```

**Files Modified**:
- `/frontend/src/core/storage/localStorageAdapter.ts`

---

## Server Configuration Archive

**Server configuration files have been archived at**: `/root/finance-manager-server-configs.tar.gz`

**Archive contents**:
- `backend/` - Full backend code
- `.git/` - Git repository (excludes db/, assets/, node_modules/, dist/, .env)
- `docs/` - Documentation
- `README.md` - Project README

**For local setup**:
1. Extract: `tar -xzf finance-manager-server-configs.tar.gz`
2. Setup frontend: `cd frontend && npm install && npm run build`
3. Start backend: `node backend/index.js`

**Note**: The `.gitignore` has been updated to exclude build artifacts and sensitive data.

---

## Deployment Checklist

After fixing issues:

1. ✅ Fix backend catch-all route to not intercept static paths
2. ✅ Fix LocalStorageAdapter circular dependency
3. ✅ Rebuild frontend: `npm run build`
4. ✅ Restart backend server
5. ✅ Verify HTTPS loads correctly
6. ✅ Test module script MIME type
