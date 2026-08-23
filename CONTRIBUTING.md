# Contributing to Finance Manager

Thank you for your interest in contributing!

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10+
- SQLite 3

### Setup

```bash
git clone https://github.com/Komediruzecki/finance-manager.git
cd finance-manager
pnpm install
```

### Development

This is a monorepo with two main workspaces:

- **`frontend/`** — SolidJS SPA with Vite
- **`backend/`** — Node.js/Express API server

```bash
# Start backend (port 3847)
cd backend && node index.js

# Start frontend dev server (port 5173)
pnpm run dev
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
pnpm run test        # Run all tests
pnpm run test -- --watch  # Watch mode
npx jest <path>      # Run specific test file
```

Tests require the backend server running on port 3847 with `NODE_ENV=test`.
The test database (`db/test.db`) is reset automatically between test files.
Run `pnpm run test` once to initialize the test database before running individual tests.

## Code Style

- TypeScript for frontend code
- ESLint + Prettier configured — run `pnpm run lint` before committing
- Follow existing patterns in the codebase

### Editable form controls

Read [`.claude/skills/solid-forms/SKILL.md`](.claude/skills/solid-forms/SKILL.md) before
adding an `<input>` or a list of editable rows. Four bugs have shipped from this area more
than once, and all four look correct in a diff:

- a `<For>` over editable rows rebuilds each row on every keystroke, so the field loses
  focus after one character — use `<Index>`
- `value={n}` + `onInput={e => set(Number(e.currentTarget.value))}` writes back under the
  caret, so the field cannot be emptied and cannot hold a decimal — use `NumberField`
- an unrounded derived number fails HTML5 `step` validation and silently blocks the whole
  form from saving — round where the number is produced
- `<input type="month">` makes users click back one year at a time — use `MonthPicker`

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
