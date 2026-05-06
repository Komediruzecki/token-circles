/**
 * Theme module - handles light/dark theme switching
 */

const THEME_STORAGE_KEY = 'finance-theme'

type Theme = 'light' | 'dark'

/**
 * Theme store - handles theme state and CSS variable updates
 */
export class ThemeStore {
  private currentTheme: Theme = 'dark'

  /**
   * Check if dark theme is active
   */
  isDark(): boolean {
    return document.documentElement.getAttribute('data-theme') === 'dark'
  }

  /**
   * Get current theme
   */
  getTheme(): Theme {
    return this.currentTheme
  }

  /**
   * Set theme
   */
  setTheme(theme: Theme): void {
    this.currentTheme = theme
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_STORAGE_KEY, theme)
    // Trigger chart refreshes
    this.refreshCharts()
  }

  /**
   * Toggle between light and dark theme
   */
  toggle(): void {
    const newTheme = this.isDark() ? 'light' : 'dark'
    this.setTheme(newTheme)
  }

  /**
   * Initialize theme from localStorage
   */
  init(): void {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null
    const themeToUse = saved || 'dark'
    this.currentTheme = themeToUse
    document.documentElement.setAttribute('data-theme', themeToUse)
  }

  /**
   * Get chart colors based on current theme
   */
  getChartColors() {
    const isDark = this.isDark()
    return {
      income: '#22c55e',
      expense: '#ef4444',
      transfer: '#6366f1',
      primary: '#3b82f6',
      incomeBg: 'rgba(34,197,94,.2)',
      expenseBg: 'rgba(239,68,68,.2)',
      primaryBg: 'rgba(59,130,246,.15)',
      grid: isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)',
      text: isDark ? '#94a3b8' : '#64748b',
      legend: isDark ? '#f1f5f9' : '#1e293b',
    }
  }

  /**
   * Refresh charts after theme change
   * This is a placeholder - actual implementation would call chart refresh methods
   */
  private refreshCharts(): void {
    // Called when theme changes to refresh charts
    // Implementation would depend on which charts are loaded
  }
}

// Export singleton instance
export const theme = new ThemeStore()

// Initialize theme on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    theme.init()
  })
} else {
  theme.init()
}
