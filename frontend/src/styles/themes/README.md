# Token Circles theme system

Each theme is one CSS file that sets the **full token contract** on a
`[data-theme='<id>']` selector (the light theme also binds `:root` as the
no-JS fallback). Components never hardcode colors — they consume tokens only,
so adding a theme means adding one file here, importing it from
`../index.css`, and registering the id in `src/core/theme.ts` (`THEMES`).

## Themes

| id      | file             | ground                                                  |
| ------- | ---------------- | ------------------------------------------------------- |
| `dark`  | `orbit-dark.css` | "Orbital Observatory" deep night indigo (brand default) |
| `light` | `dawn-light.css` | "Dawn" paper-blue daylight                              |

`instrument-deck.css` is **not a theme** — it's a scoped variant
(`.instrument-deck` on a page container, dark theme only) that re-grounds
analytics/portfolio surfaces in graphite terminal colors.

## Token contract

Grounds: `--bg --bg-secondary --surface --surface-hover --card-bg --stat-bg
--table-header-bg --table-hover --sidebar-bg --sidebar-active-bg` …
Ink: `--text --text-primary --text-secondary` … Action: `--primary
--primary-hover --primary-bg` … Semantic money (never decorative):
`--income --expense --transfer --text-positive --text-negative` …
Brand: `--accent-warm` (the one warm touch per view), `--font-display`
(headings), `--glow-primary` (button/focus glow).

The legacy component-specific tokens (`--loan-stat-bg`, `--amort-th-bg`, …)
remain part of the contract until their call sites are migrated to the
generic tokens.
