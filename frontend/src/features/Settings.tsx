/**
 * Settings Component - EARS Specification
 *
 * GIVEN: A user is on the Settings page
 * WHEN: The page loads
 * THEN: The header displays "Settings" and shows current currency and theme settings
 *
 * GIVEN: A user wants to change the local currency
 * WHEN: They select a different currency option
 * THEN: The new currency is saved and displayed throughout the application
 *
 * GIVEN: A user wants to toggle dark mode
 * WHEN: They click the dark mode toggle
 * THEN: The theme switches between light and dark modes
 *
 * GIVEN: A user changes the storage mode
 * WHEN: They select between serverless and self-hosted storage
 * THEN: The storage preference is saved and affects data persistence
 *
 * GIVEN: A user wants to export data
 * WHEN: They access the export section
 * THEN: Options for CSV or JSON export are displayed
 */

/**
 * Settings Component
 * Application configuration and preferences with storage switching
 */
import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import AccountDeletion from '../components/AccountDeletion'
import BillingPlans from '../components/BillingPlans'
import ChangelogModal from '../components/ChangelogModal'
import DangerZone from '../components/DangerZone'
import { LogViewer } from '../components/LogViewer'
import OrbitalToggle from '../components/OrbitalToggle'
import SupportContact from '../components/SupportContact'
import Toggle from '../components/Toggle'
import { getLocalCurrency, toast } from '../core/api.js'
import { apiFetch } from '../core/apiFetch'
import { bumpProfileVersion } from '../core/appStore'
import { emailAlertsLocked, setCurrentPlan } from '../core/billingStore'
import { period } from '../core/periodStore'
import { setSettingsTab, settingsTab } from '../core/settingsStore'
import { setShowShortcuts } from '../core/shortcutsStore'
import { migrateData, setStorageMode } from '../core/storage/storageFactory'
import { theme } from '../core/theme'
import { loadChartExportSettings, saveChartExportSettings } from '../utils/chartExportSettings'
import { toYYYYMM } from '../utils/period'
import styles from './SettingsPage.module.css'
import type { JSX } from 'solid-js'
import type { SettingsTab } from '../core/settingsStore'
import type { ChartExportSettings } from '../utils/chartExportSettings'

// Account self-deletion is dev-only for now: visible on the dev domain + local builds, hidden on the
// production build (the worker also 501s DELETE /api/account in production). On prod, users delete
// profiles/data in the Exports tab or contact support. Set VITE_ENABLE_ACCOUNT_DELETION=true to force-on.
const ACCOUNT_DELETION_ENABLED =
  import.meta.env.MODE !== 'production' || import.meta.env.VITE_ENABLE_ACCOUNT_DELETION === 'true'

function Reports() {
  // Seed from the global focus period so Reports opens on the period you were just
  // viewing; the report-type + full-year (month 0) selects stay report-specific.
  const [seedYear, seedMonth] = toYYYYMM(period()).split('-').map(Number)
  const [reportYear, setReportYear] = createSignal(seedYear)
  const [reportMonth, setReportMonth] = createSignal(seedMonth)
  const [reportType, setReportType] = createSignal<'monthly' | 'tax' | 'pl' | 'annual'>('monthly')
  const [reportLoading, setReportLoading] = createSignal<string | null>(null)
  const [availableYears, setAvailableYears] = createSignal<number[]>([new Date().getFullYear()])

  onMount(() => {
    const currentYear = new Date().getFullYear()
    const headers: Record<string, string> = {}
    const currentProfileId = localStorage.getItem('currentProfileId')
    const selectedProfileIds = JSON.parse(localStorage.getItem('selectedProfileIds') || '[]')
    if (currentProfileId) headers['X-Profile-Id'] = currentProfileId
    if (selectedProfileIds.length > 1) headers['X-Profile-Ids'] = JSON.stringify(selectedProfileIds)
    apiFetch('/api/analytics/distinct-years', { credentials: 'include', headers })
      .then((r) => r.json())
      .then((data) => {
        const years: number[] = data.years || []
        if (!years.includes(currentYear)) years.unshift(currentYear)
        setAvailableYears(years.sort((a, b) => b - a))
      })
      .catch(() => {
        setAvailableYears([currentYear])
      })
  })

  // Rich PDFs (charts) are always composed client-side with jsPDF + Chart.js —
  // the worker cannot render canvas, so its /api/reports/*-pdf endpoints are
  // text-only. In self-hosted mode the generators fetch their DATA from the API.
  const reportIsDark = (): boolean => {
    const exportSettings = loadChartExportSettings()
    if (exportSettings.background === 'dark') return true
    if (exportSettings.background === 'theme') {
      return document.documentElement.getAttribute('data-theme') === 'dark'
    }
    return false
  }

  const downloadReport = async (make: () => Promise<Blob>, filename: string) => {
    setReportLoading(filename)
    try {
      const blob = await make()
      const downloadUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = filename
      a.click()
      URL.revokeObjectURL(downloadUrl)
    } catch (err) {
      console.error('Report generation failed:', err)
      toast('Failed to generate report', 'error')
    } finally {
      setReportLoading(null)
    }
  }

  const handleGenerate = async () => {
    const y = reportYear()
    const dark = reportIsDark()
    const pdf = await import('../core/storage/clientPdfReports')

    if (reportType() === 'monthly') {
      const m = reportMonth()
      if (m === 0) {
        // "All Months" selected — generate annual report instead
        void downloadReport(() => pdf.generateAnnualPdf(y, dark), `annual-report-${y}.pdf`)
        return
      }
      const mStr = String(m).padStart(2, '0')
      void downloadReport(
        () => pdf.generateMonthlyPdf(`${y}-${mStr}`, dark),
        `report-${y}-${mStr}.pdf`
      )
    } else if (reportType() === 'annual') {
      void downloadReport(() => pdf.generateAnnualPdf(y, dark), `annual-report-${y}.pdf`)
    } else if (reportType() === 'tax') {
      void downloadReport(() => pdf.generateTaxSummaryPdf(y, dark), `tax-summary-${y}.pdf`)
    } else {
      void downloadReport(() => pdf.generatePlSummaryPdf(y, dark), `pl-summary-${y}.pdf`)
    }
  }

  return (
    <>
      <div class={styles.formGroup}>
        <label class={styles.formLabel}>Report Type</label>
        <select
          class={styles.formControl}
          value={reportType()}
          onchange={(e) =>
            setReportType(e.currentTarget.value as 'monthly' | 'tax' | 'pl' | 'annual')
          }
          style="max-width: 250px;"
        >
          <option value="monthly">Monthly Financial Report</option>
          <option value="annual">Annual Financial Report</option>
          <option value="tax">Year-End Tax Summary</option>
          <option value="pl">Year-End Profit &amp; Loss</option>
        </select>
      </div>
      <div class={styles.formGroup}>
        <label class={styles.formLabel}>Year</label>
        <select
          class={styles.formControl}
          value={reportYear()}
          onchange={(e) => setReportYear(Number(e.currentTarget.value))}
          style="max-width: 250px;"
        >
          <For each={availableYears()}>{(y) => <option value={y}>{y}</option>}</For>
        </select>
      </div>
      {reportType() === 'monthly' && (
        <div class={styles.formGroup}>
          <label class={styles.formLabel}>Month</label>
          <select
            class={styles.formControl}
            value={reportMonth()}
            onchange={(e) => setReportMonth(Number(e.currentTarget.value))}
            style="max-width: 250px;"
          >
            <option value="0">All Months (Full Year)</option>
            {Array.from({ length: 12 }, (_, i) => (
              <option value={i + 1}>
                {new Date(2024, i, 1).toLocaleDateString('en-US', { month: 'long' })}
              </option>
            ))}
          </select>
        </div>
      )}
      <button
        class={styles.btnPrimary}
        onclick={handleGenerate}
        disabled={reportLoading() !== null}
        style="margin-top: 8px;"
      >
        {reportLoading() ? 'Generating...' : 'Generate PDF Report'}
      </button>
    </>
  )
}

// ── Inline icon set (stroke-based, inherit currentColor; sized by container CSS) ──
function Svg(props: { children: JSX.Element }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {props.children}
    </svg>
  )
}

// Rail (navigation) icons — reuse the approved mockup's paths.
const IconGeneral = () => (
  <Svg>
    <path d="M4 6h16M4 12h16M4 18h16" />
    <circle cx="8" cy="6" r="2" fill="currentColor" stroke="none" />
    <circle cx="16" cy="12" r="2" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="2" fill="currentColor" stroke="none" />
  </Svg>
)
const IconExports = () => (
  <Svg>
    <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
  </Svg>
)
const IconBilling = () => (
  <Svg>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M3 10h18" />
  </Svg>
)
const IconAbout = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </Svg>
)

// Card-header (halo) + action icons — semantic, theme-agnostic.
const IconSun = () => (
  <Svg>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5.6 5.6l2 2M16.4 16.4l2 2M18.4 5.6l-2 2M7.6 16.4l-2 2" />
  </Svg>
)
const IconCoin = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 6.5v11" />
    <path d="M15 9.3a3.4 3 0 00-3-1.3c-1.7 0-3 .9-3 2s1.3 2 3 2 3 .9 3 2-1.3 2-3 2a3.4 3 0 01-3-1.3" />
  </Svg>
)
const IconDatabase = () => (
  <Svg>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
    <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
  </Svg>
)
const IconMail = () => (
  <Svg>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </Svg>
)
const IconFileText = () => (
  <Svg>
    <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <path d="M14 3v5h5M8 13h8M8 17h5" />
  </Svg>
)
const IconImage = () => (
  <Svg>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="m21 15-5-5L5 21" />
  </Svg>
)
const IconDownload = () => (
  <Svg>
    <path d="M12 3v12" />
    <path d="m7 11 5 4 5-4" />
    <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
  </Svg>
)
const IconUsers = () => (
  <Svg>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20a5.5 5.5 0 0111 0" />
    <path d="M16 5.2a3.2 3.2 0 010 6M17.5 20a5.5 5.5 0 00-3-4.9" />
  </Svg>
)
const IconTerminal = () => (
  <Svg>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="m7 9 3 3-3 3M13 15h4" />
  </Svg>
)
const IconCheck = () => (
  <Svg>
    <path d="M5 12l5 5L20 7" />
  </Svg>
)
const IconSend = () => (
  <Svg>
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
  </Svg>
)
const IconBell = () => (
  <Svg>
    <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M10 21a2 2 0 004 0" />
  </Svg>
)

// Shared card header: halo icon + title + optional description / move tag.
function CardHead(props: { icon: JSX.Element; title: string; desc?: string; tag?: string }) {
  return (
    <div class={styles.cardHead}>
      <span class={styles.halo}>{props.icon}</span>
      <div class={styles.cardHeadText}>
        <h2 class={styles.cardHeadTitle}>{props.title}</h2>
        <Show when={props.desc}>
          <p class={styles.cardHeadDesc}>{props.desc}</p>
        </Show>
      </div>
      <Show when={props.tag}>
        <span class={styles.moveTag}>{props.tag}</span>
      </Show>
    </div>
  )
}

export default function Settings() {
  // Initialize from the saved setting (default EUR) so the dropdown reflects reality,
  // not a hardcoded USD that mismatches how amounts actually render.
  const [localCurrency, setLocalCurrency] = createSignal(getLocalCurrency())
  const [darkMode, setDarkMode] = createSignal(false)
  const [chartExportSettings, setChartExportSettings] =
    createSignal<ChartExportSettings>(loadChartExportSettings())
  const defaultStorage: 'serverless' | 'self-hosted' =
    import.meta.env.VITE_DEFAULT_STORAGE === 'dexie' ? 'serverless' : 'self-hosted'
  const [storageMode, setLocalStorageMode] = createSignal<'serverless' | 'self-hosted'>(
    defaultStorage
  )
  const [showStorageWarning, setShowStorageWarning] = createSignal(false)
  const [migrateDataEnabled, setMigrateDataEnabled] = createSignal(false)
  const [migrating, setMigrating] = createSignal(false)
  const [showChangelog, setShowChangelog] = createSignal(false)
  // Signed-in account (server mode): shown in the About card so users can see which
  // email they are logged in with. Null = local mode or signed out.
  const [accountInfo, setAccountInfo] = createSignal<{
    email?: string
    username?: string
    auth_provider?: string
  } | null>(null)
  // Settings tabs: General / Exports / Billing / About. Billing is server-mode only; About is
  // always available. The rail renders visibleTabs(); each card group is gated by activeTab().
  const [activeTab, setActiveTab] = createSignal<SettingsTab>('general')
  const tabs: Array<{ id: SettingsTab; label: string; icon: () => JSX.Element }> = [
    { id: 'general', label: 'General', icon: IconGeneral },
    { id: 'exports', label: 'Exports', icon: IconExports },
    { id: 'billing', label: 'Billing', icon: IconBilling },
    { id: 'about', label: 'About', icon: IconAbout },
  ]
  const visibleTabs = (): typeof tabs =>
    tabs.filter((t) => t.id !== 'billing' || storageMode() === 'self-hosted')

  // Honor a cross-component request to open a specific tab (e.g. ProfileModal → Billing),
  // then consume it so re-entering Settings later does not force the tab again.
  createEffect(() => {
    const requested = settingsTab()
    if (requested) {
      setActiveTab(requested)
      setSettingsTab(null)
    }
  })

  // ── Billing (server mode only; the worker exposes /api/billing/*) ──
  const [billing, setBilling] = createSignal<{
    plan: string
    status: string | null
    renews_at: string | null
    cancel_at_period_end?: boolean
    configured: boolean
    availablePlans?: string[]
  } | null>(null)
  // Real tier name (the per-tier webhook stores 'basic'/'advanced'/'ultimate'; 'premium' is legacy).
  const planLabel = (p: string | undefined): string => {
    if (p === 'basic') return 'Basic'
    if (p === 'advanced' || p === 'premium') return 'Advanced'
    if (p === 'ultimate') return 'Ultimate'
    return 'Free'
  }
  const fmtBillingDate = (iso: string | null | undefined): string =>
    iso
      ? new Date(iso).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : ''
  // One-line plan status for the billing card. Canceled-but-not-yet-expired and past-due get their
  // own colour/message; otherwise show the tier (and renewal date for an active paid plan).
  const billingStatusLine = (): { color: string; text: string } => {
    const b = billing()
    if (!b || b.plan === 'free')
      return { color: 'var(--text-secondary)', text: "You're on the Free plan." }
    const name = planLabel(b.plan)
    if (b.cancel_at_period_end)
      return {
        color: 'var(--warning, #f59e0b)',
        text: `Your ${name} plan is canceled — you keep access until ${fmtBillingDate(b.renews_at)}, then move to Free.`,
      }
    if (b.status === 'past_due')
      return {
        color: 'var(--danger, #ef4444)',
        text: `Your ${name} plan payment is past due — update your card to keep access.`,
      }
    return {
      color: 'var(--text-secondary)',
      text: `You're on the ${name} plan${b.renews_at ? ` — renews ${fmtBillingDate(b.renews_at)}` : ''}.`,
    }
  }
  // Which billing CTA is mid-redirect ('manage' or a plan id) — so only that button shows
  // "Redirecting…", not all of them. Reset on pageshow (onMount) when returning from Stripe.
  const [billingBusyKey, setBillingBusyKey] = createSignal<string | null>(null)
  const loadBilling = async () => {
    try {
      const res = await apiFetch('/api/billing/status', { credentials: 'include' })
      const data = res.ok ? await res.json() : null
      setBilling(data)
      setCurrentPlan(data?.plan ?? null)
    } catch {
      setBilling(null)
    }
  }
  const redirectToStripe = async (path: string, failMsg: string, key: string, body?: unknown) => {
    setBillingBusyKey(key)
    try {
      const res = await apiFetch(path, {
        method: 'POST',
        credentials: 'include',
        ...(body
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      })
      const data = await res.json()
      if (res.ok && data.url) window.location.href = data.url
      else throw new Error(data.error || failMsg)
    } catch (e) {
      toast(e instanceof Error ? e.message : failMsg, 'error')
      setBillingBusyKey(null)
    }
  }

  // ── Email reminders (server mode only; the worker exposes /api/notifications/*) ──
  const [notif, setNotif] = createSignal<{
    email: string
    emailNotifications: boolean
    budgetAlerts: boolean
    spendingReport: boolean
  } | null>(null)
  const [notifBusy, setNotifBusy] = createSignal(false)
  const loadNotifications = async () => {
    try {
      const res = await apiFetch('/api/notifications/settings', { credentials: 'include' })
      setNotif(res.ok ? await res.json() : null)
    } catch {
      setNotif(null)
    }
  }
  const saveNotifications = async () => {
    const n = notif()
    if (!n) return
    setNotifBusy(true)
    try {
      const res = await apiFetch('/api/notifications/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(n),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save')
      toast('Notification settings saved.', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save', 'error')
    } finally {
      setNotifBusy(false)
    }
  }
  const sendTestEmail = async (type: 'basic' | 'spending' | 'budget' = 'basic') => {
    setNotifBusy(true)
    try {
      const res = await apiFetch('/api/notifications/test-email', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not send')
      toast(
        data.skipped
          ? 'Email is not configured on the server yet (no-op in dev).'
          : type === 'spending'
            ? 'Spending-report preview sent — check your inbox.'
            : type === 'budget'
              ? 'Budget-alert preview sent — check your inbox.'
              : 'Test email sent — check your inbox.',
        data.skipped ? 'info' : 'success'
      )
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send', 'error')
    } finally {
      setNotifBusy(false)
    }
  }

  // Load saved settings
  onMount(() => {
    const savedCurrency = localStorage.getItem('localCurrency')
    if (savedCurrency) {
      setLocalCurrency(savedCurrency)
    }

    const isDark = theme.isDark()
    setDarkMode(isDark)

    const savedStorage = localStorage.getItem('finance_storage_mode')
    if (savedStorage === 'serverless') {
      setLocalStorageMode('serverless')
    } else if (savedStorage === 'self-hosted') {
      setLocalStorageMode('self-hosted')
    } else {
      // No stored preference — use env default
      setLocalStorageMode(defaultStorage)
    }

    void loadHouseholdProfiles()

    if (storageMode() === 'self-hosted') {
      void loadBilling()
      void loadNotifications()
      // Who am I signed in as (shown in the About card).
      void apiFetch('/api/auth/me', { credentials: 'include' })
        .then(async (res) => {
          if (res.ok) setAccountInfo(await res.json())
        })
        .catch(() => {
          /* signed out — leave null */
        })
    }
    const billingParam = new URLSearchParams(window.location.search).get('billing')
    if (billingParam === 'success' || billingParam === 'cancel') {
      setActiveTab('billing')
      toast(
        billingParam === 'success' ? 'Subscription activated.' : 'Checkout canceled.',
        billingParam === 'success' ? 'success' : 'info'
      )
      window.history.replaceState({}, '', window.location.pathname + window.location.hash)
    }

    // Returning from Stripe (browser-back / bfcache restore) can leave a CTA stuck on "Redirecting…";
    // clear the redirect state whenever this page is shown again.
    const clearBillingBusy = () => setBillingBusyKey(null)
    window.addEventListener('pageshow', clearBillingBusy)
    onCleanup(() => {
      window.removeEventListener('pageshow', clearBillingBusy)
    })
  })

  // Sync local currency changes
  createEffect(() => {
    localStorage.setItem('localCurrency', localCurrency())
  })

  // Handle local currency change
  const handleLocalCurrencyChange = (event: Event) => {
    const target = event.target as HTMLSelectElement
    setLocalCurrency(target.value)
  }

  // Handle storage type change
  const handleStorageModeChange = (event: Event) => {
    const target = event.target as HTMLSelectElement
    const newMode = target.value as 'serverless' | 'self-hosted'

    setMigrateDataEnabled(false)
    setLocalStorageMode(newMode)
    setShowStorageWarning(true)
  }

  // Apply storage type with optional data migration
  const applyStorageMode = async () => {
    setMigrating(true)
    try {
      if (migrateDataEnabled()) {
        const result = await migrateData(storageMode())
        if (!result.success) {
          toast(`Migration failed: ${result.error || 'Unknown error'}`, 'error')
          setMigrating(false)
          return
        }
      } else {
        await apiFetch('/api/storage-mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ mode: storageMode() }),
        })
        setStorageMode(storageMode())
      }

      setShowStorageWarning(false)
      toast(
        `Database switched to ${storageMode() === 'serverless' ? 'Browser LocalStorage' : 'Backend SQLite'} successfully.`,
        'success'
      )
      window.location.reload()
    } catch (error) {
      console.error('Failed to switch storage:', error)
      toast('Failed to switch storage mode.', 'error')
    } finally {
      setMigrating(false)
    }
  }

  const [csvExporting, setCsvExporting] = createSignal<string | null>(null)
  const [exportFormat, setExportFormat] = createSignal('csv')

  // Data Management
  const handleExport = async () => {
    try {
      const response = await apiFetch('/api/export', {
        method: 'GET',
        credentials: 'include',
      })

      if (!response.ok) throw new Error('Export failed')

      const data = await response.json()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `finance-export-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast('Failed to export data', 'error')
    }
  }

  const handleCsvExport = async (type: string) => {
    const fmt = exportFormat()
    setCsvExporting(type)
    try {
      const response = await apiFetch(`/api/export/${type}?format=${fmt}`, {
        method: 'GET',
        credentials: 'include',
      })
      if (!response.ok) throw new Error('Export failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${type}-${new Date().toISOString().split('T')[0]}.${fmt}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast(`Failed to export ${type}`, 'error')
    } finally {
      setCsvExporting(null)
    }
  }

  const handleReset = async () => {
    await apiFetch('/api/clear-all', {
      method: 'DELETE',
      credentials: 'include',
    })
    window.location.reload()
  }

  const [renamingProfileId, setRenamingProfileId] = createSignal<number | null>(null)
  const [renameValue, setRenameValue] = createSignal('')
  const [renaming, setRenaming] = createSignal(false)

  const startRename = (id: number, currentName: string) => {
    setRenamingProfileId(id)
    setRenameValue(currentName)
  }

  const cancelRename = () => {
    setRenamingProfileId(null)
    setRenameValue('')
  }

  const submitRename = async () => {
    const pid = renamingProfileId()
    const name = renameValue().trim()
    if (!pid || !name) return
    setRenaming(true)
    try {
      const res = await apiFetch(`/api/profiles/${pid}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const data = await res.json()
        if (data.error === 'Unauthorized') {
          toast(
            'You cannot rename default demo profiles. Log in to manage your own profiles.',
            'warning'
          )
        } else {
          toast(data.error || 'Failed to rename profile', 'error')
        }
      } else {
        setRenamingProfileId(null)
        setRenameValue('')
        loadHouseholdProfiles()
        window.location.reload()
      }
    } catch {
      toast('Failed to rename profile', 'error')
    } finally {
      setRenaming(false)
    }
  }

  const handleDeleteProfile = async () => {
    const profileId = localStorage.getItem('currentProfileId') || '1'
    try {
      const res = await apiFetch(`/api/profiles/${profileId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json()
        toast(data.error || 'Failed to delete profile', 'error')
        return
      }
      // Switch to the next available profile
      const profilesRes = await apiFetch('/api/profiles', { credentials: 'include' })
      const profiles = await profilesRes.json()
      if (profiles.length > 0) {
        localStorage.setItem('currentProfileId', profiles[0].id.toString())
        localStorage.setItem('selectedProfileIds', JSON.stringify([profiles[0].id]))
      }
      window.location.reload()
    } catch {
      toast('Failed to delete profile', 'error')
    }
  }

  // Log viewer toggle state (reactive hash tracking)
  const [showLogs, setShowLogs] = createSignal(false)

  onMount(() => {
    const checkHash = () => setShowLogs(window.location.hash.includes('#logs'))
    checkHash()
    window.addEventListener('hashchange', checkHash)
    onCleanup(() => {
      window.removeEventListener('hashchange', checkHash)
    })
  })

  // Household View state
  const [allProfiles, setAllProfiles] = createSignal<
    Array<{
      id: number
      name: string
      transaction_count?: number
      account_count?: number
      budget_count?: number
    }>
  >([])
  const [householdIds, setHouseholdIds] = createSignal<number[]>(
    (() => {
      const stored = localStorage.getItem('selectedProfileIds')
      return stored
        ? (JSON.parse(stored) as number[])
        : [parseInt(localStorage.getItem('currentProfileId') || '1', 10)]
    })()
  )

  const loadHouseholdProfiles = async () => {
    try {
      const res = await apiFetch('/api/profiles', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setAllProfiles(data)
      }
    } catch {
      /* non-critical */
    }
  }

  const toggleHouseholdProfile = (id: number) => {
    const current = householdIds()
    const idx = current.indexOf(id)
    let newIds: number[]
    if (idx !== -1) {
      newIds = current.filter((pid) => pid !== id)
    } else {
      newIds = [...current, id]
    }
    if (newIds.length === 0) {
      newIds = [parseInt(localStorage.getItem('currentProfileId') || '1')]
    }
    setHouseholdIds(newIds)
    localStorage.setItem('selectedProfileIds', JSON.stringify(newIds))
    bumpProfileVersion()
  }

  const selectAllHousehold = () => {
    const all = allProfiles()
    setHouseholdIds(all.map((p) => p.id))
    localStorage.setItem('selectedProfileIds', JSON.stringify(all.map((p) => p.id)))
    bumpProfileVersion()
  }

  const clearHousehold = () => {
    const currentId = parseInt(localStorage.getItem('currentProfileId') || '1')
    setHouseholdIds([currentId])
    localStorage.setItem('selectedProfileIds', JSON.stringify([currentId]))
    bumpProfileVersion()
  }

  return (
    <div class={`page page-settings page-enter ${styles.settingsPage}`}>
      <div class={styles.pageHeader}>
        <h1 data-test-id="settings-header" data-tour="settings-header">
          Settings
        </h1>
      </div>
      <div class={styles.pageContent}>
        <div class={styles.layout}>
          <nav class={styles.rail} data-tour="settings-tabs" aria-label="Settings sections">
            <For each={visibleTabs()}>
              {(tab) => (
                <button
                  type="button"
                  class={styles.railBtn}
                  classList={{ [styles.railBtnActive]: activeTab() === tab.id }}
                  aria-current={activeTab() === tab.id ? 'page' : undefined}
                  title={tab.label}
                  onclick={() => setActiveTab(tab.id)}
                >
                  {tab.icon()}
                  <small class={styles.railCaption}>{tab.label}</small>
                </button>
              )}
            </For>
          </nav>

          <div class={styles.content}>
            {/* ─────────────── GENERAL ─────────────── */}
            <Show when={activeTab() === 'general'}>
              <div class={styles.card} data-tour="settings-theme">
                <CardHead icon={<IconSun />} title="Appearance" desc="Theme for the whole app." />
                <div class={styles.row}>
                  <span class={styles.rowLabel}>Theme</span>
                  <span class={styles.segmented}>
                    <span>Light</span>
                    {/* The celestial brand switch — sun rides the orbit into a starry night. */}
                    <OrbitalToggle
                      id="setting-dark-mode"
                      checked={darkMode}
                      onChange={(v) => {
                        setDarkMode(v)
                        theme.setTheme(v ? 'dark' : 'light')
                      }}
                      aria-label="Dark mode"
                    />
                    <span>Dark</span>
                  </span>
                </div>
              </div>

              <div class={styles.card} data-tour="settings-currency">
                <CardHead
                  icon={<IconCoin />}
                  title="Currency"
                  desc="Your default display currency."
                />
                <select
                  class={styles.formControl}
                  value={localCurrency()}
                  onchange={handleLocalCurrencyChange}
                  style="max-width: 340px;"
                >
                  <option value="USD">USD - US Dollar</option>
                  <option value="EUR">EUR - Euro</option>
                  <option value="GBP">GBP - British Pound</option>
                  <option value="JPY">JPY - Japanese Yen</option>
                  <option value="CAD">CAD - Canadian Dollar</option>
                  <option value="AUD">AUD - Australian Dollar</option>
                  <option value="CHF">CHF - Swiss Franc</option>
                  <option value="CNY">CNY - Chinese Yuan</option>
                  <option value="INR">INR - Indian Rupee</option>
                  <option value="BRL">BRL - Brazilian Real</option>
                  <option value="MXN">MXN - Mexican Peso</option>
                  <option value="SGD">SGD - Singapore Dollar</option>
                  <option value="HKD">HKD - Hong Kong Dollar</option>
                  <option value="KRW">KRW - South Korean Won</option>
                  <option value="SEK">SEK - Swedish Krona</option>
                  <option value="NOK">NOK - Norwegian Krone</option>
                  <option value="DKK">DKK - Danish Krone</option>
                  <option value="NZD">NZD - New Zealand Dollar</option>
                  <option value="ZAR">ZAR - South African Rand</option>
                  <option value="PLN">PLN - Polish Zloty</option>
                </select>
              </div>

              <div class={styles.card} data-tour="settings-storage">
                <CardHead
                  icon={<IconDatabase />}
                  title="Storage"
                  desc="Where your data lives."
                  tag="PDF reports moved to Exports"
                />
                <select
                  class={styles.formControl}
                  value={storageMode()}
                  onchange={handleStorageModeChange}
                  style="max-width: 340px;"
                >
                  <option value="self-hosted">Server (Backend Database)</option>
                  <option value="serverless">Local (Browser Storage)</option>
                </select>
                {showStorageWarning() && storageMode() === 'serverless' && (
                  <div class={styles.warningBox}>
                    <strong>Switch to Local Mode</strong>
                    <p style="margin-top: 8px; color: var(--text-secondary); font-size: 13px;">
                      Your data will be completely offline and stored in your browser's IndexedDB.
                      You will not be able to sync across devices unless you export/import manually.
                    </p>
                    <div class={styles.row}>
                      <span
                        class={styles.rowLabel}
                        style="font-size: 13px; color: var(--text-secondary);"
                      >
                        Migrate existing data from the backend to browser storage
                      </span>
                      <Toggle
                        checked={migrateDataEnabled}
                        onChange={(v) => setMigrateDataEnabled(v)}
                        aria-label="Migrate existing data to browser storage"
                      />
                    </div>
                    <button
                      class={styles.btnPrimary}
                      onclick={applyStorageMode}
                      disabled={migrating()}
                      style="margin-top: 12px;"
                    >
                      {migrating()
                        ? 'Migrating...'
                        : migrateDataEnabled()
                          ? 'Migrate & Switch'
                          : 'Switch to Local Mode'}
                    </button>
                  </div>
                )}
                {showStorageWarning() && storageMode() === 'self-hosted' && (
                  <div class={styles.warningBox}>
                    <strong>Switch to Server Mode</strong>
                    <p style="margin-top: 8px; color: var(--text-secondary); font-size: 13px;">
                      Your data will be stored on the backend SQLite server. You need the backend
                      server running for this mode to work.
                    </p>
                    <div class={styles.row}>
                      <span
                        class={styles.rowLabel}
                        style="font-size: 13px; color: var(--text-secondary);"
                      >
                        Migrate existing browser data to the backend server
                      </span>
                      <Toggle
                        checked={migrateDataEnabled}
                        onChange={(v) => setMigrateDataEnabled(v)}
                        aria-label="Migrate existing browser data to the backend server"
                      />
                    </div>
                    <button
                      class={styles.btnPrimary}
                      onclick={applyStorageMode}
                      disabled={migrating()}
                      style="margin-top: 12px;"
                    >
                      {migrating()
                        ? 'Migrating...'
                        : migrateDataEnabled()
                          ? 'Migrate & Switch'
                          : 'Switch to Server Mode'}
                    </button>
                  </div>
                )}
                {!showStorageWarning() && storageMode() === 'serverless' && (
                  <p style="margin-top: 12px; color: var(--text-secondary); font-size: 13px;">
                    Running in Local mode — data stays in this browser, fully offline.
                  </p>
                )}
                {!showStorageWarning() && storageMode() === 'self-hosted' && (
                  <p style="margin-top: 12px; color: var(--text-secondary); font-size: 13px;">
                    Currently connected to Backend Server storage.
                  </p>
                )}
              </div>

              <Show when={storageMode() === 'self-hosted' && notif()}>
                <div class={styles.card}>
                  <CardHead
                    icon={<IconMail />}
                    title="Email reminders"
                    desc="Budget alerts and spending reports, sent to your email."
                  />
                  <Show
                    when={emailAlertsLocked()}
                    fallback={
                      <p style="margin: 0 0 12px; color: var(--text-secondary); font-size: 13px;">
                        Budget alerts and a periodic spending report, sent to your email. Requires a
                        paid plan.
                      </p>
                    }
                  >
                    <p style="margin: 0 0 12px; color: var(--text-secondary); font-size: 13px;">
                      Email alerts are a Premium feature.{' '}
                      <button
                        onclick={() => setActiveTab('billing')}
                        style="background:none; border:none; padding:0; color:var(--primary); cursor:pointer; text-decoration:underline; font:inherit;"
                      >
                        See plans
                      </button>{' '}
                      to enable budget alerts and spending reports.
                    </p>
                  </Show>
                  <div class={styles.formGroup}>
                    <label class={styles.formLabel}>Email address</label>
                    <input
                      class={styles.formControl}
                      type="email"
                      value={notif()!.email}
                      onInput={(e) => setNotif({ ...notif()!, email: e.currentTarget.value })}
                      placeholder="you@example.com"
                      style="max-width: 340px;"
                    />
                  </div>
                  <div class={styles.row}>
                    <span class={styles.rowLabel}>Enable email notifications</span>
                    <Toggle
                      checked={() => notif()!.emailNotifications}
                      disabled={emailAlertsLocked()}
                      onChange={(v) => setNotif({ ...notif()!, emailNotifications: v })}
                      aria-label="Enable email notifications"
                    />
                  </div>
                  <div
                    class={`${styles.row} ${styles.rowSub}`}
                    style={`opacity:${notif()!.emailNotifications ? 1 : 0.5};`}
                  >
                    <span class={styles.rowLabel}>Budget alerts (weekly)</span>
                    <Toggle
                      checked={() => notif()!.budgetAlerts}
                      disabled={!notif()!.emailNotifications || emailAlertsLocked()}
                      onChange={(v) => setNotif({ ...notif()!, budgetAlerts: v })}
                      aria-label="Budget alerts (weekly)"
                    />
                  </div>
                  <div
                    class={`${styles.row} ${styles.rowSub}`}
                    style={`opacity:${notif()!.emailNotifications ? 1 : 0.5};`}
                  >
                    <span class={styles.rowLabel}>Spending report (biweekly)</span>
                    <Toggle
                      checked={() => notif()!.spendingReport}
                      disabled={!notif()!.emailNotifications || emailAlertsLocked()}
                      onChange={(v) => setNotif({ ...notif()!, spendingReport: v })}
                      aria-label="Spending report (biweekly)"
                    />
                  </div>
                  <div
                    class={styles.actions}
                    style={emailAlertsLocked() ? 'opacity:0.55; pointer-events:none;' : undefined}
                  >
                    <button
                      class={`${styles.iconAction} ${styles.iconActionPrimary}`}
                      onclick={() => void saveNotifications()}
                      disabled={notifBusy()}
                      title="Save notification settings"
                      aria-label="Save notification settings"
                    >
                      <IconCheck />
                      {notifBusy() ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      class={styles.iconAction}
                      onclick={() => void sendTestEmail()}
                      disabled={notifBusy()}
                      title="Send a test email to check delivery"
                      aria-label="Send a test email to check delivery"
                    >
                      <IconSend />
                      Test
                    </button>
                    <button
                      class={styles.iconAction}
                      onclick={() => void sendTestEmail('spending')}
                      disabled={notifBusy()}
                      title="Emails you the real spending report, built from your data, right now"
                      aria-label="Emails you the real spending report, built from your data, right now"
                    >
                      <IconFileText />
                      Spending
                    </button>
                    <button
                      class={styles.iconAction}
                      onclick={() => void sendTestEmail('budget')}
                      disabled={notifBusy()}
                      title="Emails you the real budget alert, built from your data, right now"
                      aria-label="Emails you the real budget alert, built from your data, right now"
                    >
                      <IconBell />
                      Budget
                    </button>
                  </div>
                </div>
              </Show>
            </Show>

            {/* ─────────────── EXPORTS ─────────────── */}
            <Show when={activeTab() === 'exports'}>
              <div class={styles.card}>
                <CardHead
                  icon={<IconFileText />}
                  title="PDF reports"
                  desc="Generate monthly, annual, tax and P&L PDFs."
                />
                <Reports />
              </div>

              <div class={styles.card}>
                <CardHead
                  icon={<IconImage />}
                  title="Chart export"
                  desc="How charts are exported across the app."
                />
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Background</label>
                  <select
                    class={styles.formControl}
                    value={chartExportSettings().background}
                    onchange={(e) => {
                      const updated: ChartExportSettings = {
                        ...chartExportSettings(),
                        background: e.currentTarget.value as ChartExportSettings['background'],
                      }
                      setChartExportSettings(updated)
                      saveChartExportSettings(updated)
                    }}
                    style="max-width: 340px;"
                  >
                    <option value="transparent">Transparent</option>
                    <option value="white">White</option>
                    <option value="dark">Dark</option>
                    <option value="theme">Match Theme</option>
                  </select>
                  <p style="margin-top: 6px; color: var(--text-secondary); font-size: 12px;">
                    Sets the background color when exporting charts as PNG. Transparent works best
                    for light backgrounds; choose White or Dark for consistent appearance.
                  </p>
                </div>
              </div>

              <div class={styles.card}>
                <CardHead
                  icon={<IconDownload />}
                  title="Data management"
                  desc="Export your data or reset the workspace."
                />
                <div style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                  <label style="font-size: 13px; color: var(--text-secondary);">
                    Export Format:
                  </label>
                  <select
                    class={styles.formControl}
                    value={exportFormat()}
                    onchange={(e) => setExportFormat(e.currentTarget.value)}
                    style="max-width: 120px;"
                  >
                    <option value="csv">CSV</option>
                    <option value="json">JSON</option>
                  </select>
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                  <button class={styles.btnSecondary} onclick={handleExport}>
                    Export All (JSON)
                  </button>
                  {[
                    { type: 'transactions', label: 'Transactions' },
                    { type: 'categories', label: 'Categories' },
                    { type: 'budgets', label: 'Budgets' },
                    { type: 'accounts', label: 'Accounts' },
                    { type: 'loans', label: 'Loans' },
                    { type: 'recurring', label: 'Recurring' },
                  ].map(({ type, label }) => (
                    <button
                      class={styles.btnSecondary}
                      onclick={() => handleCsvExport(type)}
                      disabled={csvExporting() === type}
                    >
                      {csvExporting() === type
                        ? 'Exporting...'
                        : `${label} (${exportFormat().toUpperCase()})`}
                    </button>
                  ))}
                </div>
                <DangerZone onReset={handleReset} onDeleteProfile={handleDeleteProfile} />
              </div>

              <div class={styles.card}>
                <CardHead
                  icon={<IconUsers />}
                  title="Household view"
                  desc="Combine data across multiple profiles."
                />
                <Show
                  when={allProfiles().length > 0}
                  fallback={
                    <button class={styles.btnSecondary} onclick={loadHouseholdProfiles}>
                      Load Profiles
                    </button>
                  }
                >
                  <div style="margin-bottom: 12px; display: flex; gap: 8px;">
                    <button
                      class={styles.btnSecondary}
                      style="padding: 4px 12px; font-size: 12px;"
                      onclick={selectAllHousehold}
                    >
                      Select All
                    </button>
                    <button
                      class={styles.btnSecondary}
                      style="padding: 4px 12px; font-size: 12px;"
                      onclick={clearHousehold}
                    >
                      Clear
                    </button>
                  </div>
                  <div style="max-height: 200px; overflow-y: auto;">
                    <For each={allProfiles()}>
                      {(profile) => (
                        <label
                          style={{
                            display: 'flex',
                            'align-items': 'center',
                            gap: '10px',
                            padding: '8px 0',
                            cursor: 'pointer',
                            'border-bottom': '1px solid var(--border)',
                          }}
                        >
                          <input
                            type="checkbox"
                            class={styles.checkbox}
                            checked={householdIds().includes(profile.id)}
                            onchange={() => {
                              toggleHouseholdProfile(profile.id)
                            }}
                          />
                          <Show
                            when={renamingProfileId() === profile.id}
                            fallback={
                              <>
                                <span style="font-size: 14px; color: var(--text);">
                                  {profile.name}
                                </span>
                                <button
                                  class={styles.iconBtn}
                                  onclick={(e) => {
                                    e.preventDefault()
                                    startRename(profile.id, profile.name)
                                  }}
                                  title="Rename profile"
                                  style="margin-left: auto; padding: 2px 6px; font-size: 11px; opacity: 0.6;"
                                >
                                  Edit
                                </button>
                                <Show
                                  when={householdIds().length === 1 && householdIds().length > 0}
                                >
                                  <span style="font-size: 11px; color: var(--text-secondary);">
                                    Current
                                  </span>
                                </Show>
                              </>
                            }
                          >
                            <input
                              value={renameValue()}
                              oninput={(e) => setRenameValue(e.currentTarget.value)}
                              onkeypress={(e) => {
                                if (e.key === 'Enter') submitRename()
                                if (e.key === 'Escape') cancelRename()
                              }}
                              style={{
                                'font-size': '14px',
                                padding: '2px 6px',
                                border: '1px solid var(--primary)',
                                'border-radius': '4px',
                                background: 'var(--bg)',
                                color: 'var(--text)',
                                'min-width': '120px',
                              }}
                            />
                            <button
                              class={styles.iconBtn}
                              onclick={submitRename}
                              disabled={renaming()}
                              style="padding: 2px 6px; font-size: 11px; color: var(--primary);"
                            >
                              Save
                            </button>
                            <button
                              class={styles.iconBtn}
                              onclick={cancelRename}
                              style="padding: 2px 6px; font-size: 11px; opacity: 0.6;"
                            >
                              Cancel
                            </button>
                          </Show>
                        </label>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={allProfiles().length > 0}>
                  <div style="margin-top: 16px;">
                    <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                      Household Overview
                    </div>
                    <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
                      <thead>
                        <tr style="border-bottom: 2px solid var(--border);">
                          <th style="text-align: left; padding: 6px 8px; color: var(--text-secondary); font-weight: 600;">
                            Profile
                          </th>
                          <th style="text-align: right; padding: 6px 8px; color: var(--text-secondary); font-weight: 600;">
                            Txns
                          </th>
                          <th style="text-align: right; padding: 6px 8px; color: var(--text-secondary); font-weight: 600;">
                            Accts
                          </th>
                          <th style="text-align: right; padding: 6px 8px; color: var(--text-secondary); font-weight: 600;">
                            Budgets
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={allProfiles().filter((p) => householdIds().includes(p.id))}>
                          {(profile) => (
                            <tr style="border-bottom: 1px solid var(--border);">
                              <td style="padding: 6px 8px; color: var(--text);">{profile.name}</td>
                              <td style="padding: 6px 8px; text-align: right; color: var(--text); font-variant-numeric: tabular-nums;">
                                {profile.transaction_count ?? 0}
                              </td>
                              <td style="padding: 6px 8px; text-align: right; color: var(--text); font-variant-numeric: tabular-nums;">
                                {profile.account_count ?? 0}
                              </td>
                              <td style="padding: 6px 8px; text-align: right; color: var(--text); font-variant-numeric: tabular-nums;">
                                {profile.budget_count ?? 0}
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                      <tfoot>
                        <tr style="border-top: 2px solid var(--border); font-weight: 600;">
                          <td style="padding: 6px 8px; color: var(--text);">Total</td>
                          <td style="padding: 6px 8px; text-align: right; color: var(--text); font-variant-numeric: tabular-nums;">
                            {allProfiles()
                              .filter((p) => householdIds().includes(p.id))
                              .reduce((sum, p) => sum + (p.transaction_count ?? 0), 0)}
                          </td>
                          <td style="padding: 6px 8px; text-align: right; color: var(--text); font-variant-numeric: tabular-nums;">
                            {allProfiles()
                              .filter((p) => householdIds().includes(p.id))
                              .reduce((sum, p) => sum + (p.account_count ?? 0), 0)}
                          </td>
                          <td style="padding: 6px 8px; text-align: right; color: var(--text); font-variant-numeric: tabular-nums;">
                            {allProfiles()
                              .filter((p) => householdIds().includes(p.id))
                              .reduce((sum, p) => sum + (p.budget_count ?? 0), 0)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Show>
              </div>
            </Show>

            {/* ─────────────── BILLING (server mode only) ─────────────── */}
            <Show when={activeTab() === 'billing' && storageMode() === 'self-hosted'}>
              <div class={styles.card}>
                <CardHead icon={<IconBilling />} title="Plan & billing" />
                <p
                  style={`margin: 0 0 16px; font-size: 13px; color: ${billingStatusLine().color};`}
                >
                  {billingStatusLine().text}
                </p>
                <BillingPlans
                  currentPlan={() => billing()?.plan ?? 'free'}
                  configured={() => billing()?.configured ?? false}
                  availablePlans={() => billing()?.availablePlans ?? []}
                  busyKey={billingBusyKey}
                  onUpgrade={(plan, interval) =>
                    redirectToStripe('/api/billing/checkout', 'Could not start checkout', plan, {
                      plan,
                      interval,
                    })
                  }
                  onManage={() =>
                    redirectToStripe(
                      '/api/billing/portal',
                      'Could not open billing portal',
                      'manage'
                    )
                  }
                />
              </div>
              <Show when={ACCOUNT_DELETION_ENABLED}>
                <div class={styles.card}>
                  <AccountDeletion />
                </div>
              </Show>
            </Show>

            {/* ─────────────── ABOUT (always available) ─────────────── */}
            <Show when={activeTab() === 'about'}>
              <div class={styles.card}>
                <CardHead
                  icon={<IconAbout />}
                  title="About"
                  desc="Version, changelog and support."
                />
                <p style="margin: 0 0 0; font-size: 13px; color: var(--text-secondary);">
                  {accountInfo()?.email || accountInfo()?.username ? (
                    <>
                      Signed in as{' '}
                      <span style="color: var(--text); font-weight: 600;">
                        {accountInfo()!.email || accountInfo()!.username}
                      </span>
                      {accountInfo()!.auth_provider === 'google' ? ' (Google account)' : ''}
                    </>
                  ) : storageMode() === 'serverless' ? (
                    'Local mode — no account; data is stored in this browser only.'
                  ) : (
                    'Not signed in.'
                  )}
                </p>
                <div class={styles.formGroup} style="margin-top: 16px;">
                  <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button class={styles.btnSecondary} onclick={() => setShowChangelog(true)}>
                      View Changelog
                    </button>
                    <button class={styles.btnSecondary} onclick={() => setShowShortcuts(true)}>
                      Keyboard shortcuts
                    </button>
                  </div>
                  <p style="margin-top: 8px; color: var(--text-secondary); font-size: 12px;">
                    See what&apos;s new in each version of Token Circles, or the keyboard shortcuts.
                  </p>
                  <p style="margin-top: 4px; color: var(--text-secondary); font-size: 11px; font-family: monospace;">
                    v{__APP_VERSION__} {__GIT_SHA__ !== 'unknown' ? `(${__GIT_SHA__})` : ''}
                  </p>
                  <div style="margin-top: 12px;">
                    <SupportContact />
                  </div>
                </div>
              </div>

              <div class={styles.card}>
                <CardHead
                  icon={<IconTerminal />}
                  title="Diagnostics"
                  desc="Application logs for debugging on mobile or without a console."
                />
                <button
                  class={styles.btnSecondary}
                  onclick={() => {
                    window.location.hash = showLogs() ? '#settings' : '#logs'
                  }}
                >
                  {showLogs() ? 'Hide Logs' : 'View Logs'}
                </button>
                <Show when={showLogs()}>
                  <div style="display: flex; justify-content: space-between; align-items: center; margin: 16px 0;">
                    <div style="font-size: 14px; font-weight: 600;">Application Logs</div>
                    <button
                      class={styles.btnSecondary}
                      style="padding: 4px 10px; font-size: 12px;"
                      onclick={() => (window.location.hash = '#settings')}
                    >
                      Close
                    </button>
                  </div>
                  <div style="max-height: 500px; overflow-y: auto;">
                    <LogViewer />
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </div>

      <Show when={showChangelog()}>
        <ChangelogModal onClose={() => setShowChangelog(false)} />
      </Show>
    </div>
  )
}
