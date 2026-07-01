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
import SupportContact from '../components/SupportContact'
import { toast } from '../core/api.js'
import { apiFetch } from '../core/apiFetch'
import { bumpProfileVersion } from '../core/appStore'
import { migrateData, setStorageMode } from '../core/storage/storageFactory'
import { theme } from '../core/theme'
import { loadChartExportSettings, saveChartExportSettings } from '../utils/chartExportSettings'
import styles from './SettingsPage.module.css'
import type { ChartExportSettings } from '../utils/chartExportSettings'

// Account self-deletion is dev-only for now: visible on the dev domain + local builds, hidden on the
// production build (the worker also 501s DELETE /api/account in production). On prod, users delete
// profiles/data in the Exports tab or contact support. Set VITE_ENABLE_ACCOUNT_DELETION=true to force-on.
const ACCOUNT_DELETION_ENABLED =
  import.meta.env.MODE !== 'production' || import.meta.env.VITE_ENABLE_ACCOUNT_DELETION === 'true'

function Reports() {
  const [reportYear, setReportYear] = createSignal(new Date().getFullYear())
  const [reportMonth, setReportMonth] = createSignal(new Date().getMonth() + 1)
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

  const getProfileHeaders = (): Record<string, string> => {
    const currentProfileId = localStorage.getItem('currentProfileId')
    const selectedProfileIds = JSON.parse(localStorage.getItem('selectedProfileIds') || '[]')
    const headers: Record<string, string> = {}
    if (currentProfileId) {
      headers['X-Profile-Id'] = currentProfileId
    }
    if (selectedProfileIds.length > 1) {
      headers['X-Profile-Ids'] = JSON.stringify(selectedProfileIds)
    }
    return headers
  }

  const downloadReport = async (endpoint: string, filename: string) => {
    setReportLoading(filename)
    try {
      const headers = getProfileHeaders()
      // Also append profile_ids to URL as query param fallback
      const selectedProfileIds = JSON.parse(localStorage.getItem('selectedProfileIds') || '[]')
      let url = endpoint
      if (selectedProfileIds.length > 1) {
        const sep = endpoint.includes('?') ? '&' : '?'
        url = `${endpoint}${sep}profile_ids=${selectedProfileIds.join(',')}`
      }
      // Append theme from chart export settings
      const exportSettings = loadChartExportSettings()
      if (exportSettings.background === 'dark') {
        url = `${url}${url.includes('?') ? '&' : '?'}theme=dark`
      } else if (exportSettings.background === 'theme') {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
        url = `${url}${url.includes('?') ? '&' : '?'}theme=${isDark ? 'dark' : 'light'}`
      }
      const res = await apiFetch(url, { credentials: 'include', headers })
      if (!res.ok) throw new Error('Report generation failed')
      const blob = await res.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = filename
      a.click()
      URL.revokeObjectURL(downloadUrl)
    } catch {
      toast('Failed to generate report', 'error')
    } finally {
      setReportLoading(null)
    }
  }

  const handleGenerate = () => {
    const y = reportYear()

    if (reportType() === 'monthly') {
      const m = reportMonth()
      if (m === 0) {
        // "All Months" selected — generate annual report instead
        downloadReport(`/api/reports/annual-pdf?year=${y}`, `annual-report-${y}.pdf`)
        return
      }
      const mStr = String(m).padStart(2, '0')
      downloadReport(`/api/reports/monthly-pdf?year=${y}&month=${mStr}`, `report-${y}-${mStr}.pdf`)
    } else if (reportType() === 'annual') {
      downloadReport(`/api/reports/annual-pdf?year=${y}`, `annual-report-${y}.pdf`)
    } else if (reportType() === 'tax') {
      downloadReport(`/api/reports/tax-summary-pdf?year=${y}`, `tax-summary-${y}.pdf`)
    } else {
      downloadReport(`/api/reports/pl-summary-pdf?year=${y}`, `pl-summary-${y}.pdf`)
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

export default function Settings() {
  const [localCurrency, setLocalCurrency] = createSignal('USD')
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
  // Settings tabs: General (settings) / Exports (data + household) / Billing (plan).
  type SettingsTab = 'general' | 'exports' | 'billing'
  const [activeTab, setActiveTab] = createSignal<SettingsTab>('general')
  // Display value for a card belonging to tab `t` (undefined = visible, 'none' = hidden).
  const tabSel = (t: SettingsTab): string | undefined => (activeTab() === t ? undefined : 'none')

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
      setBilling(res.ok ? await res.json() : null)
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
  const sendTestEmail = async () => {
    setNotifBusy(true)
    try {
      const res = await apiFetch('/api/notifications/test-email', {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not send')
      toast(
        data.skipped
          ? 'Email is not configured on the server yet (no-op in dev).'
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

  // Handle dark mode toggle
  const handleDarkModeToggle = (event: Event) => {
    const target = event.target as HTMLInputElement
    const checked = target.checked
    setDarkMode(checked)
    theme.setTheme(checked ? 'dark' : 'light')
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
        <h1 data-tour="settings-header">Settings</h1>
      </div>
      <div class={styles.pageContent}>
        <div
          style={{
            display: 'flex',
            gap: '4px',
            'border-bottom': '1px solid var(--border)',
            'margin-bottom': '20px',
          }}
          data-tour="settings-tabs"
        >
          {(['general', 'exports', 'billing'] as const)
            .filter((t) => t !== 'billing' || storageMode() === 'self-hosted')
            .map((t) => (
              <button
                type="button"
                onclick={() => setActiveTab(t)}
                style={{
                  padding: '10px 16px',
                  background: 'transparent',
                  border: 'none',
                  'border-bottom':
                    activeTab() === t ? '2px solid var(--primary)' : '2px solid transparent',
                  color: activeTab() === t ? 'var(--text)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  'font-size': '14px',
                  'font-weight': activeTab() === t ? 600 : 400,
                  'margin-bottom': '-1px',
                }}
              >
                {t === 'general' ? 'General' : t === 'exports' ? 'Exports' : 'Billing'}
              </button>
            ))}
        </div>
        <div class={styles.settingsGrid}>
          <div class={styles.settingsCol}>
            <Show when={activeTab() === 'billing' && storageMode() === 'self-hosted'}>
              <div class={styles.card}>
                <div class={styles.settingsSection}>
                  <div class={styles.settingsSectionTitle}>Plan &amp; Billing</div>
                  <p
                    style={`margin: 4px 0 16px; font-size: 13px; color: ${billingStatusLine().color};`}
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
              </div>
            </Show>
            <Show
              when={
                activeTab() === 'billing' &&
                storageMode() === 'self-hosted' &&
                ACCOUNT_DELETION_ENABLED
              }
            >
              <div class={styles.card}>
                <div class={styles.settingsSection}>
                  <AccountDeletion />
                </div>
              </div>
            </Show>
            <Show when={activeTab() === 'general' && storageMode() === 'self-hosted' && notif()}>
              <div class={styles.card}>
                <div class={styles.settingsSection}>
                  <div class={styles.settingsSectionTitle}>Email Reminders</div>
                  <p style="margin: 4px 0 12px; color: var(--text-secondary); font-size: 13px;">
                    Budget alerts and a periodic spending report, sent to your email. Requires a
                    paid plan.
                  </p>
                  <div class={styles.formGroup}>
                    <label class={styles.formLabel}>Email address</label>
                    <input
                      class={styles.formControl}
                      type="email"
                      value={notif()!.email}
                      onInput={(e) => setNotif({ ...notif()!, email: e.currentTarget.value })}
                      placeholder="you@example.com"
                      style="max-width: 320px;"
                    />
                  </div>
                  <label style="display:flex; align-items:center; gap:8px; margin:8px 0; cursor:pointer;">
                    <input
                      type="checkbox"
                      checked={notif()!.emailNotifications}
                      onChange={(e) =>
                        setNotif({ ...notif()!, emailNotifications: e.currentTarget.checked })
                      }
                    />
                    <span>Enable email notifications</span>
                  </label>
                  <label
                    style={`display:flex; align-items:center; gap:8px; margin:8px 0 8px 20px; cursor:pointer; opacity:${notif()!.emailNotifications ? 1 : 0.5};`}
                  >
                    <input
                      type="checkbox"
                      checked={notif()!.budgetAlerts}
                      disabled={!notif()!.emailNotifications}
                      onChange={(e) =>
                        setNotif({ ...notif()!, budgetAlerts: e.currentTarget.checked })
                      }
                    />
                    <span>Budget alerts (weekly)</span>
                  </label>
                  <label
                    style={`display:flex; align-items:center; gap:8px; margin:8px 0 8px 20px; cursor:pointer; opacity:${notif()!.emailNotifications ? 1 : 0.5};`}
                  >
                    <input
                      type="checkbox"
                      checked={notif()!.spendingReport}
                      disabled={!notif()!.emailNotifications}
                      onChange={(e) =>
                        setNotif({ ...notif()!, spendingReport: e.currentTarget.checked })
                      }
                    />
                    <span>Spending report (biweekly)</span>
                  </label>
                  <div style="display:flex; gap:8px; margin-top:12px;">
                    <button
                      class={styles.btnPrimary}
                      onclick={() => void saveNotifications()}
                      disabled={notifBusy()}
                    >
                      {notifBusy() ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      class={styles.btnSecondary}
                      onclick={() => void sendTestEmail()}
                      disabled={notifBusy()}
                    >
                      Send test email
                    </button>
                  </div>
                </div>
              </div>
            </Show>
            <div
              class={styles.card}
              style={{ display: tabSel('general') }}
              data-tour="settings-storage"
            >
              <div class={styles.settingsSection}>
                <div class={styles.settingsSectionTitle}>Database Storage</div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Storage Mode</label>
                  <select
                    class={styles.formControl}
                    value={storageMode()}
                    onchange={handleStorageModeChange}
                    style="max-width: 250px;"
                  >
                    <option value="self-hosted">Self-Hosted (Backend Server SQLite)</option>
                    <option value="serverless">Serverless (Browser LocalStorage)</option>
                  </select>
                </div>
                {showStorageWarning() && storageMode() === 'serverless' && (
                  <div class={styles.warningBox}>
                    <strong>Switch to Serverless Mode</strong>
                    <p style="margin-top: 8px; color: var(--text-secondary); font-size: 13px;">
                      Your data will be completely offline and stored in your browser's IndexedDB.
                      You will not be able to sync across devices unless you export/import manually.
                    </p>
                    <label style="display: flex; align-items: center; gap: 8px; margin-top: 12px; cursor: pointer;">
                      <input
                        type="checkbox"
                        checked={migrateDataEnabled()}
                        onchange={(e) => setMigrateDataEnabled(e.currentTarget.checked)}
                        style="width: 16px; height: 16px; cursor: pointer;"
                      />
                      <span style="font-size: 13px; color: var(--text-secondary);">
                        Migrate existing data from the backend to browser storage
                      </span>
                    </label>
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
                          : 'Apply Serverless Mode'}
                    </button>
                  </div>
                )}
                {showStorageWarning() && storageMode() === 'self-hosted' && (
                  <div class={styles.warningBox}>
                    <strong>Switch to Self-Hosted Mode</strong>
                    <p style="margin-top: 8px; color: var(--text-secondary); font-size: 13px;">
                      Your data will be stored on the backend SQLite server. You need the backend
                      server running for this mode to work.
                    </p>
                    <label style="display: flex; align-items: center; gap: 8px; margin-top: 12px; cursor: pointer;">
                      <input
                        type="checkbox"
                        checked={migrateDataEnabled()}
                        onchange={(e) => setMigrateDataEnabled(e.currentTarget.checked)}
                        style="width: 16px; height: 16px; cursor: pointer;"
                      />
                      <span style="font-size: 13px; color: var(--text-secondary);">
                        Migrate existing browser data to the backend server
                      </span>
                    </label>
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
                          : 'Switch to Self-Hosted'}
                    </button>
                  </div>
                )}
                {!showStorageWarning() && storageMode() === 'serverless' && (
                  <p style="margin-top: 12px; color: var(--text-secondary); font-size: 13px;">
                    Currently running in completely offline Serverless mode.
                  </p>
                )}
                {!showStorageWarning() && storageMode() === 'self-hosted' && (
                  <p style="margin-top: 12px; color: var(--text-secondary); font-size: 13px;">
                    Currently connected to Backend Server storage.
                  </p>
                )}
              </div>
            </div>

            <div class={styles.card} style={{ 'margin-top': '24px', display: tabSel('exports') }}>
              <div class={styles.settingsSection}>
                <div class={styles.settingsSectionTitle}>Household View</div>
                <p style="margin-bottom: 12px; color: var(--text-secondary); font-size: 13px;">
                  Select multiple profiles to view combined data across your household.
                </p>
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
                            checked={householdIds().includes(profile.id)}
                            onchange={() => {
                              toggleHouseholdProfile(profile.id)
                            }}
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
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
            </div>

            <div class={styles.card} style={{ 'margin-top': '24px', display: tabSel('exports') }}>
              <div class={styles.settingsSection}>
                <div class={styles.settingsSectionTitle}>Data Management</div>
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
              </div>
              <DangerZone onReset={handleReset} onDeleteProfile={handleDeleteProfile} />
            </div>

            <div class={styles.card} style={{ 'margin-top': '24px', display: tabSel('general') }}>
              <div class={styles.settingsSection}>
                <div class={styles.settingsSectionTitle}>Developer Tools</div>
                <div class={styles.formGroup} style="margin-top: 16px;">
                  <button
                    class={styles.btnSecondary}
                    onclick={() => {
                      window.location.hash = showLogs() ? '#settings' : '#logs'
                    }}
                  >
                    {showLogs() ? 'Hide Logs' : 'View Logs'}
                  </button>
                  <p style="margin-top: 8px; color: var(--text-secondary); font-size: 12px;">
                    Access log viewer to debug issues on mobile devices or when console is not
                    available.
                  </p>
                </div>
              </div>
            </div>

            <Show when={showLogs()}>
              <div class={styles.card} style={{ 'margin-top': '24px', display: tabSel('general') }}>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                  <div class={styles.settingsSectionTitle} style="margin-bottom: 0;">
                    Application Logs
                  </div>
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
              </div>
            </Show>
          </div>

          <div class={styles.settingsCol}>
            <div class={styles.card} style={{ display: tabSel('general') }}>
              <div class={styles.settingsSection}>
                <div class={styles.settingsSectionTitle}>Reports</div>
                <Reports />
              </div>
            </div>
            <div
              class={styles.card}
              style={{ display: tabSel('general') }}
              data-tour="settings-currency"
            >
              <div class={styles.settingsSection}>
                <div class={styles.settingsSectionTitle}>General</div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Local Currency</label>
                  <select
                    class={styles.formControl}
                    value={localCurrency()}
                    onchange={handleLocalCurrencyChange}
                    style="max-width: 200px;"
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
              </div>
            </div>
            <div
              class={styles.card}
              style={{ display: tabSel('general') }}
              data-tour="settings-theme"
            >
              <div class={styles.settingsSection}>
                <div class={styles.settingsSectionTitle}>Appearance</div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Theme</label>
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 14px; color: var(--text-secondary);">Light</span>
                    <label class={styles.toggleSwitch}>
                      <input
                        type="checkbox"
                        id="setting-dark-mode"
                        checked={darkMode()}
                        onchange={handleDarkModeToggle}
                      />
                      <span class={styles.toggleSlider}></span>
                    </label>
                    <span style="font-size: 14px; color: var(--text-secondary);">Dark</span>
                  </div>
                </div>
              </div>
            </div>
            <div class={styles.card} style={{ display: tabSel('exports') }}>
              <div class={styles.settingsSection}>
                <div class={styles.settingsSectionTitle}>Chart Export</div>
                <p style="margin-bottom: 12px; color: var(--text-secondary); font-size: 13px;">
                  Configure how charts are exported across the application.
                </p>
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
                    style="max-width: 250px;"
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
            </div>
          </div>

          <div class={styles.card} style={{ 'margin-top': '24px', display: tabSel('general') }}>
            <div class={styles.settingsSection}>
              <div class={styles.settingsSectionTitle}>About</div>
              <div class={styles.formGroup} style="margin-top: 16px;">
                <button class={styles.btnSecondary} onclick={() => setShowChangelog(true)}>
                  View Changelog
                </button>
                <p style="margin-top: 8px; color: var(--text-secondary); font-size: 12px;">
                  See what&apos;s new in each version of Finance Manager.
                </p>
                <p style="margin-top: 4px; color: var(--text-secondary); font-size: 11px; font-family: monospace;">
                  v{__APP_VERSION__} {__GIT_SHA__ !== 'unknown' ? `(${__GIT_SHA__})` : ''}
                </p>
                <div style="margin-top: 12px;">
                  <SupportContact />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Show when={showChangelog()}>
        <ChangelogModal onClose={() => setShowChangelog(false)} />
      </Show>
    </div>
  )
}
