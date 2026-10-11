/**
 * Signed in, the setup wizard belongs to the account: its record is on the Worker
 * (`/api/account/state`, user_state), so every device the account signs in on reads the same one.
 *
 * Against a stand-in for the Worker that keeps each account's record with the Worker's own rule
 * (shared/accountState.ts, checkUserStateWrite), because that is the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkUserStateWrite, sqliteDateTime } from '../../../../shared/accountState'
import { __resetAccountStateForTest, readAccountState } from '../accountState'
import {
  completeOnboarding,
  getOnboardingStatus,
  maybeOfferOnboarding,
  nextOnboardingStep,
  onboardingMirrorSettled,
  onboardingOpen,
  onboardingStep,
  prevOnboardingStep,
  setOnboardingOwner,
  skipOnboarding,
  startOnboarding,
  whereToOfferOnboarding,
} from '../onboardingStore'
import type { OnboardingRecord } from '../../../../shared/accountStateKeys'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The Worker: who is signed in, what each account has stored, and every request it was sent. */
const worker = {
  signedIn: 5,
  records: new Map<number, OnboardingRecord>(),
  settings: new Map<number, Record<string, unknown>>(),
  failRead: false,
  failWrite: false,
  /** Runs as the settings are read: another sign-in finishing while they are on their way. */
  whileSettingsRead: null as (() => void) | null,
  sent: [] as string[],
}

function workerStandIn() {
  return async (url: string, init: RequestInit = {}) => {
    const path = new URL(url, 'http://localhost').pathname
    const method = (init.method ?? 'GET').toUpperCase()
    const body = typeof init.body === 'string' ? init.body : ''
    worker.sent.push(`${method} ${path}${body ? ` ${body}` : ''}`)
    const id = worker.signedIn
    if (path === '/api/account/state' && method === 'GET') {
      if (worker.failRead) return json({ error: 'Something went wrong on our side.' }, 500)
      return json({
        onboarding: worker.records.get(id) ?? null,
        tours: null,
        getting_started: null,
      })
    }
    if (path === '/api/account/state/onboarding' && method === 'PUT') {
      if (worker.failWrite) return json({ error: 'Something went wrong on our side.' }, 500)
      const checked = checkUserStateWrite(
        'onboarding',
        JSON.parse(body) as unknown,
        worker.records.get(id) ?? null,
        sqliteDateTime(new Date())
      )
      if (!checked.ok) return json({ error: 'Check the fields.', fields: checked.fields }, 400)
      worker.records.set(id, checked.value)
      return json({ onboarding: checked.value })
    }
    if (path === '/api/settings' && method === 'GET') {
      worker.whileSettingsRead?.()
      return json(worker.settings.get(id) ?? {})
    }
    if (path === '/api/settings' && method === 'PUT') return json({ ok: true })
    return json([])
  }
}

const statePuts = () => worker.sent.filter((r) => r.startsWith('PUT /api/account/state'))
const settingsPuts = () => worker.sent.filter((r) => r.startsWith('PUT /api/settings'))

/** A page load signed in as `id`: nothing read yet. */
function signIn(id: number): void {
  worker.signedIn = id
  setOnboardingOwner(null)
  __resetAccountStateForTest()
  setOnboardingOwner(`account-${id}`)
}

/** Let the writes the store sends without waiting settle. */
async function settled(): Promise<void> {
  await onboardingMirrorSettled()
  await vi.waitFor(async () => {
    const before = worker.sent.length
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(worker.sent.length).toBe(before)
  })
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'self-hosted')
  vi.stubGlobal('fetch', workerStandIn())
  // Close a wizard a previous case left open, as nobody, so nothing is recorded for it.
  setOnboardingOwner(null)
  __resetAccountStateForTest()
  if (onboardingOpen()) skipOnboarding()
  await onboardingMirrorSettled()
  worker.records.clear()
  worker.settings.clear()
  worker.failRead = false
  worker.failWrite = false
  worker.whileSettingsRead = null
  worker.sent.length = 0
})

afterEach(async () => {
  await settled()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('an account whose record is finished', () => {
  it('is offered nothing on a fresh browser, and nothing is written', async () => {
    worker.records.set(5, {
      step: 'done',
      started_at: '2026-10-01 09:00:00',
      finished_at: '2026-10-01 09:05:00',
      outcome: 'completed',
    })
    signIn(5)

    await maybeOfferOnboarding()

    expect(onboardingOpen()).toBe(false)
    expect(worker.sent).toEqual(['GET /api/account/state'])
  })

  it('walks a relaunched wizard without touching the record', async () => {
    const finished: OnboardingRecord = {
      step: null,
      started_at: null,
      finished_at: '2026-10-11 08:00:00',
      outcome: 'existing',
    }
    worker.records.set(5, { ...finished })
    signIn(5)
    expect(await whereToOfferOnboarding()).toBeNull()

    // From the tour menu or Settings.
    startOnboarding()
    nextOnboardingStep()
    nextOnboardingStep()
    completeOnboarding()
    await settled()

    expect(statePuts()).toEqual([])
    expect(worker.records.get(5)).toEqual(finished)
  })

  it("removes this browser's flag, which the record now replaces", async () => {
    worker.records.set(5, {
      step: 'import',
      started_at: '2026-10-01 09:00:00',
      finished_at: '2026-10-01 09:05:00',
      outcome: 'skipped',
    })
    localStorage.setItem('finance_onboarding:account-5', 'completed')
    signIn(5)

    expect(await whereToOfferOnboarding()).toBeNull()

    expect(getOnboardingStatus()).toBeNull()
    expect(statePuts()).toEqual([])
  })
})

describe('an account with no finished record', () => {
  it('is offered the wizard at welcome, and each step further on is kept on the account', async () => {
    signIn(5)

    await maybeOfferOnboarding()
    expect(onboardingOpen()).toBe(true)
    expect(onboardingStep()).toBe('welcome')
    await vi.waitFor(() => {
      expect(worker.records.get(5)?.step).toBe('welcome')
    })
    const startedAt = worker.records.get(5)!.started_at
    expect(startedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)

    nextOnboardingStep()
    await vi.waitFor(() => {
      expect(worker.records.get(5)?.step).toBe('space')
    })
    nextOnboardingStep()
    await vi.waitFor(() => {
      expect(worker.records.get(5)?.step).toBe('account')
    })
    // Back, and forward to a step already reached: nothing new to keep.
    prevOnboardingStep()
    nextOnboardingStep()
    await settled()

    expect(statePuts()).toEqual([
      'PUT /api/account/state/onboarding {"step":"welcome"}',
      'PUT /api/account/state/onboarding {"step":"space"}',
      'PUT /api/account/state/onboarding {"step":"account"}',
    ])
    expect(worker.records.get(5)).toEqual({
      step: 'account',
      started_at: startedAt,
      finished_at: null,
      outcome: null,
    })
  })

  it('reopens at the step it reached, on another device', async () => {
    worker.records.set(5, {
      step: 'import',
      started_at: '2026-10-11 09:00:00',
      finished_at: null,
      outcome: null,
    })
    signIn(5)

    await maybeOfferOnboarding()

    expect(onboardingOpen()).toBe(true)
    expect(onboardingStep()).toBe('import')
    await settled()
    expect(statePuts()).toEqual([])
  })

  it('keeps a skip on the account, with the step it was left on, and writes no settings', async () => {
    signIn(5)
    await maybeOfferOnboarding()
    nextOnboardingStep()

    skipOnboarding()
    await settled()

    expect(onboardingOpen()).toBe(false)
    expect(worker.records.get(5)).toMatchObject({ step: 'space', outcome: 'skipped' })
    expect(worker.records.get(5)!.finished_at).not.toBeNull()
    expect(statePuts().at(-1)).toBe(
      'PUT /api/account/state/onboarding {"step":"space","outcome":"skipped"}'
    )
    expect(settingsPuts()).toEqual([])
    expect(getOnboardingStatus()).toBeNull()

    // The next load, here or anywhere, reads the finished record.
    signIn(5)
    expect(await whereToOfferOnboarding()).toBeNull()
  })

  it('sends a decision this browser kept to the account, once', async () => {
    localStorage.setItem('finance_onboarding:account-5', 'completed')
    signIn(5)

    expect(await whereToOfferOnboarding()).toBeNull()
    await settled()

    expect(statePuts()).toEqual(['PUT /api/account/state/onboarding {"outcome":"completed"}'])
    expect(worker.records.get(5)).toMatchObject({ step: null, outcome: 'completed' })
    expect(getOnboardingStatus()).toBeNull()

    signIn(5)
    expect(await whereToOfferOnboarding()).toBeNull()
    await settled()
    expect(statePuts()).toHaveLength(1)
  })

  it("sends a decision kept in the profile's settings to the account", async () => {
    worker.settings.set(5, { onboarding: 'skipped' })
    signIn(5)

    expect(await whereToOfferOnboarding()).toBeNull()
    await settled()

    expect(statePuts()).toEqual(['PUT /api/account/state/onboarding {"outcome":"skipped"}'])
    expect(worker.records.get(5)).toMatchObject({ outcome: 'skipped' })
  })

  it('keeps a decision the Worker did not take in this browser, and sends it at the next start', async () => {
    signIn(5)
    await maybeOfferOnboarding()
    await settled()
    worker.failWrite = true

    completeOnboarding()
    await settled()

    expect(worker.records.get(5)?.outcome).toBeNull()
    expect(getOnboardingStatus()).toBe('completed')

    worker.failWrite = false
    signIn(5)
    expect(await whereToOfferOnboarding()).toBeNull()
    await settled()

    expect(worker.records.get(5)).toMatchObject({ outcome: 'completed' })
    expect(getOnboardingStatus()).toBeNull()
  })
})

describe('when the record cannot be read', () => {
  it('opens nothing and writes nothing, and keeps a flag for the next start', async () => {
    worker.failRead = true
    localStorage.setItem('finance_onboarding:account-5', 'skipped')
    signIn(5)

    await maybeOfferOnboarding()
    expect(onboardingOpen()).toBe(false)
    // A wizard opened by hand records no step on state it could not read.
    startOnboarding()
    nextOnboardingStep()
    await settled()

    expect(statePuts()).toEqual([])
    expect(getOnboardingStatus()).toBe('skipped')
  })

  it('opens nothing when the settings cannot be read either', async () => {
    signIn(5)
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const path = new URL(url, 'http://localhost').pathname
      if (path === '/api/settings') return json({ error: 'Something went wrong on our side.' }, 500)
      return workerStandIn()(url, init)
    })

    expect(await whereToOfferOnboarding()).toBeNull()
    expect(statePuts()).toEqual([])
  })
})

describe('whose record it is', () => {
  it('keeps each account in one browser to its own record', async () => {
    signIn(1)
    await maybeOfferOnboarding()
    skipOnboarding()
    await settled()

    // A second account signs in on the same browser.
    signIn(2)
    expect(await whereToOfferOnboarding()).toBe('welcome')
    startOnboarding()
    completeOnboarding()
    await settled()

    expect(worker.records.get(1)).toMatchObject({ outcome: 'skipped' })
    expect(worker.records.get(2)).toMatchObject({ outcome: 'completed' })
    signIn(1)
    expect(await whereToOfferOnboarding()).toBeNull()
  })

  it('gives the browser-wide decision to no server account', async () => {
    localStorage.setItem('finance_onboarding', 'skipped')
    signIn(7)

    expect(await whereToOfferOnboarding()).toBe('welcome')

    expect(statePuts()).toEqual([])
    // It stays for the local account, should this browser go local-first.
    expect(localStorage.getItem('finance_onboarding')).toBe('skipped')
  })

  it('sends nothing for the account that asked once another has signed in', async () => {
    worker.settings.set(1, { onboarding: 'completed' })
    signIn(1)

    // Before the record is read.
    const asked = whereToOfferOnboarding()
    setOnboardingOwner('account-2')
    expect(await asked).toBeNull()

    // After the record is read, while the settings are on their way.
    signIn(1)
    worker.whileSettingsRead = () => { setOnboardingOwner('account-2'); }
    expect(await whereToOfferOnboarding()).toBeNull()

    await settled()
    expect(statePuts()).toEqual([])
    expect(localStorage.getItem('finance_onboarding:account-1')).toBeNull()
    expect(localStorage.getItem('finance_onboarding:account-2')).toBeNull()
  })

  it('never reads or writes the route for local-first', async () => {
    setOnboardingOwner(null)
    __resetAccountStateForTest()
    setOnboardingOwner('local')

    expect(await readAccountState()).toBeNull()
    await maybeOfferOnboarding()
    startOnboarding()
    nextOnboardingStep()
    completeOnboarding()
    await settled()

    expect(worker.sent.filter((r) => r.includes('/api/account/state'))).toEqual([])
    expect(getOnboardingStatus('local')).toBe('completed')
  })
})
