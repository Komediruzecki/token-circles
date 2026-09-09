# Achievements: the next fifty

Status: **shipped**, in #539 / #540 / #541 (released in 5.14.0, 2026-09-08). Every badge
proposed below is live, plus two the review added. Kept as the record of what was built and why
— the tables are the plan as written, not a live task list.

The first fifteen shipped in #534 and went live on the Progress page (#536). This proposed what
came next and, more importantly, the rules for deciding what is worth adding at all.

## The problem with just adding more

Fifteen badges is a set you can read in one screen. Fifty is a wall. The reason to grow the set
is not coverage, it is **pull**: at any moment a person should be able to see one thing they
could plausibly reach, and one thing they would be glad to have. A badge that nobody can name a
reason to want is noise that makes the wanted ones harder to see.

So three tests before any badge joins the list.

1. **Could a person want it out loud?** "I want the ten-year badge" passes. "I want the badge
   for having four accounts" does not.
2. **Is it earnable by doing the thing the app is for?** Tracking, budgeting, saving. Never by
   clicking around the interface, and never by using a feature we happen to want promoted.
3. **Is it computable from the profile's own data, deterministically, with no new storage?**
   The evaluator only ever adds; a badge whose rule needs a server, a clock we do not control,
   or history we do not keep is out.

Everything below passes all three, or says why it is parked.

---

## What the current fifteen are missing

- **A ceiling.** "Two years" is the top of the ladder. Someone two years in has nothing left.
- **Volume.** Nothing recognises the person who has entered four thousand transactions.
- **The comeback.** Break a streak today and the record says nothing about starting again,
  which is exactly the moment a person needs a reason to.
- **Anything that feels rare.** All fifteen are reachable by anyone who keeps going. None of
  them are a story.

---

## Proposed additions

### 1. The long ladder (extends Mastery)

The obvious gap and the strongest pull, because the reward is simply for still being here.

| Badge        | Rule          | Why it pulls                                        |
| ------------ | ------------- | --------------------------------------------------- |
| Three years  | streak >= 36  | The next rung after Two years                       |
| Five years   | streak >= 60  | The first one that sounds like a commitment         |
| Ten years    | streak >= 120 | A decade of your own financial history in one place |
| Twenty years | streak >= 240 | Almost nobody will have it, which is the point      |

These need no new mechanism at all: `monthReaching(tracked, n)` already answers them. They
also age well, because a person who imports fifteen years of statements earns them on the spot
and immediately understands what the app is for.

A fourth band, **Legacy**, holds Five, Ten and Twenty, with four rings and a deeper gold.
Mastery keeps Half a year through Three years.

### 2. Volume, which is the other axis

Time is one axis and effort is the other. Someone who tracks a business's worth of
transactions deserves recognition that a two-entries-a-month tracker does not get.

| Badge                 | Rule                |
| --------------------- | ------------------- |
| A hundred entries     | 100 transactions    |
| A thousand entries    | 1 000 transactions  |
| Five thousand entries | 5 000 transactions  |
| Ten thousand entries  | 10 000 transactions |

Counted across the profile's whole history, never revoked. Cheap: it is `transactions.length`.

### 3. The ones people will actually chase

This is where the set earns its keep. Each of these is a small story.

| Badge                      | Rule                                                                                                         | The feeling                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **The comeback**           | A tracked month that follows a gap of 2+ untracked months, after a previous streak of >= 3                   | Forgiveness. The single most valuable badge in the set: it is the one that makes returning feel like progress instead of failure. |
| **Clean sweep**            | A tracked month where every transaction is categorised **and** every budgeted category is at or under budget | The perfect month. Hard, fair, entirely in your control.                                                                          |
| **Perfect year**           | Twelve consecutive months, each with income above spending                                                   | The one people screenshot.                                                                                                        |
| **Under budget, six deep** | Six consecutive months with every budgeted category held                                                     | Rewards the boring discipline that actually works.                                                                                |
| **Reconciled**             | A tracked month where every transaction is marked reconciled                                                 | For the people who tie out against the bank. `reconciled` is already on the model.                                                |
| **Rainy day**              | A savings goal at 100% whose target is >= three months of that profile's average monthly spending            | An emergency fund, without lecturing about one.                                                                                   |
| **Debt free**              | A loan that reaches a zero balance                                                                           | The biggest real-life moment the app can see.                                                                                     |
| **Ahead of plan**          | A savings goal reached before its deadline                                                                   | Beating your own estimate.                                                                                                        |
| **The full picture**       | A tracked month with at least one transaction in each of income, expense and transfer, all categorised       | Nudges towards using the app for everything, not just spending.                                                                   |
| **Every month of a year**  | Twelve tracked months inside one calendar year                                                               | Cleaner to explain than a rolling streak, and a natural January reset.                                                            |

### 4. Seasonal and dated, if we want them (parked)

"Tracked through December", "Started in January". They read well and they cost nothing, but
they reward the calendar rather than the person, and they cannot be earned out of season, which
breaks the promise that everything is reachable from your own history. **Recommendation: no.**

### 5. Things deliberately not in this list

- **Anything social or comparative.** No leaderboards, no percentiles, no "better than 80% of
  users": every one needs the server to see the data, which breaks the promise on the page.
- **Points and levels.** They turn fifteen clear things into one meaningless number.
- **Badges for using a feature.** "Opened the Sankey chart" is a tutorial, not an achievement.
- **Anything that can be lost.** The record only adds; that is what makes it trustworthy.

---

## What it costs to build

The evaluator is a pure function over arrays that are already loaded, so most of this is
definitions plus one rule each.

| Piece                               | Size         | Notes                                                                                                      |
| ----------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| The long ladder + volume (8 badges) | small        | `monthReaching` and `transactions.length`; definitions and tests only                                      |
| The chased ten                      | medium       | Each is a rule in `evaluate.ts`; the comeback and the perfect year need new helpers over the month buckets |
| Fourth band (Legacy)                | small        | `BANDS` gains an entry, plus a fourth generated face (one more image)                                      |
| Debt free                           | small–medium | Needs the loans array in the evaluator input, which the store does not load yet                            |
| Rainy day                           | small        | Average monthly spend is already computed for the year review                                              |
| Panel at 33 badges                  | small        | The Progress page groups by band already; a band of ten wants a two-row grid, nothing more                 |

Total: one focused PR for the ladder and volume, one for the chased set, and a small one for
the band and the face.

## Sequencing

1. **The long ladder and volume.** Eight badges, no new mechanisms, and it immediately fixes
   the ceiling problem for anyone who imports history.
2. **The comeback, Clean sweep, Perfect year, Under budget six deep.** The four with the most
   pull, and all four are computable from what the evaluator already buckets.
3. **Debt free, Rainy day, Ahead of plan, Reconciled, The full picture, Every month of a year.**
4. **Legacy band and its face**, once there is something to put in it.

## Decisions taken

Answered 2026-09-07, and all five are in the shipped set.

1. **Fourth band, or stretch Mastery?** → **Both.** Legacy holds Five, Ten and Twenty years at
   four rings and a deeper gold; Mastery gained Three years.
2. **Volume thresholds** → As proposed, **plus a fifth at 20 000**: "5k and 10k and 20k is
   definitely doable for people that tracked their whole life."
3. **The comeback's shape** → As proposed. A gap of two or more months after a streak of three
   or more, so the badge still means something.
4. **The panel at 33 badges** → **Separated, and given a timeline.** The Progress page opens with
   a horizontal strip of what was earned and when, then the full gallery below with earned badges
   lit and the rest plain.
5. **Debt free** → **Built.** The evaluator now loads the loans array; a loan reaching a zero
   balance earns it.

## What shipped that this document did not propose

- **Twenty thousand entries** (Legacy), from decision 2.
- **Own the stack** (Mastery), which the review added.

The set is **34 badges in four bands**. The rules in "The problem with just adding more" are
what the next one has to pass.
