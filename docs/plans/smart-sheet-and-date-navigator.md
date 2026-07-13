# Plans: Smart Sheet + Universal Date/Period Navigator

Status: **proposal for decision** — nothing here is built yet. Two features are
described so we can pick what to build and how far to go. Each ends with open
decisions.

---

## Part 1 — Smart Sheet (entry-system direction C)

### The problem it solves

Today every record is entered one at a time. The Command Bar (⌘K) and Guided
Orbit are fast for a single entry; the Subscription Catalog handles one bulk
case. But when the data lives in your head as a _list_ — "here are the twelve
things I spent on this trip" — there is no manual equivalent of the Excel
import. The Smart Sheet is that: a keyboard-driven grid for entering many rows
quickly, then committing them in one batch.

### Shape of the experience

A spreadsheet you already know how to drive, in the brand's instrument style
(dark, mono, glass, azure focus cell):

```
 DATE        DESCRIPTION        AMOUNT   CATEGORY      ACCOUNT     TYPE
 13 Jul      Rocket Beans        4.50    Food ▾        Giro ▾      exp
 13 Jul      Tram pass           2.90    Transport ▾   Giro ▾      exp
 13 Jul ⤓    Lunch              11.20    Food ▾ ⤓      Giro ⤓      exp
 13 Jul      ▏type to add…
 ───────────────────────────────────────────────────────────────────
 3 valid · €18.60      [ Fill down ]  [ Paste ]        [ Add 3 rows ]
```

Interaction model:

- **Type a row, `Enter` opens the next.** `Tab`/`Shift-Tab` move across cells,
  `↑/↓` between rows, `Esc` blurs.
- **Fill-down** (`Ctrl/Cmd+D`) copies the cell above; a `⤓` marker shows a
  filled value so you only type what changes (date and account usually repeat).
- **Duplicate last row** for near-identical entries.
- **Paste a block** from a real spreadsheet or the clipboard — TSV/CSV is parsed
  into rows and mapped onto the columns (reusing the existing bank-import column
  matcher in `core/bankImport/*`).
- **Autocomplete per column from history** — start a merchant you've used and it
  completes, pulling its usual category and amount as ghosted hints (this is the
  "memory" pillar from the entry-system pitch, shared with the command bar).
- **Live validation** — each row shows valid/invalid; the footer counts valid
  rows and their total; **Add N rows** commits only the valid ones.

### Data & columns

Default (Transactions): `date, description, amount, category, account, type`
(+ optional `note`, `tags` behind a toggle). The grid is driven by a **column
schema** so the same component can later serve other entities:

```ts
interface SheetColumn {
  key: string;
  header: string;
  kind: 'date' | 'text' | 'money' | 'select' | 'type';
  required?: boolean;
  options?: () => { value: string; label: string; color?: string }[]; // for select
  fillDown?: boolean;
  width?: number;
}
```

A `bills` schema (`name, amount, dueDate, frequency, category`) or `holdings`
schema (`ticker, shares, price, date`) would reuse the same grid later.

### Architecture

- **`components/SmartSheet.tsx`** — a controlled grid over `rows: Partial<Row>[]`
  and an `activeCell` signal. Props: `columns`, `rows`, `onChange`, `onCommit`.
  Pure UI + keyboard/paste handling; no entity knowledge.
- **`core/entry/sheetSchema.ts`** — the column schemas + a `parseClipboard(tsv)`
  helper (thin wrapper over the bank-import matcher).
- **Reuse** the entry engine: category matching + merchant→category/amount memory
  from `core/entry/*` (the command bar's `parseEntry` already has the category
  matcher; extract the shared bits into `core/entry/memory.ts`).
- **Commit**: loop `api.createTransaction` for valid rows (same path the command
  bar/guided orbit use), with a progress toast. A dedicated `POST /api/transactions/bulk`
  endpoint would be nicer (one round-trip) — **open question**, see below.
- **Entry point**: an "Add many" button on Transactions (next to Add), and it
  can be offered from the ⌘K command bar as an action ("add many →").

### Brand styling

Instrument-panel grid: mono numerals with `tabular-nums`, a glowing azure focus
cell, a faint mint left-border on valid rows and salmon on invalid, dashed
`⤓` fill markers in dawn. Header row in the uppercase mono label style. On
narrow screens the grid is awkward, so **mobile falls back to the Guided Orbit**
(the sheet is a desktop/tablet power tool).

### Edge cases

- Paste with more/fewer columns than the schema → map by header when possible,
  else by position; extra columns ignored with a note.
- Invalid rows never block valid ones; they stay in the grid highlighted.
- Empty trailing row is always present (the "type to add" row).
- Undo of a committed batch — **open question** (could keep the batch id and
  offer "undo last import").

### Effort & risk

Medium–High. The grid keyboard/paste model is the bulk of it; the commit path
and schema reuse are straightforward. Main risk is scope creep on
spreadsheet-fidelity (range selection, multi-cell copy) — v1 should ship
row-based entry + fill-down + paste, and stop there.

### Open decisions

1. **Bulk API?** Add `POST /api/transactions/bulk` (worker + local handler) for
   one round-trip, or loop the existing single-create for v1?
2. **Scope of columns** — ship the 6 core columns only, or include tags/notes?
3. **Which entities** beyond Transactions get a schema in v1 (probably just
   Transactions; Bills/Holdings later)?
4. **Undo** a committed batch — in scope or later?

---

## Part 2 — Universal Date / Period Navigator

### Why this is worth doing (current state)

From a full audit of date handling:

- **No shared "current period" state.** Every page reinvents month/year (or
  from→to) as local signals. `appStore.ts` has nothing about time.
- **Three incompatible granularity shapes** are in use at once:
  - `month + year` numbers — Dashboard, BillCalendar, Reports
  - `"YYYY-MM"` string — Budgets
  - `{ from, to }` range strings — Transactions
  - bare `year` per-widget — Analytics
- **No shared date utility.** Month-name arrays, `startOfMonth/endOfMonth`,
  ISO formatting, and the pill→range switch are duplicated across ≥6 files.
- **Two good components already exist but only Dashboard uses them:**
  `components/Dashboard/PeriodNavigator.tsx` (‹ Month▾ Year▾ ›) and
  `components/PeriodPills.tsx` (Today/Week/Month/Quarter/Year/7D/30D/90D/All).
- **Hash routing** (`#page?query`) is available for persistence; Transactions
  already parses `?category=`/`?account=` from it.
- **⌘K keyboard handler** lives in `App.tsx`; a navigator's ←/→ shortcuts should
  register alongside it and guard against input focus.
- **Zero swipe/gesture code** anywhere — swipe-to-change-month is greenfield.

The selectors are also just ugly and inconsistent (a different control per page).
This is the single biggest navigation pain, exactly as you said.

### The vision

**One shared, brand-native way to move through time, present on every page that
needs it, replacing all the bespoke selectors.** Core action = change the month;
richer actions = jump year, pick a preset window, or drag out an A→B range —
via pills, a stepper, swipe (mobile), keyboard (desktop), and a novel **orbital
period picker** popup that echoes the Command Bar.

### Canonical period model

One object, three modes, with derived accessors so each page reads what it needs:

```ts
type PeriodMode = 'month' | 'range' | 'year'
interface Period {
  mode: PeriodMode
  year: number
  month?: number          // 0–11, for 'month'
  from?: string; to?: string  // ISO, for 'range'
  preset?: 'thisMonth' | 'lastMonth' | 'ytd' | 'last30' | 'last90' | 'all' | 'custom'
}
// utils/period.ts helpers (single source of truth):
toRange(p): { from, to }        // every mode resolves to a range for fetching
toYYYYMM(p): string
label(p): string                // "July 2026", "Q3 2026", "1–30 Jun"
shift(p, ±1): Period            // step month/year/range window
fromPill(pill): Period
```

`utils/period.ts` becomes the one place month math and formatting live (deletes
the ≥6 duplicates).

### Shared state (SolidJS)

A small store + hook so pages opt in with a clean API:

```ts
// core/periodStore.ts
const [period, setPeriod] = createStore/signal(...)
export function usePeriod(key: string, opts?: { mode; persist?: 'hash' | 'none' }): {
  period: Accessor<Period>
  setPeriod: (p: Period) => void
  step: (dir: -1 | 1) => void
  helpers: typeof periodUtils
}
```

**Key decision (see open decisions):** one **global focus period** shared across
pages (change the month on Dashboard → Transactions is already there when you
switch) vs. **per-page** periods. Recommendation: a **global focus month/year**
that every month-mode page follows, with pages that genuinely need a different
shape (Transactions ranges, Analytics year) deriving from or overriding it. This
gives the "flip through months and every page stays in sync" feel while letting
range/year pages do their thing.

Persistence: reflect the period in the hash (`#transactions?period=2026-07` /
`?from=…&to=…`) so refreshes and shared links keep the view.

### The component(s)

1. **`<PeriodBar>`** — the slim bar that sits under each page header, replacing
   the old selectors. Shows the current period label, ‹ › steppers, a compact
   pill row, and a tap target that opens the orbital picker. Controlled via
   `usePeriod`.
2. **`<PeriodOrbit>`** (the novel bit) — a Command-Bar-style popup for jumping
   anywhere fast:
   - **Months as an orbit** — the 12 months around a ring, current one lit,
     tap/click any to jump; the year sits in the core with ‹ › and scroll/keys
     to change it. Touch-friendly (big hit targets on the ring).
   - **Quick pills** — This month · Last month · YTD · Last 30/90 days · All.
   - **Custom range** — a compact two-month mini-calendar to drag out A→B
     (this is what Transactions/Analytics "advanced" needs).
   - Keyboard: ←/→ month, ↑/↓ year, `1–9` jump, `Enter` apply, `Esc` close.
3. **Controlled primitives** already exist (`PeriodNavigator`, `PeriodPills`) —
   fold them into `PeriodBar` rather than rebuild.

### Interaction model

| Context           | Change month                                                                                                                                              | Jump / range                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Desktop**       | ‹ › buttons; **←/→ keys** (globally, guarded vs input focus + open modals); pills                                                                         | Click the period label → `PeriodOrbit`; pills; custom-range calendar                  |
| **Mobile/tablet** | **Swipe left/right** on the page content to step month (like 1Money, but with a subtle orbit-arc animation on the period label as it advances); big pills | Tap the period label → `PeriodOrbit` full-screen sheet with the month ring + calendar |

Swipe is registered once at the app/main-content level and dispatched to the
active page's `usePeriod().step(dir)` — greenfield, so we design it cleanly
(horizontal-intent threshold, ignore when a horizontally-scrollable element is
under the finger, respect `prefers-reduced-motion`).

### Per-page adoption

| Page               | Mode                              | Notes                                                                                               |
| ------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------- |
| Dashboard          | month + pills                     | Already close; swap its inline wiring for `usePeriod` + `PeriodBar`.                                |
| Budgets            | month                             | Replace the custom `"YYYY-MM"` stepper; keep the same fetch key.                                    |
| Bills → Calendar   | month                             | Replace the local month stepper; keep Today.                                                        |
| Reports (Settings) | month/year                        | Replace the two selects; "whole year" = year mode.                                                  |
| Transactions       | range                             | `PeriodBar` in range mode + month presets; keep client-side filter, just feed it `toRange(period)`. |
| Analytics          | year (page) + per-chart overrides | Page-level year most charts follow; compare/week stay chart-local. **Needs a design call** (below). |

Rollout is page-by-page behind the shared hook, deleting each old selector as it
adopts — no big-bang.

### Architecture summary

```
utils/period.ts        ← month math, formatting, pill→range, shift (single source)
core/periodStore.ts    ← usePeriod(key) hook + global focus period + hash sync
components/PeriodBar    ← the slim replacement bar (folds in existing primitives)
components/PeriodOrbit  ← the novel popup (month ring + pills + range calendar)
App.tsx                ← global ←/→ keys + swipe dispatch (sibling to ⌘K), guarded
```

Everything is controlled + typed; a page adopts by calling `usePeriod` and
rendering `<PeriodBar>` — no page owns month math anymore.

### Effort & risk

Large but mechanical after the core lands: the model + `utils/period.ts` +
`usePeriod` + `PeriodBar` + `PeriodOrbit` is the real work (~1 focused PR); then
each page is a small adoption PR. Risk areas: (a) global-vs-per-page semantics
(decide up front), (b) Analytics' many independent widgets, (c) swipe not
fighting horizontally-scrollable tables/charts.

### Open decisions

1. **Global vs per-page period.** One focus month shared across pages (my
   recommendation) or independent per page? This shapes the store.
2. **Analytics.** Adopt a single page-level year that most charts follow (with
   compare/week as local overrides), or leave Analytics on per-chart selectors
   for now and convert only the simpler pages first?
3. **Swipe zone.** Whole page content, or a dedicated period bar you swipe? (Whole
   page feels best but risks conflicting with scrollable tables/charts.)
4. **URL persistence.** Put the period in the hash (shareable, survives refresh)
   — yes/no?
5. **Pill set.** Keep the current nine (Today/Week/Month/Quarter/Year/7D/30D/90D/All)
   or trim to the ones people actually use?
6. **How brave on the orbit picker.** Ship `PeriodBar` (steppers + pills +
   swipe + keys) first and add `PeriodOrbit` after, or build the orbital popup
   as the headline from day one?

---

## Suggested sequencing (if we green-light)

1. **Foundations** — `utils/period.ts` + `Period` model + `usePeriod` +
   `PeriodBar`, adopted on Dashboard + Budgets + BillCalendar (the pure month
   pages). Delete their old selectors. _(1 PR)_
2. **PeriodOrbit** popup + swipe + ←/→ keys. _(1 PR)_
3. **Transactions** (range) and **Reports** adoption. _(1 PR)_
4. **Analytics** — per the decision above. _(1 PR)_
5. **Smart Sheet** — independent of the above; can slot in whenever. _(1–2 PRs)_
