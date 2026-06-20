# Public Repo Readiness — Improvement Plan

**Created**: 2026-06-15  
**Goal**: Polish the repo for public consumption on GitHub — clean structure, welcoming docs, professional presentation.

---

## 1. Remove Internal/Infra Content

### 1.1 Move `deploy.sh` out of repo root
**Status**: `deploy.sh` at repo root contains server-specific paths (`finance-manager.clodhost.com`, `systemctl restart finance-manager.service`, `chown www-data`). Not useful for public contributors.
- **Action**: Move to `scripts/deploy.sh`, rename root `docker-compose.yml` reference or leave a generic deployment section in README.
- **Priority**: High

### 1.2 Remove `apache/` directory
**Status**: Contains `finance-manager.clodhost.com-ssl.conf` and `ready.clodhost.com-ssl.conf` — site-specific Apache configs.
- **Action**: Delete directory. Apache reverse-proxy guidance belongs in `docs/self-hosting.md`.
- **Priority**: High

### 1.3 Clean `public/` directory
**Status**: Contains `cl_workflow.md` and `serverless-vs-selfhosted-plan.md` — internal planning docs mixed with PWA icons/service worker.
- **Action**: Delete the two .md files. `public/` should only contain PWA assets.
- **Priority**: High

### 1.4 Replace `todo.md` with public `ROADMAP.md`
**Status**: `todo.md` contains internal development notes referencing Claude Code, specific build paths, and internal priorities.
- **Action**: Create `ROADMAP.md` with public-facing roadmap. Move internal-specific items to GitHub Issues or remove. Delete `todo.md`.
- **Priority**: High

### 1.5 Gitignore `.env` and stop tracking it
**Status**: `.env` is tracked in git. Currently harmless (only dev ports), but sets a bad precedent.
- **Action**: Add `.env` to `.gitignore`, remove from git tracking with `git rm --cached .env`, add `.env.example` with documented defaults.
- **Priority**: High

### 1.6 Gitignore `coverage/`
**Status**: `coverage/` directory is committed to git. Test coverage reports are build artifacts.
- **Action**: Add `/coverage/` to `.gitignore` (already has `coverage/` but not the root one), remove from tracking.
- **Priority**: Medium

---

## 2. Fix Placeholders & Incomplete Files

### 2.1 CODE_OF_CONDUCT.md — add contact method
**Status**: Has `[INSERT CONTACT METHOD]` placeholder in Enforcement section.
- **Action**: Add a real contact email or link to GitHub Issues.
- **Priority**: High

### 2.2 SECURITY.md — recommend private vulnerability reporting
**Status**: Currently says "report by opening an issue on GitHub." Best practice is private disclosure.
- **Action**: Recommend GitHub's built-in "Security Advisories" / private vulnerability reporting. Add maintainer email as fallback.
- **Priority**: High

---

## 3. Add Missing Standard Files

### 3.1 Issue templates
**Status**: No `.github/ISSUE_TEMPLATE/` directory.
- **Action**: Add:
  - `bug_report.yml` — structured form for bug reports
  - `feature_request.yml` — structured form for feature requests
  - `config.yml` — link to discussions/contributing
- **Priority**: High

### 3.2 Pull request template
**Status**: No `PULL_REQUEST_TEMPLATE.md`.
- **Action**: Add checklist: tests pass, lint passes, linked issue, description of changes.
- **Priority**: Medium

### 3.3 Enable private vulnerability reporting
**Status**: Not configured on GitHub.
- **Action**: Enable on repo Settings → Security → Private vulnerability reporting.
- **Priority**: Medium

---

## 4. Enhance Documentation

### 4.1 README improvements
**Status**: Good but can be better.
- **Action**:
  - Add badges (license, version, tests passing, PRs welcome)
  - Add screenshot(s) of the app
  - Add "Quick Start" section for 5-minute local setup
  - Move full API table into a collapsible `<details>` section
  - Add "Star History" or "Contributors" section
- **Priority**: Medium

### 4.2 Create `ROADMAP.md`
**Status**: No public roadmap exists.
- **Action**: Convert `todo.md`'s "Next Priorities" sections into a public ROADMAP.md with Q3/Q4 2026 targets.
- **Priority**: Medium

### 4.3 Fix docs/ organization
**Status**: `docs/Dashboard.spec.md` is at top level instead of `docs/specs/frontend/dashboard.md`. Duplicate `docker-compose.yml` in both root and `docs/`.
- **Action**:
  - Move `docs/Dashboard.spec.md` → `docs/specs/frontend/dashboard.md`
  - Remove duplicate `docs/docker-compose.yml` (keep root one)
  - Add `docs/README.md` as an index of all documentation
- **Priority**: Medium

### 4.4 Expand `docs/self-hosting.md`
**Status**: Covers basics but could be better structured.
- **Action**: Add sections for Apache reverse-proxy setup (salvaged from deleted `apache/` dir), systemd service unit example, environment variable reference.
- **Priority**: Low

### 4.5 Update CHANGELOG
**Status**: Last entry is 4.0.0 (2026-05-11). Several commits since then.
- **Action**: Add entries for recent fixes and improvements since 4.0.0.
- **Priority**: Low

---

## 5. Repo Polish

### 5.1 Add badges to README
- License: MIT
- Version: 4.0.0
- PRs welcome
- CI status (if E2E workflow is fixed)

### 5.2 Add repo description and topics on GitHub
- Description: "Personal finance tracker with SolidJS frontend and Express/SQLite backend"
- Topics: `finance`, `solidjs`, `express`, `sqlite`, `budgeting`, `personal-finance`, `typescript`

### 5.3 Review branch protection rules
- Require PR reviews for main
- Require status checks to pass
- Block force pushes to main

---

## Implementation Order

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 1 | Remove `apache/` directory | Small | High |
| 2 | Clean `public/` internal docs | Small | High |
| 3 | Remove `deploy.sh` from root | Small | High |
| 4 | Replace `todo.md` → `ROADMAP.md` | Medium | High |
| 5 | Gitignore `.env`, add `.env.example` | Small | High |
| 6 | Fix CODE_OF_CONDUCT contact placeholder | Small | High |
| 7 | Fix SECURITY.md vulnerability reporting | Small | High |
| 8 | Add issue templates (bug + feature) | Small | High |
| 9 | Gitignore `coverage/` | Small | Medium |
| 10 | Add PR template | Small | Medium |
| 11 | Fix docs/ organization (Dashboard.spec, duplicate docker-compose) | Small | Medium |
| 12 | Add docs/README.md index | Medium | Medium |
| 13 | README improvements (badges, screenshots, quick start) | Medium | Medium |
| 14 | Expand self-hosting.md | Medium | Low |
| 15 | Update CHANGELOG | Small | Low |
| 16 | GitHub repo settings (topics, description, security) | Small | Medium |
