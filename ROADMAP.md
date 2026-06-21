# Roadmap

This document outlines planned improvements and future directions for Finance Manager. Items are roughly ordered by priority within each section.

Contributions toward any of these are welcome — please open an issue to discuss before starting work.

---

## 🎮 Gamification & Engagement

- [ ] **Achievement system** — Badges for milestones: "First Budget Created", "30-Day Tracking Streak", "$1,000 Saved", "Debt-Free!"
- [ ] **Spending challenges** — "No-Spend Weekend", "$50 Grocery Week", "Cook at Home Month" — set rules, track progress, earn rewards
- [ ] **Streak tracking** — Days in a row of tracking expenses. Keep the chain alive!
- [ ] **Financial wellness score** — Composite score based on savings rate, budget adherence, emergency fund, and debt ratio

## 💰 Bills & Subscriptions

- [ ] **Subscription detection** — Automatically identify recurring payments (Netflix, gym, cloud services). Monthly/annual cost summary
- [ ] **Bill calendar** — Calendar view of all upcoming bills. "Due in 7 days" and "Overdue" visual indicators
- [ ] **Bill payment matching** — Auto-match transactions to bills when the payment goes through
- [ ] **Renewal reminders** — "Your annual Prime subscription renews next week ($139)"

## 🏦 Financial Planning & Calculators

- [ ] **Debt payoff planner** — Snowball vs avalanche methods. Visualize debt-free date, see impact of extra payments
- [ ] **FIRE scenario modeling** — Early retirement projections, withdrawal rate simulation, coast-FIRE calculation
- [ ] **Mortgage calculator** — Affordability check, amortization schedule, PMI calculation, PITI breakdown
- [ ] **Tax estimator** — Estimate federal & state tax liability from YTD income/deductions
- [ ] **College savings planner** — 529 projections with inflation and growth assumptions

## 👥 Multi-User & Sharing

- [ ] **Household accounts** — Invite partner or family members to a shared profile. Per-user permissions (view, edit, manage)
- [ ] **Read-only share links** — Generate expiring, password-protected links for reports or budgets
- [ ] **Activity feed** — "Sarah added a $42.50 transaction to Dining Out" — see who did what

## 📱 Mobile & PWA

- [ ] **PWA install** — "Add to Home Screen" with offline support and native-like experience
- [ ] **Swipe actions** — Swipe left to delete, right to edit — like your favorite email app
- [ ] **Pull-to-refresh** — On transaction lists and dashboard
- [ ] **Mobile quick-capture** — Lightning-fast transaction entry optimized for mobile
- [ ] **Push notifications** — Budget alerts, bill reminders, weekly summaries

## 🔌 Integrations

- [ ] **Bank sync via GoCardless/Plaid** — Connect your bank accounts for automatic transaction import
- [ ] **Email receipt parsing** — Forward receipts to a dedicated email, auto-extract merchant/amount/date
- [ ] **Google Sheets sync** — Push budgets and transactions to Sheets for custom analysis
- [ ] **Calendar integration** — Push bill due dates to Google Calendar / Apple Calendar
- [ ] **Multi-currency support** — Live exchange rates, automatic conversion at transaction time

## 📊 Analytics & Visualization

- [ ] **Sankey cash flow diagram** — Visual flow from income → expenses → savings
- [ ] **Spending velocity charts** — Burn rate: "At this pace, you'll spend $X by month end"
- [ ] **Category treemap** — Interactive drill-down spending map
- [ ] **Calendar heatmap** — GitHub-style contribution graph for your spending
- [ ] **Year-over-year comparisons** — Same month last year, side-by-side
- [ ] **Net worth projection** — Monte Carlo simulation of future net worth
- [ ] **Anomaly detection** — "This charge is 3× your usual at this merchant"

## Backend

- [ ] **API docs (OpenAPI/Swagger)** — Auto-generated spec, served at `/api/docs`
- [ ] **WebSocket for real-time updates** — Push dashboard/balance changes to frontend
- [ ] **Database migrations system** — Proper up/down migrations instead of ad-hoc ALTERs
- [ ] **Background job system** — PDF generation, email dispatch, bank imports via Bull/BullMQ + Redis
- [ ] **GraphQL endpoint** — Alternative to REST for complex dashboard queries
- [ ] **Server-sent events for progress** — Stream report generation, import progress

## Frontend

- [ ] **Dashboard widget customization** — Drag to reorder, show/hide widgets, preset layouts
- [ ] **Command palette** — `Ctrl+K` fuzzy-search palette: "New transaction", "Go to budgets", "Export PDF"
- [ ] **Full keyboard navigation** — Tab order, shortcuts for power users, `?` cheat sheet
- [ ] **Natural language input** — "coffee 4.50 yesterday at starbucks #food" → parsed automatically
- [ ] **Undo support** — Toast with "Undo" after deletes, inline editing on table cells
- [ ] **Budget scenario planner** — What-if modeling: new job, relocation, baby, sabbatical
- [ ] **Transaction receipt OCR** — Snap a photo, extract merchant/amount/date

## 🛡️ Security & Account

- [ ] **Two-factor authentication (TOTP)** — QR code setup, backup codes, remember-device
- [ ] **OAuth sign-in** — Google, GitHub, Apple sign-in options
- [ ] **Session management** — View active sessions, remote logout from other devices
- [ ] **One-click data export** — Full GDPR-compliant data export (JSON)
- [ ] **Account deletion** — Complete data purge with confirmation and cooldown

## Infrastructure

- [ ] **CI/CD pipeline** — GitHub Actions: lint → test → build on PR, auto-deploy on merge
- [ ] **Docker Compose for dev** — One-command development environment
- [ ] **S3-compatible backup** — Scheduled DB backups to S3/Backblaze/R2
- [ ] **Redis session & caching layer** — Multi-process support, faster queries
- [ ] **Prometheus metrics endpoint** — Request duration, error rates, active users

## Testing & Quality

- [ ] **Playwright E2E tests** — Critical user flows: signup → transaction → budget → report
- [ ] **Visual regression tests** — Screenshot diffs on PR to catch UI regressions
- [ ] **Load testing** — Artillery/k6 scripts to validate API under load
- [ ] **Accessibility audit (WCAG 2.1 AA)** — axe-core audit + manual screen reader pass
- [ ] **Performance budget** — Lighthouse CI: <3s FCP, <5s TTI, <200KB JS

## Docs & Community

- [ ] **API reference docs** — Every endpoint with request/response examples
- [ ] **User guide** — Screenshots, feature walkthroughs, getting started tutorial
- [ ] **Self-hosting guide** — Docker, reverse proxy, env vars, backup strategy
- [ ] **OpenAPI/Swagger spec** — Full API documentation served at `/api/docs`
- [ ] **i18n framework** — Infrastructure for community-contributed translations

## Quick Wins

Ideal for first-time contributors — each can be done in a few hours:

1. [ ] **Loading skeletons** — Replace spinners with skeleton screens on dashboard cards
2. [ ] **Relative dates** — "2 days ago" instead of "2026-06-13" in lists
3. [ ] **Number formatting** — Thousands separator (`1,234.56`) everywhere
4. [ ] **Transaction deduplication** — Detect and warn about duplicate entries
5. [ ] **Empty state illustrations** — Friendly empty states with CTAs for every list
6. [ ] **Dark mode auto-detect** — Follow system preference by default
7. [ ] **Favicon** — Add `<link>` tags for existing icon assets
