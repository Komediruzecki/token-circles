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
worktree of your own, on ports nobody else is using** — `3847` and `3800` are
the shared backend and Playwright ports. `db/*.db` is gitignored, so a fresh
worktree gets its own database rather than sharing one.

```sh
# 1. seed this worktree's own db/test.db
NODE_ENV=test node backend/scripts/nuke-demo.js

# 2. backend, on a port of your own
NODE_ENV=test PORT=3947 node backend/index.js &

# 3. dev server pointed at it
cd frontend
API_PROXY_TARGET=http://127.0.0.1:3947 npx vite --port 3900 --strictPort &

# 4. shoot
npm run marketing:shots
```

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
| `PROFILE`  | `3`                              | demo profile id                             |
| `LIGHT=1`  | off                              | light theme instead of the published dark   |
| `CHROMIUM` | Playwright's own                 | chromium binary path                        |

## Why seed with the script and not the endpoint

Use `backend/scripts/nuke-demo.js`. **Not** `POST /api/profiles/reseed-demo`:
the endpoint does not clear `portfolio_holdings`, so every call appends another
copy of them. A database reseeded a few times shows a portfolio of the same two
tickers repeated four times over, and the endpoint still answers
`{"ok":true,"message":"Demo data has been restored"}`.

## Why profile 3

Profile 1 seeds two ETFs, which makes a threadbare portfolio frame. Profile 3
("Example High Income") seeds eight tickers, and its transaction, budget and
analytics data is correspondingly denser. Shooting a mixed set — five frames
from one profile and one from another — puts a different profile name in one
sidebar, so the whole set moves together.

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
suspect the app before the capture: `backend/services/yahooFinanceService.js`.

## Sizing

Shot at 2880×1800 and halved to 1440×900. A browser at `deviceScaleFactor: 2`
renders text on the full hinting grid, and an exact 2:1 downscale keeps that
detail rather than asking the encoder to invent it. If the published size ever
changes, keep the pairing — an awkward ratio resamples and the text goes soft.

`showcase-gallery/src/index.ts` declares 1440×900 for every entry, and the
lightbox reserves that box before the image loads. A master of a different shape
shifts the layout on the live site.
