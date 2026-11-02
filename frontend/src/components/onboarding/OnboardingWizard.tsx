/**
 * OnboardingWizard: the first-run setup, in the app's orbital language.
 *
 * Three counted steps and a finish, one job to a screen:
 *
 * 1. Space (`space`): the profile's name and base currency, and on a signed-in account the way to
 *    keep everything in this browser instead. Its second screen, About this space, asks where the
 *    person lives and who the space covers while the benchmarks they choose figures for are shown
 *    (core/guidanceGate.ts).
 * 2. Account (`account`): the main account, with its balance today.
 * 3. Statement (`import`): one bank statement, read and imported in a tap (FirstImport.tsx). The
 *    subscriptions it shows (`subscriptions`) come only after an import that brought transactions.
 *
 * Then Done (`done`), with what the profile now holds and the next steps it calls for.
 *
 * On a phone the panel is the whole screen, over the night sky: Back and Close in a header with
 * the progress between them, and one footer row, a quiet Skip where a step can be skipped and the
 * primary action under the thumb. On a wider screen it is a card with the same parts.
 *
 * Every step can wait. Close asks once, naming what is left; a step's Skip asks only when it would
 * drop something typed or chosen. Auto-opens via `maybeOfferOnboarding()`: signed in, for an
 * account whose setup record is not finished, at the step it reached; local-first, for a pristine
 * workspace, or for one with only the demo's example profiles right after a signed-in account chose
 * to keep its data in this browser (core/onboardingStore.ts). Settings and the tour menu run it
 * again.
 *
 * An example profile is never renamed into the person's space. Over one, the space step makes a
 * new profile and selects it, and asks whether the example profiles stay (localOnly.ts).
 */
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, untrack } from 'solid-js'
import { refreshAchievements } from '../../core/achievementsStore'
import { api, apiGet, getLocalCurrency, showToast } from '../../core/api'
import {
  bumpProfileVersion,
  getProfiles,
  setCurrentProfile,
  setProfiles,
  useAppState,
} from '../../core/appStore'
import { showConfirm } from '../../core/confirmStore'
import { isExampleProfileName } from '../../core/demoMode'
import { loadAnswers, saveAnswers } from '../../core/guidanceAnswers'
import { benchmarksShown } from '../../core/guidanceGate'
import {
  clearLocalSetupPending,
  completeOnboarding,
  forgetOnboardingStatus,
  goToOnboardingStep,
  markLocalSetupPending,
  nextOnboardingStep,
  onboardingOpen,
  onboardingStep,
  prevOnboardingStep,
  skipOnboarding,
} from '../../core/onboardingStore'
import { getStorageMode, setStorageMode } from '../../core/storage/storageFactory'
import { handFileToImport } from '../../features/import/importHandoff'
import { Field, FormNotice } from '../form'
import { currentNextSteps, NextSteps } from '../GettingStarted'
import { SPACE_QUESTIONS_LEAD } from '../guidance/regionWords'
import { SpaceQuestions } from '../guidance/SpaceQuestions'
import choiceStyles from '../guidance/SpaceQuestions.module.css'
import { LogoMark } from '../Logo'
import { SubscriptionScanPanel } from '../SubscriptionScan'
import { counted, createFirstImport, FirstImportPanel, listed } from './FirstImport'
import {
  EXAMPLES_CHOICE_LEGEND,
  EXAMPLES_NOT_REMOVED,
  examplesChoiceNote,
  localOnlyQuestion,
  readLocalWorkspace,
} from './localOnly'
import styles from './Onboarding.module.css'
import {
  blankAccount,
  createFirstAccountForm,
  createSpaceForm,
  spaceAnswerChanges,
} from './onboardingForms'
import type { AnswerChanges, Answers } from '../../../../shared/guidance/answers'
import type { OrientationStep } from '../../../../shared/orientation'
import type { ImportSummary } from '../../features/import/importFlow'
import type { AccountType } from '../../types/models'
import type { LocalWorkspace } from './localOnly'

/** The counted steps: Space, Account, Statement. Done is not one of them. */
const COUNTED_STEPS = 3

/** The progress ring: a 24 px glyph in the header, filled by the step's share of the three. */
const RING_R = 9
const RING_C = 2 * Math.PI * RING_R

const ACCOUNT_TYPE_LABELS: { value: AccountType; label: string }[] = [
  { value: 'giro', label: 'Giro / Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'ib', label: 'Investment' },
  { value: 'cash', label: 'Cash' },
  { value: 'credit', label: 'Credit Card' },
]

const CURRENCIES = ['EUR', 'USD', 'GBP', 'JPY', 'CAD']

/** Decorative orbit field behind the panel: dotted rings + drifting tokens. */
function OrbitBackdrop() {
  return (
    <svg
      class={styles.backdrop}
      viewBox="0 0 1000 1000"
      aria-hidden="true"
      data-test-id="onboarding-backdrop"
    >
      <defs>
        <radialGradient id="onb-core" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="var(--primary)" stop-opacity="0.35" />
          <stop offset="1" stop-color="var(--primary)" stop-opacity="0" />
        </radialGradient>
      </defs>
      <circle cx="500" cy="500" r="150" fill="url(#onb-core)" />
      <circle class={styles.ring} cx="500" cy="500" r="240" stroke-dasharray="1 7" />
      <circle class={styles.ring} cx="500" cy="500" r="340" stroke-dasharray="1 9" />
      <circle class={styles.ring} cx="500" cy="500" r="450" stroke-dasharray="1 11" />
      <g class={styles.orbitSlow}>
        <circle class={styles.token} cx="500" cy="260" r="7" />
      </g>
      <g class={styles.orbitMid}>
        <circle class={styles.token} cx="500" cy="160" r="5" />
        <circle class={styles.tokenFaint} cx="840" cy="500" r="4" />
      </g>
      <g class={styles.orbitFast}>
        <circle class={styles.tokenWarm} cx="500" cy="50" r="6" />
      </g>
    </svg>
  )
}

/** Feather-style glyphs (24 x 24, 2 px stroke). */
const glyph = {
  back: (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  close: (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  device: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  ),
}

/** What the space step says when the space is saved and its answers are not. */
export const SPACE_ANSWERS_NOT_SAVED =
  "Your space is saved, but your answers didn't save. You can give them in Settings, under About this space."

/**
 * What Close asks, by where setup is: what is still to do, and where setup runs again. On the
 * subscriptions, `imported` says whether a statement went in on this visit: setup can also reopen
 * there from an earlier one, with nothing imported since it opened.
 */
export function leaveSetupQuestion(
  step: string,
  screen: 'name' | 'about',
  imported = false
): string {
  switch (step) {
    case 'account':
      return 'Leave setup? Your main account and a statement can wait. Settings can run setup again.'
    case 'import':
      return 'Leave setup? Your statement can wait: the Import page takes one any time, and Settings can run setup again.'
    case 'subscriptions':
      return imported
        ? 'Leave setup? Your import is saved, and Bills can scan for subscriptions any time.'
        : 'Leave setup? Bills can scan your transactions for subscriptions any time, and Settings can run setup again.'
    default:
      return screen === 'about'
        ? 'Leave setup? Your main account and a statement can wait. Settings can run setup again.'
        : 'Leave setup? Your space, your main account and a statement can all wait. Settings can run setup again.'
  }
}

export interface OnboardingWizardProps {
  /**
   * App's one way of choosing profiles: the first id becomes where writes land, the list is the
   * household, and the header and the sidebar's selection move with them.
   */
  selectProfiles: (ids: number[]) => void
}

/** One footer action. `skip` is the quiet button before the primary, where a step can wait. */
interface FooterAction {
  label: string
  run: () => void
  disabled: boolean
  /** The action is running: the button shows a spinner and this label. */
  busy?: string | false
  /** Defaults to onboarding-next, or onboarding-finish on Done. */
  testId?: string
  skip?: { label: string; run: () => void; disabled?: boolean; testId: string }
}

export function OnboardingWizard(props: OnboardingWizardProps) {
  const state = useAppState()

  // ---- what this visit did, for Done's summary ----
  const [createdAccounts, setCreatedAccounts] = createSignal<
    { name: string; type: AccountType; currency: string; balance: number }[]
  >([])
  const [importSummary, setImportSummary] = createSignal<ImportSummary | null>(null)
  const [subsAdded, setSubsAdded] = createSignal(0)

  // ---- step: your space ----
  // Two screens: the name and currency, then About this space while the benchmarks gate shows it.
  const [spaceScreen, setSpaceScreen] = createSignal<'name' | 'about'>('name')
  // Where the person lives and who the space covers (guidance.md 5.5): the answers the record
  // holds, and the ones chosen on this visit to the screen, which are what it saves. Both can be
  // left unanswered. The production build asks neither until the benchmarks they choose figures
  // for are shown (core/guidanceGate.ts), and saves no answer.
  const [storedAnswers, setStoredAnswers] = createSignal<Answers>({})
  const [chosenAnswers, setChosenAnswers] = createSignal<AnswerChanges>({})
  const [savingAnswers, setSavingAnswers] = createSignal(false)
  const spaceAnswers = (): Answers => ({ ...storedAnswers(), ...chosenAnswers() }) as Answers

  // A local workspace may hold the demo's example profiles. Setup over one of them makes the
  // person's space as a new profile, never by renaming the example, and asks whether they stay:
  // removed by default, so the dashboard setup ends on is the person's own and nothing else.
  // Accounts never hold example profiles.
  const exampleProfiles = () =>
    getStorageMode() === 'serverless'
      ? state.profiles.filter((p) => isExampleProfileName(p.name))
      : []
  const overExample = () =>
    getStorageMode() === 'serverless' && isExampleProfileName(state.currentProfile?.name)
  const [examplesChoice, setExamplesChoice] = createSignal<'remove' | 'keep'>('remove')

  /**
   * Remove the example profiles, each with everything in it, through the path the Danger Zone
   * uses. The space is made and selected by now: one that will not go stays, and the toast says
   * where to remove it, while setup goes on.
   */
  const removeExamples = async (examples: readonly { id: number; name: string }[]) => {
    const removed = new Set<number>()
    for (const example of examples) {
      try {
        await api.deleteProfile(example.id)
        removed.add(example.id)
      } catch {
        // Said once, below, for every one that stayed.
      }
    }
    if (removed.size > 0) {
      setProfiles(getProfiles().filter((p) => !removed.has(p.id)))
      bumpProfileVersion()
    }
    if (removed.size < examples.length) showToast(EXAMPLES_NOT_REMOVED, 'warning')
  }

  // What it checks and says is onboardingForms.ts; a refused name is said under the name.
  const spaceForm = createSpaceForm({
    // Over an example, the name is checked as a new profile's: the example keeps its own.
    current: () => (overExample() ? null : state.currentProfile),
    save: async ({ name, currency }) => {
      localStorage.setItem('localCurrency', currency)
      const current = state.currentProfile
      if (current && !overExample()) {
        if (current.name !== name) {
          await api.updateProfile(current.id, name)
          setCurrentProfile({ ...current, name })
          setProfiles(getProfiles().map((p) => (p.id === current.id ? { ...p, name } : p)))
          bumpProfileVersion()
        }
      } else {
        // Truly empty workspace (no profile at all), or one whose profile is an example: create
        // and select one, through App's one way of choosing profiles, as a profile created from
        // the sidebar is. This used to write the two storage keys itself and leave App's copy of
        // the selection on the old one, which the next close of the sidebar dropdown wrote back.
        // Over the examples, they go only once the space is made and selected.
        const leaving =
          current && examplesChoice() === 'remove'
            ? exampleProfiles().map((p) => ({ id: p.id, name: p.name }))
            : []
        const created = await api.createProfile(name)
        setProfiles([...getProfiles(), created])
        props.selectProfiles([created.id])
        if (leaving.length > 0) await removeExamples(leaving)
      }
      // The space is saved: a switch to local-only that asked for it has it.
      clearLocalSetupPending()
    },
    onSaved: () => {
      if (benchmarksShown()) setSpaceScreen('about')
      else nextOnboardingStep()
    },
  })

  // Saved for the profile the app now writes to, as every other write of setup is. The space is
  // saved by now, so a failure here does not hold setup: it says so and moves on, and the answers
  // can be given in Settings. Kept as chosen, they show if the person comes back to the screen,
  // whose save tries them again.
  const saveAnswersAndContinue = async () => {
    if (savingAnswers()) return
    setSavingAnswers(true)
    try {
      setStoredAnswers(await saveAnswers(spaceAnswerChanges(chosenAnswers())))
      setChosenAnswers({})
    } catch {
      showToast(SPACE_ANSWERS_NOT_SAVED, 'warning')
    } finally {
      setSavingAnswers(false)
    }
    if (onboardingOpen() && onboardingStep() === 'space') nextOnboardingStep()
  }

  // ---- step: your main account ----
  // What the profile ALREADY has: a wizard run again must recognise existing accounts instead of
  // pitching "your main account" at a five-account user.
  const [profileAccounts, setProfileAccounts] = createSignal<
    { id: number; name: string; currency?: string | null; balance?: number | null }[]
  >([])
  const [accountsLoaded, setAccountsLoaded] = createSignal(false)

  const refreshProfileAccounts = async () => {
    try {
      const list =
        await apiGet<
          { id: number; name: string; currency?: string | null; balance?: number | null }[]
        >('/api/accounts')
      setProfileAccounts(Array.isArray(list) ? list : [])
    } catch {
      // Keep whatever we had; the step still works, just without the list.
    } finally {
      setAccountsLoaded(true)
    }
  }

  // What it checks and says is onboardingForms.ts; a refusal is said under its field, or in the
  // step's notice when no field is the reason. Adding the account is the step's one action: the
  // next screen says it worked, so there is no toast.
  const accountForm = createFirstAccountForm({
    onCreated: async (account) => {
      setCreatedAccounts((prev) => [...prev, { ...account, type: account.type as AccountType }])
      bumpProfileVersion()
      await refreshProfileAccounts()
      if (onboardingOpen() && onboardingStep() === 'account') nextOnboardingStep()
    },
  })

  /** Skip asks only when it would drop what was typed. */
  const skipAccount = async () => {
    const typed = accountForm.values.name.trim() !== '' || accountForm.values.balance.trim() !== ''
    if (typed) {
      const sure = await showConfirm('Leave this account out? What you typed is not saved.', {
        confirmText: 'Leave it out',
        cancelText: 'Keep it',
      })
      if (!sure) return
      accountForm.reset(blankAccount(accountForm.values.currency))
    }
    nextOnboardingStep()
  }

  // ---- step: a statement ----
  const firstImport = createFirstImport({
    preferredAccount: () => createdAccounts().at(-1)?.name ?? null,
    onImported: (summary) => {
      // Totals add up across statements: "Bring in another statement" keeps the earlier ones.
      setImportSummary((prev) =>
        prev
          ? {
              ...summary,
              imported: prev.imported + summary.imported,
              duplicatesSkipped: prev.duplicatesSkipped + summary.duplicatesSkipped,
              createdAccounts: [...new Set([...prev.createdAccounts, ...summary.createdAccounts])],
            }
          : summary
      )
      // On to what the import made possible. With nothing new, the step says so and stays.
      if (summary.imported > 0) goToOnboardingStep('subscriptions')
    },
  })
  const importFlow = firstImport.flow
  let importInitialized = false

  /** Past the statement: its subscriptions when an import brought transactions in, else Done. */
  const afterStatement = () => {
    goToOnboardingStep((importSummary()?.imported ?? 0) > 0 ? 'subscriptions' : 'done')
  }

  /** Skip, with a statement ready: it asks, since the file would be dropped. */
  const skipStatement = async () => {
    if (firstImport.state() === 'ready') {
      const sure = await showConfirm(
        'Leave this statement out? Nothing from it is imported. The Import page can bring it in later.',
        { confirmText: 'Leave it out', cancelText: 'Keep it' }
      )
      if (!sure) return
    }
    firstImport.clear()
    afterStatement()
  }

  /** The way out for a file this step cannot import: setup finishes, and Import opens with it. */
  const openInImport = () => {
    const handed = firstImport.handOver()
    if (!handed) return
    handFileToImport(handed.file, handed.tab)
    completeOnboarding()
    window.location.hash = 'import'
  }

  // ---- step: subscriptions ----
  const [subScan, setSubScan] = createSignal<{
    chosenCount: () => number
    submitting: () => boolean
    addSelected: () => Promise<number>
  } | null>(null)

  // ---- step: done, with the next steps from what the profile now holds ----
  const [nextUp, setNextUp] = createSignal<OrientationStep[]>([])
  const loadNextSteps = async () => {
    setNextUp([])
    // Evaluated now rather than after the usual pause, so the steps count what was just imported.
    await refreshAchievements().catch(() => undefined)
    if (onboardingOpen() && onboardingStep() === 'done') setNextUp(currentNextSteps())
  }

  const accountsHeld = () =>
    Math.max(
      profileAccounts().length,
      createdAccounts().length + (importSummary()?.createdAccounts.length ?? 0)
    )

  /** "Personal has 1 account, 7 new transactions and 2 tracked subscriptions." */
  const doneSummary = () => {
    const name = state.currentProfile?.name ?? 'Your space'
    const parts: string[] = []
    if (accountsHeld() > 0) parts.push(counted(accountsHeld(), 'account'))
    const imported = importSummary()?.imported ?? 0
    if (imported > 0) parts.push(counted(imported, 'new transaction'))
    if (subsAdded() > 0) parts.push(counted(subsAdded(), 'tracked subscription'))
    return parts.length > 0 ? `${name} has ${listed(parts)}.` : `${name} is ready.`
  }

  const finish = () => {
    completeOnboarding()
    window.location.hash = 'dashboard'
  }

  // Seed per-step state when the wizard opens or moves.
  createEffect(() => {
    if (!onboardingOpen()) return
    const step = onboardingStep()
    // Untracked: a form is seeded when its step opens, not again as it is typed in or saved. A
    // rename that re-ran this reset the form while it saved, and the step never moved on; the
    // name typed in reset the currency chosen.
    if (step === 'space') {
      untrack(() => {
        // An example's name is not offered for the person's space.
        const named = overExample() ? undefined : state.currentProfile?.name
        spaceForm.reset({
          name: spaceForm.values.name || (named ?? 'Personal Profile'),
          currency: getLocalCurrency(),
        })
        setChosenAnswers({})
        // Asked again when the step opens again: what the record holds now. A workspace with no
        // profile yet holds none.
        if (state.currentProfile && benchmarksShown()) {
          loadAnswers()
            .then(setStoredAnswers)
            .catch(() => setStoredAnswers({}))
        } else {
          setStoredAnswers({})
        }
      })
    }
    if (step === 'account') {
      untrack(() => accountForm.set('currency', spaceForm.values.currency))
      void refreshProfileAccounts()
    }
    if (step === 'import') {
      if (!importInitialized) {
        importInitialized = true
        importFlow.init()
      } else {
        // Accounts created on the step before (or on a back-and-forth) must be ones "Goes into"
        // can offer.
        void importFlow.loadBankAccounts()
        importFlow.reloadBankRulesIfProfileChanged()
      }
    }
    if (step === 'done') {
      // The summary counts what's really on the profile (imports can create accounts too), not
      // just what this visit's form made.
      void refreshProfileAccounts()
      void untrack(loadNextSteps)
    }
  })

  // Guarded so hammering Escape can't stack confirm dialogs.
  let leavePromptOpen = false
  const requestLeave = async () => {
    if (leavePromptOpen) return
    leavePromptOpen = true
    try {
      const imported = (importSummary()?.imported ?? 0) > 0
      const sure = await showConfirm(
        leaveSetupQuestion(onboardingStep(), spaceScreen(), imported),
        {
          confirmText: 'Leave setup',
          cancelText: 'Stay',
        }
      )
      if (sure) skipOnboarding()
    } finally {
      leavePromptOpen = false
    }
  }

  // Escape asks to leave, as Close does. On Done there is nothing left: it finishes.
  const handleKeydown = (e: KeyboardEvent) => {
    if (!onboardingOpen()) return
    if (e.key === 'Escape') {
      e.preventDefault()
      if (onboardingStep() === 'done') completeOnboarding()
      else void requestLeave()
    }
  }
  document.addEventListener('keydown', handleKeydown)
  onCleanup(() => {
    document.removeEventListener('keydown', handleKeydown)
  })

  let panelRef: HTMLDivElement | undefined
  createEffect(() => {
    if (onboardingOpen()) panelRef?.focus()
  })

  /** Which of the three counted steps this is: none on Done. */
  const stepNumber = createMemo((): number | null => {
    switch (onboardingStep()) {
      case 'account':
        return 2
      case 'import':
      case 'subscriptions':
        return 3
      case 'done':
        return null
      default:
        return 1
    }
  })

  /** The import is running: nothing may move setup on until it settles. */
  const holding = () => onboardingStep() === 'import' && importFlow.loading()

  /** Back, where there is somewhere to go back to. */
  const backAction = (): (() => void) | null => {
    switch (onboardingStep()) {
      case 'space':
      case 'welcome':
        return spaceScreen() === 'about' ? () => setSpaceScreen('name') : null
      case 'account':
        return () => {
          setSpaceScreen(benchmarksShown() ? 'about' : 'name')
          prevOnboardingStep()
        }
      case 'import':
      case 'subscriptions':
        return () => {
          prevOnboardingStep()
        }
      default:
        return null
    }
  }

  // ---- the scrollable middle ----
  let bodyEl: HTMLDivElement | undefined

  // Whether the step goes on below what shows: the middle's bottom then fades out. Read on scroll,
  // and whenever the middle or the step in it changes size. The step ends where the middle's bottom
  // padding starts: stopped inside that padding, nothing is left below, and a fade there would only
  // dim the last row. Scrolled down at all, the top fades too.
  const [moreBelow, setMoreBelow] = createSignal(false)
  const [moreAbove, setMoreAbove] = createSignal(false)
  const readMoreBelow = () => {
    if (!bodyEl) return
    const padding = parseFloat(window.getComputedStyle(bodyEl).paddingBottom) || 0
    const contentEnd = bodyEl.scrollHeight - padding
    setMoreBelow(bodyEl.scrollTop + bodyEl.clientHeight < contentEnd - 0.5)
    setMoreAbove(bodyEl.scrollTop > 0.5)
  }
  if (typeof ResizeObserver !== 'undefined') {
    const sizes = new ResizeObserver(readMoreBelow)
    createEffect(() => {
      if (!onboardingOpen()) return
      onboardingStep()
      spaceScreen()
      sizes.disconnect()
      if (!bodyEl) return
      sizes.observe(bodyEl)
      if (bodyEl.firstElementChild) sizes.observe(bodyEl.firstElementChild)
      readMoreBelow()
    })
    onCleanup(() => {
      sizes.disconnect()
    })
  }

  // A new screen opens at its top, not at the scroll position the last one was left at, and focus
  // moves to its heading, so a screen reader announces it and Tab starts from there. At once, not
  // smooth: the old screen's content is already gone. Not on open, where the panel takes focus.
  createEffect(
    on(
      [onboardingStep, spaceScreen],
      () => {
        if (!onboardingOpen() || !bodyEl) return
        bodyEl.scrollTop = 0
        bodyEl.querySelector<HTMLElement>('[data-step-heading]')?.focus({ preventScroll: true })
      },
      { defer: true }
    )
  )

  // Local-only, offered to a signed-in account on the first screen, before anything is saved to
  // it: the switch reloads into this browser's local workspace, so later it would leave the space
  // and the account behind in the cloud. What that workspace holds decides what the confirm says,
  // so it is read first, without changing anything in it (localOnly.ts): nothing (a fresh local
  // workspace, which opens this wizard as the E2E zero-state helper's does), only the demo's
  // example profiles (setup opens on the space over them, and asks whether they stay), or
  // profiles of the person's own (carried on with).
  const chooseLocalOnly = async () => {
    const found = await readLocalWorkspace().catch((): LocalWorkspace => ({ kind: 'unknown' }))
    const sure = await showConfirm(localOnlyQuestion(found), {
      confirmText: 'Keep it here',
      cancelText: 'Cancel',
    })
    if (!sure) return
    try {
      // The example seed never runs into a workspace the person chose: an empty one stays empty.
      localStorage.setItem('finance_had_profiles', '1')
      // A relaunched wizard may carry a completed/skipped flag; a fresh local workspace should
      // offer setup again. (Harmless when local data exists: a workspace of the person's own that
      // is not pristine never auto-opens the wizard.)
      forgetOnboardingStatus('local')
      // Server-mode profile selection is meaningless against the local DB; stale ids would make
      // the profile picker read empty or heal onto the wrong profile (mirrors handleLogout's
      // cleanup). Over profiles of the person's own, the oldest is selected instead: the confirm
      // says they carry on with them, and App, left to pick, would open the lowest id, an example
      // where the examples are here too.
      if (found.kind === 'own') {
        localStorage.setItem('currentProfileId', String(found.ids[0]))
        localStorage.setItem('selectedProfileIds', JSON.stringify([found.ids[0]]))
      } else {
        localStorage.removeItem('currentProfileId')
        localStorage.removeItem('selectedProfileIds')
      }
      // Setup opens on the space after the reload unless the workspace has a profile of the
      // person's own (onboardingStore.ts, whereToOfferOnboarding).
      markLocalSetupPending()
    } catch {
      // Non-fatal: worst case the first init seeds the demo profiles.
    }
    setStorageMode('serverless')
    window.location.reload()
  }

  // ---- step bodies ----

  const nameScreen = () => (
    <div class={styles.step} data-test-id="onboarding-step-space">
      <h1 class={`${styles.title} ${styles.welcomeTitle}`} tabindex="-1" data-step-heading>
        Welcome to Token Circles
      </h1>
      <p class={styles.lead}>
        Three steps: your space, your main account and a statement. Each one can wait.
      </p>
      {/* Enter in the name continues, as the footer's Continue does. */}
      <form class={styles.stack} {...spaceForm.attrs} data-test-id="onboarding-space-form">
        <FormNotice form={spaceForm} testId="onboarding-space-notice" />
        <Field
          form={spaceForm}
          name="name"
          label="Profile name"
          class={styles.field}
          labelClass={styles.fieldLabel}
        >
          {(control) => (
            <input
              {...control}
              class={styles.input}
              data-test-id="onboarding-profile-name"
              value={spaceForm.values.name}
              maxlength={60}
              autocomplete="off"
              // Select the prefilled default on focus: typing replaces it outright, an arrow key
              // keeps it and positions the caret for a tweak.
              onFocus={(e) => {
                e.currentTarget.select()
              }}
              onInput={(e) => spaceForm.set('name', e.currentTarget.value)}
            />
          )}
        </Field>
        <Field
          form={spaceForm}
          name="currency"
          label="Base currency"
          class={styles.field}
          labelClass={styles.fieldLabel}
          hint="Totals and charts use it. Accounts can still hold others."
          hintClass={styles.hint}
        >
          {(control) => (
            <select
              {...control}
              class={styles.input}
              data-test-id="onboarding-currency"
              value={spaceForm.values.currency}
              onInput={(e) => spaceForm.set('currency', e.currentTarget.value)}
            >
              <For each={CURRENCIES}>
                {(c) => (
                  <option value={c} selected={c === spaceForm.values.currency}>
                    {c}
                  </option>
                )}
              </For>
            </select>
          )}
        </Field>
        <Show when={overExample() && exampleProfiles().length > 0}>
          <fieldset class={choiceStyles.question} data-test-id="onboarding-examples-choice">
            <legend class={choiceStyles.legend}>{EXAMPLES_CHOICE_LEGEND}</legend>
            <div class={choiceStyles.chips}>
              <For each={['remove', 'keep'] as const}>
                {(choice) => (
                  <label class={choiceStyles.chip} data-test-id={`onboarding-examples-${choice}`}>
                    <input
                      type="radio"
                      class={choiceStyles.radio}
                      name="onboarding-examples"
                      value={choice}
                      checked={examplesChoice() === choice}
                      disabled={spaceForm.submitting()}
                      onChange={() => setExamplesChoice(choice)}
                    />
                    <span>
                      {`${choice === 'remove' ? 'Remove' : 'Keep'} ${exampleProfiles().length === 1 ? 'it' : 'them'}`}
                    </span>
                  </label>
                )}
              </For>
            </div>
            <p class={choiceStyles.note} data-test-id="onboarding-examples-note">
              {examplesChoiceNote(
                examplesChoice(),
                exampleProfiles().map((p) => p.name)
              )}
            </p>
          </fieldset>
        </Show>
        <Show when={getStorageMode() === 'self-hosted'}>
          <button
            type="button"
            class={styles.linkBtn}
            data-test-id="onboarding-local-only"
            onClick={() => void chooseLocalOnly()}
          >
            {glyph.device}
            Keep my data in this browser only
          </button>
        </Show>
      </form>
    </div>
  )

  const aboutScreen = () => (
    <div class={styles.step} data-test-id="onboarding-step-about">
      <h2 class={styles.title} tabindex="-1" data-step-heading>
        About this space
      </h2>
      <p class={styles.lead} data-test-id="onboarding-space-questions-lead">
        {SPACE_QUESTIONS_LEAD}
      </p>
      <div class={styles.stack}>
        <SpaceQuestions
          idPrefix="onboarding-space"
          answers={spaceAnswers()}
          disabled={savingAnswers()}
          compact
          onChoose={(changes) => setChosenAnswers((chosen) => ({ ...chosen, ...changes }))}
        />
      </div>
    </div>
  )

  const accountStep = () => (
    <div class={styles.step} data-test-id="onboarding-step-account">
      <Show
        when={profileAccounts().length === 0}
        fallback={
          <>
            <h2 class={styles.title} tabindex="-1" data-step-heading>
              Your accounts
            </h2>
            <p class={styles.lead}>
              {`You have ${counted(profileAccounts().length, 'account')}. Add another here, or skip.`}
            </p>
            <div class={styles.chips}>
              <For each={profileAccounts()}>
                {(a) => (
                  <span class={styles.chip} data-test-id="onboarding-account-chip">
                    <span class={styles.chipDot} />
                    {a.name}
                    <Show when={a.currency}>
                      <span class={styles.chipMeta}>{a.currency}</span>
                    </Show>
                  </span>
                )}
              </For>
            </div>
          </>
        }
      >
        <h2 class={styles.title} tabindex="-1" data-step-heading>
          Add your main account
        </h2>
        <p class={styles.lead}>The one you pay from most. Add the rest from Accounts later.</p>
      </Show>
      <form
        class={styles.stack}
        {...accountForm.attrs}
        data-test-id="onboarding-account-form"
        // Two text fields stop the browser's own Enter-to-submit: Enter adds the account, as the
        // footer's Add account does.
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
            e.preventDefault()
            void accountForm.submit()
          }
        }}
      >
        <FormNotice form={accountForm} testId="onboarding-account-notice" />
        <Field
          form={accountForm}
          name="name"
          label="Account name"
          class={styles.field}
          labelClass={styles.fieldLabel}
        >
          {(control) => (
            <input
              {...control}
              class={styles.input}
              data-test-id="onboarding-account-name"
              placeholder="e.g. Main checking"
              autocomplete="off"
              value={accountForm.values.name}
              onInput={(e) => accountForm.set('name', e.currentTarget.value)}
            />
          )}
        </Field>
        <Field
          form={accountForm}
          name="type"
          label="Type"
          class={styles.field}
          labelClass={styles.fieldLabel}
        >
          {(control) => (
            <select
              {...control}
              class={styles.input}
              data-test-id="onboarding-account-type"
              value={accountForm.values.type}
              onInput={(e) => accountForm.set('type', e.currentTarget.value)}
            >
              <For each={ACCOUNT_TYPE_LABELS}>
                {(t) => (
                  <option value={t.value} selected={t.value === accountForm.values.type}>
                    {t.label}
                  </option>
                )}
              </For>
            </select>
          )}
        </Field>
        <Field
          form={accountForm}
          name="balance"
          label="Balance today"
          class={styles.field}
          labelClass={styles.fieldLabel}
          hint="It becomes the account's opening balance."
          hintClass={styles.hint}
        >
          {(control) => (
            <div class={styles.row}>
              <input
                {...control}
                class={styles.input}
                data-test-id="onboarding-account-balance"
                type="text"
                inputmode="decimal"
                placeholder="0.00"
                autocomplete="off"
                value={accountForm.values.balance}
                onInput={(e) => accountForm.set('balance', e.currentTarget.value)}
              />
              <select
                class={`${styles.input} ${styles.currencySelect}`}
                aria-label="Account currency"
                data-test-id="onboarding-account-currency"
                value={accountForm.values.currency}
                onInput={(e) => accountForm.set('currency', e.currentTarget.value)}
              >
                <For each={CURRENCIES}>
                  {(c) => (
                    <option value={c} selected={c === accountForm.values.currency}>
                      {c}
                    </option>
                  )}
                </For>
              </select>
            </div>
          )}
        </Field>
      </form>
    </div>
  )

  const importStep = () => (
    <div class={styles.step} data-test-id="onboarding-step-import">
      <h2 class={styles.title} tabindex="-1" data-step-heading>
        Bring in a statement
      </h2>
      <p class={styles.lead}>
        Export a CSV or Excel file from your bank's app, then choose it here.
      </p>
      <div class={styles.stack}>
        <FirstImportPanel importer={firstImport} />
      </div>
    </div>
  )

  const subscriptionsStep = () => (
    <div class={styles.step} data-test-id="onboarding-step-subscriptions">
      <h2 class={styles.title} tabindex="-1" data-step-heading>
        Subscriptions we spotted
      </h2>
      <p class={styles.lead}>
        Tick the ones to track. They go under Bills, where you can change them.
      </p>
      <div class={`${styles.stack} ${styles.subscriptions}`}>
        <SubscriptionScanPanel
          active={() => onboardingOpen() && onboardingStep() === 'subscriptions'}
          onAdded={(n) => setSubsAdded((prev) => prev + n)}
          emptyHint="You can always scan again later: Bills → Subscriptions → Scan transactions."
          expose={setSubScan}
          hideAddButton
          hideRescan
          quiet
        />
      </div>
    </div>
  )

  const doneStep = () => (
    <div class={`${styles.step} ${styles.doneStep}`} data-test-id="onboarding-step-done">
      <div class={styles.doneOrbit}>
        <svg viewBox="0 0 120 120" class={styles.doneRingSvg} aria-hidden="true">
          <circle class={styles.doneTrack} cx="60" cy="60" r="44" stroke-dasharray="1 6" />
          <circle class={styles.doneArc} cx="60" cy="60" r="44" transform="rotate(-90 60 60)" />
          <circle class={styles.doneCore} cx="60" cy="60" r="14" />
        </svg>
        <span class={styles.doneSatellite} />
      </div>
      <h2 class={styles.title} tabindex="-1" data-step-heading>
        Your orbit is set
      </h2>
      <p class={styles.doneSummary} data-test-id="onboarding-done-summary">
        {doneSummary()}
      </p>
      <Show when={nextUp().length > 0}>
        <section class={styles.nextSteps} data-test-id="onboarding-next-steps">
          <h3 class={styles.nextStepsTitle}>Next steps</h3>
          {/* A step's link leaves setup the way Go to my dashboard does, for the step's page. */}
          <NextSteps
            steps={nextUp()}
            onFollow={() => {
              completeOnboarding()
            }}
          />
        </section>
      </Show>
      {/* A keyboard shortcut, so only where there is a keyboard to press it: not on touch. */}
      <p class={styles.tip}>
        Press <kbd>Ctrl</kbd>+<kbd>K</kbd> anywhere to add a transaction, and take a page tour any
        time from the sidebar.
      </p>
    </div>
  )

  // ---- the footer: a quiet Skip where a step can wait, and the step's one primary action ----

  const statementAction = (): FooterAction => {
    const skip = (disabled = false) => ({
      label: 'Skip',
      run: () => void skipStatement(),
      disabled,
      testId: 'onboarding-import-skip',
    })
    switch (firstImport.state()) {
      case 'empty':
        return {
          label: 'Choose a file',
          run: firstImport.openPicker,
          disabled: false,
          testId: 'onboarding-import-choose',
          skip: skip(),
        }
      case 'reading':
        return {
          label: 'Choose a file',
          run: () => undefined,
          disabled: true,
          busy: 'Reading…',
          testId: 'onboarding-import-choose',
          skip: skip(true),
        }
      case 'ready':
        return {
          label: `Import ${firstImport.newCount().toLocaleString('en-GB')}`,
          run: () => void firstImport.importNow(),
          disabled: firstImport.importing(),
          busy: firstImport.importing() && 'Importing…',
          testId: 'onboarding-import-selected',
          skip: skip(firstImport.importing()),
        }
      case 'unreadable':
        return {
          label: 'Open in Import',
          run: openInImport,
          disabled: false,
          testId: 'onboarding-import-open',
          skip: skip(),
        }
      default:
        // Nothing new in it, or imported already: on to what comes next.
        return { label: 'Continue', run: afterStatement, disabled: false }
    }
  }

  const primaryAction = (): FooterAction => {
    switch (onboardingStep()) {
      case 'account':
        return {
          label: 'Add account',
          run: () => void accountForm.submit(),
          disabled: accountForm.submitting() || !accountsLoaded(),
          busy: accountForm.submitting() && 'Adding…',
          testId: 'onboarding-account-create',
          skip: {
            label: 'Skip',
            run: () => void skipAccount(),
            disabled: accountForm.submitting(),
            testId: 'onboarding-account-skip',
          },
        }
      case 'import':
        return statementAction()
      case 'subscriptions': {
        const scan = subScan()
        const picked = scan?.chosenCount() ?? 0
        if (scan && picked > 0) {
          return {
            label: `Track ${counted(picked, 'subscription')}`,
            run: () => {
              void scan.addSelected().then(() => {
                // A subscription that was refused stays chosen, marked under its row or named in
                // the panel's notice: the step stays until it is fixed or left out.
                if (scan.chosenCount() === 0) goToOnboardingStep('done')
              })
            },
            disabled: scan.submitting(),
            busy: scan.submitting() && 'Adding…',
            testId: 'onboarding-subs-add-continue',
            skip: {
              label: 'Skip',
              run: () => {
                goToOnboardingStep('done')
              },
              disabled: scan.submitting(),
              testId: 'onboarding-subs-skip',
            },
          }
        }
        return {
          label: 'Continue',
          run: () => {
            goToOnboardingStep('done')
          },
          disabled: scan?.submitting() ?? false,
        }
      }
      case 'done':
        return {
          label: 'Go to my dashboard',
          run: finish,
          disabled: false,
          testId: 'onboarding-finish',
        }
      default:
        // The space step, either screen.
        return spaceScreen() === 'about'
          ? {
              label: 'Continue',
              run: () => void saveAnswersAndContinue(),
              disabled: savingAnswers(),
              busy: savingAnswers() && 'Saving…',
            }
          : {
              label: 'Continue',
              run: () => void spaceForm.submit(),
              disabled: spaceForm.submitting(),
              busy: spaceForm.submitting() && 'Saving…',
            }
    }
  }

  return (
    <Show when={onboardingOpen()}>
      <div class={styles.overlay} data-test-id="onboarding-wizard">
        <OrbitBackdrop />
        <div
          class={styles.panel}
          role="dialog"
          aria-modal="true"
          aria-label="Token Circles setup"
          tabindex="-1"
          ref={panelRef}
          data-test-id="onboarding-panel"
        >
          <header class={styles.header}>
            <Show
              when={backAction()}
              fallback={
                <span class={styles.brandMark}>
                  <LogoMark size={28} />
                </span>
              }
            >
              <button
                type="button"
                class={styles.iconBtn}
                aria-label="Back"
                data-test-id="onboarding-back"
                disabled={holding() || firstImport.state() === 'reading'}
                onClick={() => {
                  backAction()?.()
                }}
              >
                {glyph.back}
              </button>
            </Show>
            <Show when={stepNumber()} fallback={<span />}>
              {(n) => (
                <span class={styles.progress} data-test-id="onboarding-progress">
                  <svg viewBox="0 0 24 24" class={styles.progressSvg} aria-hidden="true">
                    <circle
                      class={styles.progressTrack}
                      cx="12"
                      cy="12"
                      r={RING_R}
                      stroke-dasharray="1 3"
                    />
                    <circle
                      class={styles.progressArc}
                      cx="12"
                      cy="12"
                      r={RING_R}
                      stroke-dasharray={`${(n() / COUNTED_STEPS) * RING_C} ${RING_C}`}
                      transform="rotate(-90 12 12)"
                    />
                  </svg>
                  <span>
                    Step {n()} of {COUNTED_STEPS}
                  </span>
                </span>
              )}
            </Show>
            <Show when={onboardingStep() !== 'done'} fallback={<span />}>
              <button
                type="button"
                class={styles.iconBtn}
                aria-label="Leave setup"
                data-test-id="onboarding-skip"
                disabled={holding()}
                onClick={() => void requestLeave()}
              >
                {glyph.close}
              </button>
            </Show>
          </header>

          <div
            class={styles.body}
            ref={bodyEl}
            data-test-id="onboarding-body"
            data-more-below={moreBelow() ? '' : undefined}
            data-more-above={moreAbove() ? '' : undefined}
            onScroll={readMoreBelow}
          >
            <Show when={onboardingStep() === 'space' || onboardingStep() === 'welcome'}>
              <Show when={spaceScreen() === 'about'} fallback={nameScreen()}>
                {aboutScreen()}
              </Show>
            </Show>
            <Show when={onboardingStep() === 'account'}>{accountStep()}</Show>
            <Show when={onboardingStep() === 'import'}>{importStep()}</Show>
            <Show when={onboardingStep() === 'subscriptions'}>{subscriptionsStep()}</Show>
            <Show when={onboardingStep() === 'done'}>{doneStep()}</Show>
          </div>

          <footer class={styles.footer}>
            <Show when={primaryAction().skip}>
              {(skip) => (
                <button
                  type="button"
                  class={styles.quietBtn}
                  data-test-id={skip().testId}
                  disabled={skip().disabled}
                  onClick={() => {
                    skip().run()
                  }}
                >
                  {skip().label}
                </button>
              )}
            </Show>
            <button
              type="button"
              class={styles.primaryBtn}
              data-test-id={
                primaryAction().testId ??
                (onboardingStep() === 'done' ? 'onboarding-finish' : 'onboarding-next')
              }
              disabled={primaryAction().disabled}
              aria-busy={primaryAction().busy ? 'true' : undefined}
              onClick={() => {
                primaryAction().run()
              }}
            >
              <Show when={primaryAction().busy} fallback={primaryAction().label}>
                {/* The click's first feedback happens ON the button that was clicked. */}
                <span class={styles.btnSpinner} aria-hidden="true" />
                {primaryAction().busy}
              </Show>
            </button>
          </footer>
        </div>
      </div>
    </Show>
  )
}

export default OnboardingWizard
