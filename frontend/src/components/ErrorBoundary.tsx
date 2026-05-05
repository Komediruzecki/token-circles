import { ErrorBoundary as SolidErrorBoundary } from 'solid-js'
import type { Component, JSX } from 'solid-js'

declare global {
  const __APP_VERSION__: string
}

interface Props {
  children: JSX.Element
}

export const ErrorBoundary: Component<Props> = (props) => {
  return (
    <SolidErrorBoundary
      fallback={(err, _reset) => {
        const handleReload = () => {
          window.location.reload()
        }

        const handleClearLocalStorage = () => {
          localStorage.clear()
          window.location.reload()
        }

        const handleClearIndexedDB = async () => {
          if (window.indexedDB && window.indexedDB.databases) {
            try {
              const dbs = await window.indexedDB.databases()
              dbs.forEach((db) => {
                if (db.name) {
                  window.indexedDB.deleteDatabase(db.name)
                }
              })
            } catch (e) {
              console.error('Failed to clear IndexedDB:', e)
            }
          }
          window.location.reload()
        }

        return (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              'background-color': 'rgba(0, 0, 0, 0.5)',
              'z-index': 9999,
            }}
          >
            <div
              style={{
                background: 'var(--bg-card, #ffffff)',
                color: 'var(--text-primary, #000000)',
                padding: '2rem',
                'border-radius': '8px',
                'max-width': '500px',
                width: '90%',
                'box-shadow': '0 4px 6px rgba(0, 0, 0, 0.1)',
              }}
            >
              <h2 style={{ 'margin-top': 0, color: '#ef4444' }}>App Crashed</h2>
              <p>We're sorry, but the application encountered an unexpected error.</p>

              <div
                style={{
                  background: 'var(--bg-body, #f3f4f6)',
                  padding: '1rem',
                  'border-radius': '4px',
                  'font-family': 'monospace',
                  'overflow-x': 'auto',
                  'margin-bottom': '1.5rem',
                  color: '#ef4444',
                }}
              >
                {err.toString()}
              </div>

              <div
                style={{
                  'margin-bottom': '1.5rem',
                  'font-size': '0.9rem',
                  color: 'var(--text-secondary, #6b7280)',
                }}
              >
                <p>
                  Version: {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown'}
                </p>
                <p>
                  Please consider reporting this bug on{' '}
                  <a
                    href="https://github.com/Komediruzecki/finance-manager/issues/new"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#3b82f6', 'text-decoration': 'underline' }}
                  >
                    GitHub
                  </a>
                  .
                </p>
              </div>

              <div style={{ display: 'flex', 'flex-direction': 'column', gap: '0.5rem' }}>
                <button
                  onClick={handleReload}
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
                  onClick={handleClearLocalStorage}
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
                  onClick={handleClearIndexedDB}
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
              </div>
            </div>
          </div>
        )
      }}
    >
      {props.children}
    </SolidErrorBoundary>
  )
}
