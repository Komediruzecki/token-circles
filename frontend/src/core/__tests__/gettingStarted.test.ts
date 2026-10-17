/**
 * The Getting started card's record (gettingStarted.ts): signed in it is the account's, so Hide
 * hides the card on every device; local-first keeps it in this browser and never calls the route.
 * Either way it comes with the setup wizard's first finish or skip, and only then.
 */
import { createMemo, createRoot } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetAccountStateForTest, readAccountState } from '../accountState'
import {
  __resetGettingStartedForTest,
  gettingStartedRecord,
  gettingStartedSettled,
  hideGettingStarted,
  LOCAL_GETTING_STARTED_KEY,
} from '../gettingStarted'
import {
  completeOnboarding,
  onboardingMirrorSettled,
  setOnboardingOwner,
  skipOnboarding,
  startOnboarding,
} from '../onboardingStore'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const sent: string[] = []
let stored: { hidden: boolean } | null = null

beforeEach(() => {
  localStorage.clear()
  sent.length = 0
  stored = null
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url, 'http://localhost').pathname
    const method = (init.method ?? 'GET').toUpperCase()
    const body = typeof init.body === 'string' ? init.body : ''
    sent.push(`${method} ${path}${body ? ` ${body}` : ''}`)
    if (path === '/api/account/state' && method === 'GET') {
      return json({ onboarding: null, tours: null, getting_started: stored })
    }
    if (path === '/api/account/state/getting_started' && method === 'PUT') {
      stored = JSON.parse(body) as { hidden: boolean }
      return json({ getting_started: stored })
    }
    return json([])
  })
  setOnboardingOwner(null)
  __resetAccountStateForTest()
  __resetGettingStartedForTest()
})

afterEach(async () => {
  await onboardingMirrorSettled()
  await gettingStartedSettled()
  setOnboardingOwner(null)
  vi.unstubAllGlobals()
  localStorage.clear()
})

const routeCalls = () => sent.filter((r) => r.includes('/api/account/state'))

describe('local-first', () => {
  beforeEach(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
    setOnboardingOwner('local')
  })

  it('makes the record on the first decision, and keeps it in this browser', () => {
    expect(gettingStartedRecord()).toBeNull()

    startOnboarding('welcome')
    completeOnboarding()

    expect(gettingStartedRecord()).toEqual({ hidden: false })
    expect(JSON.parse(localStorage.getItem(LOCAL_GETTING_STARTED_KEY) ?? 'null')).toEqual({
      hidden: false,
    })
    expect(routeCalls()).toEqual([])
  })

  it('hides the card, and a wizard run again does not bring it back', () => {
    startOnboarding('welcome')
    skipOnboarding()
    createRoot((dispose) => {
      const shown = createMemo(() => gettingStartedRecord()?.hidden === false)
      expect(shown()).toBe(true)
      hideGettingStarted()
      expect(shown()).toBe(false)
      dispose()
    })

    startOnboarding('welcome')
    completeOnboarding()
    expect(gettingStartedRecord()).toEqual({ hidden: true })
    expect(routeCalls()).toEqual([])
  })

  it('gives no card to a workspace that decided before the card existed', () => {
    localStorage.setItem('finance_onboarding:local', 'skipped')

    startOnboarding('welcome')
    completeOnboarding()

    expect(gettingStartedRecord()).toBeNull()
    expect(localStorage.getItem(LOCAL_GETTING_STARTED_KEY)).toBeNull()
  })

  it('keeps a card hidden in an earlier local workspace hidden', () => {
    localStorage.setItem(LOCAL_GETTING_STARTED_KEY, JSON.stringify({ hidden: true }))

    startOnboarding('welcome')
    completeOnboarding()

    expect(gettingStartedRecord()).toEqual({ hidden: true })
  })

  it('reads a record this browser kept from an earlier visit', () => {
    localStorage.setItem(LOCAL_GETTING_STARTED_KEY, JSON.stringify({ hidden: false }))
    expect(gettingStartedRecord()).toEqual({ hidden: false })
    localStorage.setItem(LOCAL_GETTING_STARTED_KEY, 'not json')
    expect(gettingStartedRecord()).toBeNull()
  })
})

describe('signed in', () => {
  beforeEach(() => {
    localStorage.setItem('finance_storage_mode', 'self-hosted')
    setOnboardingOwner('account-5')
  })

  it("reads the account's record, and Hide hides it for the account", async () => {
    stored = { hidden: false }
    expect(gettingStartedRecord()).toBeNull()
    await readAccountState()
    expect(gettingStartedRecord()).toEqual({ hidden: false })

    hideGettingStarted()
    await gettingStartedSettled()

    expect(sent).toContain('PUT /api/account/state/getting_started {"hidden":true}')
    expect(stored).toEqual({ hidden: true })
    expect(gettingStartedRecord()).toEqual({ hidden: true })
    // Nothing kept in this browser.
    expect(localStorage.getItem(LOCAL_GETTING_STARTED_KEY)).toBeNull()
  })

  it('shows nothing from another account, or from this browser', async () => {
    localStorage.setItem(LOCAL_GETTING_STARTED_KEY, JSON.stringify({ hidden: false }))
    expect(gettingStartedRecord()).toBeNull()
    await readAccountState()
    expect(gettingStartedRecord()).toBeNull()
  })
})

describe('signed out', () => {
  it('has no card and writes nothing', () => {
    hideGettingStarted()
    expect(gettingStartedRecord()).toBeNull()
    expect(sent).toEqual([])
  })
})
