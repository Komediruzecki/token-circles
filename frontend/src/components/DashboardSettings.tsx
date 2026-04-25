/**
 * Dashboard Settings Component - Configure widget visibility and order
 */

import { createSignal, onMount } from 'solid-js'
import type { Component } from 'solid-js'
import styles from './DashboardSettings.module.css'

export const DashboardSettings: Component = () => {
  const [selectedWidget, setSelectedWidget] = createSignal<string | null>(null)

  // Widget configuration
  const widgets = [
    { id: 'metrics', name: 'Metrics Cards', icon: '📊' },
    { id: 'category-chart', name: 'Spending by Category', icon: '📈' },
    { id: 'recent-transactions', name: 'Recent Transactions', icon: '📝' },
    { id: 'upcoming-bills', name: 'Upcoming Bills', icon: '📅' },
    { id: 'savings-rate', name: 'Savings Rate', icon: '💰' },
    { id: 'budget-alerts', name: 'Budget Alerts', icon: '⚠️' },
  ]

  // Load saved preferences
  onMount(() => {
    const saved = localStorage.getItem('dashboard_widgets')
    if (saved !== null) {
      try {
        const parsed = JSON.parse(saved)
        if (parsed.visibleWidgets !== undefined) {
          parsed.visibleWidgets.forEach((id: string) => {
            setSelectedWidget((prev) => (prev ? `${prev},${id}` : id))
          })
        }
      } catch (e) {
        console.error('Failed to load dashboard settings:', e)
      }
    }
  })

  // Toggle widget visibility
  const toggleWidget = (widgetId: string) => {
    const current = selectedWidget()
    if (current !== null && current.split(',').includes(widgetId)) {
      setSelectedWidget(current.replace(new RegExp(`(^|,)${widgetId}(,|$)`), '$1$2'))
    } else {
      setSelectedWidget(current !== null ? `${current},${widgetId}` : widgetId)
    }
  }

  // Save preferences
  const saveSettings = () => {
    const current = selectedWidget()
    localStorage.setItem(
      'dashboard_widgets',
      JSON.stringify({
        visibleWidgets: current !== null ? current.split(',') : [],
        widgetOrder: [], // Can add ordering in future
      })
    )
  }

  // Reset to default
  const resetSettings = () => {
    setSelectedWidget('metrics,category-chart,recent-transactions,upcoming-bills')
    saveSettings()
  }

  return (
    <div class={styles.dashboardSettings}>
      <div class={styles.settingsHeader}>
        <h3>Dashboard Settings</h3>
        <button class={`${styles.btnSm} ${styles.btnSecondary}`} onClick={resetSettings}>
          Reset Default
        </button>
      </div>
      <div class={styles.settingsList}>
        {widgets.map((widget) => (
          <div class={styles.settingItem}>
            <button
              class={styles.widgetToggle}
              classList={{ [styles.active]: selectedWidget() !== null && selectedWidget()!.split(',').includes(widget.id) }}
              onClick={() => {
                toggleWidget(widget.id)
              }}
            >
              <span class={styles.widgetIcon}>{widget.icon}</span>
              <span class={styles.widgetName}>{widget.name}</span>
              <span class={styles.widgetStatus}>
                {selectedWidget() !== null && selectedWidget()!.split(',').includes(widget.id) ? 'Visible' : 'Hidden'}
              </span>
            </button>
          </div>
        ))}
      </div>
      <div class={styles.settingsFooter}>
        <button class={`${styles.btnSm} ${styles.btnPrimary}`} onClick={saveSettings}>
          Save Settings
        </button>
      </div>
    </div>
  )
}
