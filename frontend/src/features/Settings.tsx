/**
 * Settings Component
 * Application configuration and preferences with storage switching
 */
import { createEffect, createSignal, onMount } from 'solid-js'
import styles from '../components/SettingsPage.module.css'
import { apiPost } from '../utils/api'

import { setStorageMode } from '../core/storage/storageFactory'

export default function Settings() {
  const [localCurrency, setLocalCurrency] = createSignal('USD')
  const [darkMode, setDarkMode] = createSignal(false)
  const [storageMode, setLocalStorageMode] = createSignal<'serverless' | 'self-hosted'>('self-hosted')
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
      document.documentElement.setAttribute('data-theme', savedDarkMode === 'true' ? 'dark' : 'light')
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
      alert(`Database switched to ${storageMode() === 'serverless' ? 'Browser LocalStorage' : 'Backend SQLite'} successfully.`)
      window.location.reload()
    } catch (error) {
      console.error('Failed to switch storage:', error)
      alert('Failed to switch storage mode.')
    }
  }

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
      alert('Data exported successfully')
    } catch {
      alert('Failed to export data')
    }
  }

  const handleReset = async () => {
    if (!confirm('Are you sure you want to reset all data? This cannot be undone.')) return
    if (!confirm('This will permanently delete all your data. Continue?')) return

    try {
      await fetch('/api/clear-all', {
        method: 'DELETE',
        credentials: 'include',
      })
      alert('All data has been reset')
      window.location.reload()
    } catch {
      alert('Failed to reset data')
    }
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
                      Your data will be completely offline and stored securely in your local browser cache. 
                      You will not be able to sync across devices unless you export/import manually.
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
                <div style="display: flex; gap: 12px; margin-top: 16px;">
                  <button class={styles.btnSecondary} onclick={handleExport}>
                    Export Data (JSON)
                  </button>
                  <button class={styles.btnDanger} onclick={handleReset}>
                    Reset All Data
                  </button>
                </div>
              </div>
            </div>
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
