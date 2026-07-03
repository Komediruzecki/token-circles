import { createSignal, ErrorBoundary as SolidErrorBoundary, onCleanup, onMount } from 'solid-js'
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
    if (
      !event.filename.startsWith('/') &&
      !event.filename.includes(window.location.host)
    )
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
            onReload={handleReload}
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
          onReload={handleReload}
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
  onReload: () => void
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
        <h2 style={{ 'margin-top': 0, color: '#ef4444' }}>App Crashed</h2>
        <p style={{ 'margin-bottom': '1rem' }}>
          An unexpected error occurred. You can try reloading or clearing stored data.
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
            Reload App
          </button>
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
            Clear Local Storage & Reload
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
            Clear IndexedDB & Reload
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
            Dismiss & Continue
          </button>
        </div>
      </div>
    </div>
  )
}
