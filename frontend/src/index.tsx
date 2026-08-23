/* @refresh reload */
import './styles/index.css'
import { installPwaInstallListeners, registerServiceWorker } from '@pwa-kit'
import { render } from 'solid-js/web'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { noteWaitingBuild } from './core/appVersion'
import { installBootRecovery, markBooted } from './core/bootRecovery'
import { applyDemoModeFromUrl } from './core/demoMode'
import { consumeEmailVerifyRedirect } from './core/emailVerification'

// Install the stale-chunk recovery listeners before anything renders, so a failed dynamic
// import after a deploy quietly reloads to the fresh build instead of surfacing a parse error.
installBootRecovery()

// A shared demo link (?demo=high|mid|low) must switch to client-only mode before
// <App/> reads the storage mode, so do it here — before render().
applyDemoModeFromUrl()

// `beforeinstallprompt` fires early and is never replayed, and the event itself is the only
// handle on the native install sheet — miss it and the app can never offer installation at all.
installPwaInstallListeners()

// Register the service worker, but only once the one-time reset in index.html has settled: an
// unregister that resolved after the register would silently remove the worker it had just
// installed. `registerServiceWorker` waits for `load` on top of that, so the worker's install
// fetches stay off the critical path of the first paint.
void Promise.resolve(window.__SW_CLEANUP__).then(() => {
  registerServiceWorker({
    buildId: __GIT_SHA__,
    enabled: __SW_ENABLED__,
    // A waiting worker is one of three ways we learn a deploy landed; appVersion owns what
    // happens next, so all three converge on the same safe moment.
    onUpdateReady: noteWaitingBuild,
  })
})

// The emailed confirm link lands back here as `#everified…`. Read and strip it before render:
// it is not a page, so the hash router would resolve it to a 404, and a fragment left in the
// address bar re-announces the outcome on every reload.
consumeEmailVerifyRedirect()

const root = document.getElementById('root')

if (!root) {
  throw new Error(`Could not find element with id 'root'`)
}

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    'Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?'
  )
}

render(
  () => (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  ),
  root
)

// Signal a successful boot so the pre-JS watchdog in index.html stands down.
markBooted()
