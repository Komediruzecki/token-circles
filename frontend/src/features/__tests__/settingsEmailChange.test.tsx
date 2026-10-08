/**
 * Settings > Email reminders: a new address takes effect once the new address confirms it.
 *
 * Against a mocked API, the page shows a change that is waiting (the address, Send again, Cancel
 * change), keeps the field on the account's current address, and moves a saved address into that
 * waiting state rather than showing it as the account's. Local-first has no account email, so its
 * Settings shows no email field and asks no server for one.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setSettingsTab } from '../../core/settingsStore'
import { removeToast, toasts } from '../../core/toastStore'

const { server, calls } = vi.hoisted(() => ({
  server: {
    email: 'me@example.com',
    pendingEmail: null as string | null,
    resendStatus: 200,
    putStatus: 200,
  },
  calls: [] as { url: string; method: string; body?: Record<string, unknown> }[],
}))

vi.mock('../../core/apiFetch', () => ({
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined
    calls.push({ url, method, body })
    const reply = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    if (url === '/api/notifications/settings' && method === 'PUT' && server.putStatus === 409) {
      return reply({ error: 'That email is already in use' }, 409)
    }
    if (url === '/api/notifications/settings' && method === 'PUT') {
      const asked = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (!asked || asked === server.email) return reply({ ok: true })
      server.pendingEmail = asked
      return reply({ ok: true, pendingEmail: asked })
    }
    if (url === '/api/notifications/settings') {
      return reply({
        email: server.email,
        pendingEmail: server.pendingEmail,
        emailNotifications: true,
        budgetAlerts: true,
        spendingReport: true,
        billsReminders: true,
      })
    }
    if (url === '/api/auth/email-change/resend') {
      if (server.resendStatus === 429) {
        return reply({ error: 'Too many attempts. Please try again in about 40 minutes.' }, 429)
      }
      if (server.resendStatus === 404) {
        return reply({ error: 'No email change is waiting to be confirmed' }, 404)
      }
      return reply({ ok: true, pendingEmail: server.pendingEmail })
    }
    if (url === '/api/auth/email-change' && method === 'DELETE') {
      server.pendingEmail = null
      return reply({ ok: true })
    }
    if (url === '/api/billing/status') return reply({ plan: 'advanced' })
    if (url.startsWith('/api/profiles')) return reply([])
    return reply({})
  }),
}))

const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  for (let i = 0; i < 6; i++) await flush()
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  server.email = 'me@example.com'
  server.pendingEmail = null
  server.resendStatus = 200
  server.putStatus = 200
  calls.length = 0
  for (const t of toasts()) removeToast(t.id)
  localStorage.clear()
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
  localStorage.clear()
})

async function openSettings(mode: 'self-hosted' | 'serverless' = 'self-hosted') {
  localStorage.setItem('finance_storage_mode', mode)
  setSettingsTab('general')
  const { default: Settings } = await import('../Settings')
  dispose = render(() => <Settings />, host)
  await settle()
}

const byId = (id: string) => host.querySelector<HTMLElement>(`[data-test-id="${id}"]`)
const button = (id: string) => host.querySelector<HTMLButtonElement>(`[data-test-id="${id}"]`)
const field = () => host.querySelector<HTMLInputElement>('[data-test-id="settings-email-input"]')
const pending = () => byId('settings-email-pending')
const lastToast = () => toasts().at(-1)

describe('an email change that is waiting', () => {
  it('shows the address it waits on, and keeps the field on the current one', async () => {
    server.pendingEmail = 'new@example.com'
    await openSettings()

    expect(pending()).not.toBeNull()
    expect(pending()!.textContent).toContain(
      'We sent a link to new@example.com. Your sign-in address changes when you open it.'
    )
    expect(field()!.value).toBe('me@example.com')
  })

  it('is not shown when nothing is waiting', async () => {
    await openSettings()

    expect(field()!.value).toBe('me@example.com')
    expect(pending()).toBeNull()
  })

  it('appears when a different address is saved, and the field goes back to the current one', async () => {
    await openSettings()

    field()!.value = 'New@Example.com'
    field()!.dispatchEvent(new Event('input', { bubbles: true }))
    button('settings-notifications-save')!.click()
    await settle()

    const put = calls.find((c) => c.url === '/api/notifications/settings' && c.method === 'PUT')
    expect(put?.body?.email).toBe('New@Example.com')
    expect(pending()!.textContent).toContain('new@example.com')
    expect(field()!.value).toBe('me@example.com')
    expect(lastToast()).toMatchObject({ type: 'success' })
    expect(lastToast()!.message).toContain('new@example.com')
  })

  it('says why a refused save was refused, in the words of the answer', async () => {
    server.putStatus = 409
    await openSettings()

    field()!.value = 'someone-else@example.com'
    field()!.dispatchEvent(new Event('input', { bubbles: true }))
    button('settings-notifications-save')!.click()
    await settle()

    expect(lastToast()).toMatchObject({ type: 'error', message: 'That email is already in use' })
    expect(pending()).toBeNull()
  })

  it('Send again asks for a fresh link and says where it went', async () => {
    server.pendingEmail = 'new@example.com'
    await openSettings()

    button('settings-email-resend')!.click()
    await settle()

    expect(calls.filter((c) => c.url === '/api/auth/email-change/resend')).toEqual([
      { url: '/api/auth/email-change/resend', method: 'POST', body: undefined },
    ])
    expect(lastToast()).toMatchObject({
      type: 'success',
      message: 'Link sent again to new@example.com.',
    })
    expect(pending()).not.toBeNull()
  })

  it('says why a refused Send again was refused, and can be tried again', async () => {
    server.pendingEmail = 'new@example.com'
    server.resendStatus = 429
    await openSettings()

    button('settings-email-resend')!.click()
    await settle()

    expect(lastToast()).toMatchObject({
      type: 'error',
      message: 'Too many attempts. Please try again in about 40 minutes.',
    })
    expect(button('settings-email-resend')!.disabled).toBe(false)
  })

  it('drops the waiting address when Send again finds nothing waiting', async () => {
    server.pendingEmail = 'new@example.com'
    server.resendStatus = 404
    await openSettings()

    button('settings-email-resend')!.click()
    await settle()

    expect(lastToast()).toMatchObject({
      type: 'error',
      message: 'No email change is waiting to be confirmed',
    })
    expect(pending()).toBeNull()
  })

  it('Cancel change ends it, and the account keeps its address', async () => {
    server.pendingEmail = 'new@example.com'
    await openSettings()

    button('settings-email-cancel')!.click()
    await settle()

    expect(calls.filter((c) => c.url === '/api/auth/email-change').map((c) => c.method)).toEqual([
      'DELETE',
    ])
    expect(pending()).toBeNull()
    expect(field()!.value).toBe('me@example.com')
    expect(lastToast()).toMatchObject({
      type: 'success',
      message: 'Email change canceled. Your account keeps me@example.com.',
    })
  })

  it('names the account address after a cancel, not an edit that is not saved', async () => {
    server.pendingEmail = 'new@example.com'
    await openSettings()

    field()!.value = 'half-typed@exa'
    field()!.dispatchEvent(new Event('input', { bubbles: true }))
    button('settings-email-cancel')!.click()
    await settle()

    expect(lastToast()).toMatchObject({
      type: 'success',
      message: 'Email change canceled. Your account keeps me@example.com.',
    })
  })
})

describe('local-first', () => {
  it('shows no email field and asks no server for one', async () => {
    await openSettings('serverless')

    expect(byId('settings-header')).not.toBeNull()
    expect(field()).toBeNull()
    expect(pending()).toBeNull()
    expect(
      calls.filter((c) => c.url.startsWith('/api/notifications') || c.url.includes('email-change'))
    ).toEqual([])
  })
})
