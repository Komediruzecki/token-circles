# Claude Code Workflow

When working on this repository using Claude Code, follow this workflow for optimal results.

## Prerequisites

- Git repository is already initialized
- Claude Code CLI installed and configured
- GitHub CLI (`gh`) installed and authenticated to the repository

## Finding and Selecting Issues

### 1. List Open Issues

```bash
gh issue list --repo Komediruzecki/finance-manager --state open --json number,title,body,labels --limit 20
```

### 2. Filter Issues

- Exclude issues with the `claude-wip` label
- Ignore issues marked as `bug` if they're closed or duplicate
- Focus on the oldest unhandled issues first

### 3. Claim an Issue

```bash
gh issue edit NUMBER --add-label claude-wip --repo Komediruzecki/finance-manager
```

## Working on an Issue

### Step 1: Clone and Prepare

```bash
cd /var/www/finance-manager.clodhost.com
git fetch origin
git checkout main
git pull origin main
```

### Step 2: Create Feature Branch

```bash
git checkout -b feat/issue-NUMBER-short-description
```

Example: `git checkout -b feat/issue-151-service-worker-fix`

### Step 3: Understand the Requirements

Read:
1. The GitHub issue description
2. Any relevant existing code
3. Test files for expected behavior

### Step 4: Implement Changes

**General Rules:**
- Use Conventional Commits: `feat:`, `fix:`, `refactor:`, `chore:`, etc.
- Never push to `main` — always create a PR
- Read files before editing them
- Be careful not to introduce security vulnerabilities
- Keep changes minimal and focused on the issue

**Code Quality:**
- Follow existing code style
- Run tests before committing: `npm test`
- Check for linting errors: `npm run lint` (if configured)

### Step 5: Commit and Push

```bash
git add <files>
git commit -m "type: description"
git push origin feat/issue-NUMBER-short-description
```

### Step 6: Create PR

```bash
gh pr create --repo Komediruzecki/finance-manager \
  --title "type: short description" \
  --body "$(gh issue view NUMBER --repo Komediruzecki/finance-manager --json body --jq '.body')"

# Close the issue with the PR number
gh issue edit NUMBER --remove-label claude-wip --repo Komediruzecki/finance-manager
gh issue close NUMBER --comment "See PR #PR_NUMBER for implementation"
```

## Key Directories

```
/var/www/finance-manager.clodhost.com/
├── frontend/          # SolidJS SPA (src/, dist/)
├── backend/           # Node.js/Express API (index.js, database.js)
├── db/                # SQLite database (gitignored)
├── assets/            # User-uploaded files (gitignored)
├── test/              # Jest test suites
├── deploy.sh          # Deployment script
├── .github-workflow.md # GitHub Actions workflow
└── docs/              # Documentation
```

## Common Commands

### Build and Deploy

```bash
# Deploy using the script (builds frontend, restarts backend)
./deploy.sh --frontend

# Check status
./deploy.sh --status

# Restart only backend
./deploy.sh --backend
```

### Running Tests

```bash
npm test              # Run all tests
npm test -- --watch  # Watch mode for development
```

### Database Management

```bash
# Backup database
cp db/finance-manager.db db/backup-$(date +%Y%m%d).db

# Verify database integrity
sqlite3 db/finance-manager.db "PRAGMA integrity_check;"
```

## Development Notes

### Frontend

- **Framework**: SolidJS 1.8.15 with TypeScript
- **Build Tool**: Vite 6.4.2
- **Output**: `frontend/dist/` (served to public)
- **Build Command**: `cd frontend && npm run build`

### Backend

- **Runtime**: Node.js + Express
- **Database**: SQLite with better-sqlite3
- **Rate Limiting**: Memory-based token bucket
- **Port**: 3847

## Troubleshooting

### Service Worker Issues

If the service worker isn't working properly after a build:
1. Check `frontend/dist/assets/sw.js` exists
2. Verify cache names include the new build
3. Test with `chrome://serviceworker-internals`

### Database Locking

If you get "database is locked" errors:
1. Stop the backend: `systemctl stop finance-manager`
2. Check for pending transactions
3. Start the backend: `systemctl start finance-manager`

### Build Failures

If Vite build fails:
1. Delete `frontend/node_modules/.vite` to clear cache
2. Rebuild: `cd frontend && rm -rf dist && npm run build`
