/**
 * Settings Component
 * Application configuration and preferences
 */

import { createSignal, createEffect, onMount } from 'solid-js'

export default function Settings() {
  const [localCurrency, setLocalCurrency] = createSignal('USD')
  const [darkMode, setDarkMode] = createSignal(false)

  // Load saved settings
  onMount(() => {
    const savedCurrency = localStorage.getItem('localCurrency')
    if (savedCurrency) {
      setLocalCurrency(savedCurrency)
    }

    // Check for dark mode preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    setDarkMode(prefersDark)
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

  return (
    <div class="page page-settings page-enter">
      <div class="page-header">
        <h1>Settings</h1>
      </div>
      <div class="page-content">
        <div class="settings-grid">
          <div class="settings-col">
            <div class="card">
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
            <div class="form-group">
              <label class="form-label">Appearance</label>
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
  )
}
