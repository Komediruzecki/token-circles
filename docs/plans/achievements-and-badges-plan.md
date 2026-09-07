# Achievements and Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fifteen per-profile badges in three bands, computed from the profile's own data, never revoked, shown on the dashboard as a streak chip, in a badges panel, in an unlock toast, and on a shareable card.

**Architecture:** One pure evaluator (`evaluateAchievements`) over the profile's transactions, budgets, goals and import logs decides what is earned and in which month. A small store runs it on load and after mutations, diffs against the unlock records persisted in the profile's settings (key `achievements`, JSON; both storage modes and backups already carry settings), persists the new ones and toasts. UI is one SVG medallion recipe (rings per band + one glyph) reused by the chip, the panel, the toast and the share card.

**Tech Stack:** Solid.js + TypeScript (frontend), vitest + jsdom + fake-indexeddb (frontend tests), CSS modules, existing `api` client and `addToast`. No worker change: settings routes already exist in both modes.

**Spec:** `docs/plans/achievements-and-badges.md` (decisions of 2026-09-07 recorded there). Visual recipe: disjoint-colliders `packages/showcase-gallery/gallery-viewer/token-circles-badges.html`.

## Global Constraints

- Per profile, never per user. A tracked month = **three or more** transactions dated inside it. Unlocks are **never revoked**. Backfill dates a badge to the **first day of the month its rule was met**.
- No emojis anywhere; icons are SVG components. No raster art in the app.
- Nothing computes off-device; nothing leaves the device unless the user taps Share.
- `CHANGELOG.md`: one or two user-facing sentences, top-level bullet, under `## [Unreleased]`. `dev-changelog.md`: the mechanism, files, and the settings-not-table decision.
- Commits: no co-author trailers. Frontend tests: `cd frontend && npx vitest run <path>`. Lint before a PR: `cd frontend && npm run lint` and `npx tsc --noEmit -p .`.
- Deviation from the spec, on purpose: unlock records live in profile settings, not a `profile_achievements` table. Fifteen rows do not justify a migration, a route, and four backup sites; settings are per profile, synced, and in every backup already.

---

## File structure

| File                                                         | Responsibility                                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `frontend/src/core/achievements/definitions.ts`              | The fifteen definitions, bands, threshold, share copy. Data only.                                  |
| `frontend/src/core/achievements/months.ts`                   | Month arithmetic: `monthOf`, `addMonths`, `runs`, `monthReaching`, `currentStreak`. Pure.          |
| `frontend/src/core/achievements/evaluate.ts`                 | `evaluateAchievements(input) -> Evaluation`. Pure, deterministic, injected `today`.                |
| `frontend/src/core/achievements/records.ts`                  | Unlock record shape, settings (de)serialisation, `diffUnlocks`. Pure.                              |
| `frontend/src/core/achievements/__tests__/*.test.ts`         | Fixtures and tests for the four modules above.                                                     |
| `frontend/src/core/achievementsStore.ts`                     | Signals (`unlocks`, `streak`, panel open), `refreshAchievements()`, toasts, data-changed listener. |
| `frontend/src/core/api.ts`                                   | `getImportLogs()`; dispatch `tc:data-changed` after mutating requests.                             |
| `frontend/src/components/badgeGlyphs.ts`                     | Glyph markup per badge id (48-box), ported from the gallery page.                                  |
| `frontend/src/components/BadgeMedallion.tsx` + `.module.css` | The recipe: three SVG layers, tilt, orbs, lit/unlit.                                               |
| `frontend/src/components/StreakChip.tsx`                     | Dashboard chip; opens the panel.                                                                   |
| `frontend/src/components/BadgesPanel.tsx` + `.module.css`    | Modal with three bands, next-up hints, privacy line, Share.                                        |
| `frontend/src/core/achievements/shareCard.ts`                | 1200x630 SVG -> PNG blob; Web Share or download.                                                   |
| `frontend/src/components/AchievementsHost.tsx`               | Mounted in `App.tsx`; refreshes on profile change and data changes; renders the panel.             |
| `frontend/src/features/Dashboard.tsx`, `Settings.tsx`        | Chip next to the period bar; "Badges" in About.                                                    |
| `CHANGELOG.md`, `dev-changelog.md`                           | Entries.                                                                                           |

---

### Task 1: Definitions and month arithmetic

**Files:**

- Create: `frontend/src/core/achievements/definitions.ts`
- Create: `frontend/src/core/achievements/months.ts`
- Test: `frontend/src/core/achievements/__tests__/months.test.ts`

**Interfaces:**

- Produces: `AchievementId`, `Band`, `AchievementDef { id, band, name, rule, share }`, `ACHIEVEMENTS: readonly AchievementDef[]`, `BANDS`, `TRACKED_MONTH_MIN_TRANSACTIONS = 3`, `monthOf(date: string): string`, `addMonths(month: string, n: number): string`, `runs(months: Iterable<string>): { start: string; length: number }[]`, `monthReaching(months, n): string | null`, `currentStreak(months: Set<string>, nowMonth: string): number`.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/core/achievements/__tests__/months.test.ts
import { describe, expect, it } from 'vitest';
import { addMonths, currentStreak, monthOf, monthReaching, runs } from '../months';

describe('month arithmetic', () => {
  it('monthOf takes the YYYY-MM of an ISO date', () => {
    expect(monthOf('2026-09-07')).toBe('2026-09');
    expect(monthOf('2025-12-31T23:59:00Z')).toBe('2025-12');
  });
  it('addMonths crosses year boundaries both ways', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2025-11', 3)).toBe('2026-02');
    expect(addMonths('2026-09', 0)).toBe('2026-09');
  });
  it('runs groups consecutive months, unsorted and with duplicates', () => {
    expect(runs(['2026-03', '2026-01', '2026-02', '2026-02', '2026-06'])).toEqual([
      { start: '2026-01', length: 3 },
      { start: '2026-06', length: 1 },
    ]);
    expect(runs([])).toEqual([]);
  });
  it('monthReaching is the month a run first reaches n, earliest run wins', () => {
    const months = ['2024-01', '2024-02', '2024-03', '2025-01', '2025-02', '2025-03', '2025-04'];
    expect(monthReaching(months, 3)).toBe('2024-03');
    expect(monthReaching(months, 4)).toBe('2025-04');
    expect(monthReaching(months, 5)).toBeNull();
  });
  it('currentStreak counts back from this month, or last month when this one is not tracked yet', () => {
    const tracked = new Set(['2026-06', '2026-07', '2026-08']);
    expect(currentStreak(tracked, '2026-08')).toBe(3);
    expect(currentStreak(tracked, '2026-09')).toBe(3);
    expect(currentStreak(tracked, '2026-10')).toBe(0);
    expect(currentStreak(new Set(), '2026-09')).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/core/achievements/__tests__/months.test.ts`
Expected: FAIL, cannot resolve `../months`.

- [ ] **Step 3: Write the two modules**

```ts
// frontend/src/core/achievements/definitions.ts
/**
 * The fifteen badges, three bands. Data only: rules live in evaluate.ts, art in
 * components/badgeGlyphs.ts. `share` is the one line on the share card.
 */
export type Band = 'beginnings' | 'building' | 'mastery';

export type AchievementId =
  | 'first-entry'
  | 'first-import'
  | 'first-budget'
  | 'named-everything'
  | 'goal-in-sight'
  | 'one-month'
  | 'a-quarter'
  | 'saver-x3'
  | 'held-the-line'
  | 'goal-reached'
  | 'half-a-year'
  | 'a-year'
  | 'saver-x6'
  | 'two-years'
  | 'own-the-stack';

export interface AchievementDef {
  id: AchievementId;
  band: Band;
  name: string;
  /** How it is earned, as shown in the panel. */
  rule: string;
  /** First-person line for the share card. */
  share: string;
}

/** A month is tracked when it holds at least this many transactions dated inside it. */
export const TRACKED_MONTH_MIN_TRANSACTIONS = 3;

export const BANDS: Record<Band, { label: string; rings: number }> = {
  beginnings: { label: 'Beginnings', rings: 1 },
  building: { label: 'Building', rings: 2 },
  mastery: { label: 'Mastery', rings: 3 },
};

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'first-entry',
    band: 'beginnings',
    name: 'First entry',
    rule: 'One transaction.',
    share: 'Started tracking my money with Token Circles.',
  },
  {
    id: 'first-import',
    band: 'beginnings',
    name: 'First import',
    rule: 'One completed import.',
    share: 'Imported my first statement into Token Circles.',
  },
  {
    id: 'first-budget',
    band: 'beginnings',
    name: 'First budget',
    rule: 'One budget created.',
    share: 'Set my first budget in Token Circles.',
  },
  {
    id: 'named-everything',
    band: 'beginnings',
    name: 'Named everything',
    rule: 'A tracked month with nothing left uncategorised.',
    share: 'A whole month, every transaction categorised.',
  },
  {
    id: 'goal-in-sight',
    band: 'beginnings',
    name: 'A goal in sight',
    rule: 'One savings goal created.',
    share: 'Set a savings goal in Token Circles.',
  },
  {
    id: 'one-month',
    band: 'building',
    name: 'One month',
    rule: 'A tracked month: three or more transactions dated inside it.',
    share: 'Tracked my money for a month.',
  },
  {
    id: 'a-quarter',
    band: 'building',
    name: 'A quarter',
    rule: 'Three tracked months in a row.',
    share: 'Tracked my money for three months straight.',
  },
  {
    id: 'saver-x3',
    band: 'building',
    name: 'Saver x3',
    rule: 'Three consecutive months with income above spending.',
    share: 'Three months in a row in the black.',
  },
  {
    id: 'held-the-line',
    band: 'building',
    name: 'Held the line',
    rule: 'A full month with every budgeted category at or under budget.',
    share: 'A whole month with every budget held.',
  },
  {
    id: 'goal-reached',
    band: 'building',
    name: 'Goal reached',
    rule: 'One savings goal at 100%.',
    share: 'Reached a savings goal.',
  },
  {
    id: 'half-a-year',
    band: 'mastery',
    name: 'Half a year',
    rule: 'Six tracked months in a row.',
    share: 'Tracked my money for six months straight.',
  },
  {
    id: 'a-year',
    band: 'mastery',
    name: 'A year',
    rule: 'Twelve tracked months in a row.',
    share: 'Tracked my money for a year.',
  },
  {
    id: 'saver-x6',
    band: 'mastery',
    name: 'Saver x6',
    rule: 'Six consecutive months with income above spending.',
    share: 'Six months in a row in the black.',
  },
  {
    id: 'two-years',
    band: 'mastery',
    name: 'Two years',
    rule: 'Twenty-four tracked months in a row.',
    share: 'Tracked my money for two years.',
  },
  {
    id: 'own-the-stack',
    band: 'mastery',
    name: 'Own the stack',
    rule: 'Running against your own server, not ours.',
    share: 'Running Token Circles on my own stack.',
  },
];

export const achievementById = (id: AchievementId): AchievementDef =>
  ACHIEVEMENTS.find((a) => a.id === id) as AchievementDef;
```

```ts
// frontend/src/core/achievements/months.ts
/** Month arithmetic on 'YYYY-MM' strings. Pure; no Date parsing of the input beyond slicing. */

/** 'YYYY-MM' of an ISO date or datetime string. */
export const monthOf = (date: string): string => date.slice(0, 7);

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Consecutive runs of months, in order. Input may be unsorted and repeat months. */
export function runs(months: Iterable<string>): Array<{ start: string; length: number }> {
  const sorted = [...new Set(months)].sort();
  const out: Array<{ start: string; length: number }> = [];
  for (const m of sorted) {
    const last = out[out.length - 1];
    if (last && addMonths(last.start, last.length) === m) last.length++;
    else out.push({ start: m, length: 1 });
  }
  return out;
}

/** The month in which a run of consecutive months first reached `n`; null if none did. */
export function monthReaching(months: Iterable<string>, n: number): string | null {
  for (const run of runs(months)) if (run.length >= n) return addMonths(run.start, n - 1);
  return null;
}

/**
 * Consecutive months ending in `nowMonth`, or in the month before it when the current one is
 * not (yet) in the set: the current month is allowed to be in progress.
 */
export function currentStreak(months: Set<string>, nowMonth: string): number {
  let m = months.has(nowMonth) ? nowMonth : addMonths(nowMonth, -1);
  let n = 0;
  while (months.has(m)) {
    n++;
    m = addMonths(m, -1);
  }
  return n;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/core/achievements/__tests__/months.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/core/achievements
git commit -m "feat(achievements): badge definitions and month arithmetic"
```

---

### Task 2: The evaluator

**Files:**

- Create: `frontend/src/core/achievements/evaluate.ts`
- Create: `frontend/src/core/achievements/__tests__/fixtures.ts`
- Test: `frontend/src/core/achievements/__tests__/evaluate.test.ts`

**Interfaces:**

- Consumes: Task 1.
- Produces: `EvaluateInput`, `Earned { id: AchievementId; earnedOn: string }` (earnedOn is `YYYY-MM-01`), `Evaluation { earned: Earned[]; streak: number; trackedMonths: string[] }`, `evaluateAchievements(input: EvaluateInput): Evaluation`.

- [ ] **Step 1: Write the fixtures and the failing tests**

```ts
// frontend/src/core/achievements/__tests__/fixtures.ts
import type { EvaluateInput } from '../evaluate';

type Tx = EvaluateInput['transactions'][number];

let seq = 0;
export function tx(date: string, over: Partial<Tx> = {}): Tx {
  seq++;
  return { date, type: 'expense', amount: 10 + seq, category_id: 1, ...over };
}

/** `n` expenses spread over a month, categorised, day 3 onwards. */
export function month(m: string, n = 3, over: Partial<Tx> = {}): Tx[] {
  return Array.from({ length: n }, (_, i) => tx(`${m}-${String(3 + i).padStart(2, '0')}`, over));
}

/** `count` tracked months ending at `endMonth` (inclusive), each with `n` expenses. */
export function trackedRun(endMonth: string, count: number, n = 3): Tx[] {
  const [y, mo] = endMonth.split('-').map(Number);
  const out: Tx[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, mo - 1 - i, 1));
    out.push(...month(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, n));
  }
  return out;
}

export function input(over: Partial<EvaluateInput> = {}): EvaluateInput {
  return {
    transactions: [],
    budgets: [],
    goals: [],
    importLogs: [],
    selfHosted: false,
    today: '2026-09-07',
    ...over,
  };
}
```

```ts
// frontend/src/core/achievements/__tests__/evaluate.test.ts
import { describe, expect, it } from 'vitest';
import { evaluateAchievements } from '../evaluate';
import { input, month, trackedRun, tx } from './fixtures';

const ids = (r: ReturnType<typeof evaluateAchievements>) => r.earned.map((e) => e.id);
const on = (r: ReturnType<typeof evaluateAchievements>, id: string) =>
  r.earned.find((e) => e.id === id)?.earnedOn;

describe('evaluateAchievements', () => {
  it('earns nothing from nothing', () => {
    const r = evaluateAchievements(input());
    expect(r.earned).toEqual([]);
    expect(r.streak).toBe(0);
  });

  it('first entry is dated to the month of the earliest transaction', () => {
    const r = evaluateAchievements(input({ transactions: [tx('2026-08-20'), tx('2025-03-02')] }));
    expect(ids(r)).toEqual(['first-entry']);
    expect(on(r, 'first-entry')).toBe('2025-03-01');
  });

  it('a month needs three transactions to be tracked', () => {
    expect(ids(evaluateAchievements(input({ transactions: month('2026-09', 2) })))).toEqual([
      'first-entry',
    ]);
    const r = evaluateAchievements(input({ transactions: month('2026-09', 3) }));
    expect(ids(r)).toContain('one-month');
    expect(r.streak).toBe(1);
    expect(r.trackedMonths).toEqual(['2026-09']);
  });

  it('two years of history unlocks the whole ladder, each dated to the month reached', () => {
    const r = evaluateAchievements(input({ transactions: trackedRun('2026-08', 24) }));
    expect(ids(r)).toEqual(
      expect.arrayContaining(['one-month', 'a-quarter', 'half-a-year', 'a-year', 'two-years'])
    );
    expect(on(r, 'one-month')).toBe('2024-09-01');
    expect(on(r, 'a-quarter')).toBe('2024-11-01');
    expect(on(r, 'half-a-year')).toBe('2025-02-01');
    expect(on(r, 'a-year')).toBe('2025-08-01');
    expect(on(r, 'two-years')).toBe('2026-08-01');
    expect(r.streak).toBe(24);
  });

  it('a gap ends the streak but keeps what an earlier run earned', () => {
    const r = evaluateAchievements(
      input({ transactions: [...trackedRun('2025-06', 6), ...trackedRun('2026-08', 2)] })
    );
    expect(ids(r)).toContain('half-a-year');
    expect(ids(r)).not.toContain('a-year');
    expect(r.streak).toBe(2);
  });

  it('a profile that only imports still tracks months, and first import is dated to the log', () => {
    const r = evaluateAchievements(
      input({
        transactions: trackedRun('2026-08', 3),
        importLogs: [{ created_at: '2026-09-01T10:00:00Z' }],
      })
    );
    expect(ids(r)).toEqual(expect.arrayContaining(['first-import', 'a-quarter']));
    expect(on(r, 'first-import')).toBe('2026-09-01');
  });

  it('saver runs need income above spending in consecutive tracked months', () => {
    const saving = (m: string) => [
      ...month(m, 3, { type: 'expense', amount: 100 }),
      tx(`${m}-25`, { type: 'income', amount: 1000 }),
    ];
    const r = evaluateAchievements(
      input({ transactions: [...saving('2026-05'), ...saving('2026-06'), ...saving('2026-07')] })
    );
    expect(ids(r)).toContain('saver-x3');
    expect(on(r, 'saver-x3')).toBe('2026-07-01');
    expect(ids(r)).not.toContain('saver-x6');
    const broken = evaluateAchievements(
      input({
        transactions: [
          ...saving('2026-05'),
          ...month('2026-06', 3, { amount: 5000 }),
          ...saving('2026-07'),
        ],
      })
    );
    expect(ids(broken)).not.toContain('saver-x3');
  });

  it('named everything needs a tracked month with every non-transfer transaction categorised', () => {
    const r = evaluateAchievements(
      input({
        transactions: [
          ...month('2026-07', 3),
          tx('2026-07-20', { type: 'transfer', category_id: null }),
        ],
      })
    );
    expect(ids(r)).toContain('named-everything');
    const messy = evaluateAchievements(
      input({ transactions: [...month('2026-07', 3), tx('2026-07-21', { category_id: null })] })
    );
    expect(ids(messy)).not.toContain('named-everything');
  });

  it('held the line needs a finished month with a monthly budget in every spent category held', () => {
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
    const held = evaluateAchievements(
      input({ budgets, transactions: month('2026-07', 3, { amount: 20 }) })
    );
    expect(ids(held)).toContain('held-the-line');
    expect(on(held, 'held-the-line')).toBe('2026-07-01');
    expect(on(held, 'first-budget')).toBe('2026-01-01');
    const blown = evaluateAchievements(
      input({ budgets, transactions: month('2026-07', 3, { amount: 40 }) })
    );
    expect(ids(blown)).not.toContain('held-the-line');
    const current = evaluateAchievements(
      input({ budgets, transactions: month('2026-09', 3, { amount: 20 }) })
    );
    expect(ids(current)).not.toContain('held-the-line');
  });

  it('goals: created is dated to creation, reached to today', () => {
    const goals = [{ target_amount: 500, current_amount: 500, created_at: '2026-02-10T00:00:00Z' }];
    const r = evaluateAchievements(input({ goals }));
    expect(on(r, 'goal-in-sight')).toBe('2026-02-01');
    expect(on(r, 'goal-reached')).toBe('2026-09-01');
    expect(
      ids(evaluateAchievements(input({ goals: [{ ...goals[0], current_amount: 10 }] })))
    ).not.toContain('goal-reached');
  });

  it('own the stack follows the storage mode, dated today', () => {
    expect(on(evaluateAchievements(input({ selfHosted: true })), 'own-the-stack')).toBe(
      '2026-09-01'
    );
    expect(ids(evaluateAchievements(input({ selfHosted: false })))).not.toContain('own-the-stack');
  });

  it('returns earned in definition order and ignores unparseable dates', () => {
    const r = evaluateAchievements(
      input({ transactions: [tx('nonsense'), ...month('2026-09', 3)] })
    );
    expect(ids(r)).toEqual(['first-entry', 'one-month']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/core/achievements/__tests__/evaluate.test.ts`
Expected: FAIL, cannot resolve `../evaluate`.

- [ ] **Step 3: Write the evaluator**

```ts
// frontend/src/core/achievements/evaluate.ts
/**
 * The one place a badge is decided. Pure and deterministic: everything, including "today", is
 * an input, so a fixture profile always evaluates the same way. Runs over arrays the app already
 * holds; cost is one pass per array.
 */
import type { Budget, SavingsGoal, Transaction } from '../../types/models';
import { ACHIEVEMENTS, TRACKED_MONTH_MIN_TRANSACTIONS, type AchievementId } from './definitions';
import { addMonths, currentStreak, monthOf, monthReaching } from './months';

export interface EvaluateInput {
  transactions: Array<Pick<Transaction, 'date' | 'type' | 'amount' | 'category_id'>>;
  budgets: Array<
    Pick<Budget, 'category_id' | 'amount' | 'period' | 'start_date' | 'end_date' | 'created_at'>
  >;
  goals: Array<Pick<SavingsGoal, 'target_amount' | 'current_amount' | 'created_at'>>;
  importLogs: Array<{ created_at: string }>;
  /** Server mode against an origin that is not ours. */
  selfHosted: boolean;
  /** YYYY-MM-DD. Injected so evaluation is reproducible. */
  today: string;
}

export interface Earned {
  id: AchievementId;
  /** First day of the month the rule was met, YYYY-MM-01. */
  earnedOn: string;
}

export interface Evaluation {
  earned: Earned[];
  /** Live figure: consecutive tracked months ending this month or last. */
  streak: number;
  trackedMonths: string[];
}

const MONTH_RE = /^\d{4}-\d{2}/;
const firstDay = (month: string): string => `${month}-01`;
const earliestMonth = (dates: string[]): string | null => {
  const months = dates
    .filter((d) => MONTH_RE.test(d))
    .map(monthOf)
    .sort();
  return months[0] ?? null;
};

export function evaluateAchievements(input: EvaluateInput): Evaluation {
  const nowMonth = monthOf(input.today);
  const byMonth = new Map<string, EvaluateInput['transactions']>();
  for (const t of input.transactions) {
    if (!MONTH_RE.test(t.date)) continue;
    const m = monthOf(t.date);
    const list = byMonth.get(m);
    if (list) list.push(t);
    else byMonth.set(m, [t]);
  }
  const tracked = [...byMonth.entries()]
    .filter(([, list]) => list.length >= TRACKED_MONTH_MIN_TRANSACTIONS)
    .map(([m]) => m)
    .sort();
  const trackedSet = new Set(tracked);

  const sum = (list: EvaluateInput['transactions'], types: string[]) =>
    list.filter((t) => types.includes(t.type)).reduce((acc, t) => acc + Math.abs(t.amount), 0);
  const savingMonths = tracked.filter((m) => {
    const list = byMonth.get(m) ?? [];
    return sum(list, ['income']) > sum(list, ['expense', 'deduction']);
  });
  const namedMonths = tracked.filter((m) =>
    (byMonth.get(m) ?? []).every((t) => t.type === 'transfer' || t.category_id !== null)
  );
  const heldMonths = tracked.filter((m) => {
    if (m >= nowMonth) return false; // only finished months
    const start = firstDay(m);
    const end = `${m}-31`;
    const active = input.budgets.filter(
      (b) =>
        b.period === 'monthly' &&
        b.start_date <= end &&
        (b.end_date === null || b.end_date >= start)
    );
    if (active.length === 0) return false;
    const list = byMonth.get(m) ?? [];
    return active.every(
      (b) =>
        sum(
          list.filter((t) => t.category_id === b.category_id),
          ['expense']
        ) <= b.amount
    );
  });

  const when: Partial<Record<AchievementId, string | null>> = {
    'first-entry': earliestMonth(input.transactions.map((t) => t.date)),
    'first-import': earliestMonth(input.importLogs.map((l) => l.created_at)),
    'first-budget': earliestMonth(input.budgets.map((b) => b.created_at)),
    'named-everything': namedMonths[0] ?? null,
    'goal-in-sight': earliestMonth(input.goals.map((g) => g.created_at)),
    'one-month': monthReaching(tracked, 1),
    'a-quarter': monthReaching(tracked, 3),
    'saver-x3': monthReaching(savingMonths, 3),
    'held-the-line': heldMonths[0] ?? null,
    'goal-reached': input.goals.some(
      (g) => g.target_amount > 0 && g.current_amount >= g.target_amount
    )
      ? nowMonth
      : null,
    'half-a-year': monthReaching(tracked, 6),
    'a-year': monthReaching(tracked, 12),
    'saver-x6': monthReaching(savingMonths, 6),
    'two-years': monthReaching(tracked, 24),
    'own-the-stack': input.selfHosted ? nowMonth : null,
  };

  const earned: Earned[] = [];
  for (const def of ACHIEVEMENTS) {
    const month = when[def.id];
    if (month) earned.push({ id: def.id, earnedOn: firstDay(month) });
  }
  return { earned, streak: currentStreak(trackedSet, nowMonth), trackedMonths: tracked };
}

// Exported for the panel's "next up" copy: how far the live streak is from a target.
export const monthsTo = (streak: number, target: number): number => Math.max(0, target - streak);
export { addMonths };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/core/achievements/`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/core/achievements
git commit -m "feat(achievements): pure evaluator over the profile's data"
```

---

### Task 3: Unlock records in settings

**Files:**

- Create: `frontend/src/core/achievements/records.ts`
- Test: `frontend/src/core/achievements/__tests__/records.test.ts`

**Interfaces:**

- Consumes: `Earned` from Task 2, `AchievementId` from Task 1.
- Produces: `UnlockRecord { id; earnedOn; unlockedAt }`, `SETTINGS_KEY = 'achievements'`, `parseRecords(raw: unknown): UnlockRecord[]`, `serializeRecords(records): string`, `diffUnlocks(stored, earned, now: string): { newly: UnlockRecord[]; merged: UnlockRecord[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/core/achievements/__tests__/records.test.ts
import { describe, expect, it } from 'vitest';
import { diffUnlocks, parseRecords, serializeRecords } from '../records';

describe('unlock records', () => {
  it('round-trips through the settings string and drops junk', () => {
    const records = [
      { id: 'a-year' as const, earnedOn: '2025-08-01', unlockedAt: '2026-09-07T10:00:00.000Z' },
    ];
    expect(parseRecords(serializeRecords(records))).toEqual(records);
    expect(parseRecords(undefined)).toEqual([]);
    expect(parseRecords('not json')).toEqual([]);
    expect(
      parseRecords(JSON.stringify({ v: 1, unlocks: [{ id: 'nope', earnedOn: 'x' }, 42] }))
    ).toEqual([]);
  });
  it('diff keeps stored unlocks even when no longer earned, and adds new ones stamped now', () => {
    const stored = [
      { id: 'a-year' as const, earnedOn: '2025-08-01', unlockedAt: '2026-01-01T00:00:00.000Z' },
    ];
    const { newly, merged } = diffUnlocks(
      stored,
      [{ id: 'first-entry', earnedOn: '2024-09-01' }],
      '2026-09-07T12:00:00.000Z'
    );
    expect(newly).toEqual([
      { id: 'first-entry', earnedOn: '2024-09-01', unlockedAt: '2026-09-07T12:00:00.000Z' },
    ]);
    expect(merged.map((r) => r.id)).toEqual(['first-entry', 'a-year']);
  });
  it('diff is empty when everything earned is already stored', () => {
    const stored = [
      {
        id: 'first-entry' as const,
        earnedOn: '2024-09-01',
        unlockedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    expect(
      diffUnlocks(
        stored,
        [{ id: 'first-entry', earnedOn: '2024-09-01' }],
        '2026-09-07T12:00:00.000Z'
      ).newly
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/core/achievements/__tests__/records.test.ts`
Expected: FAIL, cannot resolve `../records`.

- [ ] **Step 3: Write the module**

```ts
// frontend/src/core/achievements/records.ts
/**
 * What persists: which badges this profile has unlocked, and when. Stored as one JSON string
 * under the profile's settings key `achievements` — per profile, in both storage modes, and in
 * every backup already. The evaluator decides what is earned; this record only adds, so a badge
 * survives the deletion of the data that earned it.
 */
import { ACHIEVEMENTS, type AchievementId } from './definitions';
import type { Earned } from './evaluate';

export const SETTINGS_KEY = 'achievements';

export interface UnlockRecord extends Earned {
  /** ISO datetime of the unlock (toast time). */
  unlockedAt: string;
}

const KNOWN = new Set<string>(ACHIEVEMENTS.map((a) => a.id));
const isRecord = (v: unknown): v is UnlockRecord =>
  typeof v === 'object' &&
  v !== null &&
  KNOWN.has((v as { id?: unknown }).id as string) &&
  typeof (v as { earnedOn?: unknown }).earnedOn === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test((v as { earnedOn: string }).earnedOn) &&
  typeof (v as { unlockedAt?: unknown }).unlockedAt === 'string';

export function parseRecords(raw: unknown): UnlockRecord[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw) as { unlocks?: unknown };
    const list = Array.isArray(parsed?.unlocks) ? parsed.unlocks : [];
    return list
      .filter(isRecord)
      .map((r) => ({ id: r.id, earnedOn: r.earnedOn, unlockedAt: r.unlockedAt }));
  } catch {
    return [];
  }
}

export const serializeRecords = (records: UnlockRecord[]): string =>
  JSON.stringify({ v: 1, unlocks: records });

/** Stored wins; earned-but-unstored becomes a new record stamped `now`. Definition order. */
export function diffUnlocks(
  stored: UnlockRecord[],
  earned: Earned[],
  now: string
): { newly: UnlockRecord[]; merged: UnlockRecord[] } {
  const have = new Map<AchievementId, UnlockRecord>(stored.map((r) => [r.id, r]));
  const newly: UnlockRecord[] = [];
  for (const e of earned) {
    if (have.has(e.id)) continue;
    const rec = { id: e.id, earnedOn: e.earnedOn, unlockedAt: now };
    have.set(e.id, rec);
    newly.push(rec);
  }
  const merged = ACHIEVEMENTS.map((a) => have.get(a.id)).filter(
    (r): r is UnlockRecord => r !== undefined
  );
  return { newly, merged };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/core/achievements/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/core/achievements
git commit -m "feat(achievements): unlock records in profile settings"
```

---

### Task 4: Store, data-changed signal, import logs on the client

**Files:**

- Create: `frontend/src/core/achievementsStore.ts`
- Modify: `frontend/src/core/api.ts` (add `getImportLogs()` next to `getSettings()`; dispatch `tc:data-changed` in `request()` after a successful non-GET response)
- Test: `frontend/src/core/__tests__/achievementsStore.test.ts`

**Interfaces:**

- Consumes: Tasks 1–3; `api.getTransactions()`, `api.getBudgets()`, `api.getGoals()`, `api.getSettings()`, `api.updateSettings()`; `addToast` from `toastStore.ts`; `getStorageMode()` from `storage/storageFactory.ts`.
- Produces: `unlocks: Accessor<UnlockRecord[]>`, `streak: Accessor<number>`, `panelOpen: Accessor<boolean>`, `openBadgesPanel()`, `closeBadgesPanel()`, `refreshAchievements(): Promise<UnlockRecord[]>` (resolves to the newly unlocked), `isSelfHosted(): boolean`, `DATA_CHANGED_EVENT = 'tc:data-changed'`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/core/__tests__/achievementsStore.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Record<string, unknown[]> = {};
vi.mock('../api', () => ({
  api: {
    getSettings: vi.fn(async () => ({ achievements: calls.stored?.[0] })),
    updateSettings: vi.fn(async (data: unknown) => {
      calls.updated = [data];
    }),
    getTransactions: vi.fn(async () => calls.transactions ?? []),
    getBudgets: vi.fn(async () => []),
    getGoals: vi.fn(async () => []),
    getImportLogs: vi.fn(async () => []),
  },
}));
const toasts: string[] = [];
vi.mock('../toastStore', () => ({ addToast: vi.fn((m: string) => toasts.push(m)) }));
vi.mock('../storage/storageFactory', () => ({ getStorageMode: () => 'serverless' }));

import { refreshAchievements, streak, unlocks } from '../achievementsStore';

const month = (m: string) =>
  [3, 4, 5].map((d) => ({ date: `${m}-0${d}`, type: 'expense', amount: 10, category_id: 1 }));

describe('achievementsStore.refreshAchievements', () => {
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k];
    toasts.length = 0;
  });

  it('first run on a history persists the backfill and toasts once as a summary', async () => {
    calls.transactions = [...month('2026-07'), ...month('2026-08'), ...month('2026-09')];
    const newly = await refreshAchievements();
    expect(newly.map((n) => n.id)).toEqual(['first-entry', 'one-month', 'a-quarter']);
    expect(unlocks().length).toBe(3);
    expect(streak()).toBeGreaterThanOrEqual(2);
    const saved = JSON.parse((calls.updated![0] as { achievements: string }).achievements) as {
      unlocks: unknown[];
    };
    expect(saved.unlocks).toHaveLength(3);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatch(/3 badges/);
  });

  it('a later single unlock toasts by name and does not re-persist what is stored', async () => {
    calls.stored = [
      JSON.stringify({
        v: 1,
        unlocks: [
          { id: 'first-entry', earnedOn: '2026-07-01', unlockedAt: '2026-08-01T00:00:00.000Z' },
        ],
      }),
    ];
    calls.transactions = month('2026-09');
    const newly = await refreshAchievements();
    expect(newly.map((n) => n.id)).toEqual(['one-month']);
    expect(toasts[0]).toMatch(/One month/);
  });

  it('nothing new means no write and no toast', async () => {
    calls.stored = [
      JSON.stringify({
        v: 1,
        unlocks: [
          { id: 'first-entry', earnedOn: '2026-09-01', unlockedAt: '2026-09-01T00:00:00.000Z' },
        ],
      }),
    ];
    calls.transactions = [{ date: '2026-09-03', type: 'expense', amount: 10, category_id: 1 }];
    expect(await refreshAchievements()).toEqual([]);
    expect(calls.updated).toBeUndefined();
    expect(toasts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/core/__tests__/achievementsStore.test.ts`
Expected: FAIL, cannot resolve `../achievementsStore`.

- [ ] **Step 3: Write the store and the two api.ts additions**

```ts
// frontend/src/core/achievementsStore.ts
/**
 * Runs the evaluator for the current profile and keeps the unlock records in sync with the
 * profile's settings. Refresh happens on profile change and, debounced, after any mutating
 * request (api.ts dispatches DATA_CHANGED_EVENT). Nothing here is server-side.
 */
import { createRoot, createSignal } from 'solid-js';
import { api } from './api';
import { achievementById } from './achievements/definitions';
import { evaluateAchievements } from './achievements/evaluate';
import {
  diffUnlocks,
  parseRecords,
  serializeRecords,
  SETTINGS_KEY,
  type UnlockRecord,
} from './achievements/records';
import { getStorageMode } from './storage/storageFactory';
import { addToast } from './toastStore';

export const DATA_CHANGED_EVENT = 'tc:data-changed';

const OUR_HOSTS = /(^|\.)tokencircles\.com$/i;

/** Server mode against an API origin that is not ours: the user runs the stack. */
export function isSelfHosted(): boolean {
  if (getStorageMode() !== 'self-hosted') return false;
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
  try {
    const host = new URL(
      base || '/',
      typeof window === 'undefined' ? 'http://localhost' : window.location.href
    ).hostname;
    return !OUR_HOSTS.test(host);
  } catch {
    return false;
  }
}

const state = createRoot(() => {
  const [unlocks, setUnlocks] = createSignal<UnlockRecord[]>([]);
  const [streak, setStreak] = createSignal(0);
  const [panelOpen, setPanelOpen] = createSignal(false);
  return { unlocks, setUnlocks, streak, setStreak, panelOpen, setPanelOpen };
});

export const unlocks = state.unlocks;
export const streak = state.streak;
export const panelOpen = state.panelOpen;
export const openBadgesPanel = (): void => state.setPanelOpen(true);
export const closeBadgesPanel = (): void => state.setPanelOpen(false);

const today = (): string => new Date().toISOString().slice(0, 10);

let inFlight: Promise<UnlockRecord[]> | null = null;

/** Evaluate, persist what is new, toast. Concurrent calls share one run. */
export function refreshAchievements(): Promise<UnlockRecord[]> {
  if (inFlight) return inFlight;
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<UnlockRecord[]> {
  const [settings, transactions, budgets, goals, importLogs] = await Promise.all([
    api.getSettings(),
    api.getTransactions(),
    api.getBudgets(),
    api.getGoals(),
    api.getImportLogs(),
  ]);
  const stored = parseRecords(settings[SETTINGS_KEY]);
  const evaluation = evaluateAchievements({
    transactions,
    budgets,
    goals,
    importLogs,
    selfHosted: isSelfHosted(),
    today: today(),
  });
  state.setStreak(evaluation.streak);
  const { newly, merged } = diffUnlocks(stored, evaluation.earned, new Date().toISOString());
  state.setUnlocks(merged);
  if (newly.length === 0) return [];
  await api.updateSettings({ [SETTINGS_KEY]: serializeRecords(merged) });
  announce(newly, stored.length === 0);
  return newly;
}

function announce(newly: UnlockRecord[], firstRun: boolean): void {
  const opts = {
    channel: 'achievements',
    durationMs: 9000,
    action: { label: 'See badges', onClick: openBadgesPanel },
  };
  if (firstRun && newly.length > 1) {
    addToast(`${newly.length} badges earned from your history so far.`, 'success', opts);
    return;
  }
  for (const rec of newly)
    addToast(`Badge unlocked: ${achievementById(rec.id).name}.`, 'success', opts);
}
```

In `frontend/src/core/api.ts`, next to `getSettings()`:

```ts
  /** Past imports, newest first (mirrors GET /api/import-logs). */
  async getImportLogs(): Promise<Array<{ id: number; created_at: string }>> {
    return this.request('/import-logs', z.array(z.object({ id: z.number(), created_at: z.string() }).passthrough()))
  }
```

In `ApiClient.request`, right after the response is known to be successful (where the parsed result is returned), before the `return`:

```ts
// Anything that wrote data may have earned a badge; achievementsStore listens. Settings
// writes are excluded so persisting an unlock does not trigger another evaluation.
if (method !== 'GET' && !endpoint.startsWith('/settings') && typeof window !== 'undefined') {
  window.dispatchEvent(new CustomEvent('tc:data-changed', { detail: { endpoint } }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/core/__tests__/achievementsStore.test.ts src/core/__tests__/api.getTransactions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/core/achievementsStore.ts frontend/src/core/api.ts frontend/src/core/__tests__/achievementsStore.test.ts
git commit -m "feat(achievements): store that evaluates, persists and toasts unlocks"
```

---

### Task 5: BadgeMedallion

**Files:**

- Create: `frontend/src/components/badgeGlyphs.ts`
- Create: `frontend/src/components/BadgeMedallion.tsx`
- Create: `frontend/src/components/BadgeMedallion.module.css`
- Test: `frontend/src/components/__tests__/BadgeMedallion.test.tsx`

**Interfaces:**

- Consumes: `AchievementId`, `Band`, `BANDS` from Task 1.
- Produces: `<BadgeMedallion id band size? lit? interactive? class? />` — `size` in px (default 48), `lit` default true (unlit renders desaturated), `interactive` default false (true adds pointer tilt and orbs). `BADGE_GLYPHS: Record<AchievementId, string>`; `medallionSvg(id, band, size): string` (one static SVG string, for the share card).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/__tests__/BadgeMedallion.test.tsx
import { render } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from '../../core/achievements/definitions';
import BadgeMedallion, { medallionSvg } from '../BadgeMedallion';
import { BADGE_GLYPHS } from '../badgeGlyphs';

describe('BadgeMedallion', () => {
  it('has a glyph for every badge', () => {
    for (const a of ACHIEVEMENTS) expect(BADGE_GLYPHS[a.id], a.id).toMatch(/<(path|circle|rect)/);
  });
  it('draws one, two or three rings by band and marks unlit', () => {
    const { container, unmount } = render(() => (
      <BadgeMedallion id="a-year" band="mastery" size={96} lit={false} />
    ));
    const el = container.querySelector('[data-band="mastery"]') as HTMLElement;
    expect(el.querySelectorAll('[data-ring]')).toHaveLength(3);
    expect(el.dataset.lit).toBe('false');
    expect(el.style.getPropertyValue('--size')).toBe('96px');
    unmount();
    const { container: c2 } = render(() => <BadgeMedallion id="first-entry" band="beginnings" />);
    expect(c2.querySelectorAll('[data-ring]')).toHaveLength(1);
  });
  it('renders a static SVG string for the share card with no raster', () => {
    const svg = medallionSvg('a-year', 'mastery', 400);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toMatch(/<image/);
    expect(svg).toContain('data-ring');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/__tests__/BadgeMedallion.test.tsx`
Expected: FAIL, cannot resolve `../BadgeMedallion`.

- [ ] **Step 3: Write the glyphs, the component, the CSS**

```ts
// frontend/src/components/badgeGlyphs.ts
/** Glyphs in a 48x48 box (centre 24,24), stroke 2.2 round, dots filled. One per badge. */
import type { AchievementId } from '../core/achievements/definitions';

const dots = (r: number, angles: number[], size = 2.2): string =>
  angles
    .map((a) => {
      const t = (a * Math.PI) / 180;
      return `<circle cx="${(24 + r * Math.cos(t)).toFixed(2)}" cy="${(24 + r * Math.sin(t)).toFixed(2)}" r="${size}" fill="currentColor" stroke="none"/>`;
    })
    .join('');

export const BADGE_GLYPHS: Record<AchievementId, string> = {
  'first-entry': '<path d="M24 12v24M12 24h24"/>',
  'first-import':
    '<path d="M10 28v8a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2v-8"/><path d="M24 8v20M16 20l8 8 8-8"/>',
  'first-budget':
    '<path d="M10.84 19.21A14 14 0 0 1 34.72 15"/><path d="M37.16 19.21A14 14 0 0 1 26.43 37.79"/><path d="M21.57 37.79A14 14 0 0 1 10 24"/><circle cx="24" cy="24" r="2.2" fill="currentColor" stroke="none"/>',
  'named-everything':
    '<path d="M12 10h12l14 14-12 12L12 22z"/><circle cx="18" cy="16" r="2.2" fill="currentColor" stroke="none"/>',
  'goal-in-sight': '<path d="M14 40V8"/><path d="M14 10h20l-5 6 5 6H14"/>',
  'one-month':
    '<rect x="10" y="12" width="28" height="26" rx="3"/><path d="M10 20h28M17 8v8M31 8v8"/>',
  'a-quarter': `<path d="M10.21 21.57A14 14 0 0 1 37.79 21.57"/>${dots(14, [210, 270, 330], 2.6)}`,
  'saver-x3':
    '<circle cx="24" cy="30" r="8"/><circle cx="24" cy="30" r="3.4"/><path d="M24 18V6M18 12l6-6 6 6"/>',
  'held-the-line':
    '<path d="M8 32h32"/><rect x="17" y="17" width="14" height="8" rx="4"/><circle cx="24" cy="21" r="1.7" fill="currentColor" stroke="none"/>',
  'goal-reached':
    '<path d="M8 38l10-16 6 9 5-7 11 14z"/><path d="M29 24V11"/><path d="M29 11h7l-2.5 3.5 2.5 3.5h-7"/>',
  'half-a-year': `<path d="M10 24A14 14 0 0 1 38 24"/>${dots(14, [195, 225, 255, 285, 315, 345])}`,
  'a-year': `<circle cx="24" cy="24" r="14" opacity=".35"/>${dots(14, [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330])}`,
  'saver-x6': [10, 15, 20, 25, 30, 35]
    .map((y) => `<rect x="13" y="${y}" width="22" height="4.4" rx="2.2"/>`)
    .join(''),
  'two-years': '<circle cx="18" cy="24" r="10"/><circle cx="30" cy="24" r="10"/>',
  'own-the-stack': `<rect x="10" y="9" width="28" height="9" rx="2"/><rect x="10" y="19.5" width="28" height="9" rx="2"/><rect x="10" y="30" width="28" height="9" rx="2"/>${['13.5', '24', '34.5'].map((y) => `<circle cx="15" cy="${y}" r="1.5" fill="currentColor" stroke="none"/>`).join('')}`,
};
```

```tsx
// frontend/src/components/BadgeMedallion.tsx
/**
 * The badge recipe: a glass face, the band's rings (one, two, three), one glyph. Three SVG
 * layers on one CSS perspective so an interactive medallion tilts with parallax and orbs take
 * the dashed orbit. Gradient ids are per instance so several medallions can share a page.
 */
import { createUniqueId, type JSX } from 'solid-js';
import type { AchievementId, Band } from '../core/achievements/definitions';
import { BANDS } from '../core/achievements/definitions';
import { BADGE_GLYPHS } from './badgeGlyphs';
import styles from './BadgeMedallion.module.css';

const RINGS: Record<Band, Array<{ r: number; w: number }>> = {
  beginnings: [{ r: 84, w: 2.2 }],
  building: [
    { r: 84, w: 2.2 },
    { r: 72, w: 1.6 },
  ],
  mastery: [
    { r: 84, w: 2.4 },
    { r: 73, w: 1.8 },
    { r: 63, w: 1.3 },
  ],
};
const ORB = { beginnings: '#93b4ff', building: '#93b4ff', mastery: '#f0a860' } as const;

const orbAt = (r: number, deg: number, size: number, color: string): string => {
  const t = (deg * Math.PI) / 180;
  return `<circle cx="${(110 + r * Math.cos(t)).toFixed(2)}" cy="${(110 + r * Math.sin(t)).toFixed(2)}" r="${size}" fill="${color}"/>`;
};

function defs(uid: string): string {
  return `<defs>
<linearGradient id="${uid}-azure" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#93b4ff"/><stop offset="1" stop-color="#3b6fe0"/></linearGradient>
<linearGradient id="${uid}-mastery" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#93b4ff"/><stop offset=".5" stop-color="#6e9bff"/><stop offset="1" stop-color="#f0a860"/></linearGradient>
<radialGradient id="${uid}-face" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="#ffffff" stop-opacity=".16"/><stop offset=".55" stop-color="#6e9bff" stop-opacity=".06"/><stop offset="1" stop-color="#6e9bff" stop-opacity=".02"/></radialGradient>
</defs>`;
}

function baseMarkup(uid: string, band: Band): string {
  const paint = `url(#${uid}-${band === 'mastery' ? 'mastery' : 'azure'})`;
  const rings = RINGS[band]
    .map(
      (r) =>
        `<circle data-ring cx="110" cy="110" r="${r.r}" fill="none" stroke="${paint}" stroke-width="${r.w}"/>`
    )
    .join('');
  return `${defs(uid)}<circle cx="110" cy="110" r="80" fill="url(#${uid}-face)" stroke="rgba(147,180,255,.22)"/><circle cx="110" cy="110" r="93" fill="none" stroke="${paint}" stroke-width="1.2" stroke-dasharray="1.6 4.4" opacity=".55"/>${rings}`;
}

const glyphMarkup = (id: AchievementId): string =>
  `<g transform="translate(110 110) scale(1.55) translate(-24 -24)" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${BADGE_GLYPHS[id]}</g>`;

/** One static SVG (base + glyph), for the share card and anywhere a string is needed. */
export function medallionSvg(id: AchievementId, band: Band, size: number, uid = 'm'): string {
  const color = band === 'mastery' ? '#f0a860' : '#e8edff';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220" width="${size}" height="${size}" color="${color}">${baseMarkup(uid, band)}${glyphMarkup(id)}</svg>`;
}

export interface BadgeMedallionProps {
  id: AchievementId;
  band: Band;
  /** Pixels. The chip uses 22, a toast 40, the panel 120, the share card 400. */
  size?: number;
  /** Unlit renders desaturated and dim. */
  lit?: boolean;
  /** Tilt to the pointer and run the orbs on hover/focus. */
  interactive?: boolean;
  class?: string;
  label?: string;
}

export default function BadgeMedallion(props: BadgeMedallionProps): JSX.Element {
  const uid = createUniqueId();
  const MAX = 16;
  let el!: HTMLDivElement;
  const onMove = (e: PointerEvent): void => {
    if (!props.interactive || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    el.style.setProperty('--ry', `${((x - 0.5) * 2 * MAX).toFixed(2)}deg`);
    el.style.setProperty('--rx', `${((0.5 - y) * 2 * MAX).toFixed(2)}deg`);
    el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
  };
  const onLeave = (): void => {
    for (const p of ['--rx', '--ry']) el.style.setProperty(p, '0deg');
    for (const p of ['--mx', '--my']) el.style.setProperty(p, '50%');
  };
  return (
    <div
      ref={el}
      class={`${styles.medal} ${props.class ?? ''}`}
      style={{ '--size': `${props.size ?? 48}px` }}
      data-band={props.band}
      data-lit={props.lit === false ? 'false' : 'true'}
      data-interactive={props.interactive ? 'true' : 'false'}
      role="img"
      aria-label={props.label ?? `${props.id} badge`}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      <svg
        class={styles.base}
        viewBox="0 0 220 220"
        aria-hidden="true"
        innerHTML={baseMarkup(uid, props.band)}
      />
      <svg
        class={styles.glyph}
        viewBox="0 0 220 220"
        aria-hidden="true"
        innerHTML={glyphMarkup(props.id)}
      />
      <svg
        class={styles.orbs}
        viewBox="0 0 220 220"
        aria-hidden="true"
        innerHTML={`<g class="${styles.orbit}">${[0, 120, 240].map((a) => orbAt(93, a, 3.2, ORB[props.band])).join('')}</g><g class="${styles.orbit} ${styles.ccw}">${[60, 240].map((a) => orbAt(104, a, 2, ORB[props.band])).join('')}</g>`}
      />
      <div class={styles.shine} />
    </div>
  );
}
```

```css
/* frontend/src/components/BadgeMedallion.module.css */
.medal {
  --size: 48px;
  position: relative;
  width: var(--size);
  height: var(--size);
  border-radius: 50%;
  transform-style: preserve-3d;
  transform: perspective(700px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
  transition: transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
  flex: none;
}
.medal > svg,
.medal > .shine {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.medal[data-lit='false'] {
  filter: grayscale(1);
  opacity: 0.38;
}
.base {
  transform: translateZ(0);
}
.glyph {
  transform: translateZ(30px);
  color: var(--text);
}
.medal[data-band='mastery'] .glyph {
  color: var(--accent-warm);
}
.orbs {
  transform: translateZ(46px);
  opacity: 0;
  transition: opacity 0.45s;
}
.orbit {
  transform-box: view-box;
  transform-origin: 50% 50%;
  animation: spin 7s linear infinite;
  animation-play-state: paused;
}
.ccw {
  animation: spin 11s linear infinite reverse;
  animation-play-state: paused;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.shine {
  border-radius: 50%;
  transform: translateZ(54px);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s;
  mix-blend-mode: screen;
  background: radial-gradient(
    circle at var(--mx, 50%) var(--my, 50%),
    rgba(255, 255, 255, 0.3),
    rgba(255, 255, 255, 0.07) 26%,
    transparent 54%
  );
}
.medal[data-interactive='true']:hover .orbs,
.medal[data-interactive='true']:focus-visible .orbs {
  opacity: 1;
}
.medal[data-interactive='true']:hover .orbit,
.medal[data-interactive='true']:focus-visible .orbit {
  animation-play-state: running;
}
.medal[data-interactive='true']:hover .shine,
.medal[data-interactive='true']:focus-visible .shine {
  opacity: 1;
}
.medal[data-interactive='true']:hover .base {
  filter: drop-shadow(0 0 16px rgba(110, 155, 255, 0.38));
}
.medal[data-band='mastery'][data-interactive='true']:hover .base {
  filter: drop-shadow(0 0 18px rgba(240, 168, 96, 0.42));
}
@media (prefers-reduced-motion: reduce) {
  .orbit {
    animation: none !important;
  }
  .medal,
  .orbs,
  .shine {
    transition: none !important;
  }
}
```

Check `frontend/src/__tests__/cssModuleNaming.test.ts` for the class-name convention before committing; rename classes if it demands a pattern.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/components/__tests__/BadgeMedallion.test.tsx src/__tests__/cssModuleNaming.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/badgeGlyphs.ts frontend/src/components/BadgeMedallion.tsx frontend/src/components/BadgeMedallion.module.css frontend/src/components/__tests__/BadgeMedallion.test.tsx
git commit -m "feat(achievements): BadgeMedallion, the SVG ring recipe"
```

---

### Task 6: Share card

**Files:**

- Create: `frontend/src/core/achievements/shareCard.ts`
- Test: `frontend/src/core/achievements/__tests__/shareCard.test.ts`

**Interfaces:**

- Consumes: `achievementById`, `BANDS` (Task 1); `medallionSvg` (Task 5).
- Produces: `shareCardSvg(id: AchievementId): string` (1200x630), `shareBadge(id): Promise<'shared' | 'downloaded'>`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/core/achievements/__tests__/shareCard.test.ts
import { describe, expect, it } from 'vitest';
import { shareCardSvg } from '../shareCard';

describe('shareCardSvg', () => {
  it('is a 1200x630 SVG carrying the badge name, the share line and the URL, no raster', () => {
    const svg = shareCardSvg('a-year');
    expect(svg).toMatch(/^<svg[^>]*width="1200"[^>]*height="630"/);
    expect(svg).toContain('A year');
    expect(svg).toContain('Tracked my money for a year.');
    expect(svg).toContain('tokencircles.com');
    expect(svg).not.toMatch(/<image/);
  });
  it('escapes markup in copy', () => {
    expect(shareCardSvg('saver-x3')).not.toContain('<3');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/core/achievements/__tests__/shareCard.test.ts`
Expected: FAIL, cannot resolve `../shareCard`.

- [ ] **Step 3: Write the module**

```ts
// frontend/src/core/achievements/shareCard.ts
/**
 * The marketing loop: a 1200x630 card rendered client-side from the medallion SVG. Web Share
 * with a file where the platform has it, a PNG download otherwise. Nothing is uploaded.
 */
import { medallionSvg } from '../../components/BadgeMedallion';
import { achievementById, BANDS, type AchievementId } from './definitions';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function shareCardSvg(id: AchievementId): string {
  const def = achievementById(id);
  const medal = medallionSvg(id, def.band, 400, 'share')
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="Georgia, 'Times New Roman', serif">
<defs>
<radialGradient id="bg-glow" cx="0.78" cy="0.5" r="0.6"><stop offset="0" stop-color="#3b6fe0" stop-opacity=".45"/><stop offset=".6" stop-color="#f0a860" stop-opacity=".12"/><stop offset="1" stop-color="#0a0e1c" stop-opacity="0"/></radialGradient>
</defs>
<rect width="1200" height="630" fill="#0a0e1c"/>
<rect width="1200" height="630" fill="url(#bg-glow)"/>
<g fill="none" stroke="#6e9bff" opacity=".35"><circle cx="900" cy="315" r="300" stroke-dasharray="2 8"/><circle cx="900" cy="315" r="360" stroke-width=".8"/></g>
<text x="84" y="150" font-family="ui-monospace, Menlo, monospace" font-size="18" letter-spacing="4" fill="#93b4ff">TOKEN CIRCLES · ${esc(BANDS[def.band].label.toUpperCase())}</text>
<text x="84" y="270" font-size="96" font-weight="600" fill="#e8edff" letter-spacing="-2">${esc(def.name)}</text>
<foreignObject x="84" y="300" width="520" height="160"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family: system-ui, sans-serif; font-size: 30px; line-height: 1.3; color: #c3ccf0;">${esc(def.share)}</div></foreignObject>
<text x="84" y="530" font-family="ui-monospace, Menlo, monospace" font-size="20" letter-spacing="1" fill="#93b4ff">tokencircles.com</text>
<svg x="700" y="115" width="400" height="400" viewBox="0 0 220 220" color="${def.band === 'mastery' ? '#f0a860' : '#e8edff'}">${medal}</svg>
</svg>`;
}

async function toPng(svg: string): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('share card did not render'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function shareBadge(id: AchievementId): Promise<'shared' | 'downloaded'> {
  const def = achievementById(id);
  const png = await toPng(shareCardSvg(id));
  const file = new File([png], `token-circles-${id}.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], title: def.name, text: def.share });
    return 'shared';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(png);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return 'downloaded';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/core/achievements/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/core/achievements/shareCard.ts frontend/src/core/achievements/__tests__/shareCard.test.ts
git commit -m "feat(achievements): client-side share card"
```

---

### Task 7: Panel, chip, host, and the two insertion points

**Files:**

- Create: `frontend/src/components/BadgesPanel.tsx`, `frontend/src/components/BadgesPanel.module.css`
- Create: `frontend/src/components/StreakChip.tsx`
- Create: `frontend/src/components/AchievementsHost.tsx`
- Modify: `frontend/src/App.tsx` (mount `<AchievementsHost />` next to `<VerifyEmailBanner />`, line ~1142)
- Modify: `frontend/src/features/Dashboard.tsx:562` (chip beside `<PeriodBar …/>`)
- Modify: `frontend/src/features/Settings.tsx` About card (button "Badges" after the signed-in paragraph, ~line 1904)
- Test: `frontend/src/components/__tests__/BadgesPanel.test.tsx`

**Interfaces:**

- Consumes: store (Task 4), `BadgeMedallion` (Task 5), `shareBadge` (Task 6), `ACHIEVEMENTS`, `BANDS`, `monthsTo`.
- Produces: `<BadgesPanel />` (renders when `panelOpen()`), `<StreakChip />`, `<AchievementsHost />`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/__tests__/BadgesPanel.test.tsx
import { render } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../core/achievementsStore', () => ({
  unlocks: () => [
    { id: 'first-entry', earnedOn: '2026-07-01', unlockedAt: '2026-08-01T00:00:00.000Z' },
  ],
  streak: () => 2,
  panelOpen: () => true,
  closeBadgesPanel: vi.fn(),
  openBadgesPanel: vi.fn(),
}));

import BadgesPanel from '../BadgesPanel';
import StreakChip from '../StreakChip';

describe('BadgesPanel', () => {
  it('lists fifteen badges in three bands, lights the earned one and names the next step', () => {
    const { container, getByText } = render(() => <BadgesPanel />);
    expect(container.querySelectorAll('[data-band]')).toHaveLength(15);
    expect(container.querySelectorAll('[data-lit="true"]')).toHaveLength(1);
    expect(getByText(/Next: A quarter/)).toBeTruthy();
    expect(getByText(/Earned July 2026/)).toBeTruthy();
    expect(getByText(/Nothing leaves this device/)).toBeTruthy();
  });
});

describe('StreakChip', () => {
  it('pluralises the live streak', () => {
    const { getByText } = render(() => <StreakChip />);
    expect(getByText('2 months tracked')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/__tests__/BadgesPanel.test.tsx`
Expected: FAIL, cannot resolve `../BadgesPanel`.

- [ ] **Step 3: Write the components and wire them in**

```tsx
// frontend/src/components/StreakChip.tsx
import type { JSX } from 'solid-js';
import { openBadgesPanel, streak } from '../core/achievementsStore';
import BadgeMedallion from './BadgeMedallion';
import styles from './BadgesPanel.module.css';

export const streakLabel = (n: number): string =>
  n === 0 ? 'Start a streak' : n === 1 ? '1 month tracked' : `${n} months tracked`;

export default function StreakChip(): JSX.Element {
  return (
    <button
      type="button"
      class={styles.chip}
      onClick={openBadgesPanel}
      data-test-id="streak-chip"
      title="Badges"
    >
      <BadgeMedallion
        id={streak() >= 3 ? 'a-quarter' : 'one-month'}
        band="building"
        size={22}
        lit={streak() > 0}
        label=""
      />
      <span>{streakLabel(streak())}</span>
    </button>
  );
}
```

```tsx
// frontend/src/components/BadgesPanel.tsx
/** The occasional touchpoint: three bands, earned lit, the next step named. Opened from the chip and Settings. */
import { For, Show, type JSX } from 'solid-js';
import {
  ACHIEVEMENTS,
  BANDS,
  type AchievementDef,
  type Band,
} from '../core/achievements/definitions';
import { monthsTo } from '../core/achievements/evaluate';
import { shareBadge } from '../core/achievements/shareCard';
import { closeBadgesPanel, panelOpen, streak, unlocks } from '../core/achievementsStore';
import { addToast } from '../core/toastStore';
import BadgeMedallion from './BadgeMedallion';
import styles from './BadgesPanel.module.css';

const STREAK_TARGET: Partial<Record<AchievementDef['id'], number>> = {
  'one-month': 1,
  'a-quarter': 3,
  'half-a-year': 6,
  'a-year': 12,
  'two-years': 24,
};
const monthName = (ymd: string): string =>
  new Date(`${ymd.slice(0, 7)}-15T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export default function BadgesPanel(): JSX.Element {
  const earned = () => new Map(unlocks().map((u) => [u.id, u]));
  const nextIn = (band: Band): AchievementDef | undefined =>
    ACHIEVEMENTS.find((a) => a.band === band && !earned().has(a.id));
  const share = async (a: AchievementDef): Promise<void> => {
    try {
      const how = await shareBadge(a.id);
      if (how === 'downloaded')
        addToast('Share card saved as a PNG.', 'success', { channel: 'achievements' });
    } catch {
      addToast('Could not build the share card.', 'error', { channel: 'achievements' });
    }
  };
  return (
    <Show when={panelOpen()}>
      <div class={styles.overlay} onClick={closeBadgesPanel}>
        <div
          class={styles.panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby="badges-title"
          onClick={(e) => e.stopPropagation()}
        >
          <header class={styles.head}>
            <div>
              <h2 id="badges-title">Badges</h2>
              <p class={styles.sub}>
                {streak() === 1 ? '1 month tracked so far.' : `${streak()} months tracked so far.`}
              </p>
            </div>
            <button
              type="button"
              class={styles.close}
              onClick={closeBadgesPanel}
              aria-label="Close"
            >
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                <path
                  d="M5 5l10 10M15 5L5 15"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  fill="none"
                />
              </svg>
            </button>
          </header>
          <For each={Object.keys(BANDS) as Band[]}>
            {(band) => (
              <section class={styles.band}>
                <div class={styles.bandHead}>
                  <h3>{BANDS[band].label}</h3>
                  <Show when={nextIn(band)}>
                    {(next) => (
                      <span class={styles.next}>
                        Next: {next().name}
                        {STREAK_TARGET[next().id]
                          ? ` — ${monthsTo(streak(), STREAK_TARGET[next().id]!)} more tracked months`
                          : ''}
                      </span>
                    )}
                  </Show>
                </div>
                <ul class={styles.grid}>
                  <For each={ACHIEVEMENTS.filter((a) => a.band === band)}>
                    {(a) => {
                      const rec = () => earned().get(a.id);
                      return (
                        <li class={styles.card}>
                          <BadgeMedallion
                            id={a.id}
                            band={a.band}
                            size={104}
                            lit={!!rec()}
                            interactive={!!rec()}
                            label={`${a.name}: ${a.rule}`}
                          />
                          <div class={styles.name}>{a.name}</div>
                          <p class={styles.rule}>
                            {rec() ? `Earned ${monthName(rec()!.earnedOn)}` : a.rule}
                          </p>
                          <Show when={rec()}>
                            <button
                              type="button"
                              class={styles.share}
                              onClick={() => void share(a)}
                            >
                              Share
                            </button>
                          </Show>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </section>
            )}
          </For>
          <p class={styles.privacy}>
            Badges are worked out from this profile's data, on this device. Nothing leaves this
            device unless you tap Share.
          </p>
        </div>
      </div>
    </Show>
  );
}
```

```tsx
// frontend/src/components/AchievementsHost.tsx
/** Mounted once in App: refreshes on profile change and after data changes, renders the panel. */
import { createEffect, on, onCleanup, onMount, type JSX } from 'solid-js';
import { DATA_CHANGED_EVENT, refreshAchievements } from '../core/achievementsStore';
import { useAppState } from '../core/appStore';
import BadgesPanel from './BadgesPanel';

export default function AchievementsHost(): JSX.Element {
  const state = useAppState();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => void refreshAchievements().catch(() => undefined), 1200);
  };
  createEffect(
    on([() => state.profileVersion, () => state.currentProfile?.id], ([, id]) => {
      if (id != null) schedule();
    })
  );
  onMount(() => window.addEventListener(DATA_CHANGED_EVENT, schedule));
  onCleanup(() => {
    window.removeEventListener(DATA_CHANGED_EVENT, schedule);
    clearTimeout(timer);
  });
  return <BadgesPanel />;
}
```

CSS module `BadgesPanel.module.css`: `.overlay` (fixed inset 0, `rgba(10,14,28,.6)`, backdrop blur, z-index above the sidebar, grid place-items center, padding 20px), `.panel` (background `var(--bg-elevated)` or the app's card token, border `1px solid var(--border)`, radius 22px, max-width 920px, max-height 88vh, overflow auto, padding 26px), `.head` (flex, space-between), `.sub` (muted), `.close` (icon button), `.band` (margin-top 22px, border-top), `.bandHead` (flex baseline gap), `.next` (mono 11px muted), `.grid` (grid auto-fill minmax(150px,1fr) gap 14px, list-style none, padding 0), `.card` (grid justify-items center gap 8px, padding 16px 10px, border radius 16px), `.name` (600 14px), `.rule` (12px muted, centred), `.share` (small pill button), `.privacy` (12px muted, margin-top 20px), `.chip` (inline-flex, gap 8px, pill, border `1px solid var(--border)`, font 12px mono). Use the app's existing tokens: check `frontend/src/styles/themes/orbit-dark.css` for `--bg-elevated`/`--border`/`--text-secondary` names before writing.

Wire-in:

- `App.tsx`: `import AchievementsHost from './components/AchievementsHost'` and render `<AchievementsHost />` directly after `<VerifyEmailBanner />`.
- `Dashboard.tsx` line 562: wrap the period bar: `<div class={styles.periodRow}><PeriodBar tourAnchor="dashboard-period" class={styles.periodBarSlot} /><StreakChip /></div>` with `.periodRow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap }` in `DashboardPage.module.css`.
- `Settings.tsx` About card: after the signed-in paragraph add `<button type="button" class={styles.secondaryBtn} onClick={openBadgesPanel} style="margin-top: 12px">Badges</button>` (reuse the card's existing button class; check the class names used by the neighbouring "What's new" button).

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `cd frontend && npx vitest run src/components/__tests__/BadgesPanel.test.tsx && npm run lint && npx tsc --noEmit -p .`
Expected: PASS, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(achievements): badges panel, streak chip, host, dashboard and settings entry points"
```

---

### Task 8: Changelogs, tour check, PR

**Files:**

- Modify: `CHANGELOG.md` under `## [Unreleased]`
- Modify: `dev-changelog.md` under `## [Unreleased]`

- [ ] **Step 1: CHANGELOG.md entry (one bullet, user-facing)**

```markdown
- **Badges.** Tracking your money now earns badges: a month tracked, a quarter, a year, saving streaks, budgets held, and more. Fifteen in three bands, per profile, worked out on your device, never taken away, and each one shareable as a card. Your history counts from day one.
```

- [ ] **Step 2: dev-changelog.md entry**

```markdown
- **Achievements** (`frontend/src/core/achievements/*`, `achievementsStore.ts`, `components/BadgeMedallion.tsx`, `BadgesPanel.tsx`, `StreakChip.tsx`, `AchievementsHost.tsx`). One pure evaluator (`evaluate.ts`) over the profile's transactions, budgets, goals and import logs; a tracked month is three or more transactions dated inside it; streak = consecutive tracked months ending this month or last. Unlocks are records `{ id, earnedOn, unlockedAt }` kept as JSON under the profile settings key `achievements` — not a table: fifteen rows did not justify a migration, a route and four backup sites, and settings are already per profile, in both modes and in every backup. `api.ts` dispatches `tc:data-changed` after any non-GET, non-settings request; the host debounces that into a refresh. First evaluation on a history toasts once as a summary. Art is the SVG ring recipe from the gallery page (`disjoint-colliders/packages/showcase-gallery/gallery-viewer/token-circles-badges.html`); the share card is rendered client-side from the same SVG.
```

- [ ] **Step 3: Full test run, then the tour gate**

Run: `cd frontend && npx vitest run && cd ../worker && npx vitest run`
Expected: PASS. Then `cd frontend && pnpm run test:tours` (the dashboard tour anchors `dashboard-period`; the chip sits beside it, so the tour must still find its target).

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/achievements
gh pr create --title "feat(achievements): fifteen badges in three bands, per profile" --body "..."
```

---

## Self-review

- **Spec coverage:** tracked month (T2), never revoked (T3 diff keeps stored), fifteen badges (T1/T2), per profile via settings (T3/T4), backfill dating (T2 `earnedOn`), chip + panel + toast + share (T4–T7), SVG art (T5), privacy line (T7), first-run summary toast (T4). Not in v1, as the spec says: points, leagues, notifications beyond the toast, server-side evaluation.
- **Placeholders:** none; the CSS module for the panel is specified by token and rule rather than as a full file, which the implementer writes against the app's theme tokens.
- **Type consistency:** `Earned`/`UnlockRecord` share `id`/`earnedOn`; `monthsTo` exported from `evaluate.ts` and used in the panel; `medallionSvg(id, band, size, uid?)` used by `shareCard.ts`; `DATA_CHANGED_EVENT` string matches the api.ts dispatch.
