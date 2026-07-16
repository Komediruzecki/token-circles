/**
 * OnboardingWizard — the first-run setup flow, in the app's orbital language.
 *
 * A full-screen night-sky overlay with animated orbit rings behind a glass
 * panel; six steps: welcome → name your space → first account(s) → bring your
 * data (the real import flow, embedded) → detected subscriptions → orbit
 * complete. Every step can be skipped (with a confirm where data would be
 * lost), so nobody is ever stuck — and the whole thing can be relaunched from
 * the tour menu. Auto-opens via `maybeOfferOnboarding()` for pristine
 * profiles only.
 */
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { api, apiGet, apiPost, getLocalCurrency, toast } from '../../core/api'
import {
  bumpProfileVersion,
  getProfiles,
  setCurrentProfile,
  setProfiles,
  useAppState,
} from '../../core/appStore'
import { showConfirm } from '../../core/confirmStore'
import {
  completeOnboarding,
  nextOnboardingStep,
  ONBOARDING_STEPS,
  onboardingOpen,
  onboardingStep,
  prevOnboardingStep,
  skipOnboarding,
} from '../../core/onboardingStore'
import importStyles from '../../features/Import.module.css'
import { ImportDataEntry } from '../../features/import/ImportDataEntry'
import { createImportFlow } from '../../features/import/importFlow'
import { ImportMappingStep } from '../../features/import/ImportMappingStep'
import { ImportPreviewStep } from '../../features/import/ImportPreviewStep'
import { LogoMark } from '../Logo'
import { OrbitSpinner } from '../OrbitSpinner'
import { SubscriptionScanPanel } from '../SubscriptionScan'
import styles from './Onboarding.module.css'
import type { ImportSummary } from '../../features/import/importFlow'
import type { AccountType } from '../../types/models'

const R = 26
const CIRC = 2 * Math.PI * R

const ACCOUNT_TYPE_LABELS: { value: AccountType; label: string }[] = [
  { value: 'giro', label: 'Giro / Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'ib', label: 'Investment' },
  { value: 'cash', label: 'Cash' },
]

const CURRENCIES = ['EUR', 'USD', 'GBP', 'JPY', 'CAD']

/** Decorative orbit field behind the panel: dotted rings + drifting tokens. */
function OrbitBackdrop() {
  return (
    <svg class={styles.backdrop} viewBox="0 0 1000 1000" aria-hidden="true">
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

/** Small feather-style icons for the welcome bullets (24x24, 2px stroke). */
const icons = {
  orbit: (
    <svg
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.6" />
      <circle cx="19.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  ),
  inbox: (
    <svg
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      viewBox="0 0 24 24"
    >
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
    </svg>
  ),
  repeat: (
    <svg
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      viewBox="0 0 24 24"
    >
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 014-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 01-4 4H3" />
    </svg>
  ),
  shield: (
    <svg
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      viewBox="0 0 24 24"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  wallet: (
    <svg
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      viewBox="0 0 24 24"
    >
      <path d="M21 12V7H5a2 2 0 010-4h14v4" />
      <path d="M3 5v14a2 2 0 002 2h16v-5" />
      <path d="M18 12a2 2 0 000 4h4v-4h-4z" />
    </svg>
  ),
}

export function OnboardingWizard() {
  const state = useAppState()

  // ---- wizard-session results (feed the final summary) ----
  const [createdAccounts, setCreatedAccounts] = createSignal<
    { name: string; type: AccountType; currency: string; balance: number }[]
  >([])
  const [importSummary, setImportSummary] = createSignal<ImportSummary | null>(null)
  const [subsAdded, setSubsAdded] = createSignal(0)

  // ---- step: your space ----
  const [spaceName, setSpaceName] = createSignal('')
  const [baseCurrency, setBaseCurrency] = createSignal(getLocalCurrency())
  const [savingSpace, setSavingSpace] = createSignal(false)

  // ---- step: first account ----
  const [accName, setAccName] = createSignal('')
  const [accType, setAccType] = createSignal<AccountType>('giro')
  const [accCurrency, setAccCurrency] = createSignal(getLocalCurrency())
  const [accBalance, setAccBalance] = createSignal('')
  const [accDate, setAccDate] = createSignal('')
  const [creatingAccount, setCreatingAccount] = createSignal(false)
  // What the profile ALREADY has — a relaunched wizard must recognize existing
  // accounts instead of pitching "your first account" at a five-account user.
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

  // ---- step: bring your data (the real import flow, embedded) ----
  const importFlow = createImportFlow({
    initialTab: 'bank-imports',
    autoResetAfterImport: false,
    onImported: (summary) => {
      setImportSummary((prev) =>
        prev ? { ...summary, imported: prev.imported + summary.imported } : summary
      )
    },
  })
  let importInitialized = false

  // Seed per-step state when the wizard opens / advances.
  createEffect(() => {
    if (!onboardingOpen()) return
    const step = onboardingStep()
    if (step === 'space') {
      if (!spaceName()) setSpaceName(state.currentProfile?.name ?? 'Personal Profile')
      setBaseCurrency(getLocalCurrency())
    }
    if (step === 'account') {
      setAccCurrency(baseCurrency())
      void refreshProfileAccounts()
    }
    if (step === 'import') {
      if (!importInitialized) {
        importInitialized = true
        importFlow.init()
      } else {
        // Accounts created on the previous step (or on a back-and-forth) must
        // show up in the bank statements' target-account pickers.
        void importFlow.loadBankAccounts()
      }
    }
    if (step === 'done') {
      // The summary counts what's really on the profile (imports can create
      // accounts too), not just what this step's form made.
      void refreshProfileAccounts()
    }
  })

  // Escape asks to leave (same as the Skip button); plain steps navigate back.
  const handleKeydown = (e: KeyboardEvent) => {
    if (!onboardingOpen()) return
    if (e.key === 'Escape') {
      e.preventDefault()
      void requestSkipAll()
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

  const stepIndex = createMemo(() => ONBOARDING_STEPS.indexOf(onboardingStep()))
  const progress = createMemo(() => (stepIndex() / (ONBOARDING_STEPS.length - 1)) * CIRC)

  // Guarded so hammering Escape can't stack multiple confirm dialogs.
  let skipPromptOpen = false
  const requestSkipAll = async () => {
    if (skipPromptOpen) return
    skipPromptOpen = true
    try {
      const sure = await showConfirm(
        'Leave setup? You can explore the app freely and relaunch this wizard any time from the sidebar tour menu.'
      )
      if (sure) skipOnboarding()
    } finally {
      skipPromptOpen = false
    }
  }

  // ---- step actions ----

  const saveSpace = async () => {
    const name = spaceName().trim()
    if (!name) return
    setSavingSpace(true)
    try {
      localStorage.setItem('localCurrency', baseCurrency())
      const current = state.currentProfile
      if (current) {
        if (current.name !== name) {
          await api.updateProfile(current.id, name)
          setCurrentProfile({ ...current, name })
          setProfiles(getProfiles().map((p) => (p.id === current.id ? { ...p, name } : p)))
          bumpProfileVersion()
        }
      } else {
        // Truly empty workspace (no profile at all): create and select one.
        const created = await api.createProfile(name)
        localStorage.setItem('currentProfileId', String(created.id))
        localStorage.setItem('selectedProfileIds', JSON.stringify([created.id]))
        setProfiles([...getProfiles(), created])
        setCurrentProfile({ ...created })
        bumpProfileVersion()
      }
      nextOnboardingStep()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save your space', 'error')
    } finally {
      setSavingSpace(false)
    }
  }

  const createAccount = async () => {
    const name = accName().trim()
    if (!name || creatingAccount()) return
    setCreatingAccount(true)
    try {
      const opening = parseFloat(accBalance().replace(',', '.')) || 0
      await apiPost('/api/accounts', {
        name,
        type: accType(),
        currency: accCurrency(),
        balance: opening,
        starting_balance: opening,
        ...(accDate() ? { starting_date: accDate() } : {}),
      })
      setCreatedAccounts((prev) => [
        ...prev,
        { name, type: accType(), currency: accCurrency(), balance: opening },
      ])
      toast(`Account "${name}" created`, 'success')
      setAccName('')
      setAccBalance('')
      setAccDate('')
      bumpProfileVersion()
      await refreshProfileAccounts()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create the account', 'error')
    } finally {
      setCreatingAccount(false)
    }
  }

  const continueFromAccounts = async () => {
    // Any account counts — created here or already on the profile (relaunch).
    if (profileAccounts().length > 0 || createdAccounts().length > 0) {
      nextOnboardingStep()
      return
    }
    const sure = await showConfirm(
      'Skip creating an account? Most of the app orbits around at least one account — you can add it later on the Accounts page.'
    )
    if (sure) nextOnboardingStep()
  }

  const continueFromImport = async () => {
    if (importSummary()) {
      nextOnboardingStep()
      return
    }
    const midFlow = importFlow.activeStep() !== 'upload' || importFlow.bankFiles().length > 0
    const sure = await showConfirm(
      midFlow
        ? 'Skip importing? The data you prepared here will be discarded — you can import any time from the Import page.'
        : 'Skip importing for now? You can bring your history any time from the Import page.'
    )
    if (sure) {
      importFlow.resetForm()
      nextOnboardingStep()
    }
  }

  const finish = () => {
    completeOnboarding()
    window.location.hash = 'dashboard'
  }

  // ---- step bodies ----

  const welcomeStep = () => (
    <div class={styles.step} data-test-id="onboarding-step-welcome">
      <div class={styles.hero}>
        <div class={styles.heroMark}>
          <LogoMark size={72} />
        </div>
        <h1 class={styles.title}>Welcome to Token Circles</h1>
        <p class={styles.lead}>
          Your money, mapped as orbits: accounts circle your net worth, spending and income keep
          them in motion. Let's set up your space — it takes about two minutes.
        </p>
      </div>
      <ul class={styles.features}>
        <li>
          <span class={styles.featureIcon}>{icons.wallet}</span>
          <span>
            <b>Create your first account</b> — the home for your balance and transactions.
          </span>
        </li>
        <li>
          <span class={styles.featureIcon}>{icons.inbox}</span>
          <span>
            <b>Bring your history</b> — bank statements (Revolut, Erste, PBZ), CSV, or Google
            Sheets.
          </span>
        </li>
        <li>
          <span class={styles.featureIcon}>{icons.repeat}</span>
          <span>
            <b>Auto-detect subscriptions</b> — we recognize Netflix, Spotify, Claude and 40+ more
            from your imported charges.
          </span>
        </li>
        <li>
          <span class={styles.featureIcon}>{icons.shield}</span>
          <span>
            <b>Skip anything</b> — every step is optional, and the wizard can be relaunched from the
            tour menu.
          </span>
        </li>
      </ul>
    </div>
  )

  const spaceStep = () => (
    <div class={styles.step} data-test-id="onboarding-step-space">
      <h2 class={styles.stepTitle}>Name your space</h2>
      <p class={styles.stepLead}>
        A profile is one financial space — yours, a partner's, or a shared household view. You can
        add more later.
      </p>
      <div class={styles.formGrid}>
        <label class={styles.field}>
          <span class={styles.fieldLabel}>Profile name</span>
          <input
            class={styles.input}
            data-test-id="onboarding-profile-name"
            value={spaceName()}
            maxlength={60}
            // Select the prefilled default on focus: typing replaces it outright,
            // an arrow key keeps it and positions the caret for a tweak.
            onFocus={(e) => {
              e.currentTarget.select()
            }}
            onInput={(e) => setSpaceName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveSpace()
            }}
          />
        </label>
        <label class={styles.field}>
          <span class={styles.fieldLabel}>Base currency</span>
          <select
            class={styles.input}
            data-test-id="onboarding-currency"
            value={baseCurrency()}
            onChange={(e) => setBaseCurrency(e.currentTarget.value)}
          >
            <For each={CURRENCIES}>{(c) => <option value={c}>{c}</option>}</For>
          </select>
          <span class={styles.fieldHint}>
            Totals and charts are shown in this currency. Individual accounts can still hold others.
          </span>
        </label>
      </div>
    </div>
  )

  const accountStep = () => (
    <div class={styles.step} data-test-id="onboarding-step-account">
      <Show
        when={profileAccounts().length === 0}
        fallback={
          <>
            <h2 class={styles.stepTitle}>Your accounts</h2>
            <p class={styles.stepLead}>
              You already have {profileAccounts().length} account
              {profileAccounts().length === 1 ? '' : 's'} in orbit — add another below if you like,
              then continue.
            </p>
          </>
        }
      >
        <h2 class={styles.stepTitle}>Create your first account</h2>
        <p class={styles.stepLead}>
          An account is anything that holds money — a checking account, savings, cash in a drawer, a
          brokerage. Add the one you use most; more can join the orbit any time.
        </p>
      </Show>
      <Show when={profileAccounts().length > 0}>
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
      </Show>
      <div class={styles.formGrid}>
        <label class={styles.field}>
          <span class={styles.fieldLabel}>Account name</span>
          <input
            class={styles.input}
            data-test-id="onboarding-account-name"
            placeholder="e.g. Main Checking"
            value={accName()}
            onInput={(e) => setAccName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createAccount()
            }}
          />
        </label>
        <label class={styles.field}>
          <span class={styles.fieldLabel}>Type</span>
          <select
            class={styles.input}
            data-test-id="onboarding-account-type"
            value={accType()}
            onChange={(e) => setAccType(e.currentTarget.value as AccountType)}
          >
            <For each={ACCOUNT_TYPE_LABELS}>
              {(t) => <option value={t.value}>{t.label}</option>}
            </For>
          </select>
        </label>
        <label class={styles.field}>
          <span class={styles.fieldLabel}>Currency</span>
          <select
            class={styles.input}
            data-test-id="onboarding-account-currency"
            value={accCurrency()}
            onChange={(e) => setAccCurrency(e.currentTarget.value)}
          >
            <For each={CURRENCIES}>{(c) => <option value={c}>{c}</option>}</For>
          </select>
        </label>
        <label class={styles.field}>
          <span class={styles.fieldLabel}>Current balance</span>
          <input
            class={styles.input}
            data-test-id="onboarding-account-balance"
            type="text"
            inputmode="decimal"
            placeholder="0.00"
            value={accBalance()}
            onInput={(e) => setAccBalance(e.currentTarget.value.replace(/[^\d.,-]/g, ''))}
          />
          <span class={styles.fieldHint}>Used as the opening balance.</span>
        </label>
        <label class={styles.field}>
          <span class={styles.fieldLabel}>Tracking since (optional)</span>
          <input
            class={styles.input}
            data-test-id="onboarding-account-date"
            type="date"
            value={accDate()}
            onChange={(e) => setAccDate(e.currentTarget.value)}
          />
        </label>
      </div>
      <button
        class={styles.secondaryAction}
        data-test-id="onboarding-account-create"
        disabled={!accName().trim() || creatingAccount()}
        onClick={() => void createAccount()}
      >
        {creatingAccount()
          ? 'Creating…'
          : profileAccounts().length > 0
            ? 'Add another account'
            : 'Create account'}
      </button>
    </div>
  )

  const importStep = () => (
    <div class={styles.step} data-test-id="onboarding-step-import">
      <h2 class={styles.stepTitle}>Bring your data</h2>
      <p class={styles.stepLead}>
        This is the app's full importer. Drop bank statements and we detect the bank, or use CSV /
        Google Sheets — everything lands as regular transactions you can refine later.
      </p>
      <div class={styles.comingSoon}>
        <span class={styles.comingSoonBadge}>Coming soon</span>
        Direct migration from YNAB, Mint and other budgeting apps.
      </div>

      <Show when={importFlow.error()}>
        <div class={`${importStyles.resultMessage} ${importStyles.error}`}>
          {importFlow.error()}
        </div>
      </Show>
      <Show when={importFlow.resultMessage()}>
        <div class={`${importStyles.resultMessage} ${importStyles.success}`}>
          {importFlow.resultMessage()!.text}
        </div>
      </Show>
      <Show when={importFlow.loading()}>
        <div class={importStyles.loadingOverlay} data-test-id="onboarding-import-loading">
          <OrbitSpinner size={72} label="Processing your data…" />
        </div>
      </Show>

      <Show
        when={importSummary()}
        fallback={
          <div class={styles.importEmbed}>
            <Show when={importFlow.activeStep() === 'upload'}>
              <ImportDataEntry flow={importFlow} compact />
            </Show>
            <Show when={importFlow.activeStep() === 'mapping'}>
              <ImportMappingStep flow={importFlow} />
            </Show>
            <Show when={importFlow.activeStep() === 'preview'}>
              <ImportPreviewStep flow={importFlow} />
            </Show>
          </div>
        }
      >
        <div class={styles.importDone} data-test-id="onboarding-import-summary">
          <Show
            when={importSummary()!.imported > 0}
            fallback={
              <p>
                Nothing new to import —{' '}
                {importSummary()!.duplicatesSkipped > 0
                  ? `all ${importSummary()!.duplicatesSkipped} rows were already in your data (duplicates are skipped automatically).`
                  : 'no rows could be imported from those files.'}
              </p>
            }
          >
            <p>
              <b>{importSummary()!.imported}</b> transactions imported
              {importSummary()!.duplicatesSkipped > 0
                ? ` (${importSummary()!.duplicatesSkipped} duplicates skipped)`
                : ''}
              {importSummary()!.createdAccounts.length > 0
                ? `, ${importSummary()!.createdAccounts.length} account${importSummary()!.createdAccounts.length === 1 ? '' : 's'} created`
                : ''}
              . Next: we scan them for subscriptions.
            </p>
          </Show>
          <button
            class={styles.secondaryAction}
            onClick={() => {
              importFlow.resetForm()
              setImportSummary(null)
            }}
          >
            Import more files
          </button>
        </div>
      </Show>
    </div>
  )

  const subscriptionsStep = () => (
    <div class={styles.step} data-test-id="onboarding-step-subscriptions">
      <h2 class={styles.stepTitle}>Your subscriptions, spotted</h2>
      <p class={styles.stepLead}>
        We scanned your transactions for recurring charges from known services — check the ones you
        want tracked, and adjust a price or period where we guessed wrong.
      </p>
      <SubscriptionScanPanel
        active={() => onboardingOpen() && onboardingStep() === 'subscriptions'}
        onAdded={(n) => setSubsAdded((prev) => prev + n)}
        emptyHint="You can always scan again later: Bills → Subscriptions → Scan transactions."
      />
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
      <h2 class={styles.title}>Your orbit is set</h2>
      <ul class={styles.summary}>
        <li>
          <b>{state.currentProfile?.name ?? 'Your space'}</b> is ready
        </li>
        <li>
          {Math.max(
            profileAccounts().length,
            createdAccounts().length + (importSummary()?.createdAccounts.length ?? 0)
          )}{' '}
          account
          {Math.max(
            profileAccounts().length,
            createdAccounts().length + (importSummary()?.createdAccounts.length ?? 0)
          ) === 1
            ? ''
            : 's'}{' '}
          in orbit
        </li>
        <Show when={(importSummary()?.imported ?? 0) > 0}>
          <li>{importSummary()!.imported} transactions imported</li>
        </Show>
        <Show when={subsAdded() > 0}>
          <li>
            {subsAdded()} subscription{subsAdded() === 1 ? '' : 's'} tracked
          </li>
        </Show>
      </ul>
      <p class={styles.stepLead}>
        Tip: press <kbd>Ctrl</kbd>+<kbd>K</kbd> anywhere for quick entry, and take a page tour any
        time from the sidebar.
      </p>
    </div>
  )

  // Footer primary action per step.
  const primaryAction = () => {
    switch (onboardingStep()) {
      case 'welcome':
        return {
          label: 'Begin setup',
          run: () => {
            nextOnboardingStep()
          },
          disabled: false,
        }
      case 'space':
        return {
          label: savingSpace() ? 'Saving…' : 'Continue',
          run: () => void saveSpace(),
          disabled: !spaceName().trim() || savingSpace(),
        }
      case 'account':
        return {
          label: profileAccounts().length > 0 ? 'Continue' : 'Continue without an account',
          run: () => void continueFromAccounts(),
          disabled: creatingAccount() || !accountsLoaded(),
        }
      case 'import':
        return {
          label: importSummary() ? 'Continue' : 'Continue without importing',
          run: () => void continueFromImport(),
          disabled: importFlow.loading(),
        }
      case 'subscriptions':
        return {
          label: 'Continue',
          run: () => {
            nextOnboardingStep()
          },
          disabled: false,
        }
      case 'done':
        return { label: 'Go to my dashboard', run: finish, disabled: false }
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
            <span class={styles.brand}>
              <LogoMark size={26} />
              <span class={styles.brandName}>Token Circles</span>
            </span>
            <span
              class={styles.progressWrap}
              aria-label={`Step ${stepIndex() + 1} of ${ONBOARDING_STEPS.length}`}
            >
              <svg viewBox="0 0 64 64" class={styles.progressSvg} aria-hidden="true">
                <circle class={styles.progressTrack} cx="32" cy="32" r={R} stroke-dasharray="1 5" />
                <circle
                  class={styles.progressArc}
                  cx="32"
                  cy="32"
                  r={R}
                  stroke-dasharray={`${progress()} ${CIRC}`}
                  transform="rotate(-90 32 32)"
                />
              </svg>
              <span class={styles.progressText}>
                {stepIndex() + 1}/{ONBOARDING_STEPS.length}
              </span>
            </span>
          </header>

          <div class={styles.body}>
            <Show when={onboardingStep() === 'welcome'}>{welcomeStep()}</Show>
            <Show when={onboardingStep() === 'space'}>{spaceStep()}</Show>
            <Show when={onboardingStep() === 'account'}>{accountStep()}</Show>
            <Show when={onboardingStep() === 'import'}>{importStep()}</Show>
            <Show when={onboardingStep() === 'subscriptions'}>{subscriptionsStep()}</Show>
            <Show when={onboardingStep() === 'done'}>{doneStep()}</Show>
          </div>

          <footer class={styles.footer}>
            <Show
              when={onboardingStep() !== 'welcome' && onboardingStep() !== 'done'}
              fallback={<span />}
            >
              <button
                class={styles.ghostBtn}
                data-test-id="onboarding-back"
                onClick={prevOnboardingStep}
              >
                Back
              </button>
            </Show>
            <span class={styles.footerRight}>
              <Show when={onboardingStep() !== 'done'}>
                <button
                  class={styles.ghostBtn}
                  data-test-id="onboarding-skip"
                  onClick={() => void requestSkipAll()}
                >
                  Skip setup
                </button>
              </Show>
              <button
                class={styles.primaryBtn}
                data-test-id={onboardingStep() === 'done' ? 'onboarding-finish' : 'onboarding-next'}
                disabled={primaryAction()!.disabled}
                onClick={() => {
                  primaryAction()!.run()
                }}
              >
                {primaryAction()!.label}
              </button>
            </span>
          </footer>
        </div>
      </div>
    </Show>
  )
}

export default OnboardingWizard
