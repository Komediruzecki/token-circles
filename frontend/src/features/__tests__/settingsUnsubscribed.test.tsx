/**
 * Settings > Email reminders after an unsubscribe by the link in a reminder mail.
 *
 * The Worker's GET answers `unsubscribed: true` while that unsubscribe is in force. The switches
 * can all read on and still nothing is sent, so the card says why and offers "Send me reminders
 * again", which posts to /api/notifications/resubscribe. Saving the form does not lift it (the
 * Worker ignores the switches for that), so the line stays after a save. A refusal is shown in the
 * line. A plan without email reminders cannot use the button, so it is not offered.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentPlan } from '../../core/billingStore'
import { setSettingsTab } from '../../core/settingsStore'
import { removeToast, toasts } from '../../core/toastStore'

const { server, calls } = vi.hoisted(() => ({
  server: { unsubscribed: false, plan: 'advanced', resubscribeStatus: 200 },
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
    // A save never lifts the unsubscribe; only the button's request does.
    if (url === '/api/notifications/settings' && method === 'PUT') return reply({ ok: true })
    if (url === '/api/notifications/resubscribe' && method === 'POST') {
      if (server.resubscribeStatus === 400) {
        return reply(
          { error: 'Turn on email notifications and at least one reminder, save, then try again.' },
          400
        )
      }
      server.unsubscribed = false
      return reply({ ok: true, unsubscribed: false })
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
  server.resubscribeStatus = 200
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

const resubscribeButton = () =>
  host.querySelector<HTMLButtonElement>('[data-test-id="settings-reminders-resubscribe"]')
const posts = () =>
  calls.filter((c) => c.url === '/api/notifications/resubscribe' && c.method === 'POST')

describe('the unsubscribed line in Email reminders', () => {
  it('shows while the account is unsubscribed by link, with the button', async () => {
    server.unsubscribed = true
    await openSettings()

    expect(line()).not.toBeNull()
    expect(line()!.textContent).toContain('unsubscribe link')
    expect(resubscribeButton()!.textContent).toContain('Send me reminders again')
  })

  it('is not shown for an account that never unsubscribed', async () => {
    await openSettings()

    expect(host.querySelector('[data-test-id="settings-notifications-form"]')).not.toBeNull()
    expect(line()).toBeNull()
  })

  it('stays after a save, which does not turn reminder mails back on', async () => {
    server.unsubscribed = true
    await openSettings()

    save().click()
    await settle()

    expect(
      calls.filter((c) => c.url === '/api/notifications/settings' && c.method === 'PUT')
    ).toHaveLength(1)
    expect(posts()).toEqual([])
    expect(line()).not.toBeNull()
  })

  it('goes once the button is pressed and the Worker lifts it', async () => {
    server.unsubscribed = true
    await openSettings()

    resubscribeButton()!.click()
    await settle()

    expect(posts()).toHaveLength(1)
    expect(line()).toBeNull()
    expect(toasts().at(-1)).toMatchObject({ type: 'success' })
  })

  it('shows a refusal in the line, in the words of the answer, and keeps the button', async () => {
    server.unsubscribed = true
    server.resubscribeStatus = 400
    await openSettings()

    resubscribeButton()!.click()
    await settle()

    expect(line()).not.toBeNull()
    expect(line()!.querySelector('[role="alert"]')!.textContent).toContain('at least one reminder')
    expect(resubscribeButton()).not.toBeNull()
  })

  it('is not shown on a plan without email reminders, which cannot use the button', async () => {
    server.unsubscribed = true
    server.plan = 'free'
    await openSettings()

    expect(host.querySelector('[data-test-id="settings-notifications-form"]')).not.toBeNull()
    expect(line()).toBeNull()
  })
})
