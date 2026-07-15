/* @refresh reload */
import './styles/index.css'
import { render } from 'solid-js/web'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installBootRecovery, markBooted } from './core/bootRecovery'
import { applyDemoModeFromUrl } from './core/demoMode'

// Install the stale-chunk recovery listeners before anything renders, so a failed dynamic
// import after a deploy quietly reloads to the fresh build instead of surfacing a parse error.
installBootRecovery()

// A shared demo link (?demo=high|mid|low) must switch to client-only mode before
// <App/> reads the storage mode, so do it here — before render().
applyDemoModeFromUrl()

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
