import { beforeEach, describe, expect, it } from 'vitest'
import {
  collectionIsEmpty,
  completeOnboarding,
  forgetOnboardingStatus,
  getOnboardingStatus,
  goToOnboardingStep,
  nextOnboardingStep,
  ONBOARDING_STEPS,
  onboardingMirrorSettled,
  onboardingOpen,
  onboardingOwnerFor,
  onboardingStep,
  prevOnboardingStep,
  setOnboardingOwner,
  shouldOfferOnboarding,
  skipOnboarding,
  startOnboarding,
} from '../onboardingStore'
import { getDB } from '../storage/idb.js'
import {
  accountsCreate,
  billsCreate,
  settingsGet,
  settingsUpdate,
  transactionsCreate,
} from '../storage/localHandlers.js'

/** The mirrored flag as the settings KV sees it (serverless -> IndexedDB). */
async function remoteOnboardingFlag(): Promise<unknown> {
  const res = await settingsGet()
  const settings = (await res.json()) as Record<string, unknown>
  return settings.onboarding
}

describe('onboardingStore', () => {
  beforeEach(async () => {
    localStorage.clear()
    // Mark the first-run seed as done so getCurrentProfileId() never seeds the
    // demo dataset under the test — mirrors the e2e zero-state technique.
    localStorage.setItem('finance_had_profiles', '1')
    localStorage.setItem('currentProfileId', '1')
    // Local-first: the browser's one local account.
    setOnboardingOwner('local')
    const db = await getDB()
    await db.clear('profiles')
    await db.clear('accounts')
    await db.clear('transactions')
    await db.clear('bills')
    await db.clear('settings')
    await db.add('profiles', { id: 1, name: 'Personal Profile', created_at: '2026-01-01' })
    // Reset wizard state between tests. Drain any in-flight KV mirror (from
    // this call OR a previous test's complete/skip) BEFORE clearing settings,
    // so a late write can't leak into the test about to run.
    completeOnboarding()
    await onboardingMirrorSettled()
    await db.clear('settings')
    forgetOnboardingStatus('local')
  })

  describe('collectionIsEmpty (list-endpoint shape handling)', () => {
    it('treats a bare array (serverless) as empty/non-empty by length', () => {
      expect(collectionIsEmpty([])).toBe(true)
      expect(collectionIsEmpty([{ id: 1 }])).toBe(false)
    })

    it('treats the server paginated envelope { rows, total } correctly', () => {
      // /api/transactions on the worker/self-hosted backend returns this shape,
      // NOT a bare array — the original bug: onboarding never triggered in
      // server mode because Array.isArray({rows}) is false.
      expect(collectionIsEmpty({ rows: [], total: 0, limit: 0, offset: 0 })).toBe(true)
      expect(collectionIsEmpty({ rows: [{ id: 1 }], total: 1 })).toBe(false)
      expect(collectionIsEmpty({ total: 0 })).toBe(true)
      expect(collectionIsEmpty({ total: 5 })).toBe(false)
    })

    it('treats an unrecognized shape as NOT empty (never trap a user with data)', () => {
      expect(collectionIsEmpty(null)).toBe(false)
      expect(collectionIsEmpty(undefined)).toBe(false)
      expect(collectionIsEmpty({})).toBe(false)
      expect(collectionIsEmpty('oops')).toBe(false)
    })
  })

  describe('step machine', () => {
    it('starts at welcome and opens', () => {
      startOnboarding()
      expect(onboardingOpen()).toBe(true)
      expect(onboardingStep()).toBe('welcome')
    })

    it('walks forward and backward through the fixed step order', () => {
      startOnboarding()
      for (const expected of ONBOARDING_STEPS.slice(1)) {
        nextOnboardingStep()
        expect(onboardingStep()).toBe(expected)
      }
      // Clamped at the end
      nextOnboardingStep()
      expect(onboardingStep()).toBe('done')
      prevOnboardingStep()
      expect(onboardingStep()).toBe('subscriptions')
    })

    it('clamps prev at the first step and supports direct jumps', () => {
      startOnboarding()
      prevOnboardingStep()
      expect(onboardingStep()).toBe('welcome')
      goToOnboardingStep('import')
      expect(onboardingStep()).toBe('import')
    })

    it('can be relaunched at a specific step', () => {
      startOnboarding('account')
      expect(onboardingStep()).toBe('account')
      expect(onboardingOpen()).toBe(true)
    })
  })

  describe('completion flag', () => {
    it('completeOnboarding stamps the flag and closes', () => {
      startOnboarding()
      completeOnboarding()
      expect(onboardingOpen()).toBe(false)
      expect(getOnboardingStatus()).toBe('completed')
    })

    it('skipOnboarding stamps the flag and closes', () => {
      startOnboarding()
      skipOnboarding()
      expect(onboardingOpen()).toBe(false)
      expect(getOnboardingStatus()).toBe('skipped')
    })

    it('ignores garbage flag values', () => {
      localStorage.setItem('finance_onboarding:local', 'whatever')
      expect(getOnboardingStatus()).toBeNull()
    })

    it('mirrors completion into the settings KV', async () => {
      completeOnboarding()
      await onboardingMirrorSettled()
      expect(await remoteOnboardingFlag()).toBe('completed')
    })

    it('mirrors a skip into the settings KV', async () => {
      skipOnboarding()
      await onboardingMirrorSettled()
      expect(await remoteOnboardingFlag()).toBe('skipped')
    })
  })

  describe('shouldOfferOnboarding', () => {
    it('offers for a pristine profile (no accounts, no transactions)', async () => {
      await expect(shouldOfferOnboarding()).resolves.toBe(true)
    })

    it('does not offer once completed or skipped', async () => {
      localStorage.setItem('finance_onboarding:local', 'completed')
      await expect(shouldOfferOnboarding()).resolves.toBe(false)
      localStorage.setItem('finance_onboarding:local', 'skipped')
      await expect(shouldOfferOnboarding()).resolves.toBe(false)
    })

    it('does not offer when an account exists', async () => {
      await accountsCreate({ name: 'Main', type: 'giro', balance: 100 })
      await expect(shouldOfferOnboarding()).resolves.toBe(false)
    })

    it('does not offer when transactions exist (even with zero accounts)', async () => {
      await transactionsCreate({
        description: 'Coffee',
        amount: 3.5,
        date: '2026-07-01',
        type: 'expense',
      })
      await expect(shouldOfferOnboarding()).resolves.toBe(false)
    })

    it('does not offer when bills/subscriptions exist', async () => {
      await billsCreate({
        name: 'Netflix',
        amount: 13.99,
        dueDate: '2026-08-01',
        frequency: 'monthly',
        type: 'subscription',
      })
      await expect(shouldOfferOnboarding()).resolves.toBe(false)
    })

    it('respects a completion recorded in the settings KV (fresh device, no local flag)', async () => {
      // Simulate "completed on another device": remote flag set, local flag absent,
      // workspace still pristine.
      await settingsUpdate({ onboarding: 'completed' })
      expect(getOnboardingStatus()).toBeNull()
      await expect(shouldOfferOnboarding()).resolves.toBe(false)
      // ...and the decision is cached locally for instant future boots.
      expect(getOnboardingStatus()).toBe('completed')
    })

    it('respects a skip recorded in the settings KV', async () => {
      await settingsUpdate({ onboarding: 'skipped' })
      await expect(shouldOfferOnboarding()).resolves.toBe(false)
      expect(getOnboardingStatus()).toBe('skipped')
    })
  })

  describe('whose decision it is', () => {
    it('names the owner: the local account, or the signed-in account by id', () => {
      expect(onboardingOwnerFor(false, null)).toBe('local')
      expect(onboardingOwnerFor(false, 1)).toBe('local')
      expect(onboardingOwnerFor(true, 42)).toBe('account-42')
      expect(onboardingOwnerFor(true, null)).toBeNull()
    })

    it('keeps each account in one browser to its own decision', async () => {
      setOnboardingOwner('account-1')
      skipOnboarding()
      await onboardingMirrorSettled()
      expect(getOnboardingStatus()).toBe('skipped')

      // A second account signs in here. Its own settings on the server say nothing yet.
      const db = await getDB()
      await db.clear('settings')
      setOnboardingOwner('account-2')
      expect(getOnboardingStatus()).toBeNull()
      await expect(shouldOfferOnboarding()).resolves.toBe(true)
      completeOnboarding()
      await onboardingMirrorSettled()
      expect(getOnboardingStatus()).toBe('completed')

      // The first account keeps the decision it made.
      setOnboardingOwner('account-1')
      expect(getOnboardingStatus()).toBe('skipped')
      expect(localStorage.getItem('finance_onboarding:account-1')).toBe('skipped')
      expect(localStorage.getItem('finance_onboarding:account-2')).toBe('completed')
    })

    it('moves the browser-wide decision to the first account signed in, and only to it', () => {
      localStorage.setItem('finance_onboarding', 'skipped')

      setOnboardingOwner('account-7')

      expect(getOnboardingStatus()).toBe('skipped')
      expect(localStorage.getItem('finance_onboarding')).toBeNull()
      expect(localStorage.getItem('finance_onboarding:account-7')).toBe('skipped')
      setOnboardingOwner('account-8')
      expect(getOnboardingStatus()).toBeNull()
    })

    it('waits for an account before moving the browser-wide decision', () => {
      localStorage.setItem('finance_onboarding', 'completed')

      setOnboardingOwner(null)

      expect(localStorage.getItem('finance_onboarding')).toBe('completed')
      setOnboardingOwner('account-3')
      expect(getOnboardingStatus()).toBe('completed')
    })

    it("leaves an account's own decision as it is", () => {
      localStorage.setItem('finance_onboarding:account-5', 'completed')
      localStorage.setItem('finance_onboarding', 'skipped')

      setOnboardingOwner('account-5')

      expect(getOnboardingStatus()).toBe('completed')
      expect(localStorage.getItem('finance_onboarding')).toBeNull()
    })

    it('moves the browser-wide decision to the local account in local-first', () => {
      forgetOnboardingStatus('local')
      localStorage.setItem('finance_onboarding', 'completed')

      setOnboardingOwner('local')

      expect(getOnboardingStatus()).toBe('completed')
      expect(localStorage.getItem('finance_onboarding:local')).toBe('completed')
    })

    it('offers nothing and keeps nothing on this device while no account is known', async () => {
      setOnboardingOwner(null)

      expect(getOnboardingStatus()).toBeNull()
      await expect(shouldOfferOnboarding()).resolves.toBe(false)
      skipOnboarding()
      await onboardingMirrorSettled()
      expect(
        Object.keys(localStorage).filter((key) => key.startsWith('finance_onboarding'))
      ).toEqual([])
    })
  })
})
