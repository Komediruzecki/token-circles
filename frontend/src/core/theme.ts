/**
 * Theme module — registry-based theme switching.
 *
 * Every theme is a CSS file in src/styles/themes/ that defines the full
 * token contract under [data-theme='<id>'] (see themes/README.md). To add
 * a theme: create the CSS file, import it from styles/index.css, and add
 * an entry to THEMES below — the Settings toggle and persistence pick it
 * up from the registry.
 */

const THEME_STORAGE_KEY = 'finance-theme'

export interface ThemeDefinition {
  id: string
  label: string
  /** Base scheme, used for scheme-dependent fallbacks (charts, toggles). */
  scheme: 'light' | 'dark'
}

export const THEMES: ThemeDefinition[] = [
  { id: 'dark', label: 'Orbit (dark)', scheme: 'dark' },
  { id: 'light', label: 'Dawn (light)', scheme: 'light' },
]

const DEFAULT_THEME = 'dark'

export type Theme = string

/**
 * Theme store - handles theme state and CSS variable updates
 */
export class ThemeStore {
  private currentTheme: Theme = DEFAULT_THEME

  /**
   * Check if the active theme is dark-schemed
   */
  isDark(): boolean {
    const active = document.documentElement.getAttribute('data-theme') ?? this.currentTheme
    return (THEMES.find((t) => t.id === active)?.scheme ?? 'dark') === 'dark'
  }

  /**
   * Get current theme
   */
  getTheme(): Theme {
    return this.currentTheme
  }

  /**
   * List registered themes (for settings UIs)
   */
  getThemes(): ThemeDefinition[] {
    return THEMES
  }

  /**
   * Set theme by registry id (unknown ids fall back to the default)
   */
  setTheme(theme: Theme): void {
    const resolved = THEMES.some((t) => t.id === theme) ? theme : DEFAULT_THEME
    this.currentTheme = resolved
    document.documentElement.setAttribute('data-theme', resolved)
    localStorage.setItem(THEME_STORAGE_KEY, resolved)
    // Trigger chart refreshes
    this.refreshCharts()
  }

  /**
   * Toggle between the dark and light base themes
   */
  toggle(): void {
    const newTheme = this.isDark() ? 'light' : 'dark'
    this.setTheme(newTheme)
  }

  /**
   * Initialize theme from localStorage
   */
  init(): void {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    const themeToUse = saved && THEMES.some((t) => t.id === saved) ? saved : DEFAULT_THEME
    this.currentTheme = themeToUse
    document.documentElement.setAttribute('data-theme', themeToUse)
  }

  /**
   * Get chart colors based on current theme. Colors come from the active
   * theme's CSS tokens so charts always match the surface they sit on.
   */
  getChartColors() {
    const cs = window.getComputedStyle(document.documentElement)
    const token = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
    const alpha = (hex: string, a: number) => {
      const m = /^#([0-9a-f]{6})$/i.exec(hex)
      if (!m) return hex
      const n = parseInt(m[1], 16)
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
    }
    const primary = token('--primary', '#6e9bff')
    const income = token('--income', '#7dffb0')
    const expense = token('--expense', '#ff9d9d')
    return {
      income,
      expense,
      transfer: token('--transfer', '#93b4ff'),
      primary,
      incomeBg: alpha(income, 0.12),
      expenseBg: alpha(expense, 0.12),
      primaryBg: token('--chart-primary-bg', 'rgba(110,155,255,.12)'),
      grid: token('--chart-grid', this.isDark() ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)'),
      text: token('--text', '#eaf0ff'),
      textSecondary: token('--text-secondary', '#9fb0d6'),
      border: token('--border', '#26324f'),
      legend: token('--text', '#eaf0ff'),
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
