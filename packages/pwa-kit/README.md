# @komediruzecki/pwa-kit

The parts of "make this a real installable app" that are the same in every app, kept together so
they can be reviewed once and reused. Ported from mercurypitch, where this has been in production
long enough to be boring.

It has **no imports from the app that uses it**, which is the property that matters: extracting it
to its own repository is a `git filter-repo` and a publish, not a rewrite.

## What is here

### `install` — can this browser install the app, and has it already?

```ts
import {
  installPwaInstallListeners,
  canInstall,
  needsIosInstallHint,
  promptInstall,
} from '@pwa-kit';

// Once, as early as possible — before the app renders.
installPwaInstallListeners();
```

|                                       |                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `installPwaInstallListeners(target?)` | Start listening. **Call before first render.** Chrome fires `beforeinstallprompt` once, early, and never replays it; that event is the only handle on the native install sheet.             |
| `canInstall()`                        | A sheet can be opened right now. Reactive. False before the event arrives, false once installed, false forever on browsers that never fire it.                                              |
| `needsIosInstallHint()`               | iOS Safari, where installing means Share → Add to Home Screen and no API exists. Excludes Chrome/Firefox/Edge on iOS, which are WebKit underneath but cannot add to the home screen at all. |
| `isStandalone()`                      | Already running as an installed app, so every install affordance should be hidden. Reactive — the same code has different answers in a tab and on the home screen.                          |
| `promptInstall()`                     | Opens the sheet. Returns `'accepted' \| 'dismissed' \| 'unavailable'`. Single-use.                                                                                                          |

The state is a module-level singleton on purpose. It has to outlive any component, because the
event fires before there are components.

### `sw-runtime` — every caching rule, testable

`createServiceWorkerRuntime(options)` is the whole worker minus the globals. The app's `sw.ts`
owns `self`, `clients`, `skipWaiting` and `__WB_MANIFEST` and does nothing else; the rules live
here so they can be run against a fake CacheStorage instead of only against a real deploy.

The model is a **precached shell, one build at a time**:

|                 |                                                                                                                                                                                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `install()`     | Fetch the shell, **refuse it unless every script it names is in this build's manifest**, then store it with the assets it needs to boot. The previous build's cache is copied forward first, so an unchanged chunk costs nothing. Rejecting means the worker never activates, and the visitor keeps the build they have — whole. |
| `handleFetch()` | Navigations answer from the cached shell without touching the network. Assets answer cache-first, and only for URLs this build shipped. A hashed chunk the origin answers with HTML becomes a **503**, so it fails as a load error rather than a syntax error inside the page.                                                   |
| `activate()`    | Drop the other builds' caches — only ones carrying this app's prefix.                                                                                                                                                                                                                                                            |

No `skipWaiting`, no `clientsClaim`. A worker that took over mid-session would pair its own chunk
map with the page's already-loaded HTML, which is what a multi-reload deploy loop is made of.

Every option has a default that suits a standard Vite SPA: `cachePrefix`, `shellKey`,
`assetPathPrefix`, `standaloneDocumentPaths`, `stableShellAssets`, `bypassPathPrefixes`.

References in the shipped HTML are **resolved**, not matched on a leading slash — Vite writes
`./assets/x.js` under a relative `base` and `/assets/x.js` under an absolute one, and a worker
that recognised only one would silently precache nothing and check nothing.

### `register` — put it on the page, and route its updates to the user

```ts
import { registerServiceWorker, reloadToLatest, requestUpdateCheck } from '@pwa-kit';

registerServiceWorker({
  buildId: __GIT_SHA__,
  enabled: __SW_ENABLED__,
  onUpdateReady: () => showTheUpdateAffordance(),
});
```

Because the worker refuses to skip waiting, this is the only way a visitor moves to a newer build,
so the prompt has to mean something. Three things feed it: a **waiting worker**, its **build id**
(asked over a MessageChannel — a worker built from the commit the page is already running is
adopted silently rather than announced), and a **stale-build notice** the worker posts the moment
a request proves the origin has moved on.

`reloadToLatest()` is the reload to use everywhere, never `location.reload()`. The controlling
worker answers a plain reload out of its own precache, so when the running build's chunks are gone
a reload re-serves the same dead shell and fails identically, forever. It climbs a ladder instead:
adopt the waiting worker → else unregister and reload → else (offline) reload plainly.

## Consuming it

It is a workspace package with no build step — `exports` points at TypeScript source, and the
consumer's bundler compiles it. `frontend/` reaches it through a `@pwa-kit` alias in
`vite.config.ts`, `vitest.config.ts` and `tsconfig.json`.

`solid-js` is a **peer** dependency: the reactive primitives are Solid's, and the consuming app
supplies its own copy so there are never two.

## Testing

The tests live here (`test/`) and run under the frontend's vitest, which is aliased to resolve
`@pwa-kit`. That way CI covers the kit with no extra job. When this becomes its own repository it
brings its own runner and the tests move with it unchanged.

104 cases: 11 for install, 58 for the caching rules against a fake CacheStorage, 35 for the
registration and update flow against a fake `ServiceWorkerContainer`. Every one of them is a thing
that happened or would have — a deploy landing between two fetches, a chunk answered with
index.html and a 200, a cache surviving from a build whose chunks are gone. In a browser each
needs a deployment to reproduce.
