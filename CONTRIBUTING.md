# Contributing to Finance Manager

Thank you for your interest in contributing!

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- SQLite 3

### Setup

```bash
git clone https://github.com/Komediruzecki/finance-manager.git
cd finance-manager
npm install
```

### Development

This is a monorepo with two main workspaces:

- **`frontend/`** — SolidJS SPA with Vite
- **`backend/`** — Node.js/Express API server

```bash
# Start backend (port 3847)
cd backend && node index.js

# Start frontend dev server (port 5173)
cd frontend && npm run dev
```

## Workflow

1. **Find an issue** — Pick an open issue from [GitHub Issues](https://github.com/Komediruzecki/finance-manager/issues), or open one to discuss your idea first
2. **Create a feature branch** — Branch off `main`:

   ```bash
   git checkout -b feat/issue-NUMBER-short-description
   ```

   Use branch prefixes: `feat/`, `fix/`, `refactor/`, `docs/`, `chore/`

3. **Make changes** — Follow the code style and write tests
4. **Commit** — Use [Conventional Commits](https://www.conventionalcommits.org/):

   ```bash
   git commit -m "feat: add transaction search"
   git commit -m "fix: resolve pagination off-by-one"
   ```

5. **Push and open a PR** — Open a pull request against `main`
6. **CI must pass** — Lint, typecheck, build, and tests must all pass before review

## Testing

```bash
npm test              # Run all tests
npm test -- --watch  # Watch mode
npx jest <path>      # Run specific test file
```

Tests require the backend server running on port 3847 with `NODE_ENV=test`.
The test database (`db/test.db`) is reset automatically between test files.
Run `npm test` once to initialize the test database before running individual tests.

## Code Style

- TypeScript for frontend code
- ESLint + Prettier configured — run `npm run lint` before committing
- Follow existing patterns in the codebase

## Pull Request Guidelines

- Keep PRs focused on a single change
- Include a clear description of what changed and why
- Link to the issue being resolved
- Ensure all checks pass before requesting review

## Reporting Bugs

Open an issue with:

- Steps to reproduce
- Expected vs actual behavior
- Browser and OS details
- Any relevant console errors

## Questions?

Open a [discussion](https://github.com/Komediruzecki/finance-manager/issues) or ask in an issue.
