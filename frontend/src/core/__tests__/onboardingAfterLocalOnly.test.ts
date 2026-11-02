/**
 * A signed-in account that chooses "Keep my data in this browser only" reloads into this
 * browser's local workspace. When that workspace holds only the demo's example profiles, the
 * wizard opens on its space step, though the examples are far from pristine: the person sets up a
 * space of their own instead of landing on Example Low Income's dashboard. A one-shot marker
 * (LOCAL_SETUP_PENDING_KEY), left by the switch, asks for that; it goes once setup is left or
 * finished, and at once when the workspace has a profile of the person's own, which is carried on
 * with as before.
 *
 * Against the real local router on fake-indexeddb.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { EXAMPLE_PROFILE_NAMES } from '../demoMode'
import {
  completeOnboarding,
  forgetOnboardingStatus,
  LOCAL_SETUP_PENDING_KEY,
  localSetupPending,
  markLocalSetupPending,
  onboardingMirrorSettled,
  onboardingOpen,
  setOnboardingOwner,
  skipOnboarding,
  startOnboarding,
  whereToOfferOnboarding,
} from '../onboardingStore'
import { getDB } from '../storage/idb.js'

/** A workspace like the demo's: the three examples, the first holding an account and a payment. */
async function examplesWorkspace(): Promise<void> {
  const db = await getDB()
  for (const [i, name] of EXAMPLE_PROFILE_NAMES.entries()) {
    await db.add('profiles', { id: i + 1, name, created_at: '2026-01-01' })
  }
  await db.add('accounts', { id: 1, profile_id: 1, name: 'Checking Account', balance: 100 })
  await db.add('transactions', {
    id: 1,
    profile_id: 1,
    account_id: 1,
    type: 'expense',
    amount: 12,
    date: '2026-10-01',
    description: 'Groceries',
  })
  await db.add('bills', { id: 1, profile_id: 1, name: 'Rent', amount: 600 })
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  // As the switch leaves it: the example seed never runs again.
  localStorage.setItem('finance_had_profiles', '1')
  setOnboardingOwner('local')
  const db = await getDB()
  completeOnboarding()
  await onboardingMirrorSettled()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  forgetOnboardingStatus('local')
  localStorage.removeItem(LOCAL_SETUP_PENDING_KEY)
})

describe('after "Keep my data in this browser only"', () => {
  it('opens on the space over a workspace of example profiles, and keeps asking until setup is left', async () => {
    await examplesWorkspace()
    // Without the switch, the examples are not a workspace setup opens for.
    expect(await whereToOfferOnboarding()).toBeNull()

    markLocalSetupPending()
    expect(await whereToOfferOnboarding()).toBe('space')
    // A reload before the space is saved opens it again: the marker is still there.
    expect(localSetupPending()).toBe(true)
    expect(await whereToOfferOnboarding()).toBe('space')
  })

  it('opens even where the demo finished its setup before', async () => {
    await examplesWorkspace()
    const db = await getDB()
    await db.put('settings', { key: 'onboarding', value: 'completed' })
    markLocalSetupPending()
    expect(await whereToOfferOnboarding()).toBe('space')
  })

  it('carries on with a workspace that has a profile of its own, and drops the marker', async () => {
    await examplesWorkspace()
    const db = await getDB()
    await db.add('profiles', { id: 4, name: 'Our flat', created_at: '2026-02-01' })
    await db.add('accounts', { id: 2, profile_id: 4, name: 'Main', balance: 5 })
    localStorage.setItem('currentProfileId', '4')
    markLocalSetupPending()

    expect(await whereToOfferOnboarding()).toBeNull()
    expect(localSetupPending()).toBe(false)
  })

  it('a workspace with no profile yet gets its first one and is pristine: setup opens as it always did', async () => {
    markLocalSetupPending()
    expect(await whereToOfferOnboarding()).toBe('space')
    // The profile the workspace made for itself is the person's own, not an example.
    expect(localSetupPending()).toBe(false)
  })

  it('goes once setup is left', async () => {
    await examplesWorkspace()
    markLocalSetupPending()
    startOnboarding('space')
    skipOnboarding()
    expect(onboardingOpen()).toBe(false)
    expect(localSetupPending()).toBe(false)
    await onboardingMirrorSettled()
    // Left over the examples: nothing opens again by itself.
    expect(await whereToOfferOnboarding()).toBeNull()
  })

  it('goes once setup is finished', async () => {
    await examplesWorkspace()
    markLocalSetupPending()
    startOnboarding('space')
    completeOnboarding()
    expect(localSetupPending()).toBe(false)
    await onboardingMirrorSettled()
  })

  it('opens nothing on a signed-in account, where the marker means nothing', async () => {
    await examplesWorkspace()
    markLocalSetupPending()
    setOnboardingOwner(null)
    expect(await whereToOfferOnboarding()).toBeNull()
    setOnboardingOwner('local')
  })
})
