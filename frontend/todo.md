# Finance Manager - TODO List

## Critical Issues
1. [x] Fix Budgets.tsx runtime error with allocations().map() - FIXED
2. [x] Investigate Settings.tsx duplicate .page-settings elements - FIXED
3. [x] Add missing page-specific CSS classes (.page-goals, .page-loans, etc.) - FIXED
4. [ ] Add file type validation for uploads (Critical security)
5. [ ] Enforce SESSION_SECRET environment variable (Critical security)

## Security Issues (Audit Complete)
6. [x] Check for SQL injection vulnerabilities - MITIGATED (Parameterized queries used)
7. [x] Review XSS vulnerabilities in import functionality - MITIGATED (escapeHtml used)
8. [x] Review localStorage usage for sensitive data - Documented
9. [ ] Check CSP headers and security middleware - Missing
10. [ ] Add file upload content-type validation
11. [ ] Enable secure flag in session cookies
12. [ ] Remove error message exposure to clients
13. [ ] Add CORS origin whitelist

## Code Quality
14. [x] Remove unused CSS modules and dead code - FIXED
15. [x] Fix TypeScript type safety issues - Partially FIXED (Chart component)
16. [ ] Add proper error boundaries
17. [ ] Consolidate duplicate code patterns
18. [ ] Remove commented-out legacy code
19. [ ] Fix implicit any types (Badge, Button components)
20. [ ] Add error handling to fetch calls (10+ locations)

## Testing
21. [ ] Fix remaining animation test failures
22. [ ] Add integration tests for API endpoints
23. [ ] Add unit tests for utility functions
24. [ ] Add tests for edge cases
25. [ ] Add security vulnerability tests (XSS, file upload)

## Performance
26. [ ] Optimize large CSS bundles
27. [ ] Implement lazy loading for pages
28. [ ] Add bundle size optimization
29. [ ] Review database query performance
30. [ ] Replace in-memory rate limiting with Redis (production only)

## Refactoring
31. [ ] Create shared UI component library
32. [ ] Centralize common patterns
33. [ ] Extract API client configuration
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