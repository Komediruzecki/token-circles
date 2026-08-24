# PWA install assets

What the browser shows when someone installs Token Circles: the icon that lands on their home
screen, and the screenshots in the install dialog. Both are declared in
`frontend/src/pwaManifest.ts` and both are files in `frontend/public/`.

Everything here fails **silently**. A `src` that does not resolve is a 404 the install dialog
swallows; a `sizes` that disagrees with the file is a screenshot Chrome drops without a word; an
icon set with no maskable member is not an error at all. Nothing appears in a build log. That is
why `frontend/src/__tests__/pwaManifest.test.ts` reads the PNG headers back off disk and compares
them to what the manifest claims — it is the only thing standing between a re-shoot at a new size
and an install dialog that quietly goes blank.

## Icons

| File                    | Purpose    | Notes                                   |
| ----------------------- | ---------- | --------------------------------------- |
| `icon-192.png`          | `any`      | rasterized from `icon-192.svg`          |
| `icon-512.png`          | `any`      | rasterized from `icon-512.svg`          |
| `icon-512.svg`          | `any`      | `sizes: 'any'` — it is scalable         |
| `icon-maskable-192.png` | `maskable` | rasterized from `icon-maskable-512.svg` |
| `icon-maskable-512.png` | `maskable` | rasterized from `icon-maskable-512.svg` |

**Why a maskable variant exists.** Android applies its own mask — circle, squircle, teardrop,
depending on the launcher. Given only `purpose: "any"` icons, Chrome does not mask ours: it
shrinks the whole square into a white circle, so the installed app is a small dark tile floating
in white. A maskable icon is drawn to be masked.

Two rules the master (`frontend/public/icon-maskable-512.svg`) follows, both asserted by the test:

- **The background bleeds to the edges.** No `rx` on the backing rect — the platform supplies the
  shape, and baking our own corners in produces a rounded square inside a circle.
- **The artwork sits inside the safe circle**, whose diameter is 80% of the canvas. Anything
  outside it may be cropped. The unscaled artwork reaches 207px from the centre of a 512 canvas,
  just past the 204.8px safe radius (the orange marker is the culprit), so the maskable master
  wraps it in `scale(0.8)`.

Regenerate the PNGs after editing any SVG:

```bash
cd frontend && npm run pwa:icons
```

Needs `rsvg-convert` (librsvg): `pacman -S librsvg`, `apt install librsvg2-bin`, or
`brew install librsvg`. It is **not** run in CI — the PNGs are committed, because a build that
rasterizes its own icons fails on any machine without the tool, and these change about once a year.

## Screenshots

Six: `dashboard`, `transactions` and `analytics`, each at `wide` (1280x720) and `narrow`
(720x1280). Chrome shows the rich install dialog only when there is a `wide` entry, and falls back
to the plain one on phones without a `narrow` entry, so half a set is worse than none.

Chrome's constraints, all asserted by the test: every side between 320 and 3840, the long side at
most 2.3x the short side, and one consistent aspect ratio per form factor.

Re-shoot them:

```bash
cd frontend && npm run pwa:shots
```

That runs `playwright.shots.config.ts`, which starts the same two servers the e2e suite uses —
`wrangler dev` against a local D1, and vite proxying `/api` at it — runs the same setup project, and
therefore shoots the same seeded fixture account. Writing straight into `frontend/public/`, it
leaves a dirty working tree by design; commit what changed.

Two things are deliberate and easy to undo by accident, because both fail by producing a plausible
wrong image rather than an error:

- **The theme is pinned to dark via `finance-theme` in an init script.** That is the key
  `public/theme-init.js` reads. With nothing pinned the app follows `prefers-color-scheme`, and
  headless Chromium reports _light_ — so an unpinned run returns a whole light set to sit beside a
  `#0a0e1c` splash screen. (The e2e fixture state's `darkMode` key is dead; nothing has read it
  since the theme moved to `core/theme.ts`.)
- **Animation and scrollbar suppression is an init script, not `addStyleTag`.** A style tag belongs
  to the document that was live when it ran, so it evaporates on the first navigation and only the
  first shot comes out clean.

Shot at `deviceScaleFactor: 2` with `scale: 'css'`: the browser renders text on the full hinting
grid and hands back an image at the declared CSS size, rather than asking a resampler to invent the
detail. If you change the output size, keep that pairing.

The screenshots are **not** precached by the service worker — `injectManifest.globPatterns` in
`vite.config.ts` is an explicit allowlist, and these are read by the browser's install UI, never by
the page.

## Related

- [Deploy-Update Pipeline](deploy-update-pipeline.md) — the service worker, and how open tabs cross
  a release
- [Marketing Screenshots](marketing-screenshots.md) — the separate, larger set the landing sites
  bundle
