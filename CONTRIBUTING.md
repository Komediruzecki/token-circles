# Contributing to Finance Manager

Thank you for your interest in contributing!

Before your first change, read **[AGENTS.md](./AGENTS.md)** — it says what ships, what is retired
but still in the tree, and the few rules that will bite you (migrations are append-only; only a
`v*` tag reaches production).

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10+

### Setup

```bash
git clone https://github.com/Komediruzecki/finance-manager.git
cd finance-manager
pnpm install
```

### Development

Two things ship: the app and the API.

- **`frontend/`** — SolidJS SPA with Vite. Also runs with no server at all, on IndexedDB.
- **`worker/`** — the API: Hono on Cloudflare Workers, with D1 for data and R2 for receipts.

```bash
# The API on :8787 — wrangler dev against a local D1
pnpm run dev:worker
pnpm -C worker run d1:migrate:local   # once, and after pulling new migrations

# The app on :3800, proxying /api to :8787
pnpm run dev
```

`backend/` is a retired Express + SQLite server. Nothing deploys it and CI does not test it; it
survives only as the API the Playwright suite currently drives. Do not add to it — see
[AGENTS.md](./AGENTS.md).

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
pnpm run test                       # frontend — vitest + fake-indexeddb
pnpm -C worker run test             # worker — vitest in a real Worker isolate, against a real D1
pnpm run typecheck                  # both
pnpm run lint                       # frontend eslint
```

Neither suite needs a server running: the frontend fakes IndexedDB, and the Worker suite boots the
Worker itself with migrations applied.

New behaviour needs a test that fails without the change. A guard needs a test that fails when the
guard is removed — it is worth deleting the guard once to check that it does.

The Playwright suite (`frontend/tests/`) is the exception: it drives the real built app and needs
an API answering on :3847. `.github/workflows/e2e.yml` is the reference for how it is started and
seeded.

## Code Style

- TypeScript for frontend code
- ESLint + Prettier configured — run `pnpm run lint` before committing
- Follow existing patterns in the codebase
- **No emojis** — not in components, buttons, headings, labels, logs, or commit messages. Use an
  SVG icon: reuse one from the file you are editing, or add a new icon component.

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
