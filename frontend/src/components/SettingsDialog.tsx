/**
 * Settings Dialog - Modal for app settings
 * Supports theme, language, currency, and storage mode selection
 */

import {  createSignal, For } from 'solid-js'
import { toast } from '../core/api.js'
import { setStorageMode } from '../core/storage/storageFactory.js'
import { Modal } from './Modal.js'
import type {Component} from 'solid-js';
import type { StorageMode } from '../core/storage/storageFactory.js';

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
}

type SettingTab = 'general' | 'storage'

export const SettingsDialog: Component<SettingsDialogProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<SettingTab>('general')

  // Settings state
  const [theme, setTheme] = createSignal<'light' | 'dark'>('light')
  const [language, setLanguage] = createSignal('en')
  const [currency, setCurrency] = createSignal('USD')
  const [primaryCurrency, setPrimaryCurrency] = createSignal('USD')

  // Storage mode state
  const [currentMode, setCurrentMode] = createSignal<StorageMode>('serverless')

  // Load current settings
  const loadSettings = async () => {
    try {
      const response = await fetch('/api/settings')
      if (response.ok) {
        const settings = await response.json()
        setTheme(settings.theme || 'light')
        setLanguage(settings.language || 'en')
        setCurrency(settings.currency || 'USD')
        setPrimaryCurrency(settings.primary_currency || 'USD')
      }
    } catch (_error) {
      console.error('Failed to load settings:', _error)
    }

    try {
      const response = await fetch('/api/storage-mode')
      if (response.ok) {
        setCurrentMode(await response.json())
      }
    } catch (_error) {
      console.error('Failed to load storage mode:', _error)
    }
  }

  // Save settings
  const saveSettings = async () => {
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          theme: theme(),
          language: language(),
          currency: currency(),
          primary_currency: primaryCurrency(),
        }),
      })
      toast('Settings saved', 'success')
    } catch (_error) {
      toast('Failed to save settings', 'error')
      console.error('Failed to save settings:', _error)
    }
  }

  // Set storage mode
  const handleSetMode = async (mode: StorageMode) => {
    try {
      await fetch('/api/storage-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mode }),
      })
      setStorageMode(mode)
      setCurrentMode(mode)
      toast(`Storage mode: ${mode === 'serverless' ? 'Serverless' : 'Self-Hosted'}`, 'success')
    } catch {
      toast('Failed to change storage mode', 'error')
    }
  }

  // Export data
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
      toast('Data exported successfully', 'success')
    } catch {
      toast('Failed to export data', 'error')
    }
  }

  // Import data
  const handleImport = async (e: Event) => {
    const target = e.target as HTMLInputElement
    const file = target.files?.[0]

    if (!file) return

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/import', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })

      if (!response.ok) {
        throw new Error('Import failed')
      }

      const result = await response.json()
      toast(`${result.imported || 0} items imported`, 'success')
      props.onClose()
    } catch {
      toast('Failed to import data', 'error')
    }
  }

  // Reset data
  const _handleReset = async () => {
    if (!confirm('Are you sure you want to reset all data? This cannot be undone.')) {
      return
    }

    if (!confirm('This will permanently delete all your data. Continue?')) {
      return
    }

    try {
      await fetch('/api/clear-all', {
        method: 'DELETE',
        credentials: 'include',
      })
      toast('All data has been reset', 'success')
      props.onClose()
    } catch {
      toast('Failed to reset data', 'error')
    }
  }

  // Initialize
  if (props.isOpen) {
    loadSettings()
  }

  const languages = [
    { code: 'en', name: 'English' },
    { code: 'pl', name: 'Polski' },
    { code: 'de', name: 'Deutsch' },
    { code: 'fr', name: 'Français' },
    { code: 'es', name: 'Español' },
  ]

  const currencies = [
    { code: 'USD', name: 'USD - US Dollar' },
    { code: 'EUR', name: 'EUR - Euro' },
    { code: 'GBP', name: 'GBP - British Pound' },
    { code: 'PLN', name: 'PLN - Polish Złoty' },
    { code: 'CZK', name: 'CZK - Czech Koruna' },
    { code: 'SEK', name: 'SEK - Swedish Krona' },
  ]

  return (
    <div class="settings-dialog">
      <Modal isOpen={props.isOpen} onClose={props.onClose} title="Settings">
        {/* Tabs */}
        <div class="settings-tabs">
          <button
            class={`tab ${activeTab() === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            General
          </button>
          <button
            class={`tab ${activeTab() === 'storage' ? 'active' : ''}`}
            onClick={() => setActiveTab('storage')}
          >
            Storage
          </button>
        </div>

        {/* General Settings */}
        <div class="tab-content" classList={{ active: activeTab() === 'general' }}>
          {/* Theme */}
          <div class="setting-group">
            <label class="setting-label">Theme</label>
            <div class="theme-selector">
              <button
                class={`theme-btn ${theme() === 'light' ? 'active' : ''}`}
                onClick={() => setTheme('light')}
              >
                <span>☀️ Light</span>
              </button>
              <button
                class={`theme-btn ${theme() === 'dark' ? 'active' : ''}`}
                onClick={() => setTheme('dark')}
              >
                <span>🌙 Dark</span>
              </button>
            </div>
          </div>

          {/* Language */}
          <div class="setting-group">
            <label class="setting-label">Language</label>
            <select
              class="setting-select"
              value={language()}
              onChange={(e) => setLanguage(e.currentTarget.value)}
            >
              <For each={languages}>{(lang) => <option value={lang.code}>{lang.name}</option>}</For>
            </select>
          </div>

          {/* Currency */}
          <div class="setting-group">
            <label class="setting-label">Currency</label>
            <select
              class="setting-select"
              value={currency()}
              onChange={(e) => setCurrency(e.currentTarget.value)}
            >
              <For each={currencies}>
                {(curr) => <option value={curr.code}>{curr.name}</option>}
              </For>
            </select>
          </div>

          <div class="setting-group">
            <label class="setting-label">Primary Currency</label>
            <select
              class="setting-select"
              value={primaryCurrency()}
              onChange={(e) => setPrimaryCurrency(e.currentTarget.value)}
            >
              <For each={currencies}>
                {(curr) => <option value={curr.code}>{curr.name}</option>}
              </For>
            </select>
          </div>

          <div class="setting-actions">
            <button class="btn-primary" onClick={saveSettings}>
              Save Settings
            </button>
          </div>
        </div>

        {/* Storage Settings */}
        <div class="tab-content" classList={{ active: activeTab() === 'storage' }}>
          {/* Storage Mode */}
          <div class="setting-group">
            <label class="setting-label">Storage Mode</label>
            <div class="mode-selector">
              <button
                class={`mode-btn ${currentMode() === 'serverless' ? 'active' : ''}`}
                onClick={() => handleSetMode('serverless')}
              >
                <div class="mode-info">
                  <strong>Serverless</strong>
                  <span>Browser localStorage storage</span>
                </div>
                <div class="mode-icon">☁️</div>
              </button>
              <button
                class={`mode-btn ${currentMode() === 'self-hosted' ? 'active' : ''}`}
                onClick={() => handleSetMode('self-hosted')}
              >
                <div class="mode-info">
                  <strong>Self-Hosted</strong>
                  <span>Backend server storage</span>
                </div>
                <div class="mode-icon">🖥️</div>
              </button>
            </div>
            <p class="setting-hint">
              {currentMode() === 'serverless'
                ? 'Your data is stored in your browser. You can export/import your data at any time.'
                : 'Your data is stored on the backend server. Use this if you need data access across devices.'}
            </p>
          </div>

          {/* Data Management */}
          <div class="setting-group">
            <label class="setting-label">Data Management</label>
            <div class="data-actions">
              <button class="btn-secondary" onClick={handleExport}>
                📤 Export Data
              </button>
              <button class="btn-secondary">
                📥 Import Data
                <input type="file" accept=".json" style="display: none" onChange={handleImport} />
              </button>
            </div>
          </div>

          {/* Reset */}
          <div class="setting-group">
            <label class="setting-label">Danger Zone</label>
            <button class="btn-danger" onClick={_handleReset}>
              🗑️ Reset All Data
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
