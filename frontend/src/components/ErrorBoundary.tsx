import { createSignal, ErrorBoundary as SolidErrorBoundary, onCleanup, onMount } from 'solid-js'
import { isChunkLoadError } from '../core/bootRecovery'
import type { Component, JSX } from 'solid-js'

interface Props {
  children: JSX.Element
}

function isBenignError(msg: string): boolean {
  if (!msg) return false
  return /ResizeObserver loop/i.test(msg)
}

/**
 * Errors from scripts we did not ship must never take over the screen.
 * Cross-origin scripts (Cloudflare's injected /cdn-cgi/ challenge, browser
 * extensions, in-app browser shims) surface as an opaque "Script error."
 * with no Error object, or carry a filename on a foreign host. Treating those
 * as fatal made the app "crash" on iOS whenever Bot Fight Mode's script
 * hiccuped — e.g. right after tapping a calendar day.
 */
function isThirdPartyError(event: ErrorEvent): boolean {
  const msg = event.message || ''
  if (!event.error && /^Script error\.?$/i.test(msg.trim())) return true
  if (event.filename) {
    if (/cdn-cgi|challenge-platform/.test(event.filename)) return true
    if (!event.filename.startsWith('/') && !event.filename.includes(window.location.host))
      return true
  }
  return false
}

export const ErrorBoundary: Component<Props> = (props) => {
  const [fatalError, setFatalError] = createSignal<Error | null>(null)
  const [errorLog, setErrorLog] = createSignal<string[]>([])

  function addToLog(msg: string) {
    setErrorLog((prev) => [...prev.slice(-19), msg])
  }

  onMount(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      const msg = event.message || (event.error ? String(event.error) : '')
      if (isBenignError(msg)) return
      const err = event.error || new Error(msg)
      addToLog(`[${new Date().toISOString()}] ${err.message || String(err)}`)
      // Third-party/opaque errors are logged (visible in any later crash modal)
      // but never escalate to the full-screen fatal takeover.
      if (isThirdPartyError(event)) return
      if (!fatalError()) {
        setFatalError(err)
      }
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const err = event.reason instanceof Error ? event.reason : new Error(String(event.reason))
      if (isBenignError(err.message)) return
      addToLog(`[${new Date().toISOString()}] Unhandled: ${err.message}`)
      if (!fatalError()) {
        setFatalError(err)
      }
    }

    window.addEventListener('error', handleGlobalError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    onCleanup(() => {
      window.removeEventListener('error', handleGlobalError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    })
  })

  const handleReload = () => {
    window.location.reload()
  }
  const handleClearLocalStorage = () => {
    localStorage.clear()
    window.location.reload()
  }
  const handleClearIndexedDB = async () => {
    if (window.indexedDB?.databases) {
      try {
        const dbs = await window.indexedDB.databases()
        dbs.forEach((db: any) => {
          if (db.name) window.indexedDB.deleteDatabase(db.name)
        })
      } catch {
        /* ignore */
      }
    }
    window.location.reload()
  }
  // The recovery that actually fixes a stale-cache white screen: drop the service worker and
  // the Cache Storage (the old app shell + chunks), then reload to fetch the current build.
  // Unlike the two handlers above, this keeps the user's local data (localStorage/IndexedDB).
  const handleClearCaches = async () => {
    try {
      if ('serviceWorker' in window.navigator) {
        const regs = await window.navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map((r) => r.unregister()))
      }
    } catch {
      /* ignore */
    }
    try {
      if (window.caches) {
        const keys = await window.caches.keys()
        await Promise.all(keys.map((k) => window.caches.delete(k)))
      }
    } catch {
      /* ignore */
    }
    window.location.reload()
  }
  const handleDismiss = () => setFatalError(null)

  return (
    <SolidErrorBoundary
      fallback={(err, _reset) => {
        addToLog(`[${new Date().toISOString()}] Render error: ${err.toString()}`)
        const displayError = fatalError() || err
        const logs = errorLog()
        return (
          <CrashModal
            error={displayError}
            logs={logs}
            isUpdateError={isChunkLoadError(displayError)}
            onReload={handleReload}
            onClearCaches={handleClearCaches}
            onClearLocalStorage={handleClearLocalStorage}
            onClearIndexedDB={handleClearIndexedDB}
            onDismiss={handleDismiss}
          />
        )
      }}
    >
      {fatalError() ? (
        <CrashModal
          error={fatalError()!}
          logs={errorLog()}
          isUpdateError={isChunkLoadError(fatalError()!)}
          onReload={handleReload}
          onClearCaches={handleClearCaches}
          onClearLocalStorage={handleClearLocalStorage}
          onClearIndexedDB={handleClearIndexedDB}
          onDismiss={handleDismiss}
        />
      ) : (
        props.children
      )}
    </SolidErrorBoundary>
  )
}

function CrashModal(props: {
  error: Error
  logs: string[]
  isUpdateError: boolean
  onReload: () => void
  onClearCaches: () => void
  onClearLocalStorage: () => void
  onClearIndexedDB: () => void
  onDismiss: () => void
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        'background-color': 'rgba(0, 0, 0, 0.5)',
        'z-index': 99999,
      }}
    >
      <div
        style={{
          background: 'var(--bg-card, #ffffff)',
          color: 'var(--text-primary, #000000)',
          padding: '2rem',
          'border-radius': '8px',
          'max-width': '550px',
          width: '95%',
          'max-height': '90vh',
          'overflow-y': 'auto',
          'box-shadow': '0 4px 6px rgba(0, 0, 0, 0.1)',
        }}
      >
        <h2 style={{ 'margin-top': 0, color: props.isUpdateError ? '#3b82f6' : '#ef4444' }}>
          {props.isUpdateError ? 'Update available' : 'App Crashed'}
        </h2>
        <p style={{ 'margin-bottom': '1rem' }}>
          {props.isUpdateError
            ? 'A new version was released and part of the app failed to load. Reload to get the latest — if that does not help, clear the app cache (your data is kept).'
            : 'An unexpected error occurred. Try reloading, or clear the app cache. Clearing stored data is a last resort — it erases local accounts and transactions on this device.'}
        </p>

        <div
          style={{
            background: 'var(--bg-body, #1f2937)',
            color: '#f87171',
            padding: '1rem',
            'border-radius': '4px',
            'font-family': 'monospace',
            'font-size': '0.8rem',
            'overflow-x': 'auto',
            'margin-bottom': '1rem',
            'max-height': '200px',
            'overflow-y': 'auto',
            'white-space': 'pre-wrap',
            'word-break': 'break-all',
          }}
        >
          <strong>Error:</strong> {props.error.toString()}
          {props.logs.length > 0 && (
            <>
              <div style={{ margin: '8px 0', 'border-top': '1px solid #4b5563' }} />
              <strong>Log:</strong>
              {'\n'}
              {props.logs.join('\n')}
            </>
          )}
        </div>

        <p
          style={{
            'font-size': '0.85rem',
            color: 'var(--text-secondary, #6b7280)',
            'margin-bottom': '1rem',
          }}
        >
          Version: {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown'}
          {' — '}
          <a
            href="https://github.com/Komediruzecki/finance-manager/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#3b82f6', 'text-decoration': 'underline' }}
          >
            Report on GitHub
          </a>
        </p>

        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '0.5rem' }}>
          <button
            onClick={props.onReload}
            style={{
              padding: '0.5rem 1rem',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              'border-radius': '4px',
              cursor: 'pointer',
            }}
          >
            {props.isUpdateError ? 'Reload' : 'Reload App'}
          </button>
          {/* The safe recovery: drops the service worker + cached shell (the usual cause of a
              stale-build white screen) but keeps the user's local data. */}
          <button
            onClick={props.onClearCaches}
            style={{
              padding: '0.5rem 1rem',
              background: 'transparent',
              color: '#3b82f6',
              border: '1px solid #3b82f6',
              'border-radius': '4px',
              cursor: 'pointer',
            }}
          >
            Clear cache &amp; reload
          </button>

          <p
            style={{
              'font-size': '0.75rem',
              color: 'var(--text-secondary, #6b7280)',
              margin: '0.5rem 0 0',
            }}
          >
            Still stuck? These erase local accounts &amp; transactions on this device:
          </p>
          <button
            onClick={props.onClearLocalStorage}
            style={{
              padding: '0.5rem 1rem',
              background: 'transparent',
              color: '#ef4444',
              border: '1px solid #ef4444',
              'border-radius': '4px',
              cursor: 'pointer',
            }}
          >
            Clear Local Storage &amp; Reload
          </button>
          <button
            onClick={props.onClearIndexedDB}
            style={{
              padding: '0.5rem 1rem',
              background: 'transparent',
              color: '#ef4444',
              border: '1px solid #ef4444',
              'border-radius': '4px',
              cursor: 'pointer',
            }}
          >
            Clear IndexedDB &amp; Reload
          </button>
          <button
            onClick={props.onDismiss}
            style={{
              padding: '0.5rem 1rem',
              background: 'transparent',
              color: 'var(--text-secondary, #6b7280)',
              border: '1px solid var(--border, #e5e7eb)',
              'border-radius': '4px',
              cursor: 'pointer',
            }}
          >
            Dismiss &amp; Continue
          </button>
        </div>
      </div>
    </div>
  )
}
