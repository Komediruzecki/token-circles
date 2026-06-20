# Roadmap

This document outlines planned improvements and future directions for Finance Manager. Items are roughly ordered by priority within each section.

Contributions toward any of these are welcome — please open an issue to discuss before starting work.

---

## Backend

- [ ] **API docs (OpenAPI/Swagger)** — Auto-generated from route annotations or hand-written spec
- [ ] **WebSocket for real-time updates** — Push dashboard/balance changes to frontend
- [ ] **Bank feed/webhook ingestion** — Accept structured bank data via webhook
- [ ] **Multi-currency auto-conversion** — Fetch live rates and store historical conversions
- [ ] **Database migrations system** — Proper up/down migrations instead of ad-hoc ALTERs
- [ ] **Redis for rate limiting** — Replace in-memory Map for multi-process/production
- [ ] **Audit log pruning** — Auto-delete logs older than N days, add log levels filter
- [ ] **GraphQL endpoint** — Alternative to REST for complex dashboard queries
- [ ] **Server-sent events for cron progress** — Stream long-running report generation

## Frontend

- [ ] **Dashboard widget customization** — Drag to reorder, show/hide individual widgets
- [ ] **Full keyboard navigation** — Tab order, shortcuts for power users
- [ ] **PWA manifest + service worker** — Installable on mobile/home screen
- [ ] **Offline-first mode hardening** — Queue mutations when offline, sync on reconnect
- [ ] **Sankey diagram for cash flow** — Visual income→expense→savings flow
- [ ] **Budget scenario planner** — What-if modeling (new job, move, baby, etc.)
- [ ] **Transaction receipt OCR** — Extract merchant/amount/date from receipt images
- [ ] **Natural language transaction input** — "coffee 4.50 yesterday at starbucks"

## Data & Analytics

- [ ] **ML category prediction** — Train on user's categorized transactions
- [ ] **Anomaly detection** — Flag unusual transactions (spike in normally flat category)
- [ ] **Year-over-year comparisons** — Same month last year side-by-side
- [ ] **Spending velocity charts** — Burn rate visualization
- [ ] **Net worth projection** — Monte Carlo simulation of future net worth
- [ ] **Tax loss harvesting tracker** — For investment portfolios

## Collaboration & Sharing

- [ ] **Multi-user household** — Invite another user to a shared profile
- [ ] **Read-only share links** — Generate expiring links to share a report/dashboard
- [ ] **Export to accounting software** — QuickBooks/Xero CSV format templates

## Infrastructure

- [ ] **CI/CD pipeline** — GitHub Actions to run tests, lint, build on PR
- [ ] **Docker Compose for dev** — One-command dev environment
- [ ] **S3-compatible backup** — Scheduled DB backups to S3/Backblaze
- [ ] **Healthcheck endpoint hardening** — Check DB write, disk space, memory
- [ ] **Prometheus metrics endpoint** — Request duration, error rates, DB pool stats

## Testing & Quality

- [ ] **Frontend E2E tests** — Playwright tests for critical user flows
- [ ] **Visual regression tests** — Screenshot comparison for UI components
- [ ] **Load testing** — Artillery/k6 scripts for API under load
- [ ] **Fuzz testing for input validation** — SQLi, XSS, oversized payloads
- [ ] **Accessibility audit** — axe-core automated + manual screen reader pass

## Docs & Community

- [ ] **API reference docs** — Every endpoint with request/response examples
- [ ] **User guide** — Screenshots, feature walkthrough
- [ ] **Self-hosting guide** — Docker, reverse proxy, env vars, backups

## Code Quality

- [ ] **Remove commented-out legacy code** — Several files have `// old approach` blocks
- [ ] **Fix implicit `any` types** — Clean up remaining TypeScript escape hatches
- [ ] **Consolidate delete confirmation patterns** — 10+ nearly identical confirm dialogs
- [ ] **Extract shared chart config** — Chart.js options repeated across Analytics/Dashboard
- [ ] **Bundle size audit** — Tree-shake unused chart.js sub-plugins
