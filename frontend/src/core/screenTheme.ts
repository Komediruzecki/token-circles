/**
 * Which theme a screen opens in, decided once, the same way before first paint and after.
 *
 * `public/theme-init.js` stamps `data-theme` before anything paints. It used to stamp the system
 * theme; then App's start-up set dark over it (signed-out screens stay dark: the brand's choice),
 * and on a signed-in boot `core/theme.ts` set the system theme back. With the system on light and
 * no stored choice, a signed-out visitor saw light then dark, a signed-in one light, dark, light.
 *
 * Now both read one rule:
 * 1. a stored choice (`finance-theme`) wins;
 * 2. a signed-out screen (sign-in, confirm your email, reset password) is dark;
 * 3. the app follows the system.
 *
 * Before first paint the script cannot ask the Worker whether the session is live, so App records
 * which screen it settled on (`finance-screen`) and the next boot reads that; with no record yet,
 * a current profile (`currentProfileId`, kept while signed in) counts as signed in. Local-first
 * always shows the app. The stamp is wrong only when the answer changed since the last visit (a
 * session that expired, a first visit to a local-first build); App corrects it once auth answers.
 * themeFirstPaint.test.ts runs theme-init.js against `themeFor` for every case.
 */

export const THEME_KEY = 'finance-theme'
export const SCREEN_KEY = 'finance-screen'

export type Screen = 'signed-out' | 'app'
export type ThemeName = 'light' | 'dark'

export function themeFor(stored: string | null, screen: Screen, systemLight: boolean): ThemeName {
  if (stored === 'light' || stored === 'dark') return stored
  if (screen === 'signed-out') return 'dark'
  return systemLight ? 'light' : 'dark'
}

/** Record the screen App settled on and give it its theme, touching nothing that already fits. */
export function applyScreenTheme(screen: Screen): void {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(THEME_KEY)
    localStorage.setItem(SCREEN_KEY, screen)
  } catch {
    // Storage blocked: no stored choice, and the next boot stamps from the default.
  }
  const systemLight =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  const want = themeFor(stored, screen, systemLight)
  const root = document.documentElement
  if (root.getAttribute('data-theme') === want) return
  root.setAttribute('data-theme', want)
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  const bg = window.getComputedStyle(root).getPropertyValue('--bg').trim()
  if (meta && bg) meta.setAttribute('content', bg)
}
