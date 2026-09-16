import { createEffect, createResource, createSignal, onMount, Show } from 'solid-js'
import { toast } from '../core/api'
import { apiFetch } from '../core/apiFetch'
import { setPage } from '../core/appStore'

function humanizeError(rawError: string | null): string {
  if (!rawError) return 'An unexpected error occurred during bank connection.'
  if (rawError.includes('ALREADY_AUTHORIZED') || rawError.includes('already authorized')) {
    return 'This bank authorization link has already been used or has expired. Please initiate a new connection from Settings.'
  }
  if (rawError.includes('access_denied') || rawError.includes('Cancelled by user')) {
    return 'Bank connection was cancelled.'
  }
  // Strip raw JSON wrapping if present
  try {
    const jsonMatch = rawError.match(/\{.*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      if (parsed.message) return parsed.message
    }
  } catch {
    // Ignore JSON parse errors and return original
  }
  return rawError
}

async function authorizeSession(code: string) {
  const res = await apiFetch('/api/imports/enablebanking/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to authorize session')
  }
  return res.json()
}

export default function BankCallback() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const err = params.get('error')
  const errDesc = params.get('error_description')

  const [authCode, setAuthCode] = createSignal<string | null>(null)

  onMount(() => {
    if (code && !err) {
      setAuthCode(code)
      // Wipe the query params from the URL immediately to avoid re-submitting an already-used one-time code
      window.history.replaceState(null, '', '/#bankCallback')
    }
  })

  const [resource] = createResource(authCode, authorizeSession)

  createEffect(() => {
    if (resource.state === 'ready') {
      toast('Bank account linked successfully!', 'success')
      setPage('settings')
      window.history.replaceState(null, '', '/#settings')
    }
  })

  const errorMessage = () => {
    if (err) return humanizeError(errDesc || err)
    if (resource.error) return humanizeError(resource.error.message)
    return null
  }

  return (
    <div
      style={{ padding: '2rem', 'max-width': '600px', margin: '0 auto', 'text-align': 'center' }}
    >
      <h1>Connecting to your Bank...</h1>
      <Show when={!err && resource.loading}>
        <p>Please wait while we establish a secure connection...</p>
      </Show>

      <Show when={errorMessage()}>
        <div
          style={{
            color: 'var(--color-danger, #ef4444)',
            'margin-top': '1.5rem',
            padding: '1rem',
            border: '1px solid var(--color-danger, #ef4444)',
            'border-radius': '8px',
            'background-color': 'rgba(239, 68, 68, 0.05)',
            'line-height': '1.5',
          }}
        >
          {errorMessage()}
        </div>
        <button
          style={{ 'margin-top': '1.5rem', padding: '0.5rem 1.25rem', cursor: 'pointer' }}
          onClick={() => {
            setPage('settings')
          }}
        >
          Return to Settings
        </button>
      </Show>
    </div>
  )
}
