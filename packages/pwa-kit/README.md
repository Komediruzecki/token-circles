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

## Not here yet

The service-worker half — registration, the update prompt, and the caching rules — is the risky
part and is deliberately a separate change. See
[#417](https://github.com/Komediruzecki/token-circles/issues/417).
