/**
 * Achievements must hear about every write, not just the ones made through the typed client.
 *
 * THE BUG THIS PINS. The `tc:data-changed` dispatch lived inside the typed client's `request()`
 * in api.ts. The raw helpers — `apiPost`, `apiPut`, `apiDelete` — call `apiFetch` directly and
 * never pass through `request()`, so a write made through them never triggered an achievements
 * evaluation. Goals, Bills and Budgets write *exclusively* through the raw helpers, so the four
 * badges that depend on their data (`first-budget`, `goal-in-sight`, `goal-reached`,
 * `under-budget-six`) unlocked only by accident — whenever some unrelated typed-client write
 * happened to fire the event later.
 *
 * The dispatch now lives in `apiFetch`, the one function both surfaces share, so this test drives
 * the real helpers rather than calling the announcer directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_CHANGED_EVENT } from '../dataChangedEvent'

let events: string[] = []
const record = (e: Event) => {
  events.push(((e as CustomEvent).detail as { endpoint: string }).endpoint)
}

beforeEach(() => {
  events = []
  window.addEventListener(DATA_CHANGED_EVENT, record)
})

afterEach(() => {
  window.removeEventListener(DATA_CHANGED_EVENT, record)
  vi.unstubAllGlobals()
  vi.resetModules()
})

/**
 * Load api.ts against a stubbed network in self-hosted mode, so the raw helpers run for real.
 */
async function loadApi(status = 200) {
  vi.resetModules()
  vi.doMock('../storage/storageFactory', () => ({
    getStorageMode: () => 'self-hosted',
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 1 }), {
          status,
          headers: { 'content-type': 'application/json' },
        })
    )
  )
  return import('../api')
}

describe('data-changed announcements', () => {
  it('fires for a raw apiPost — the path Goals, Bills and Budgets actually use', async () => {
    const { apiPost } = await loadApi()
    await apiPost('/api/savings-goals', { name: 'Car' })
    expect(events).toEqual(['/api/savings-goals'])
  })

  it('fires for a raw apiPut', async () => {
    const { apiPut } = await loadApi()
    await apiPut('/api/categories/3', { name: 'Rent' })
    expect(events).toEqual(['/api/categories/3'])
  })

  it('fires for a raw apiDelete', async () => {
    const { apiDelete } = await loadApi()
    await apiDelete('/api/categories/3')
    expect(events).toEqual(['/api/categories/3'])
  })

  it('still fires for the typed client, exactly once', async () => {
    // The dispatch moved rather than being duplicated: leaving the old one in api.ts as well
    // would double every typed write.
    const { api } = await loadApi()
    // The stubbed body does not satisfy the response schema, so this rejects after the request
    // completes. That is fine and deliberate: the announcement happens in apiFetch, before any
    // parsing, and the point here is that it happens exactly once — not that the call succeeds.
    await api
      .createTransaction({ amount: 1, description: 'x', date: '2026-01-01' } as never)
      .catch(() => undefined)
    expect(events).toHaveLength(1)
  })

  it('does not fire for a read', async () => {
    const { apiGet } = await loadApi()
    await apiGet('/api/categories')
    expect(events).toEqual([])
  })

  it('does not fire when the write failed', async () => {
    // A rejected write left the server's state alone, so nothing can have been earned.
    const { apiPost } = await loadApi(400)
    await apiPost('/api/savings-goals', { name: '' }).catch(() => undefined)
    expect(events).toEqual([])
  })

  it('does not fire for a settings write, which would evaluate forever', async () => {
    // Persisting an unlock is itself a settings write. Without this exclusion, evaluating
    // achievements schedules another evaluation, and so on.
    const { apiPut } = await loadApi()
    await apiPut('/api/settings', { theme: 'dark' })
    expect(events).toEqual([])
  })

  it('does not fire for the exact call achievementsStore persists unlocks with', async () => {
    // The loop this guards against is real and specific: refreshAchievements ends in
    // `api.updateSettings({...})`. That is the typed client, whose endpoint is '/settings' and
    // which only becomes '/api/settings' once apiFetch has resolved it — so the exclusion has to
    // be written against the resolved path, not the endpoint the caller passed. Testing it
    // through the raw helper above would not have caught getting that wrong.
    const { api } = await loadApi()
    await api.updateSettings({ theme: 'dark' } as never).catch(() => undefined)
    expect(events).toEqual([])
  })
})
