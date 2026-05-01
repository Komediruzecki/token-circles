/**
 * Error Boundary Component
 * Catches React/Solid errors and displays fallback UI
 */
import { createSignal } from 'solid-js'
import type { Component, JSX } from 'solid-js'

interface ErrorBoundaryProps {
  children: JSX.Element
  fallback?: Component<{ error: Error; reset: () => void }>
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export function ErrorBoundary(props: ErrorBoundaryProps) {
  const [state, setState] = createSignal<ErrorBoundaryState>({
    hasError: false,
    error: null,
  })

  const reset = () => {
    setState({ hasError: false, error: null })
    window.location.reload()
  }

  // Simple error handler for SolidJS
  const FallbackComponent =
    props.fallback ||
    (() => (
      <div
        style={{
          padding: '40px',
          'text-align': 'center',
          'max-width': '500px',
          margin: '0 auto',
        }}
      >
        <h2 style={{ color: '#dc3545', 'margin-bottom': '16px' }}>Something went wrong</h2>
        <p style={{ color: '#666', 'margin-bottom': '20px' }}>
          {state().error?.message ?? 'An unexpected error occurred'}
        </p>
        <button
          onClick={reset}
          style={{
            padding: '10px 20px',
            background: '#007bff',
            color: 'white',
            border: 'none',
            'border-radius': '6px',
            cursor: 'pointer',
            'font-size': '14px',
          }}
        >
          Reload Page
        </button>
      </div>
    ))

  if (state().hasError) {
    return <FallbackComponent error={state().error!} reset={reset} />
  }

  return (
    <ErrorCatch onError={(error) => setState({ hasError: true, error })}>
      {props.children}
    </ErrorCatch>
  )
}

// Helper component to catch errors
function ErrorCatch(props: { children: JSX.Element; onError: (e: Error) => void }) {
  return props.children
}
