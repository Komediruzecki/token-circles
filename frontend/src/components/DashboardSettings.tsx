/**
 * Dashboard Settings Component - Configure widget visibility and order
 */

import { createSignal, For, onMount } from 'solid-js'
import styles from './DashboardSettings.module.css'
import type { Component } from 'solid-js'

const ALL_WIDGET_IDS = [
  'metrics',
  'category-chart',
  'recent-transactions',
  'upcoming-bills',
  'savings-rate',
  'budget-alerts',
]

export interface DashboardSettingsProps {
  onSave?: () => void
}

export const DashboardSettings: Component<DashboardSettingsProps> = (props) => {
  const [selectedWidget, setSelectedWidget] = createSignal<string>(ALL_WIDGET_IDS.join(','))

  // Widget configuration
  const widgets = [
    {
      id: 'metrics',
      name: 'Metrics Cards',
      icon: (
        <svg
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
    {
      id: 'category-chart',
      name: 'Spending by Category',
      icon: (
        <svg
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path d="M13 17V9m-4 8v-4m8 4v-2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      id: 'recent-transactions',
      name: 'Recent Transactions',
      icon: (
        <svg
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      id: 'upcoming-bills',
      name: 'Upcoming Bills',
      icon: (
        <svg
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      id: 'savings-rate',
      name: 'Savings Rate',
      icon: (
        <svg
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      id: 'budget-alerts',
      name: 'Budget Alerts',
      icon: (
        <svg
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      ),
    },
  ]

  // Load saved preferences
  onMount(() => {
    const saved = localStorage.getItem('dashboard_widgets')
    if (saved !== null) {
      try {
        const parsed = JSON.parse(saved)
        if (parsed.visibleWidgets && Array.isArray(parsed.visibleWidgets)) {
          setSelectedWidget(parsed.visibleWidgets.join(','))
        }
      } catch (e) {
        console.error('Failed to load dashboard settings:', e)
      }
    }
  })

  // Toggle widget visibility
  const toggleWidget = (widgetId: string) => {
    const current = selectedWidget()
    const ids = current ? current.split(',').filter(Boolean) : []
    if (ids.includes(widgetId)) {
      setSelectedWidget(ids.filter((id) => id !== widgetId).join(','))
    } else {
      setSelectedWidget([...ids, widgetId].join(','))
    }
  }

  const isVisible = (widgetId: string) => {
    const current = selectedWidget()
    return current ? current.split(',').includes(widgetId) : false
  }

  // Save preferences
  const saveSettings = () => {
    const current = selectedWidget()
    const ids = current ? current.split(',').filter(Boolean) : []
    localStorage.setItem(
      'dashboard_widgets',
      JSON.stringify({
        visibleWidgets: ids,
        widgetOrder: [],
      })
    )
    props.onSave?.()
  }

  // Reset to default
  const resetSettings = () => {
    setSelectedWidget(ALL_WIDGET_IDS.join(','))
  }

  return (
    <div class={styles.dashboardSettings}>
      <div class={styles.settingsHeader}>
        <h3>Dashboard Views</h3>
        <button class={`${styles.btnSm} ${styles.btnSecondary}`} onClick={resetSettings}>
          Reset Default
        </button>
      </div>
      <div class={styles.settingsList}>
        <For each={widgets}>
          {(widget) => (
            <div class={styles.settingItem}>
              <button
                class={styles.widgetToggle}
                classList={{
                  [styles.active]: isVisible(widget.id),
                }}
                onClick={() => {
                  toggleWidget(widget.id)
                }}
              >
                <span class={styles.widgetIcon}>{widget.icon}</span>
                <span class={styles.widgetName}>{widget.name}</span>
                <span class={styles.widgetStatus}>
                  {isVisible(widget.id) ? 'Visible' : 'Hidden'}
                </span>
              </button>
            </div>
          )}
        </For>
      </div>
      <div class={styles.settingsFooter}>
        <button class={`${styles.btnSm} ${styles.btnPrimary}`} onClick={saveSettings}>
          Save & Close
        </button>
      </div>
    </div>
  )
}
