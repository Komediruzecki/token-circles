/**
 * API access panel, driven through the real component.
 *
 * The property worth protecting is the one the worker cannot help with: the token secret comes
 * back exactly once and is unrecoverable afterwards, so the reveal must not be dismissible by
 * anything except an explicit acknowledgement. Everything else here is wiring — a create that
 * posts the wrong body, a revoke that hits the wrong id — which is why this mounts the panel and
 * clicks the buttons rather than re-implementing the logic.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { showConfirm as ShowConfirm } from '../../core/confirmStore'

const token = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'tok-1',
  name: 'Claude on my laptop',
  hint: '1a2b3c4d',
  scopes: ['read', 'import'],
  default_profile_id: 7,
  created_at: '2026-08-29 10:00:00',
  last_used_at: null,
  expires_at: null,
  revoked_at: null,
  ...over,
})

let serverTokens: Record<string, unknown>[] = []
const profiles = [
  { id: 7, name: 'Personal' },
  { id: 8, name: 'Business' },
]

const apiFetch = vi.fn(async (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET'
  if (url === '/api/profiles') return new Response(JSON.stringify(profiles), { status: 200 })
  if (url === '/api/account/api-tokens' && method === 'GET') {
    return new Response(JSON.stringify({ tokens: serverTokens }), { status: 200 })
  }
  if (url === '/api/account/api-tokens' && method === 'POST') {
    serverTokens = [token(), ...serverTokens]
    return new Response(
      JSON.stringify({ id: 'tok-1', secret: 'tc_pat_SECRETVALUE', hint: '1a2b3c4d' }),
      { status: 201 }
    )
  }
  if (url.startsWith('/api/account/api-tokens/') && method === 'DELETE') {
    const id = url.split('/').pop()
    serverTokens = serverTokens.map((t) => (t.id === id ? { ...t, revoked_at: '2026-08-29' } : t))
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  return new Response('{}', { status: 404 })
})

const toast = vi.fn()
vi.mock('../../core/apiFetch', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...(a as [string])),
  // The panel prints the MCP endpoint for the user to paste; a deployed build reads it
  // from VITE_API_URL rather than the SPA's own origin.
  API_ORIGIN: 'https://api.example.test',
}))
vi.mock('../../core/api', () => ({ toast: (...a: unknown[]) => toast(...a) }))
vi.mock('../../core/apiProfileScope', () => ({ activeProfileId: () => 7 }))
vi.mock('../../core/confirmStore', async (importOriginal) => ({
  ...(await importOriginal<{ showConfirm: typeof ShowConfirm }>()),
  showConfirm: vi.fn(async () => true),
}))

const flush = () => new Promise((r) => setTimeout(r, 0))

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  serverTokens = []
  apiFetch.mockClear()
  toast.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  host?.remove()
})

async function mount() {
  const { default: ApiAccess } = await import('../ApiAccess')
  dispose = render(() => <ApiAccess />, host)
  await flush()
  await flush()
  return host
}

const byText = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

const nameInput = (root: HTMLElement) => root.querySelector<HTMLInputElement>('#api-token-name')
// Keyed by test id, not text: the label carries a typographic apostrophe.
const ackButton = (root: HTMLElement) =>
  root.querySelector<HTMLButtonElement>('[data-test-id="api-token-ack"]')
const checkboxes = (root: HTMLElement) => [
  ...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
]

async function fillName(root: HTMLElement, value: string) {
  const input = nameInput(root)!
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flush()
}

describe('creating a token', () => {
  it('will not submit without a name, or without a scope', async () => {
    const root = await mount()
    const create = () => byText(root, 'Create token')!

    // The worker 422s on both; a disabled button beats a round-trip to find that out.
    expect(create().disabled, 'no name yet').toBe(true)

    await fillName(root, 'My token')
    expect(create().disabled, 'name and the default read scope').toBe(false)

    checkboxes(root)[0]!.click() // uncheck the only checked scope
    await flush()
    expect(create().disabled, 'name but no scopes').toBe(true)
  })

  it('posts the name, scopes and default profile the form is showing', async () => {
    const root = await mount()
    await fillName(root, 'Drive routine')
    checkboxes(root)[2]!.click() // + import
    await flush()

    byText(root, 'Create token')!.click()
    await flush()

    const post = apiFetch.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(post, 'a POST should have been made').toBeDefined()
    const sent = post![1]!.body
    expect(typeof sent, 'body should be a JSON string').toBe('string')
    expect(JSON.parse(sent as string)).toEqual({
      name: 'Drive routine',
      scopes: ['read', 'import'],
      defaultProfileId: 7,
    })
  })
})

describe('the secret reveal', () => {
  it('shows the secret once and cannot be dismissed except by acknowledging it', async () => {
    const root = await mount()
    await fillName(root, 'My token')
    byText(root, 'Create token')!.click()
    await flush()

    const dialog = root.querySelector('[data-test-id="api-token-reveal"]')
    expect(dialog, 'reveal should be open').not.toBeNull()
    expect(dialog!.textContent).toContain('tc_pat_SECRETVALUE')

    // Clicking the backdrop must NOT close it: the secret is unrecoverable, so a stray click
    // outside would cost the user the token.
    ;(dialog as HTMLElement).click()
    await flush()
    expect(
      root.querySelector('[data-test-id="api-token-reveal"]'),
      'backdrop click should not dismiss'
    ).not.toBeNull()

    ackButton(root)!.click()
    await flush()
    expect(root.querySelector('[data-test-id="api-token-reveal"]')).toBeNull()
    // And it is gone for good — the list never carries the secret.
    expect(root.textContent).not.toContain('tc_pat_SECRETVALUE')
  })

  it('names the API origin as the MCP endpoint, not the page it is being viewed on', async () => {
    // Derived from window.location this reads https://api.localhost:3800/mcp in development and
    // the SPA's own host in a same-origin build -- neither of which serves /mcp.
    const root = await mount()
    await fillName(root, 'My token')
    byText(root, 'Create token')!.click()
    await flush()

    const dialog = root.querySelector('[data-test-id="api-token-reveal"]')!
    expect(dialog.textContent).toContain('https://api.example.test/mcp')
    expect(dialog.textContent).toContain('Authorization: Bearer tc_pat_SECRETVALUE')
  })

  it('clears the name field so the next token cannot silently reuse it', async () => {
    const root = await mount()
    await fillName(root, 'My token')
    byText(root, 'Create token')!.click()
    await flush()
    ackButton(root)!.click()
    await flush()
    expect(nameInput(root)!.value).toBe('')
  })
})

describe('the token list', () => {
  it('flags a token that has never been used', async () => {
    serverTokens = [token()]
    const root = await mount()
    expect(root.querySelector('[data-test-id="api-token-list"]')!.textContent).toContain(
      'Never used'
    )
  })

  it('names the profile a token defaults to, rather than its id', async () => {
    serverTokens = [token()]
    const root = await mount()
    const list = root.querySelector('[data-test-id="api-token-list"]')!
    expect(list.textContent).toContain('Personal')
    expect(list.textContent).not.toContain('Profile 7')
  })

  it('revokes the token whose button was clicked, then re-renders it as revoked', async () => {
    serverTokens = [token({ id: 'tok-a', name: 'Keep' }), token({ id: 'tok-b', name: 'Drop' })]
    const root = await mount()

    const rows = [...root.querySelectorAll('[data-test-id="api-token-list"] li')]
    const dropRow = rows.find((r) => r.textContent?.includes('Drop'))!
    dropRow.querySelector<HTMLButtonElement>('button')!.click()
    await flush()
    await flush()

    const del = apiFetch.mock.calls.find(([, init]) => init?.method === 'DELETE')
    expect(del![0]).toBe('/api/account/api-tokens/tok-b')

    const after = [...root.querySelectorAll('[data-test-id="api-token-list"] li')]
    const revoked = after.find((r) => r.textContent?.includes('Drop'))!
    expect(revoked.textContent, 'revoked tokens stay listed, badged').toContain('Revoked')
    // No revoke button on an already-revoked token.
    expect(revoked.querySelector('button')).toBeNull()
  })

  it('says so when there are no tokens instead of rendering an empty list', async () => {
    const root = await mount()
    expect(root.textContent).toContain('No tokens yet.')
    expect(root.querySelector('[data-test-id="api-token-list"]')).toBeNull()
  })
})
