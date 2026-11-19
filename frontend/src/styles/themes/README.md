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
(headings), `--glow-primary` (button/focus glow). Floating: `--surface-floating
--border-floating`, painted by every menu, dropdown, popover, tooltip and toast; a
theme sets them where it sets its grounds, with an edge of 2:1 against them in a
light theme and 3:1 in a dark one (`src/__tests__/floatingEdges.test.ts`). Text on a
floating surface reads 4.5:1 on it in every theme, so status text there takes the text
tokens, `--success-text --danger-text --warning-text`, which each theme sets beside its
status colours; the status colours themselves are for marks and edges.
Dialog: `--border-dialog`, the edge of every dialog, and `--border-dialog-sidebar`,
the edge of the two painted in the sidebar's navy (sign-in and Create Profile); a
theme sets them where it sets its grounds and the deck sets its own
`--border-dialog`. The edge measures at least 3:1 in a dark theme and 2:1 in a
light one against the page a dialog's backdrop dims, and at least 2:1 and 1.2:1
on the dialog's own surface (`src/__tests__/dialogEdges.test.ts`).

The legacy component-specific tokens (`--loan-stat-bg`, `--amort-th-bg`, …)
remain part of the contract until their call sites are migrated to the
generic tokens.
