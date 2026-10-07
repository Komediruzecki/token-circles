/**
 * What index.tsx renders: the app, and the toasts beside it.
 *
 * The toasts sit outside App on purpose. App shows nothing but the boot screen until it has
 * finished loading, and loading is exactly what a database upgrade blocked by another tab holds
 * up. The upgrade's notice, "Close your other Token Circles tabs to finish updating this one.", is
 * a toast: with the container inside App's loading gate it was queued where nothing drew it, and
 * the tab sat on the boot screen without a word, which is the very case the notice exists for.
 */
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import ToastContainer from './components/ToastContainer'

export function Root() {
  return (
    <>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
      <ToastContainer />
    </>
  )
}
