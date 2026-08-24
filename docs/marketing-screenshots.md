# Marketing screenshots

The product stills on [irchiinnuss.com](https://irchiinnuss.com) and
`blog.irchiinnuss.com` come from this app. The image files themselves live in a
different repository — `disjoint-colliders`, under
`packages/showcase-gallery/assets/token-circles/` — where both sites bundle them
at build time.

They are screenshots of a moving product, so they go stale silently. The set
published before 2026-08-23 was ten commits of UI work behind, and nothing in
either repository could have told you that.

`frontend/scripts/gen-marketing-shots.mjs` re-shoots them.

## Shooting a set

This repository often has several worktrees running at once. **Do this in a
worktree of your own, on ports nobody else is using** — `8787` and `3800` are
the e2e suite's. `worker/.wrangler` is gitignored, so a fresh worktree gets its
own local D1 rather than sharing one.

The app is the e2e suite's app: `wrangler dev` against a local D1, vite proxying
`/api` at it, and the seeded fixture account. Three steps, because the capturer
needs the servers to still be up when it runs and Playwright stops the ones it
starts.

```sh
# 1. the Worker, on ports of your own (it keeps running)
cd worker
pnpm run d1:migrate:local && pnpm exec wrangler dev --port 8790 &

# 2. the dev server pointed at it
cd ../frontend
API_PROXY_TARGET=http://127.0.0.1:8790 npx vite --port 3900 --strictPort &

# 3. register and seed the fixture account against those two
E2E_PORT=3900 E2E_API_PORT=8790 \
  npx playwright test --config=playwright.shots.config.ts --project=setup

# 4. shoot
BASE_URL=http://127.0.0.1:3900 npm run marketing:shots
```

Step 3 is `--project=setup` deliberately: without it the config also re-shoots
the PWA install screenshots into `public/`, which is a different job (see
[PWA Install Assets](pwa-install-assets.md)). It is idempotent — run it again on
a database that already has the account and it signs in and re-seeds what is
missing.

A capture against an unseeded database photographs six empty states without
complaint, which is why the script checks each frame for content and prints the
row and digit counts it found.

Output lands in `frontend/local/marketing-shots/` (gitignored). To write
straight into the gallery instead:

```sh
OUT=/path/to/disjoint-colliders/packages/showcase-gallery/assets/token-circles \
  npm run marketing:shots
```

Then rebuild the two sites that bundle them:

```sh
pnpm --filter @irchiinnuss/landing build
pnpm --filter @irchiinnuss/blog build
```

Both sites carry the gallery, so both need a version bump and a tag
(`irch-v*`, `blog-v*`) when the images change. The Token Circles landing does
**not** — it has no gallery, only brand art.

| Variable   | Default                          |                                             |
| ---------- | -------------------------------- | ------------------------------------------- |
| `BASE_URL` | `http://127.0.0.1:3900`          | where the dev server is                     |
| `OUT`      | `frontend/local/marketing-shots` | output directory                            |
| `SHOT`     | all six                          | one slug or route, e.g. `SHOT=05-portfolio` |
| `PROFILE`  | looked up                        | profile id; default is the fixture, by name |
| `EMAIL`    | `e2e@tokencircles.test`          | account to sign in as                       |
| `PASSWORD` | the fixture's                    | its password                                |
| `LIGHT=1`  | off                              | light theme instead of the published dark   |
| `CHROMIUM` | Playwright's own                 | chromium binary path                        |

## Where the data comes from

`frontend/tests/e2e-seed.ts` — the same fixture the e2e suite runs against.
Twenty-four months of transactions across six categories, two accounts, four
monthly budgets, two savings goals, a loan, three holdings and two bills.

One fixture, shot by both, on purpose: a screenshot pipeline with its own idea
of what the data looks like drifts from the app the moment either side moves,
and it drifts silently — the frames still render.

**Do not use `POST /api/profiles/reseed-demo`.** On the Worker it only resets
the current profile to default categories; the rich three-profile demo it used
to run is client-only now. It will empty the profile you are about to shoot.

## What changed when the Express server went

The published set before 2026-08-24 was shot from the Express server's demo
profile 3 ("Example High Income"), seeded by `backend/scripts/nuke-demo.js`.
That runtime and that script are gone — see [AGENTS.md](../AGENTS.md).

The fixture account replaces them, and it is thinner: one checking account and
one savings account rather than a full set, three tickers rather than eight.
Frames that leaned on the old profile's density — `05-portfolio` most of all —
read leaner. The content gates in the script were re-checked against the fixture
and all six pass; they catch a collapse, they do not grade the frame.

## Why the profile is looked up, not pinned

The fixture profile's id is whatever the database handed out, so it differs
between worktrees and between resets. The script reads `GET /api/profiles` and
picks the one named `E2E Fixture`. A wrong id is not an error anywhere — it is
six shots of somebody else's empty profile. Set `PROFILE` to override.

## Things that fail by looking fine

Every trap here produces a plausible image rather than an error, which is why
the script pins each one rather than leaving it to the environment.

- **The theme.** The app follows `prefers-color-scheme` whenever no theme is
  pinned, and headless Chromium reports _light_. An unpinned run returns a
  complete, correct-looking light set, to be published into a dark gallery. The
  script pins `localStorage['finance-theme']`. The older `darkMode` key that
  `walk-tours.mjs` still writes does nothing.
- **`page.addStyleTag`.** A style tag belongs to the document that was live when
  it ran, so scrollbar and animation suppression evaporates on the first
  `goto()` and only the first shot comes out clean. It is an init script.
- **Empty states photograph well.** A page header renders just as happily above
  no data, so waiting for the header proves only that the page mounted. Each
  shot also asserts a minimum number of rows, and a floor on the digits visible
  on screen, before the shutter opens.
- **The profile dropdown looks open** to `getBoundingClientRect`. It hides with
  `max-height: 0; overflow: hidden`, which clips visually without collapsing its
  children's layout boxes. Check for the `.visible` class if this ever needs
  re-verifying — it is genuinely closed in a shot.

## Live prices

The portfolio frame's gain/loss column carries live quotes from the moment of
capture, against the seed's 2024–25 cost basis. The percentages are large, and
that one frame does not reproduce byte-for-byte later.

It read a flat `€0.00` everywhere until the `yahoo-finance2` v3 client bug was
found — the price lookup was throwing into a silent fallback, so every holding
reported `currentPrice === purchase_price`. If the column ever goes flat again,
suspect the app before the capture. The quote path is now
`worker/src/routes/portfolio.ts` (the Express service that hosted the original
bug is gone with the rest of that runtime), and it fails the same way: a lookup
that cannot answer leaves the purchase price in place rather than erroring.

## Sizing

Shot at 2880×1800 and halved to 1440×900. A browser at `deviceScaleFactor: 2`
renders text on the full hinting grid, and an exact 2:1 downscale keeps that
detail rather than asking the encoder to invent it. If the published size ever
changes, keep the pairing — an awkward ratio resamples and the text goes soft.

`showcase-gallery/src/index.ts` declares 1440×900 for every entry, and the
lightbox reserves that box before the image loads. A master of a different shape
shifts the layout on the live site.
