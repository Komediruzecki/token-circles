# Achievements and badges — proposal for decision

Status: proposal, nothing built. Companion to the go-to-market tasklist (dotfiles,
`personal/finance/go-to-market-tasklist-2026-09-07.md`, §4d) — the feature is both a retention
mechanic and the one marketing loop the product does not yet have: a user who has tracked their
money for six months gets something to show for it, and showing it is a link back here.

## What this is for

Tracking money is a habit, and habits need feedback that is not a number going up or down. The
app already carries fifteen guided tours and an onboarding wizard for the first hour; nothing
speaks to the first month, or the twelfth. Badges do, cheaply, and they produce a shareable
artefact — "I've tracked my expenses for a year" — that people post without being asked.

Two constraints shape every decision below:

- **Local-first is the default mode and has no server.** Everything must compute from the
  user's own data on the device. The cloud tier only syncs the result.
- **A finance app must not rank people against each other.** No leaderboards, no leagues, no
  points totals. A badge says what _you_ did.

## The reference: what MercuryPitch already has

MercuryPitch (`~/foss/mercurypitch`) has a working system; take its mechanics, not its art.

| Piece                                                                                                 | Where                                                                             | Take?                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `achievements` table: `id, name, description, icon, points, condition, required, sortOrder, category` | `workers/db-worker/migrations/0001_baseline.sql`, `0012_achievement_category.sql` | **Yes** — data-driven definitions; `condition` + `required` keep rules out of code paths                                                 |
| `category` bands `beginnings` / `building` / `mastery`                                                | `0012`                                                                            | **Yes** — the migration's own comment says why: "there is always one within reach, and the far ones stay visible as something to aim at" |
| Art keyed by `icon`, not id; any icon without art falls back to a glyph                               | `src/features/challenges/badge-art.ts`                                            | **Yes** — seeding a badge is never blocked on drawing it                                                                                 |
| Tier metals bronze / silver / gold on one ring recipe                                                 | `badge-art.ts`                                                                    | **Adapt** — our tiers are the bands, our motif is rings                                                                                  |
| Daily streak with freezes (max 3), high-water mark, repair                                            | `src/db/services/streak-service.ts`                                               | **No** — the unit here is a month, not a day; freezes solve a daily-pressure problem we do not have                                      |
| Leagues (`public/leagues/l1..l6`)                                                                     | —                                                                                 | **No** — see constraint two                                                                                                              |

## Model

### The unit: a tracked month

A calendar month is **tracked** when it holds at least three transactions dated inside it,
regardless of when they were entered. Three, not one: a single stray entry is not tracking.
Imports count — a statement imported for March tracks March. This is deliberate, and it is the
best first-run moment the feature has: **someone who imports two years of statements unlocks
their whole track record on the spot.**

The **streak** is the run of consecutive tracked months ending in the current _or previous_
month (the current month is allowed to be in progress). It is a live number and can fall.

### The rule: badges are earned, never revoked

An unlock is monotonic. Deleting transactions later, or a streak breaking, does not take a badge
away — the thing it marks did happen. The streak chip is the live figure; the badges are the
record. This is also what makes the evaluator simple: it only ever adds.

### First set — fifteen, in three bands

| Band       | Badge            | Rule (all computed from the profile's own data)                                         |
| ---------- | ---------------- | --------------------------------------------------------------------------------------- |
| Beginnings | First entry      | 1 transaction                                                                           |
|            | First import     | 1 completed import                                                                      |
|            | First budget     | 1 budget created                                                                        |
|            | Named everything | a tracked month with 0 uncategorised transactions                                       |
|            | A goal in sight  | 1 savings goal created                                                                  |
| Building   | One month        | streak ≥ 1                                                                              |
|            | A quarter        | streak ≥ 3                                                                              |
|            | Saver ×3         | 3 consecutive tracked months, each with income > expenses                               |
|            | Held the line    | a full tracked month with spend ≤ budget in every budgeted category                     |
|            | Goal reached     | 1 savings goal at 100%                                                                  |
| Mastery    | Half a year      | streak ≥ 6                                                                              |
|            | A year           | streak ≥ 12                                                                             |
|            | Saver ×6         | 6 consecutive saving months                                                             |
|            | Two years        | streak ≥ 24                                                                             |
|            | Own the stack    | app running in server mode against an origin that is not tokencircles.com (self-hosted) |

Names are placeholders for the copy pass. `points` from the reference is dropped (constraint two).

### Where it computes, and what persists

- **Evaluator**: one pure function, `evaluateAchievements(input) -> Unlock[]`, over
  `{ transactions, budgets, goals, imports, storageMode, origin }`. Deterministic, no I/O, so it
  is unit-tested with fixture data — a synthetic two-year profile, a profile with a gap, a
  profile that only imports. It runs on load and after any mutation; the app already holds the
  whole transaction list in memory (`Transactions.tsx:456`, the cross-page-selection invariant),
  so the cost is a pass over an array the app already has.
- **Persistence** is only the unlock record `{ id, unlockedAt }`, **per profile** — the data it
  is computed from is per profile, and a family profile earning "A year" is not the same as a
  personal one. Local mode: an IndexedDB store. Server mode: a `profile_achievements
(profile_id, achievement_id, unlocked_at)` table, synced like any other profile data. The
  evaluator's output is the source of truth; the table is a cache of _when_, which the evaluator
  cannot know after the fact.
- **Backfill on first run**: the first evaluation after this ships unlocks everything the history
  already earns, with `unlockedAt` = the first day of the month the rule was met, not "today".
  A user with a year of data gets "A year" dated correctly, and the toast says so.

### Surface

- A **streak chip** on the dashboard: "7 months tracked" — the live number, tapping opens the
  badges panel. This is the everyday touchpoint; the panel is the occasional one.
- A **Badges panel** (dashboard → chip, and Settings → About): three bands, earned ones lit,
  the next unearned one in each band described so there is always a visible next step.
- A **toast on unlock**, using the existing toast stack, with the medallion and a Share action.
- **Share card**: a 1200×630 image rendered client-side from the medallion SVG — badge, one
  line ("Tracked my money for 6 months with Token Circles"), the URL. Web Share API where it
  exists, download otherwise. Nothing is uploaded; the user posts it where they like. This is
  the marketing loop, and it needs to look good enough that people _want_ to.

### Art — SVG, the brand motif, procedurally composed

Every badge is `<BadgeMedallion icon band />`: a shared ring recipe plus one small glyph.

- **Rings are the brand.** Beginnings = one ring, Building = two concentric, Mastery = three,
  in the theme's primary → gold gradient for Mastery. The rings are the "circles" in the name;
  the medallion is the "token". Fifteen badges are fifteen glyphs and one recipe, and a new
  badge is a new glyph.
- **Themeable and crisp**: SVG in the app, `currentColor` and theme tokens, readable at 24 px
  (the chip, the toast) and 512 px (the share card). No raster in the app.
- **Where ChatGPT image generation fits** (you have unlimited runs): a _concept sheet_ — the
  fifteen glyph ideas in the ring motif, several directions — to choose from, and the raster
  _share-card backgrounds_. The chosen glyphs are then drawn by hand as SVG paths so they are
  ours, consistent, and tiny. Do not ship generated raster in the app: it is the wrong format
  for a themed UI and it is not distinctive.

### Privacy

Nothing computes off-device and nothing leaves the device unless the user taps Share. The server
table (cloud tier) holds five ids and dates, not what earned them. This should be said in the
panel in one line, because a finance app awarding badges is exactly where someone asks.

## Sizing

| Piece                                                     | Size         | Notes                                                               |
| --------------------------------------------------------- | ------------ | ------------------------------------------------------------------- |
| Evaluator + fixtures + tests                              | medium       | the part worth doing carefully; everything else renders its output  |
| Persistence (IndexedDB store, D1 table + migration, sync) | small–medium | follows existing per-profile patterns                               |
| Chip, panel, toast                                        | medium       | three components, existing toast stack                              |
| Medallion recipe + 15 glyphs                              | medium       | the recipe is a day; the glyphs are the concept sheet plus hand SVG |
| Share card                                                | small–medium | SVG → canvas → PNG; Web Share API                                   |

Together it is a release's feature slot — comparable to the smart sheet / date navigator
proposal, and the tasklist says pick one for 5.14. The argument for this one is the marketing
timing: it ships a share loop before the Show HN / Product Hunt push, and the badges panel is
itself a screenshot.

## Decisions (taken 2026-09-07)

1. **Per profile.** One account is often a family with several profiles, and the data a badge is
   computed from is per profile. The share card names neither the profile nor the account. Later,
   as an option: count all of an account's profiles towards the same badges.
2. **"Tracked" means three transactions in the month.** Enough to rule out an empty month, low
   enough that nobody has to work for it. Revisit once real usage shows what a tracked month
   actually looks like.
3. **Backfill dates a badge to the month its rule was met**, not to the day the feature shipped.
4. **Ships in the next release**, together with the smart sheet and period navigator if that
   proposal is green-lit (`smart-sheet-and-date-navigator.md`, pending); otherwise on its own.

## Explicitly not in v1

Points, leaderboards, leagues, daily streaks, freezes, notifications outside the in-app toast,
and any server-side evaluation. Each is a decision that would need its own argument, and none is
needed for the loop above to work.
