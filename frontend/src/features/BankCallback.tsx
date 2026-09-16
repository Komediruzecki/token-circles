import { createSignal, onMount, Show } from 'solid-js'
import { toast } from '../core/api'
import { apiFetch } from '../core/apiFetch'
import { setPage } from '../core/appStore'

export default function BankCallback() {
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(true)

  onMount(async () => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const err = params.get('error')
    const errDesc = params.get('error_description')

    if (err) {
      setError(`Bank authorization failed: ${errDesc || err}`)
      setLoading(false)
      return
    }

    if (!code) {
      setError('No authorization code found in URL.')
      setLoading(false)
      return
    }

    try {
      const res = await apiFetch('/api/imports/enablebanking/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })

      if (!res.ok) {
        throw new Error((await res.json()).error || 'Failed to authorize session')
      }

      toast('Bank account linked successfully!')
      // Redirect to imports or settings
      setPage('settings')
      // Wipe the query params from the URL cleanly
      window.history.replaceState(null, '', '/#settings')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  })

  return (
    <div
      style={{ padding: '2rem', 'max-width': '600px', margin: '0 auto', 'text-align': 'center' }}
    >
      <h1>Connecting to your Bank...</h1>
      <Show when={loading()}>
        <p>Please wait while we establish a secure connection...</p>
      </Show>
      <Show when={error()}>
        <div
          style={{ color: 'red', 'margin-top': '1rem', padding: '1rem', border: '1px solid red' }}
        >
          {error()}
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
