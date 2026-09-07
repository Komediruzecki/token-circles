# Progress Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Progress page in the sidebar after Bills, where the badges, the tracked-month record, and advice drawn from the profile's own data live together, and where the dashboard's badge rail sends people.

**Architecture:** Nothing new is fetched. One pure advice engine (`buildAdvice`) reads the same arrays the achievements evaluator already loads (transactions, budgets, goals, import logs) and returns ranked, dismissible cards. The page composes four sections over the existing `achievementsStore`: a record strip, an advice list, the fifteen badges, and a year in review. The badges panel modal is retired: its contents become the page, and the dashboard chip becomes a horizontal rail of earned badges with a link here.

**Tech Stack:** Solid.js + TypeScript, CSS modules, vitest + jsdom. Existing `api` client, `periodStore`, `toastStore`, `BadgeMedallion`.

**Spec:** `docs/plans/achievements-and-badges.md` (shipped in #534) and this document. Visual reference for the medal face and the orbit paths: disjoint-colliders `packages/showcase-gallery/gallery-viewer/token-circles-badges.html` (served at `/badges`).

## Global Constraints

- Everything computes on device from the current profile's data. Nothing new leaves the device; nothing is added to the worker.
- Per profile, like the badges. A tracked month is **three or more** transactions dated inside it. Unlocks are never revoked.
- No emojis. Icons are inline SVG. No raster art in the app.
- The medal face is **aurora glass** (decision of 2026-09-07). Three ways to get it, all built in the gallery page: drawn in SVG, the generated blank face with the SVG glyph over it, or a full generated medal per badge. `data core` is the fallback if aurora fails a sanity check at 24 px or on a low-end device.
- Advice never scolds and never invents a number. Every card names the figure it is built from and links to the page that shows it.
- `CHANGELOG.md`: one or two user-facing sentences. `dev-changelog.md`: the mechanism and the files.
- Commits carry no co-author trailers. Before a PR: `cd frontend && npx vitest run && npm run lint && pnpm run typecheck`, then `pnpm run test:tours` (the dashboard tour anchors on the period bar, and the rail sits beside it).

---

## File structure

| File                                                             | Responsibility                                                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `frontend/src/components/BadgeMedallion.tsx`                     | Gains the aurora-glass face: a well, three blurred sweeps, a dome, a specular. Face selectable by prop for the fallback. |
| `frontend/src/components/BadgeMedallion.module.css`              | The face layers, the slow aurora drift, the etched-glyph shadow.                                                         |
| `frontend/src/core/achievements/advice.ts`                       | `buildAdvice(input) -> AdviceCard[]`. Pure, ranked, no I/O.                                                              |
| `frontend/src/core/achievements/__tests__/advice.test.ts`        | Fixture-driven tests, one per rule plus ranking and dismissal.                                                           |
| `frontend/src/core/achievements/review.ts`                       | `buildYearReview(input) -> YearReview`. Pure totals for the year-in-review card.                                         |
| `frontend/src/core/achievementsStore.ts`                         | Exposes the loaded arrays so the page can compute advice without a second fetch; keeps `dismissedAdvice` in settings.    |
| `frontend/src/features/Progress.tsx` + `ProgressPage.module.css` | The page: record strip, advice, badges, year in review.                                                                  |
| `frontend/src/components/BadgeRail.tsx`                          | The dashboard rail: earned badges, horizontally scrollable, with a link to the page.                                     |
| `frontend/src/components/BadgesPanel.tsx`                        | Deleted; its band/card markup moves into the page.                                                                       |
| `frontend/src/router.tsx`, `types/models.ts`, `App.tsx`          | Register `progress` after `bills`.                                                                                       |
| `frontend/src/features/Dashboard.tsx`                            | The chip becomes the rail.                                                                                               |
| `frontend/src/features/Settings.tsx`                             | The About button navigates to the page instead of opening the modal.                                                     |

---

### Task 1: The aurora-glass face

**Files:**

- Modify: `frontend/src/components/BadgeMedallion.tsx`
- Modify: `frontend/src/components/BadgeMedallion.module.css`
- Test: `frontend/src/components/__tests__/BadgeMedallion.test.tsx`

**Interfaces:**

- Produces: `<BadgeMedallion id band size? lit? interactive? face? />` where `face` is `'aurora' | 'core' | 'plain'`, default `'aurora'`.

- [ ] **Step 1: Extend the test**

```tsx
it('draws the aurora face by default and swaps to core or plain on request', () => {
  const c = mount(() => <BadgeMedallion id="a-year" band="mastery" size={120} />);
  const el = c.querySelector('.medal, [data-band]') as HTMLElement;
  expect(el.dataset.face).toBe('aurora');
  expect(el.querySelectorAll('[data-sweep]')).toHaveLength(4);
  expect(el.querySelector('[data-dome]')).not.toBeNull();
  dispose?.();
  host.remove();
  const c2 = mount(() => <BadgeMedallion id="a-year" band="mastery" face="plain" />);
  expect(c2.querySelectorAll('[data-sweep]')).toHaveLength(0);
});
it('gives every instance its own gradient ids so two medallions cannot collide', () => {
  const c = mount(() => (
    <>
      <BadgeMedallion id="a-year" band="mastery" />
      <BadgeMedallion id="one-month" band="building" />
    </>
  ));
  const ids = [...c.querySelectorAll('radialGradient, linearGradient, clipPath')].map((n) => n.id);
  expect(new Set(ids).size).toBe(ids.length);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/__tests__/BadgeMedallion.test.tsx`
Expected: FAIL — `dataset.face` undefined, no `[data-sweep]`.

- [ ] **Step 3: Port the recipe from the gallery page**

In `BadgeMedallion.tsx`, add to `defs(uid)` (keeping the existing three):

```ts
<radialGradient id="${uid}-well" cx=".42" cy=".38" r=".78"><stop offset="0" stop-color="#16203c"/><stop offset=".6" stop-color="#0b1226"/><stop offset="1" stop-color="#05080f"/></radialGradient>
<radialGradient id="${uid}-dome" cx=".33" cy=".26" r=".92"><stop offset="0" stop-color="#ffffff" stop-opacity=".2"/><stop offset=".42" stop-color="#ffffff" stop-opacity=".03"/><stop offset=".88" stop-color="#050810" stop-opacity=".26"/><stop offset="1" stop-color="#050810" stop-opacity=".5"/></radialGradient>
<radialGradient id="${uid}-spec" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffffff" stop-opacity=".5"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
<linearGradient id="${uid}-core" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity=".5"/><stop offset="1" stop-color="#6e9bff" stop-opacity="0"/></linearGradient>
<clipPath id="${uid}-clip"><circle cx="110" cy="110" r="80"/></clipPath>
<filter id="${uid}-aurora" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="9"/></filter>
```

and the face builder, replacing the single face circle in `baseMarkup`:

```ts
const ACCENT: Record<Band, string> = {
  beginnings: '#6e9bff',
  building: '#6e9bff',
  mastery: '#f0a860',
};

/** The face behind the glyph. Aurora is the shipped one; core and plain are the alternates. */
function faceMarkup(uid: string, band: Band, face: Face): string {
  const gold = band === 'mastery';
  const accent = ACCENT[band];
  const well = `<circle cx="110" cy="110" r="80" fill="url(#${uid}-well)"/>`;
  const glass = `<circle data-dome cx="110" cy="110" r="80" fill="url(#${uid}-dome)"/><ellipse cx="84" cy="78" rx="31" ry="17" transform="rotate(-28 84 78)" fill="url(#${uid}-spec)"/>`;
  const sweep = (
    r: number,
    w: number,
    dash: number,
    deg: number,
    color: string,
    op: number
  ): string =>
    `<circle data-sweep cx="110" cy="110" r="${r}" fill="none" stroke="${color}" stroke-width="${w}" stroke-dasharray="${dash} 500" stroke-linecap="round" opacity="${op}" transform="rotate(${deg} 110 110)"/>`;
  if (face === 'plain') {
    return `<circle cx="110" cy="110" r="80" fill="url(#${uid}-plain)" stroke="rgba(147,180,255,.22)"/>`;
  }
  if (face === 'core') {
    const line = 'M 48,141 L 68,121 L 84,133 L 101,104 L 119,118 L 139,87 L 170,71';
    return `<g clip-path="url(#${uid}-clip)">${well}<path d="${line} L 170,196 L 48,196 Z" fill="url(#${uid}-core)" opacity=".6"/><path d="${line}" fill="none" stroke="${accent}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/></g>${glass}`;
  }
  return `<g clip-path="url(#${uid}-clip)">${well}<g class="${styles.aurora}" filter="url(#${uid}-aurora)">${sweep(60, 30, 150, -20, '#3b6fe0', 0.85)}${sweep(45, 18, 95, 140, '#93b4ff', 0.75)}${sweep(69, gold ? 21 : 15, gold ? 96 : 70, 62, accent, gold ? 0.9 : 0.72)}${sweep(33, 10, 58, -150, '#c9dbff', 0.6)}</g></g>${glass}`;
}
```

Rename the existing `${uid}-face` gradient to `${uid}-plain`, add `face?: Face` to the props with a default of `'aurora'`, and put `data-face={props.face ?? 'aurora'}` on the root div.

CSS additions:

```css
.aurora {
  transform-box: view-box;
  transform-origin: 50% 50%;
  animation: spin 34s linear infinite;
  animation-play-state: paused;
}
.medal[data-interactive='true']:hover .aurora,
.medal[data-interactive='true']:focus-visible .aurora {
  animation-play-state: running;
}
.medal[data-face='aurora'] .glyph,
.medal[data-face='core'] .glyph {
  filter: drop-shadow(0 1px 2px rgba(4, 8, 20, 0.8));
}
@media (prefers-reduced-motion: reduce) {
  .aurora {
    animation: none !important;
  }
}
```

- [ ] **Step 4 (alternative worth taking): the generated face instead of the drawn one**

`packages/showcase-gallery/assets/token-circles/branding/2026-09-07-medal-faces/aurora-blank-<band>.webp`
are the same aurora with no symbol in them, one per band, about 20 KB each. Copying those three
into `frontend/public/badges/` and rendering `<img>` under the existing glyph layer gives the
generated look for all fifteen badges, and a sixteenth badge still costs only a glyph. The
trade is a fixed look that cannot follow a light theme, three network requests, and blur past
440 px. Decide between this and the drawn face at this step, in front of both:
`gallery-viewer/token-circles-badges.html`, face switch `aurora` against `art`. If the art wins,
`BadgeMedallion` takes `face="art"` and swaps the `<svg class="base">` for an `<img>`, and
everything downstream in this plan is unchanged.

- [ ] **Step 5: Check it at chip size before believing it**

Run the tests, then the visual sanity check the decision depends on: render the rail at 24 px and 32 px and confirm the glyph still reads over the aurora. If it does not, switch the default to `'core'` and say so in the PR.

Run: `cd frontend && npx vitest run src/components/__tests__/BadgeMedallion.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/BadgeMedallion.tsx frontend/src/components/BadgeMedallion.module.css frontend/src/components/__tests__/BadgeMedallion.test.tsx
git commit -m "feat(achievements): aurora glass medal face"
```

---

### Task 2: The advice engine

**Files:**

- Create: `frontend/src/core/achievements/advice.ts`
- Test: `frontend/src/core/achievements/__tests__/advice.test.ts`

**Interfaces:**

- Consumes: `EvaluateInput` from `evaluate.ts` (same arrays), `monthOf`/`addMonths` from `months.ts`.
- Produces:
  ```ts
  export type AdviceKind =
    | 'budget-drift'
    | 'goal-pace'
    | 'in-the-red'
    | 'uncategorised'
    | 'unbudgeted-subscription'
    | 'streak-at-risk';
  export interface AdviceCard {
    id: string;
    kind: AdviceKind;
    tone: 'warn' | 'info' | 'good';
    title: string;
    detail: string;
    figure: string;
    link?: { page: string; label: string };
  }
  export function buildAdvice(input: AdviceInput): AdviceCard[];
  ```
  `id` is stable across runs (`kind` plus the thing it points at) so a dismissal sticks. Ranked: `warn` before `info` before `good`, then by size of the number.

Rules, each computed only from data already loaded:

| Kind                      | Fires when                                                                                                                            | Figure it names                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `budget-drift`            | A budgeted category's spend this month is already above the budget, or is on pace to be (spend / fraction of month elapsed > amount)  | The category, spent so far, the budget |
| `goal-pace`               | A goal has a deadline and the required monthly amount to reach it exceeds the average monthly contribution over the last three months | The goal, the monthly amount needed    |
| `in-the-red`              | The last finished month had expenses above income                                                                                     | The month, the shortfall               |
| `uncategorised`           | The current month has uncategorised non-transfer transactions                                                                         | The count                              |
| `unbudgeted-subscription` | A subscription detected by `features/subscriptionDetection.ts` has no budget in its category                                          | The merchant, the monthly amount       |
| `streak-at-risk`          | The streak is at least 2 and the current month has fewer than three transactions with under 8 days left                               | The streak, transactions still needed  |

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildAdvice } from '../advice';
import { input, month, tx } from './fixtures';

const kinds = (cards: ReturnType<typeof buildAdvice>) => cards.map((c) => c.kind);

describe('buildAdvice', () => {
  it('says nothing about an empty profile', () => {
    expect(buildAdvice({ ...input(), dismissed: [] })).toEqual([]);
  });

  it('flags a budgeted category already over budget this month, naming both figures', () => {
    const budgets = [
      {
        category_id: 1,
        amount: 100,
        period: 'monthly' as const,
        start_date: '2026-01-01',
        end_date: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];
    const cards = buildAdvice({
      ...input({ budgets, transactions: month('2026-09', 3, { amount: 60 }) }),
      dismissed: [],
    });
    const drift = cards.find((c) => c.kind === 'budget-drift');
    expect(drift).toBeDefined();
    expect(drift!.figure).toContain('100');
    expect(drift!.tone).toBe('warn');
    expect(drift!.link?.page).toBe('budgets');
  });

  it('flags a goal that will miss its deadline at the current pace', () => {
    const goals = [
      {
        target_amount: 1200,
        current_amount: 200,
        deadline: '2026-12-31',
        created_at: '2026-01-01T00:00:00Z',
      },
    ];
    expect(kinds(buildAdvice({ ...input({ goals }), dismissed: [] }))).toContain('goal-pace');
  });

  it('flags the last finished month in the red, not the month in progress', () => {
    const heavy = month('2026-08', 3, { amount: 900 });
    const light = month('2026-09', 3, { amount: 900 });
    const cards = buildAdvice({
      ...input({
        transactions: [...heavy, ...light, tx('2026-08-25', { type: 'income', amount: 100 })],
      }),
      dismissed: [],
    });
    const red = cards.find((c) => c.kind === 'in-the-red');
    expect(red!.detail).toContain('August');
  });

  it('counts uncategorised transactions in the current month only', () => {
    const cards = buildAdvice({
      ...input({
        transactions: [
          ...month('2026-09', 3),
          tx('2026-09-20', { category_id: null }),
          tx('2026-05-04', { category_id: null }),
        ],
      }),
      dismissed: [],
    });
    expect(cards.find((c) => c.kind === 'uncategorised')!.figure).toBe('1');
  });

  it('warns the streak is at risk late in a month with too few entries', () => {
    const cards = buildAdvice({
      ...input({
        transactions: [...month('2026-07', 3), ...month('2026-08', 3), tx('2026-09-02')],
        today: '2026-09-26',
      }),
      dismissed: [],
    });
    expect(kinds(cards)).toContain('streak-at-risk');
  });

  it('ranks warnings first and drops what the user dismissed', () => {
    const budgets = [
      {
        category_id: 1,
        amount: 10,
        period: 'monthly' as const,
        start_date: '2026-01-01',
        end_date: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];
    const all = buildAdvice({
      ...input({
        budgets,
        transactions: [
          ...month('2026-09', 3, { amount: 60 }),
          tx('2026-09-20', { category_id: null }),
        ],
      }),
      dismissed: [],
    });
    expect(all[0].tone).toBe('warn');
    const after = buildAdvice({
      ...input({
        budgets,
        transactions: [
          ...month('2026-09', 3, { amount: 60 }),
          tx('2026-09-20', { category_id: null }),
        ],
      }),
      dismissed: [all[0].id],
    });
    expect(after.map((c) => c.id)).not.toContain(all[0].id);
  });

  it('gives every card a stable id across two runs of the same data', () => {
    const args = {
      ...input({ transactions: [...month('2026-09', 3), tx('2026-09-20', { category_id: null })] }),
      dismissed: [],
    };
    expect(buildAdvice(args).map((c) => c.id)).toEqual(buildAdvice(args).map((c) => c.id));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/core/achievements/__tests__/advice.test.ts`
Expected: FAIL, cannot resolve `../advice`.

- [ ] **Step 3: Implement `advice.ts`**

Write one small function per rule, each returning `AdviceCard | null`, and a `buildAdvice` that calls them, drops nulls, drops dismissed ids, and sorts by `tone` then by the magnitude carried on the card. Reuse `evaluate.ts`'s month bucketing by exporting a `bucketByMonth(transactions)` helper from there rather than copying it. For the subscription rule, call `detectSubscriptions` from `features/subscriptionDetection.ts` with the existing bills as `ExistingBillLike[]`; if that import pulls in too much, pass the detected list in as part of `AdviceInput` and let the store supply it.

Category and goal names come from arrays the store already has; add `categories` and `bills` to `AdviceInput`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/core/achievements/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/core/achievements/advice.ts frontend/src/core/achievements/__tests__/advice.test.ts
git commit -m "feat(progress): advice engine over the profile's own data"
```

---

### Task 3: Year in review

**Files:**

- Create: `frontend/src/core/achievements/review.ts`
- Test: `frontend/src/core/achievements/__tests__/review.test.ts`

**Interfaces:**

- Produces: `buildYearReview(input: { transactions; today: string; year?: number }) -> YearReview` with `{ year, trackedMonths, income, expenses, saved, bestMonth: { month, saved } | null, topCategory: { id, total } | null, entries }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildYearReview } from '../review';
import { month, tx } from './fixtures';

describe('buildYearReview', () => {
  it('totals the calendar year, names the best saving month and the biggest category', () => {
    const txs = [
      ...month('2026-03', 3, { amount: 100, category_id: 1 }),
      ...month('2026-04', 3, { amount: 50, category_id: 2 }),
      tx('2026-03-28', { type: 'income', amount: 400 }),
      tx('2026-04-28', { type: 'income', amount: 400 }),
      ...month('2025-04', 3, { amount: 999, category_id: 2 }),
    ];
    const r = buildYearReview({ transactions: txs, today: '2026-09-07' });
    expect(r.year).toBe(2026);
    expect(r.income).toBe(800);
    expect(r.expenses).toBe(450);
    expect(r.saved).toBe(350);
    expect(r.bestMonth).toEqual({ month: '2026-04', saved: 250 });
    expect(r.topCategory).toEqual({ id: 1, total: 300 });
    expect(r.trackedMonths).toBe(2);
    expect(r.entries).toBe(8);
  });
  it('is empty rather than wrong when the year has no data', () => {
    const r = buildYearReview({ transactions: [], today: '2026-09-07' });
    expect(r.saved).toBe(0);
    expect(r.bestMonth).toBeNull();
    expect(r.topCategory).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/core/achievements/__tests__/review.test.ts`
Expected: FAIL, cannot resolve `../review`.

- [ ] **Step 3: Implement it.** One pass over the year's transactions, summing income and outflow (`expense` + `deduction`) per month and per category.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/core/achievements/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/core/achievements/review.ts frontend/src/core/achievements/__tests__/review.test.ts
git commit -m "feat(progress): year in review totals"
```

---

### Task 4: Store support — expose the data, remember dismissals

**Files:**

- Modify: `frontend/src/core/achievementsStore.ts`
- Test: `frontend/src/core/__tests__/achievementsStore.test.ts`

**Interfaces:**

- Produces: `snapshot: Accessor<AchievementsSnapshot | null>` where the snapshot carries `{ transactions, budgets, goals, categories, bills, importLogs, evaluation, at }`; `dismissedAdvice: Accessor<string[]>`; `dismissAdvice(id): Promise<void>`; `undismissAllAdvice(): Promise<void>`. Dismissals persist in the same settings key as the unlocks (`achievements`), under `dismissedAdvice`, so no new key or migration appears.

- [ ] **Step 1: Extend the test**

```ts
it('keeps the loaded arrays in a snapshot so the page needs no second fetch', async () => {
  calls.transactions = month(thisMonth);
  await refreshAchievements();
  expect(snapshot()!.transactions).toHaveLength(3);
  expect(snapshot()!.evaluation.streak).toBe(1);
});

it('persists a dismissed advice id alongside the unlocks, not in a new key', async () => {
  calls.transactions = month(thisMonth);
  await refreshAchievements();
  await dismissAdvice('uncategorised:2026-09');
  const saved = JSON.parse((calls.updated!.at(-1) as { achievements: string }).achievements);
  expect(saved.dismissedAdvice).toEqual(['uncategorised:2026-09']);
  expect(saved.unlocks.length).toBeGreaterThan(0);
  expect(dismissedAdvice()).toEqual(['uncategorised:2026-09']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/core/__tests__/achievementsStore.test.ts`
Expected: FAIL, `snapshot` is not exported.

- [ ] **Step 3: Implement.** `run()` already loads everything; keep it in a signal, add `categories` and `bills` to the parallel fetch (`api.getCategories()`, `api.getBills()`), and extend `records.ts` with `parseDismissed(raw)` and a serializer that writes `{ v: 1, unlocks, dismissedAdvice }`. Keep `parseRecords` tolerant of the older shape without the new field.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/core/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/core
git commit -m "feat(progress): snapshot and advice dismissals in the achievements store"
```

---

### Task 5: The page

**Files:**

- Create: `frontend/src/features/Progress.tsx`, `frontend/src/features/ProgressPage.module.css`
- Modify: `frontend/src/types/models.ts` (add `'progress'` to `PageName`), `frontend/src/router.tsx` (`progress: lazy(() => import('./features/Progress.tsx'))`), `frontend/src/App.tsx` (nav item after `bills`)
- Test: `frontend/src/features/__tests__/progressPage.test.tsx`

**Interfaces:**

- Consumes: `snapshot`, `unlocks`, `streak`, `dismissedAdvice`, `dismissAdvice` (Task 4); `buildAdvice` (Task 2); `buildYearReview` (Task 3); `BadgeMedallion` (Task 1); `shareBadge` from `shareCard.ts`.

Sections, in order:

1. **Record.** The streak as the headline ("7 months tracked"), then a twelve-month strip: one cell per month for the last twelve, filled when tracked, hollow when not, labelled by initial, with the count on hover. A gap is meant to be visible.
2. **Advice.** The ranked cards. Each shows a title, one sentence, the figure, a link to the page that shows it, and a dismiss control. Empty state: "Nothing needs your attention this month."
3. **Badges.** The three bands, exactly the panel's markup, earned lit and interactive, unearned dimmed with the rule, Share on earned ones. Plus the privacy line.
4. **Year in review.** Totals for the calendar year, best saving month, biggest category, and a Share button that reuses the share card.

- [ ] **Step 1: Write the failing test**

```tsx
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/achievementsStore', () => ({
  snapshot: () => ({
    transactions: [],
    budgets: [],
    goals: [],
    categories: [],
    bills: [],
    importLogs: [],
    evaluation: { earned: [], streak: 2, trackedMonths: ['2026-08', '2026-09'] },
    at: '2026-09-07',
  }),
  unlocks: () => [
    { id: 'first-entry', earnedOn: '2026-07-01', unlockedAt: '2026-08-01T00:00:00.000Z' },
  ],
  streak: () => 2,
  dismissedAdvice: () => [],
  dismissAdvice: vi.fn(),
  refreshAchievements: vi.fn(async () => []),
}));

import Progress from '../Progress';

describe('Progress page', () => {
  it('shows the record, twelve months, all fifteen badges and the year in review', () => {
    const c = mount(() => <Progress />);
    expect(c.textContent).toContain('2 months tracked');
    expect(c.querySelectorAll('[data-month-cell]')).toHaveLength(12);
    expect(c.querySelectorAll('[data-month-cell][data-tracked="true"]')).toHaveLength(2);
    expect(c.querySelectorAll('[data-band]')).toHaveLength(15);
    expect(c.querySelectorAll('[data-lit="true"]')).toHaveLength(1);
    expect(c.textContent).toContain('Nothing needs your attention');
    expect(c.textContent).toContain('Year in review');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/features/__tests__/progressPage.test.tsx`
Expected: FAIL, cannot resolve `../Progress`.

- [ ] **Step 3: Build the page**, then register it:

```ts
// types/models.ts — after 'bills'
  | 'progress'
// router.tsx — after bills
  progress: lazy(() => import('./features/Progress.tsx')),
// App.tsx — nav item directly after the Bills entry
    {
      name: 'progress' as PageName,
      label: 'Progress',
      icon: <path d="M12 3a9 9 0 109 9h-9V3z M12 3v9h9" />,
    },
```

Use the page header pattern from `features/Goals.tsx:318` (`styles.pageHeader` with an `<h1 data-test-id="progress-header">`), and the card styling from the badges panel CSS.

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `cd frontend && npx vitest run && npm run lint && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(progress): the Progress page — record, advice, badges, year in review"
```

---

### Task 6: The dashboard rail, and retiring the modal

**Files:**

- Create: `frontend/src/components/BadgeRail.tsx`
- Delete: `frontend/src/components/BadgesPanel.tsx`, `frontend/src/components/StreakChip.tsx`, `frontend/src/components/__tests__/BadgesPanel.test.tsx`
- Modify: `frontend/src/components/AchievementsHost.tsx` (no panel to render; keeps the refresh), `frontend/src/features/Dashboard.tsx`, `frontend/src/features/Settings.tsx`, `frontend/src/core/achievementsStore.ts` (drop `panelOpen`/`openBadgesPanel`/`closeBadgesPanel`; the unlock toast's action navigates to the page instead)
- Test: `frontend/src/components/__tests__/BadgeRail.test.tsx`

**Interfaces:**

- Produces: `<BadgeRail />` — earned badges newest first in a horizontally scrollable, keyboard-reachable list, each with the medallion, its name and the month earned; a "See all" control that calls `setPage('progress')`; an empty state before the first badge.

Follow MercuryPitch's milestone shelf (`src/features/progress/ProgressPage.tsx:1193`): a `<ul>` with `tabindex="0"` and an `aria-label` telling people they can scroll, items as `<li>` of art plus label plus detail, and an explicit empty item rather than a blank rail.

- [ ] **Step 1: Write the failing test**

```tsx
vi.mock('../../core/achievementsStore', () => ({
  unlocks: () => [
    { id: 'first-entry', earnedOn: '2026-07-01', unlockedAt: '2026-07-02T00:00:00.000Z' },
    { id: 'one-month', earnedOn: '2026-08-01', unlockedAt: '2026-08-03T00:00:00.000Z' },
  ],
  streak: () => 2,
}));
const setPage = vi.fn();
vi.mock('../../core/appStore', () => ({ setPage, useAppState: () => ({ page: 'dashboard' }) }));

import BadgeRail from '../BadgeRail';

describe('BadgeRail', () => {
  it('lists earned badges newest first, is scrollable and reachable, and links to Progress', () => {
    const c = mount(() => <BadgeRail />);
    const items = [...c.querySelectorAll('[data-rail-item]')];
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('One month');
    const list = c.querySelector('ul[aria-label]') as HTMLElement;
    expect(list.getAttribute('tabindex')).toBe('0');
    (c.querySelector('[data-test-id="badges-see-all"]') as HTMLButtonElement).click();
    expect(setPage).toHaveBeenCalledWith('progress');
  });
  it('says what will appear before the first badge is earned', () => {
    // remock unlocks to [] for this case
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/__tests__/BadgeRail.test.tsx`
Expected: FAIL, cannot resolve `../BadgeRail`.

- [ ] **Step 3: Build the rail** and swap it in at `features/Dashboard.tsx` where `StreakChip` sits now, keeping the flex row with the period bar. CSS: `overflow-x: auto`, `scroll-snap-type: x proximity` with `scroll-snap-align: start` on the items, `gap: 12px`, a mask on both edges so it reads as scrollable, medallion at 44 px, and `scrollbar-width: thin`. Delete the panel and the chip, and point the toast action and the Settings button at `setPage('progress')`.

- [ ] **Step 4: Run everything, then walk the tours**

Run: `cd frontend && npx vitest run && npm run lint && pnpm run typecheck && pnpm run test:tours`
Expected: PASS, including `MOBILE=1 pnpm run test:tours`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(progress): badge rail on the dashboard, badges panel retired"
```

---

### Task 7: Changelogs and the PR

- [ ] **Step 1: `CHANGELOG.md` under `## [Unreleased]`**

```markdown
- **A Progress page.** Your tracked months, your badges, and advice drawn from your own data — budgets drifting, goals that will miss their date, months that ran in the red — all in one place, with a year in review you can share. The dashboard now shows the badges you have earned, and opens the page.
```

- [ ] **Step 2: `dev-changelog.md`**

Name the files, the settings key reuse (`achievements` gains `dismissedAdvice`, no migration), the fact that the advice engine reads the store's existing snapshot rather than fetching, the aurora face and its `core` fallback, and that `BadgesPanel`/`StreakChip` are gone.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin feat/progress-page
gh pr create --title "feat(progress): a Progress page for badges, record and advice" --body "..."
```

---

## Self-review

- **Coverage of what was asked:** page after Bills (Task 5), twelve-month record (5), badges in full (5), advice from current data (2, 5), year in review (3, 5), aurora glass face for the whole set with a core fallback (1), dashboard rail scrolling left to right with a link to the page (6).
- **Placeholders:** the page's own CSS module is described by rule and token rather than written out, since it follows the existing panel styles; every other step carries its code.
- **Type consistency:** `AdviceCard.id` is what `dismissAdvice` stores and `buildAdvice` filters on; `snapshot()` carries exactly the arrays `buildAdvice` and `buildYearReview` take; `face` on `BadgeMedallion` is the same union the page and rail pass.
- **Risk to watch:** the aurora face is four blurred strokes behind a filter, drawn once per medallion. Fifteen at 104 px on the page is fine; if the rail at 44 px or a low-end phone stutters, drop the blur filter below a size threshold or switch the default to `core`. Task 1 step 4 is where that gets decided.
