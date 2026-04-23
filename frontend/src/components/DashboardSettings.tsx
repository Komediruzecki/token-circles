/**
 * Dashboard Settings Component - Configure widget visibility and order
 */

import { createSignal, onMount } from 'solid-js'
import type { Component } from 'solid-js'

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
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        parsed.visibleWidgets?.forEach((id: string) => {
          setSelectedWidget((prev) => (prev ? `${prev  },${  id}` : id))
        })
      } catch (e) {
        console.error('Failed to load dashboard settings:', e)
      }
    }
  })

  // Toggle widget visibility
  const toggleWidget = (widgetId: string) => {
    const current = selectedWidget()
    if (current?.split(',').includes(widgetId)) {
      setSelectedWidget(current.replace(new RegExp(`(^|,)${widgetId}(,|$)`), '$1$2'))
    } else {
      setSelectedWidget(current ? `${current},${widgetId}` : widgetId)
    }
  }

  // Save preferences
  const saveSettings = () => {
    const current = selectedWidget()
    localStorage.setItem(
      'dashboard_widgets',
      JSON.stringify({
        visibleWidgets: current ? current.split(',') : [],
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
    <div class="dashboard-settings">
      <div class="settings-header">
        <h3>Dashboard Settings</h3>
        <button class="btn btn-sm btn-secondary" onClick={resetSettings}>
          Reset Default
        </button>
      </div>
      <div class="settings-list">
        {widgets.map((widget) => (
          <div class="setting-item">
            <button
              class="widget-toggle"
              classList={{ active: selectedWidget()?.split(',').includes(widget.id) }}
              onClick={() => { toggleWidget(widget.id); }}
            >
              <span class="widget-icon">{widget.icon}</span>
              <span class="widget-name">{widget.name}</span>
              <span class="widget-status">
                {selectedWidget()?.split(',').includes(widget.id) ? 'Visible' : 'Hidden'}
              </span>
            </button>
          </div>
        ))}
      </div>
      <div class="settings-footer">
        <button class="btn btn-primary" onClick={saveSettings}>
          Save Settings
        </button>
      </div>
    </div>
  )
}
