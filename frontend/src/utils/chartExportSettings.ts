/**
 * Chart Export Settings
 * Persistent preferences for chart export (background, format)
 */

export interface ChartExportSettings {
  /** Background color for exported charts: 'transparent' | 'white' | 'dark' | 'theme' */
  background: 'transparent' | 'white' | 'dark' | 'theme'
}

const STORAGE_KEY = 'chartExportSettings'

export const defaultSettings: ChartExportSettings = {
  background: 'transparent',
}

export function loadChartExportSettings(): ChartExportSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      return { ...defaultSettings, ...parsed }
    }
  } catch {
    // ignore
  }
  return { ...defaultSettings }
}

export function saveChartExportSettings(settings: ChartExportSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

/** Resolve background setting to an actual CSS color string for canvas fill */
export function resolveBackgroundColor(setting: ChartExportSettings['background']): string | null {
  switch (setting) {
    case 'transparent':
      return null
    case 'white':
      return '#ffffff'
    case 'dark':
      return '#1a1a2e'
    case 'theme': {
      const isDark = document.documentElement.classList.contains('dark')
      return isDark ? '#1a1a2e' : '#ffffff'
    }
  }
}
