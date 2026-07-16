import { beforeEach, describe, expect, it } from 'vitest'
import {
  collectionIsEmpty,
  completeOnboarding,
  getOnboardingStatus,
  goToOnboardingStep,
  nextOnboardingStep,
  ONBOARDING_STEPS,
  onboardingMirrorSettled,
  onboardingOpen,
  onboardingStep,
  prevOnboardingStep,
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
    localStorage.removeItem('finance_onboarding')
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
      localStorage.setItem('finance_onboarding', 'whatever')
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
      localStorage.setItem('finance_onboarding', 'completed')
      await expect(shouldOfferOnboarding()).resolves.toBe(false)
      localStorage.setItem('finance_onboarding', 'skipped')
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
})
