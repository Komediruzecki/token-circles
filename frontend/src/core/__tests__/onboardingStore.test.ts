import { beforeEach, describe, expect, it } from 'vitest'
import { markLocalSetupPending, onboardingStampKey } from '../onboardingFlag'
import {
  collectionIsEmpty,
  completeOnboarding,
  countProfileMadeAsDecided,
  forgetOnboardingStatus,
  getOnboardingStatus,
  goToOnboardingStep,
  importedWhileSetupWaits,
  nextOnboardingStep,
  noteImportWhileSetupWaits,
  noteSetupImport,
  ONBOARDING_STEPS,
  onboardingMirrorSettled,
  onboardingOpen,
  onboardingOwnerFor,
  onboardingStep,
  openingStep,
  pauseOnboarding,
  prevOnboardingStep,
  resumeOnboarding,
  setOnboardingOwner,
  setupWaiting,
  shouldOfferOnboarding,
  SHOWN_ONBOARDING_STEPS,
  skipOnboarding,
  startOnboarding,
  whereToOfferOnboarding,
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
    it('starts at the space step and opens', () => {
      startOnboarding()
      expect(onboardingOpen()).toBe(true)
      expect(onboardingStep()).toBe('space')
    })

    it('walks forward and backward through the steps it shows, which leave out welcome', () => {
      expect(SHOWN_ONBOARDING_STEPS).toEqual([
        'space',
        'account',
        'import',
        'subscriptions',
        'done',
      ])
      startOnboarding()
      for (const expected of SHOWN_ONBOARDING_STEPS.slice(1)) {
        nextOnboardingStep()
        expect(onboardingStep()).toBe(expected)
      }
      // Clamped at the end
      nextOnboardingStep()
      expect(onboardingStep()).toBe('done')
      prevOnboardingStep()
      expect(onboardingStep()).toBe('subscriptions')
    })

    it('clamps prev at the first step shown and supports direct jumps', () => {
      startOnboarding()
      prevOnboardingStep()
      expect(onboardingStep()).toBe('space')
      goToOnboardingStep('import')
      expect(onboardingStep()).toBe('import')
    })

    it('opens a record that stopped at welcome, the old first screen, on the space step', () => {
      startOnboarding('welcome')
      expect(onboardingStep()).toBe('space')
      goToOnboardingStep('welcome')
      expect(onboardingStep()).toBe('space')
      expect(openingStep('welcome')).toBe('space')
      expect(openingStep(null)).toBe('space')
      expect(openingStep('import')).toBe('import')
      // Every stored step but welcome is shown; welcome stays readable for the records that hold it.
      expect(ONBOARDING_STEPS.filter((s) => !SHOWN_ONBOARDING_STEPS.includes(s))).toEqual([
        'welcome',
      ])
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

    it('moves the browser-wide decision to the local account in local-first', () => {
      forgetOnboardingStatus('local')
      localStorage.setItem('finance_onboarding', 'completed')

      setOnboardingOwner('local')

      expect(getOnboardingStatus()).toBe('completed')
      expect(localStorage.getItem('finance_onboarding:local')).toBe('completed')
      expect(localStorage.getItem('finance_onboarding')).toBeNull()
    })

    it("leaves the local account's own decision as it is", () => {
      localStorage.setItem('finance_onboarding:local', 'completed')
      localStorage.setItem('finance_onboarding', 'skipped')

      setOnboardingOwner('local')

      expect(getOnboardingStatus()).toBe('completed')
      expect(localStorage.getItem('finance_onboarding')).toBeNull()
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
  // Open in Import, for a file setup cannot read: setup waits on the Import page while its columns
  // are matched, and Back to setup there opens it again (maff, 19 Nov: "there is no way back to
  // finalize onboarding").
  describe('setup waiting on the Import page', () => {
    const marker = () => localStorage.getItem('finance_local_setup_pending')

    /** Setup at the statement, left for the Import page. */
    function waitAtTheStatement(imported = 0): void {
      startOnboarding()
      goToOnboardingStep('import')
      // What setup brought in itself before it handed a file over.
      noteSetupImport({ imported, createdAccounts: [], statements: [] })
      pauseOnboarding()
    }

    it('closes with nothing decided, keeps the step reached, and opens again there', async () => {
      waitAtTheStatement()

      expect(onboardingOpen()).toBe(false)
      expect(setupWaiting()).toBe(true)
      expect(getOnboardingStatus('local')).toBeNull()
      expect(marker()).toBe('import')

      await expect(resumeOnboarding()).resolves.toBe('opened')
      expect(onboardingOpen()).toBe(true)
      expect(onboardingStep()).toBe('import')
      expect(setupWaiting()).toBe(false)
    })

    it('goes back to the subscriptions in what came in, and a start that never came back opens there too', async () => {
      waitAtTheStatement()
      noteImportWhileSetupWaits(23)

      expect(marker()).toBe('subscriptions')
      await expect(whereToOfferOnboarding()).resolves.toBe('subscriptions')

      await expect(resumeOnboarding()).resolves.toBe('opened')
      expect(onboardingStep()).toBe('subscriptions')
    })

    it('goes back to the subscriptions when setup imported before it handed the file over', async () => {
      waitAtTheStatement(7)
      expect(marker()).toBe('subscriptions')
      // The Import page counts only its own: the file handed over is not in yet.
      expect(importedWhileSetupWaits()).toBe(0)
      noteImportWhileSetupWaits(5)
      expect(importedWhileSetupWaits()).toBe(5)
      await expect(resumeOnboarding()).resolves.toBe('opened')
      expect(onboardingStep()).toBe('subscriptions')
    })

    it('an import that brought nothing new keeps it at the statement', async () => {
      waitAtTheStatement()
      noteImportWhileSetupWaits(0)
      expect(marker()).toBe('import')
      await expect(resumeOnboarding()).resolves.toBe('opened')
      expect(onboardingStep()).toBe('import')
    })

    it('stays closed once setup was finished or left in another tab meanwhile', async () => {
      waitAtTheStatement()
      localStorage.setItem('finance_onboarding:local', 'skipped')

      await expect(resumeOnboarding()).resolves.toBe('finished')
      expect(onboardingOpen()).toBe(false)
      expect(setupWaiting()).toBe(false)
    })

    it('waits no more once setup opens another way, or is decided', async () => {
      waitAtTheStatement()
      startOnboarding()
      expect(setupWaiting()).toBe(false)

      goToOnboardingStep('import')
      pauseOnboarding()
      startOnboarding('import')
      skipOnboarding()
      expect(setupWaiting()).toBe(false)
    })

    it('run again after a decision, goes back without asking anything', async () => {
      completeOnboarding()
      await onboardingMirrorSettled()
      startOnboarding('import')
      pauseOnboarding()

      await expect(resumeOnboarding()).resolves.toBe('opened')
      expect(onboardingStep()).toBe('import')
    })

    it('belongs to the owner that left it: another sign-in finds nothing waiting', () => {
      waitAtTheStatement()
      setOnboardingOwner('account-9')
      expect(setupWaiting()).toBe(false)
    })

    // Review of 19 Nov (P3): Create Profile in the profile menu counted as setup's decision while
    // setup waited, so Back to setup said it was finished and the next start opened it again.
    it('a profile made from the profile menu meanwhile decides nothing: the way back opens it', async () => {
      waitAtTheStatement()

      countProfileMadeAsDecided()

      expect(getOnboardingStatus('local')).toBeNull()
      expect(setupWaiting()).toBe(true)
      await expect(resumeOnboarding()).resolves.toBe('opened')
      expect(onboardingStep()).toBe('import')
    })

    it('a profile made with no setup waiting still counts as the decision, and takes the marker', () => {
      markLocalSetupPending('account')

      countProfileMadeAsDecided()

      expect(getOnboardingStatus('local')).toBe('skipped')
      expect(marker()).toBeNull()
    })

    it('the next start does not open setup decided while it waited, and drops the marker', async () => {
      waitAtTheStatement()
      // Decided while it waited, by a path that left the marker behind.
      localStorage.setItem('finance_onboarding:local', 'skipped')

      await expect(whereToOfferOnboarding()).resolves.toBeNull()
      expect(marker()).toBeNull()
    })

    /**
     * What another tab's Skip or Finish leaves in the shared localStorage: decide() there writes
     * the decision with its stamp, and drops the marker unless the path that decided left it.
     */
    function otherTabDecides(outcome: 'skipped' | 'completed', keepMarker = false): void {
      localStorage.setItem('finance_onboarding:local', outcome)
      localStorage.setItem(onboardingStampKey('local'), 'stamped-in-another-tab')
      if (keepMarker) return
      localStorage.removeItem('finance_local_setup_pending')
      localStorage.removeItem('finance_local_setup_waiting')
    }

    // Round 4: compared by status, another tab's decision, the same as the one the demo had left,
    // read as none, and the way back opened setup again.
    for (const outcome of ['skipped', 'completed'] as const) {
      it(`over the demo's ${outcome}, another tab's ${outcome} meanwhile counts: the way back stays closed`, async () => {
        localStorage.setItem('finance_onboarding:local', outcome)
        markLocalSetupPending()
        startOnboarding('import')
        pauseOnboarding()

        otherTabDecides(outcome)

        await expect(resumeOnboarding()).resolves.toBe('finished')
        expect(onboardingOpen()).toBe(false)
        expect(setupWaiting()).toBe(false)
      })
    }

    it('stamps every decision kept, anew each time, the same decision again included', () => {
      const stamp = () => localStorage.getItem(onboardingStampKey('local'))
      const before = stamp()
      skipOnboarding()
      const first = stamp()
      expect(first).not.toBeNull()
      expect(first).not.toBe(before)
      startOnboarding('import')
      skipOnboarding()
      expect(stamp()).not.toBeNull()
      expect(stamp()).not.toBe(first)
    })

    it("over the demo's skip, the next start does not open setup another tab skipped while it waited", async () => {
      localStorage.setItem('finance_onboarding:local', 'skipped')
      markLocalSetupPending()
      startOnboarding('import')
      pauseOnboarding()

      // The same decision again, by a path that left the marker behind.
      otherTabDecides('skipped', true)

      await expect(whereToOfferOnboarding()).resolves.toBeNull()
      expect(marker()).toBeNull()
    })

    it('over a decision the demo left before it, the way back and the next start still open it', async () => {
      completeOnboarding()
      await onboardingMirrorSettled()
      markLocalSetupPending()
      startOnboarding('import')
      pauseOnboarding()

      await expect(whereToOfferOnboarding()).resolves.toBe('import')
      await expect(resumeOnboarding()).resolves.toBe('opened')
      expect(onboardingStep()).toBe('import')
    })
  })
})
