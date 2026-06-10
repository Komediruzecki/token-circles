# Security Audit Report
**Date:** 2026-04-24
**Status:** Critical vulnerabilities identified

## Executive Summary
The finance manager application has multiple security concerns that need immediate attention. While SQL injection is properly mitigated, several vulnerabilities exist around file uploads, session security, and error handling.

---

## Critical Vulnerabilities

### 1. **File Upload - No Content-Type Validation** ⚠️ CRITICAL
**Location:** `/backend/index.js` lines 1915-1940
**Severity:** HIGH

```javascript
app.post("/api/receipts/upload", apiRateLimiter, upload.single('receipt'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" })

  const filename = `${req.file.filename}`
  // No content-type validation - could upload executable files
})
```

**Issue:** No validation of file type/mimetype before saving. Attackers could upload `.exe`, `.sh`, or `.php` files and execute them.

**Recommendation:** Add file type validation:
```javascript
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf']
if (!ALLOWED_TYPES.includes(req.file.mimetype)) {
  return res.status(400).json({ error: "Invalid file type" })
}
```

---

### 2. **Session Secret - Using Development Default** ⚠️ CRITICAL
**Location:** `/backend/index.js` line 164
**Severity:** CRITICAL

```javascript
const SESSION_SECRET = process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex')
```

**Issue:** Falls back to auto-generated secret in production if not set. Predictable session cookies allow session hijacking.

**Recommendation:** Force environment variable:
```javascript
if (!process.env.SESSION_SECRET) {
  return res.status(500).json({ error: "SESSION_SECRET environment variable is required" })
}
```

---

### 3. **Session Cookie - Secure Flag Disabled** ⚠️ HIGH
**Location:** `/backend/index.js` line 179
**Severity:** HIGH

```javascript
secure: false, // Set to true if using HTTPS
```

**Issue:** Session cookies sent over HTTP, vulnerable to man-in-the-middle attacks.

**Recommendation:** Always set to true in production, detect HTTPS:
```javascript
secure: process.env.NODE_ENV === 'production',
```

---

### 4. **Exposing Error Messages** ⚠️ MEDIUM
**Location:** Multiple locations throughout `/backend/index.js`
**Severity:** MEDIUM

```javascript
res.status(500).json({ error: err.message })
```

**Issue:** Error stack traces exposed to clients, revealing internal system information.

**Recommendation:** Log errors server-side, return generic messages:
```javascript
res.status(500).json({ error: "Internal server error" })
console.error(err)
```

---

### 5. **localStorage for Sensitive Data** ⚠️ LOW
**Location:** Multiple files
**Severity:** LOW

**Issue:** Profile IDs stored in localStorage, which can be accessed via:
- Chrome DevTools
- Cross-origin request forgery (if other sites controlled)
- XSS attacks if implemented

**Recommendation:** Use HTTP-only cookies for session management.

---

## SQL Injection - MITIGATED ✅

**Status:** Secure
**Evidence:**
- Backend uses parameterized queries (SQLite prepared statements)
- 42+ instances of `db.prepare("SELECT ... WHERE id = ?")` pattern
- No string concatenation in SQL queries

**Example of safe pattern:**
```javascript
db.prepare("SELECT * FROM profiles WHERE id = ?").get(pid)
```

---

## XSS - MITIGATED ✅

**Status:** Mostly Secure
**Evidence:**
- `escapeHtml` function exists in `/frontend/src/core/api.ts`
- Used in `/frontend/src/core/handlers.ts` for safe rendering

**Vulnerability:** Some areas may use template literals without escaping.

**Recommendation:** Audit all template literal usage, prefer `.textContent` over `.innerHTML`.

---

## Security Middleware Status

| Middleware | Present | Issue |
|------------|---------|-------|
| Helmet.js (CSP headers) | ❌ Missing | No Content-Security-Policy |
| x-rate-limit | ✅ Custom | Rate limiting exists but uses in-memory store |
| Session | ✅ Yes | Missing secure flag detection |
| SSL/TLS | ❌ Not enforced | `secure: false` in cookie config |
| CORS | ✅ Yes | No origin whitelist |

---

## Recommendations (Priority Order)

1. **Immediate:** Add SESSION_SECRET enforcement, implement file type validation
2. **High:** Enable secure flag in session cookies, remove error message exposure
3. **Medium:** Add Helmet.js for CSP headers, CORS origin whitelist
4. **Low:** Migrate to HTTP-only cookies for profile IDs

---

## Testing Recommendations

- [ ] File upload whitelist test (upload executable should fail)
- [ ] Session hijacking test (wrong session cookie)
- [ ] XSS injection test (script tag in description field)
- [ ] CSRF test (POST request from different origin)
- [ ] Rate limiting test (excessive API calls)