/**
 * Signed in, the setup wizard belongs to the account: its record is on the Worker
 * (`/api/account/state`, user_state), so every device the account signs in on reads the same one.
 *
 * Against a stand-in for the Worker that reads and keeps each account's record with the Worker's
 * own rules (shared/accountState.ts, answerUserStateValue and applyUserStateWrite), because that
 * is the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  answerUserStateValue,
  applyUserStateWrite,
  sqliteDateTime,
} from '../../../../shared/accountState'
import { __resetAccountStateForTest, accountState, readAccountState } from '../accountState'
import {
  __resetGettingStartedForTest,
  gettingStartedRecord,
  gettingStartedSettled,
  hideGettingStarted,
} from '../gettingStarted'
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
import type { GettingStartedRecord, OnboardingRecord } from '../../../../shared/accountStateKeys'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The Worker: who is signed in, what each account has stored, and every request it was sent. */
const worker = {
  signedIn: 5,
  records: new Map<number, OnboardingRecord>(),
  gettingStarted: new Map<number, GettingStartedRecord>(),
  settings: new Map<number, Record<string, unknown>>(),
  failRead: false,
  failWrite: false,
  /** Runs as the settings are read: another sign-in finishing while they are on their way. */
  whileSettingsRead: null as (() => void) | null,
  sent: [] as string[],
}

/** A stored value as the row's text, as the Worker reads it. */
const stored = (value: unknown): string | null =>
  value === undefined ? null : JSON.stringify(value)

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
        onboarding: answerUserStateValue('onboarding', stored(worker.records.get(id))),
        tours: null,
        getting_started: answerUserStateValue(
          'getting_started',
          stored(worker.gettingStarted.get(id))
        ),
      })
    }
    if (path === '/api/account/state/getting_started' && method === 'PUT') {
      const write = applyUserStateWrite(
        'getting_started',
        JSON.parse(body) as unknown,
        stored(worker.gettingStarted.get(id)),
        sqliteDateTime(new Date())
      )
      if (!write.ok && 'unreadable' in write) return json({ error: 'Left as it is.' }, 409)
      if (!write.ok) return json({ error: 'Check the fields.', fields: write.fields }, 400)
      if (write.changed) worker.gettingStarted.set(id, write.value)
      return json({ getting_started: write.value })
    }
    if (path === '/api/account/state/onboarding' && method === 'PUT') {
      if (worker.failWrite) return json({ error: 'Something went wrong on our side.' }, 500)
      const write = applyUserStateWrite(
        'onboarding',
        JSON.parse(body) as unknown,
        stored(worker.records.get(id)),
        sqliteDateTime(new Date())
      )
      if (!write.ok && 'unreadable' in write) return json({ error: 'Left as it is.' }, 409)
      if (!write.ok) return json({ error: 'Check the fields.', fields: write.fields }, 400)
      if (write.changed) worker.records.set(id, write.value)
      return json({ onboarding: write.value })
    }
    if (path === '/api/settings' && method === 'GET') {
      worker.whileSettingsRead?.()
      return json(worker.settings.get(id) ?? {})
    }
    if (path === '/api/settings' && method === 'PUT') return json({ ok: true })
    return json([])
  }
}

const statePuts = () =>
  worker.sent.filter(
    (r) => r.startsWith('PUT /api/account/state') && !r.includes('/getting_started')
  )
const cardPuts = () =>
  worker.sent.filter((r) => r.startsWith('PUT /api/account/state/getting_started'))
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
  await gettingStartedSettled()
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
  __resetGettingStartedForTest()
  worker.records.clear()
  worker.gettingStarted.clear()
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

  it('is offered nothing when the record has a step this build does not know', async () => {
    // A newer build added a step; this one is older, or a rollback.
    const newer = {
      step: 'essentials',
      started_at: '2026-10-01 09:00:00',
      finished_at: '2026-10-01 09:05:00',
      outcome: 'completed',
    }
    worker.records.set(5, newer as unknown as OnboardingRecord)
    signIn(5)

    await maybeOfferOnboarding()
    expect(onboardingOpen()).toBe(false)

    // Relaunched from the tour menu, and finished again: the record stays the newer build's.
    startOnboarding()
    nextOnboardingStep()
    completeOnboarding()
    await settled()
    expect(statePuts()).toEqual([])
    expect(worker.records.get(5)).toEqual(newer)
  })

  it('is offered nothing when the record finished with an outcome this build does not know', async () => {
    // A newer build added an outcome; this one is older, or a rollback.
    const newer = {
      step: 'done',
      started_at: '2026-10-01 09:00:00',
      finished_at: '2026-10-01 09:05:00',
      outcome: 'imported',
    }
    worker.records.set(5, newer as unknown as OnboardingRecord)
    localStorage.setItem('finance_onboarding:account-5', 'completed')
    signIn(5)

    expect(await whereToOfferOnboarding()).toBeNull()
    // Read as finished, the rest of the record kept: the flag it replaces goes, as for any.
    expect(accountState()?.onboarding).toEqual({ ...newer, outcome: null })
    expect(getOnboardingStatus('account-5')).toBeNull()

    startOnboarding()
    nextOnboardingStep()
    completeOnboarding()
    await settled()
    expect(statePuts()).toEqual([])
    expect(worker.records.get(5)).toEqual(newer)
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

describe('the Getting started card', () => {
  it('comes with the first finish, shown, and follows the account to another device', async () => {
    signIn(5)
    await maybeOfferOnboarding()
    completeOnboarding()
    await settled()

    expect(cardPuts()).toEqual(['PUT /api/account/state/getting_started {"hidden":false}'])
    expect(worker.gettingStarted.get(5)).toEqual({ hidden: false })
    expect(gettingStartedRecord()).toEqual({ hidden: false })

    signIn(5)
    expect(gettingStartedRecord()).toBeNull()
    await readAccountState()
    expect(gettingStartedRecord()).toEqual({ hidden: false })
  })

  it('comes with a skip too', async () => {
    signIn(5)
    await maybeOfferOnboarding()
    skipOnboarding()
    await settled()

    expect(worker.gettingStarted.get(5)).toEqual({ hidden: false })
  })

  it('does not come to an account that decided before, in this browser or its settings', async () => {
    localStorage.setItem('finance_onboarding:account-5', 'completed')
    signIn(5)
    expect(await whereToOfferOnboarding()).toBeNull()
    worker.settings.set(6, { onboarding: 'skipped' })
    signIn(6)
    expect(await whereToOfferOnboarding()).toBeNull()
    await settled()

    expect(worker.records.get(5)?.outcome).toBe('completed')
    expect(worker.records.get(6)?.outcome).toBe('skipped')
    expect(cardPuts()).toEqual([])
  })

  it('stays hidden when a tab that read the account before it was hidden leaves its wizard', async () => {
    // A new account: the wizard opens on the laptop, which read the state as it started.
    worker.records.set(5, {
      step: 'welcome',
      started_at: '2026-10-11 10:00:00',
      finished_at: null,
      outcome: null,
    })
    signIn(5)
    await maybeOfferOnboarding()
    expect(onboardingOpen()).toBe(true)

    // Meanwhile on the phone: the wizard finished, and the Getting started card hidden.
    worker.records.set(5, {
      step: 'done',
      started_at: '2026-10-11 10:00:00',
      finished_at: '2026-10-11 10:03:00',
      outcome: 'completed',
    })
    worker.gettingStarted.set(5, { hidden: true })

    // Back on the laptop: Skip. Its copy says there is no card, so it asks for one.
    skipOnboarding()
    await settled()

    expect(cardPuts()).toEqual(['PUT /api/account/state/getting_started {"hidden":false}'])
    expect(worker.gettingStarted.get(5)).toEqual({ hidden: true })
    expect(gettingStartedRecord()).toEqual({ hidden: true })
  })

  it('is not shown again by a wizard relaunched over a finished record', async () => {
    worker.records.set(5, {
      step: 'done',
      started_at: '2026-10-01 09:00:00',
      finished_at: '2026-10-01 09:05:00',
      outcome: 'completed',
    })
    worker.gettingStarted.set(5, { hidden: true })
    signIn(5)
    await maybeOfferOnboarding()

    startOnboarding('welcome')
    completeOnboarding()
    await settled()

    expect(cardPuts()).toEqual([])
    expect(gettingStartedRecord()).toEqual({ hidden: true })
  })

  it('stays hidden on an account that already has it hidden', async () => {
    worker.gettingStarted.set(5, { hidden: true })
    signIn(5)
    await maybeOfferOnboarding()
    completeOnboarding()
    await settled()

    expect(worker.records.get(5)?.outcome).toBe('completed')
    expect(cardPuts()).toEqual([])
    expect(gettingStartedRecord()).toEqual({ hidden: true })
  })

  it('is not shown or written when its row cannot be read', async () => {
    const unreadable = { hidden: 'no' }
    worker.gettingStarted.set(5, unreadable as unknown as GettingStartedRecord)
    signIn(5)

    expect(await whereToOfferOnboarding()).toBe('welcome')
    startOnboarding()
    completeOnboarding()
    await settled()
    expect(gettingStartedRecord()).toBeNull()

    hideGettingStarted()
    await settled()
    expect(cardPuts()).toEqual([])
    expect(worker.gettingStarted.get(5)).toEqual(unreadable)
  })

  it('is not written when the account state could not be read', async () => {
    worker.failRead = true
    signIn(5)
    await maybeOfferOnboarding()
    // Opened by hand, from the tour menu.
    startOnboarding('welcome')
    skipOnboarding()
    await settled()

    expect(cardPuts()).toEqual([])
    expect(worker.gettingStarted.get(5)).toBeUndefined()
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
    worker.whileSettingsRead = () => {
      setOnboardingOwner('account-2')
    }
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

describe('a record this build cannot read at all', () => {
  // Written by another build, in a shape this one cannot read: the Worker answers it as
  // unreadable, which is not the null of no record.
  const unreadable = {
    step: 'welcome',
    started_at: 'yesterday',
    finished_at: null,
    outcome: null,
  }

  it('opens no wizard and sends nothing, at this start or the next', async () => {
    worker.records.set(5, unreadable as unknown as OnboardingRecord)
    signIn(5)

    await maybeOfferOnboarding()
    expect(onboardingOpen()).toBe(false)

    // Relaunched from the tour menu and left: the record is unknown, so nothing goes to it and
    // no card is begun.
    startOnboarding()
    nextOnboardingStep()
    skipOnboarding()
    await settled()
    expect(worker.sent).toEqual(['GET /api/account/state'])
    expect(worker.records.get(5)).toEqual(unreadable)
    expect(gettingStartedRecord()).toBeNull()

    signIn(5)
    await maybeOfferOnboarding()
    await settled()
    expect(onboardingOpen()).toBe(false)
    expect(worker.sent).toEqual(['GET /api/account/state', 'GET /api/account/state'])
  })

  it("keeps this browser's decision without sending it over the record", async () => {
    worker.records.set(5, unreadable as unknown as OnboardingRecord)
    localStorage.setItem('finance_onboarding:account-5', 'skipped')
    signIn(5)

    expect(await whereToOfferOnboarding()).toBeNull()
    await settled()

    expect(worker.sent).toEqual(['GET /api/account/state'])
    expect(getOnboardingStatus('account-5')).toBe('skipped')
    expect(worker.records.get(5)).toEqual(unreadable)
  })
})
