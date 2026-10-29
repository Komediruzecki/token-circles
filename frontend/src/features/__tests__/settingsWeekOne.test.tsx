/**
 * Settings > Email reminders: the switch for the week-one mails (WeekOneMails.tsx).
 *
 * Against a mocked API: a Free account sees it working, outside the plan lock that dims the
 * reminders, and flipping it saves that one switch at once. It shows only while a mail can still
 * come, shows off and fixed after an unsubscribe from a mail, and local-first never shows it.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentPlan } from '../../core/billingStore'
import { setSettingsTab } from '../../core/settingsStore'
import { removeToast, toasts } from '../../core/toastStore'
import { WEEK_ONE_DESCRIPTION, WEEK_ONE_UNSUBSCRIBED } from '../WeekOneMails'

const { server, calls } = vi.hoisted(() => ({
  server: {
    plan: 'free',
    weekOneMails: true,
    weekOneAhead: true,
    unsubscribed: false,
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
    if (url === '/api/notifications/settings' && method === 'PUT') {
      if (server.putStatus !== 200)
        return reply({ error: 'Something went wrong' }, server.putStatus)
      if (typeof body?.weekOneMails === 'boolean') server.weekOneMails = body.weekOneMails
      return reply({ ok: true })
    }
    if (url === '/api/notifications/resubscribe' && method === 'POST') {
      server.unsubscribed = false
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
        weekOneMails: server.weekOneMails,
        weekOneAhead: server.weekOneAhead,
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
  server.plan = 'free'
  server.weekOneMails = true
  server.weekOneAhead = true
  server.unsubscribed = false
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
  setCurrentPlan(null)
})

async function openSettings(mode: 'self-hosted' | 'serverless' = 'self-hosted') {
  localStorage.setItem('finance_storage_mode', mode)
  setSettingsTab('general')
  const { default: Settings } = await import('../Settings')
  dispose = render(() => <Settings />, host)
  await settle()
}

const row = () => host.querySelector<HTMLElement>('[data-test-id="settings-week-one"]')
const toggle = () =>
  host.querySelector<HTMLButtonElement>('[data-test-id="settings-week-one-toggle"]')
const puts = () =>
  calls.filter((c) => c.url === '/api/notifications/settings' && c.method === 'PUT')

describe('the week-one switch', () => {
  it('works for a Free account, outside the plan lock, and saves itself when flipped', async () => {
    setCurrentPlan('free')
    await openSettings()

    // The reminders are locked for this plan; the week-one switch is not.
    const reminders = host.querySelector<HTMLButtonElement>(
      '[aria-label="Enable email notifications"]'
    )
    expect(reminders!.disabled).toBe(true)
    expect(row()).not.toBeNull()
    expect(row()!.textContent).toContain('First-week mails')
    expect(row()!.textContent).toContain(WEEK_ONE_DESCRIPTION)
    expect(toggle()!.disabled).toBe(false)
    expect(toggle()!.getAttribute('aria-checked')).toBe('true')

    toggle()!.click()
    await settle()

    expect(puts()).toEqual([
      { url: '/api/notifications/settings', method: 'PUT', body: { weekOneMails: false } },
    ])
    expect(toggle()!.getAttribute('aria-checked')).toBe('false')
    expect(toasts().at(-1)).toMatchObject({ type: 'success', message: 'First-week mails are off.' })
  })

  it('stays as it was when the save fails', async () => {
    server.putStatus = 500
    await openSettings()

    toggle()!.click()
    await settle()

    expect(toggle()!.getAttribute('aria-checked')).toBe('true')
    expect(toasts().at(-1)).toMatchObject({ type: 'error' })
  })

  it('is not shown once no week-one mail can come', async () => {
    server.weekOneAhead = false
    await openSettings()
    expect(host.querySelector('[data-test-id="settings-notifications-form"]')).not.toBeNull()
    expect(row()).toBeNull()
  })

  it('shows off and fixed after an unsubscribe from a mail, and says why', async () => {
    server.unsubscribed = true
    await openSettings()

    expect(toggle()!.getAttribute('aria-checked')).toBe('false')
    expect(toggle()!.disabled).toBe(true)
    expect(row()!.textContent).toContain(WEEK_ONE_UNSUBSCRIBED)
  })

  it('comes back on with Send me reminders again, which lifts the same unsubscribe', async () => {
    server.plan = 'advanced'
    server.unsubscribed = true
    setCurrentPlan('advanced')
    await openSettings()
    expect(toggle()!.disabled).toBe(true)

    host
      .querySelector<HTMLButtonElement>('[data-test-id="settings-reminders-resubscribe"]')!
      .click()
    await settle()

    expect(calls.some((c) => c.url === '/api/notifications/resubscribe')).toBe(true)
    expect(toggle()!.disabled).toBe(false)
    expect(toggle()!.getAttribute('aria-checked')).toBe('true')
    expect(row()!.textContent).toContain(WEEK_ONE_DESCRIPTION)
    expect(row()!.textContent).not.toContain(WEEK_ONE_UNSUBSCRIBED)
  })

  it('is never shown in local-first, which asks no server about it', async () => {
    await openSettings('serverless')
    expect(row()).toBeNull()
    expect(calls.filter((c) => c.url.startsWith('/api/notifications'))).toEqual([])
  })
})
