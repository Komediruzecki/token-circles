# Finance Manager - TODO List

## Critical Issues
1. [x] Fix Budgets.tsx runtime error with allocations().map() - FIXED
2. [x] Investigate Settings.tsx duplicate .page-settings elements - FIXED
3. [x] Add missing page-specific CSS classes (.page-goals, .page-loans, etc.) - FIXED
4. [x] Add file type validation for uploads - FIXED (MIME type whitelisting)
5. [x] Enforce SESSION_SECRET environment variable - FIXED (required in production)

## Security Issues (Audit Complete)
6. [x] Check for SQL injection vulnerabilities - MITIGATED (Parameterized queries used)
7. [x] Review XSS vulnerabilities in import functionality - MITIGATED (escapeHtml used)
8. [x] Review localStorage usage for sensitive data - Documented
9. [x] Check CSP headers and security middleware - FIXED (Helmet added)
10. [x] Add file upload content-type validation - FIXED
11. [x] Enable secure flag in session cookies - FIXED
12. [x] Remove error message exposure to clients - FIXED (Global error handler)
13. [x] Add CORS origin whitelist - FIXED

## Code Quality
14. [x] Remove unused CSS modules and dead code - FIXED
15. [x] Fix TypeScript type safety issues - FIXED (Chart component, api.ts)
16. [x] Add proper error boundaries - FIXED (ErrorBoundary component)
17. [x] Add error handling to fetch calls - FIXED (Goals, Loans, Housing, Bills, Categories)
18. [ ] Consolidate duplicate code patterns
19. [ ] Remove commented-out legacy code
20. [ ] Fix implicit any types (Badge, Button components)

## Testing
21. [ ] Fix remaining animation test failures
22. [ ] Add integration tests for API endpoints
23. [ ] Add unit tests for utility functions
24. [ ] Add tests for edge cases
25. [ ] Add security vulnerability tests (XSS, file upload)

## Performance
26. [ ] Optimize large CSS bundles
27. [x] Implement lazy loading for pages - FIXED (code splitting working)
28. [ ] Add bundle size optimization
29. [ ] Review database query performance
30. [ ] Replace in-memory rate limiting with Redis (production only)

## Refactoring
31. [ ] Create shared UI component library
32. [x] Centralize common patterns - FIXED (utils/api.ts)
33. [x] Extract API client configuration - FIXED
34. [ ] Consolidate delete operation patterns (10+ instances)
35. [ ] Add proper TypeScript types for all props

## Features
36. [ ] Add export to CSV/Excel functionality
37. [ ] Add recurring transaction support
38. [ ] Add transaction filtering by date range
39. [ ] Add search functionality
40. [ ] Add notification system for alerts
41. [ ] Add dark mode toggle

## Static Analysis
42. [ ] Add @typescript-eslint/no-unused-vars to catch unused vars
43. [ ] Add @typescript-eslint/strict-boolean-expressions rule adjustments
44. [ ] Add @typescript-eslint/no-explicit-any rule for all code