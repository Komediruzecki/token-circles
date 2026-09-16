import { createEffect, createResource, createSignal, onMount, Show } from 'solid-js'
import { toast } from '../core/api'
import { apiFetch } from '../core/apiFetch'
import { setPage } from '../core/appStore'

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

  return (
    <div
      style={{ padding: '2rem', 'max-width': '600px', margin: '0 auto', 'text-align': 'center' }}
    >
      <h1>Connecting to your Bank...</h1>
      <Show when={!err && resource.loading}>
        <p>Please wait while we establish a secure connection...</p>
      </Show>

      <Show when={err}>
        <div
          style={{ color: 'red', 'margin-top': '1rem', padding: '1rem', border: '1px solid red' }}
        >
          Bank authorization failed: {errDesc || err}
        </div>
        <button
          style={{ 'margin-top': '1rem', padding: '0.5rem 1rem' }}
          onClick={() => {
            setPage('settings')
          }}
        >
          Return to Settings
        </button>
      </Show>

      <Show when={resource.error}>
        <div
          style={{ color: 'red', 'margin-top': '1rem', padding: '1rem', border: '1px solid red' }}
        >
          {resource.error.message}
        </div>
        <button
          style={{ 'margin-top': '1rem', padding: '0.5rem 1rem' }}
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
