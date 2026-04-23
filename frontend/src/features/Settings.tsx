/**
 * Settings Component
 * Application configuration and preferences with storage switching
 */
import { createEffect, createSignal, onMount } from 'solid-js'
import styles from '../components/SettingsPage.module.css'

export default function Settings() {
  const [localCurrency, setLocalCurrency] = createSignal('USD')
  const [darkMode, setDarkMode] = createSignal(false)
  const [storageType, setStorageType] = createSignal<'sqlite' | 'postgresql'>('sqlite')
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
    }

    const savedStorage = localStorage.getItem('storageType')
    if (savedStorage === 'postgresql') {
      setStorageType('postgresql')
    } else {
      setStorageType('sqlite')
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
      document.documentElement.classList.add('dark')
    } else {
      localStorage.setItem('darkMode', 'false')
      document.documentElement.classList.remove('dark')
    }
  }

  // Handle storage type change
  const handleStorageTypeChange = (event: Event) => {
    const target = event.target as HTMLSelectElement
    const newStorageType = target.value as 'sqlite' | 'postgresql'
    
    if (newStorageType === 'postgresql') {
      setShowStorageWarning(true)
    } else {
      setShowStorageWarning(false)
      setStorageType('sqlite')
      localStorage.setItem('storageType', 'sqlite')
    }
  }

  // Apply storage type
  const applyStorageType = async () => {
    if (storageType() === 'postgresql') {
      try {
        const response = await fetch('/api/settings/set-storage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'postgresql' })
        })
        
        if (response.ok) {
          localStorage.setItem('storageType', 'postgresql')
          setShowStorageWarning(false)
          alert('Database switched to PostgreSQL successfully. Please restart the application.')
          window.location.reload()
        } else {
          alert('Failed to switch to PostgreSQL. Please check the server logs.')
          setShowStorageWarning(true)
        }
      } catch (error) {
        console.error('Failed to switch storage:', error)
        alert('Failed to switch storage. Please check the server logs.')
        setShowStorageWarning(true)
      }
    } else {
      localStorage.setItem('storageType', 'sqlite')
      alert('Database switched to SQLite. Please restart the application.')
      window.location.reload()
    }
  }

  return (
    <div class={`page page-settings page-enter ${styles.settingsPage}`}>
      <div class={styles.pageHeader}>
        <h1>Settings</h1>
      </div>
      <div class="page page-settings page-content">
        <div class="settings-grid">
          <div class="settings-col">
            <div class={styles.card}>
              <div class="settings-section">
                <div class="settings-section-title">Database Storage</div>
                <div class="form-group">
                  <label class="form-label">Storage Type</label>
                  <select
                    class="form-control"
                    value={storageType()}
                    onchange={handleStorageTypeChange}
                    style="max-width: 250px;"
                  >
                    <option value="sqlite">SQLite (Local File)</option>
                    <option value="postgresql">PostgreSQL (Remote Server)</option>
                  </select>
                </div>
                {showStorageWarning() && (
                  <div class={styles.warningBox}>
                    <strong>PostgreSQL is required for the deployment version.</strong>
                    <p style="margin-top: 8px; color: var(--text-secondary); font-size: 13px;">
                      To use PostgreSQL, ensure it is properly configured in the backend. 
                      Restart the application after switching storage types.
                    </p>
                    <button
                      class="btn btn-primary"
                      onclick={applyStorageType}
                      style="margin-top: 12px;"
                    >
                      Apply {storageType() === 'postgresql' ? 'PostgreSQL' : 'SQLite'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div class="settings-col">
            <div class={styles.card}>
              <div class="settings-section">
                <div class="settings-section-title">General</div>
                <div class="form-group">
                  <label class="form-label">Local Currency</label>
                  <select
                    class="form-control"
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
              <div class="settings-section">
                <div class="settings-section-title">Appearance</div>
                <div class="form-group">
                  <label class="form-label">Theme</label>
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 14px; color: var(--text-secondary);">Light</span>
                    <label class="toggle-switch">
                      <input
                        type="checkbox"
                        id="setting-dark-mode"
                        checked={darkMode()}
                        onchange={handleDarkModeToggle}
                      />
                      <span class="toggle-slider"></span>
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
