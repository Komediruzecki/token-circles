/**
 * Settings > Email reminders after an unsubscribe by the link in a reminder mail.
 *
 * The Worker's GET answers `unsubscribed: true` while that link's stop is in force. The switches
 * can all read on and still nothing is sent, so the card says why, and that a save with a reminder
 * on turns reminder mails back on (the Worker clears the stop on that save). Once the save is in,
 * the card reloads and the line goes. A plan without email reminders cannot save here, so it is
 * not told to.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentPlan } from '../../core/billingStore'
import { setSettingsTab } from '../../core/settingsStore'
import { removeToast, toasts } from '../../core/toastStore'

const { server, calls } = vi.hoisted(() => ({
  server: { unsubscribed: false, plan: 'advanced' },
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
    if (url === '/api/notifications/settings' && method === 'PUT') {
      // What the Worker does: a save with a reminder on lifts the stop.
      if (
        body?.emailNotifications &&
        (body.budgetAlerts || body.spendingReport || body.billsReminders)
      ) {
        server.unsubscribed = false
      }
      return reply({ ok: true })
    }
    if (url === '/api/notifications/settings') {
      return reply({
        email: 'me@example.com',
        pendingEmail: null,
        emailNotifications: true,
        budgetAlerts: true,
        spendingReport: true,
        billsReminders: true,
        unsubscribed: server.unsubscribed,
      })
    }
    if (url === '/api/billing/status') return reply({ plan: server.plan })
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
  server.unsubscribed = false
  server.plan = 'advanced'
  setCurrentPlan(null)
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

async function openSettings() {
  localStorage.setItem('finance_storage_mode', 'self-hosted')
  setSettingsTab('general')
  const { default: Settings } = await import('../Settings')
  dispose = render(() => <Settings />, host)
  await settle()
}

const line = () =>
  host.querySelector<HTMLElement>('[data-test-id="settings-reminders-unsubscribed"]')
const save = () =>
  host.querySelector<HTMLButtonElement>('[data-test-id="settings-notifications-save"]')!

describe('the unsubscribed line in Email reminders', () => {
  it('shows while the account is unsubscribed by link, and says how to turn reminders back on', async () => {
    server.unsubscribed = true
    await openSettings()

    expect(line()).not.toBeNull()
    expect(line()!.textContent).toContain('unsubscribe link')
    expect(line()!.textContent).toContain('save')
  })

  it('is not shown for an account that never unsubscribed', async () => {
    await openSettings()

    expect(host.querySelector('[data-test-id="settings-notifications-form"]')).not.toBeNull()
    expect(line()).toBeNull()
  })

  it('goes once a save with a reminder on is in', async () => {
    server.unsubscribed = true
    await openSettings()
    expect(line()).not.toBeNull()

    save().click()
    await settle()

    expect(
      calls.filter((c) => c.url === '/api/notifications/settings' && c.method === 'PUT')
    ).toHaveLength(1)
    expect(line()).toBeNull()
  })

  it('is not shown on a plan without email reminders, which cannot save here', async () => {
    server.unsubscribed = true
    server.plan = 'free'
    await openSettings()

    expect(host.querySelector('[data-test-id="settings-notifications-form"]')).not.toBeNull()
    expect(line()).toBeNull()
  })
})
