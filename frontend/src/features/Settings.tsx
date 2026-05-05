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
import { createEffect, createSignal, onMount, Show } from 'solid-js'
import DangerZone from '../components/DangerZone'
import { LogViewer } from '../components/LogViewer'
import styles from '../components/SettingsPage.module.css'
import { setStorageMode } from '../core/storage/storageFactory'

export default function Settings() {
  const [localCurrency, setLocalCurrency] = createSignal('USD')
  const [darkMode, setDarkMode] = createSignal(false)
  const [storageMode, setLocalStorageMode] = createSignal<'serverless' | 'self-hosted'>(
    'self-hosted'
  )
  const [showStorageWarning, setShowStorageWarning] = createSignal(false)

  // Load saved settings
  onMount(() => {
    const savedCurrency = localStorage.getItem('localCurrency')
    if (savedCurrency) {
      setLocalCurrency(savedCurrency)
    }

    const savedDarkMode = localStorage.getItem('darkMode')
    if (savedDarkMode) {
      setDarkMode(savedDarkMode === 'true')
      document.documentElement.setAttribute(
        'data-theme',
        savedDarkMode === 'true' ? 'dark' : 'light'
      )
    }

    const savedStorage = localStorage.getItem('finance_storage_mode')
    if (savedStorage === 'serverless') {
      setLocalStorageMode('serverless')
    } else {
      setLocalStorageMode('self-hosted')
    }
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

    // Save theme preference
    if (checked) {
      localStorage.setItem('darkMode', 'true')
      document.documentElement.setAttribute('data-theme', 'dark')
    } else {
      localStorage.setItem('darkMode', 'false')
      document.documentElement.setAttribute('data-theme', 'light')
    }
  }

  // Handle storage type change
  const handleStorageModeChange = (event: Event) => {
    const target = event.target as HTMLSelectElement
    const newMode = target.value as 'serverless' | 'self-hosted'

    if (newMode === 'serverless') {
      setLocalStorageMode('serverless')
      setShowStorageWarning(true)
    } else {
      setShowStorageWarning(false)
      setLocalStorageMode('self-hosted')
    }
  }

  // Apply storage type
  const applyStorageMode = async () => {
    try {
      await fetch('/api/storage-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mode: storageMode() }),
      })
      setStorageMode(storageMode())
      setShowStorageWarning(false)
      alert(
        `Database switched to ${storageMode() === 'serverless' ? 'Browser LocalStorage' : 'Backend SQLite'} successfully.`
      )
      window.location.reload()
    } catch (error) {
      console.error('Failed to switch storage:', error)
      alert('Failed to switch storage mode.')
    }
  }

  const [csvExporting, setCsvExporting] = createSignal<string | null>(null)

  // Data Management
  const handleExport = async () => {
    try {
      const response = await fetch('/api/export', {
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
      alert('Failed to export data')
    }
  }

  const handleCsvExport = async (type: string) => {
    setCsvExporting(type)
    try {
      const response = await fetch(`/api/export/${type}?format=csv`, {
        method: 'GET',
        credentials: 'include',
      })
      if (!response.ok) throw new Error('Export failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${type}-${new Date().toISOString().split('T')[0]}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert(`Failed to export ${type}`)
    } finally {
      setCsvExporting(null)
    }
  }

  const handleReset = async () => {
    await fetch('/api/clear-all', {
      method: 'DELETE',
      credentials: 'include',
    })
    window.location.reload()
  }

  return (
    <div class={`page page-settings page-enter ${styles.settingsPage}`}>
      <div class={styles.pageHeader}>
        <h1>Settings</h1>
      </div>
      <div class={styles.pageContent}>
        <div class={styles.settingsGrid}>
          <div class={styles.settingsCol}>
            <div class={styles.card}>
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
                {showStorageWarning() && (
                  <div class={styles.warningBox}>
                    <strong>Serverless Mode uses Browser LocalStorage.</strong>
                    <p style="margin-top: 8px; color: var(--text-secondary); font-size: 13px;">
                      Your data will be completely offline and stored securely in your local browser
                      cache. You will not be able to sync across devices unless you export/import
                      manually.
                    </p>
                    <button
                      class={styles.btnPrimary}
                      onclick={applyStorageMode}
                      style="margin-top: 12px;"
                    >
                      Apply Serverless Mode
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

            <div class={styles.card} style="margin-top: 24px;">
              <div class={styles.settingsSection}>
                <div class={styles.settingsSectionTitle}>Data Management</div>
                <div style="margin-top: 16px; display: flex; flex-wrap: wrap; gap: 8px;">
                  <button class={styles.btnSecondary} onclick={handleExport}>
                    Export All (JSON)
                  </button>
                  {[
                    { type: 'transactions', label: 'Transactions CSV' },
                    { type: 'categories', label: 'Categories CSV' },
                    { type: 'budgets', label: 'Budgets CSV' },
                    { type: 'accounts', label: 'Accounts CSV' },
                    { type: 'loans', label: 'Loans CSV' },
                    { type: 'recurring', label: 'Recurring CSV' },
                  ].map(({ type, label }) => (
                    <button
                      class={styles.btnSecondary}
                      onclick={() => handleCsvExport(type)}
                      disabled={csvExporting() === type}
                    >
                      {csvExporting() === type ? 'Exporting...' : label}
                    </button>
                  ))}
                </div>
              </div>
              <DangerZone onReset={handleReset} />
            </div>

            <div class={styles.card} style="margin-top: 24px;">
              <div class={styles.settingsSection}>
                <div class={styles.settingsSectionTitle}>Developer Tools</div>
                <div class={styles.formGroup} style="margin-top: 16px;">
                  <button
                    class={styles.btnSecondary}
                    onclick={() => {
                      const hash = window.location.hash.replace('#', '')
                      if (hash === 'settings') {
                        window.location.hash = '#logs'
                      } else {
                        window.location.hash = '#settings#logs'
                      }
                    }}
                  >
                    View Logs
                  </button>
                  <p style="margin-top: 8px; color: var(--text-secondary); font-size: 12px;">
                    Access log viewer to debug issues on mobile devices or when console is not
                    available.
                  </p>
                </div>
              </div>
            </div>

            <Show when={window.location.hash.includes('#logs')}>
              <div class={styles.card} style="margin-top: 24px;">
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
            <div class={styles.card}>
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
            <div class={styles.card}>
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
          </div>
        </div>
      </div>
    </div>
  )
}
