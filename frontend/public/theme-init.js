// Stamp the theme before first paint so the boot loader (and the app behind
// it) never flashes the wrong theme. Resolution order:
//   1. Explicit user choice in localStorage
//   2. A signed-out screen: dark
//   3. System prefers-color-scheme media query
//   4. Default: dark
// An external file by choice, not because a policy requires it today: the
// enforcing Content-Security-Policy in public/_headers sets no script-src, and
// the report-only one allows 'unsafe-inline'. Kept external so a stricter
// script-src 'self' can be enforced without moving it, so the service worker
// can precache it (vite.config.ts), and so tests can run it as the browser
// does (themeFirstPaint.test.ts, statusBarColor.test.ts).
//
// It also stamps <meta name="theme-color">, which is what iOS paints the
// standalone status bar with. That has to happen HERE rather than in the app:
// by the time core/theme.ts runs, the status bar has already been painted, and
// a hardcoded colour means the light theme gets a dark strip above it.
//
// The two literals below duplicate the `--bg` token of each theme, because at
// this point in the document no stylesheet has loaded and there is nothing to
// read it from. Source of truth: src/styles/themes/orbit-dark.css (dark) and
// dawn-light.css (light). src/__tests__/statusBarColor.test.ts fails the build
// if they ever drift apart.
var BG = { dark: '#0a0e1c', light: '#f7f9ff' }

function stampTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta && BG[theme]) meta.setAttribute('content', BG[theme])
}

// The rule is core/screenTheme.ts's themeFor, which App applies once auth answers; a test runs
// this file against it. A stored choice wins; a signed-out screen is dark; the app follows the
// system. Whether this boot shows a signed-out screen: the password-reset link always does,
// local-first never does, and otherwise the screen App settled on last time (finance-screen).
// A browser that has no record yet (its first visit since the record began) is signed in when
// it holds a current profile, which App keeps while signed in and drops at sign-out.
try {
  var saved = localStorage.getItem('finance-theme')
  var resetRoute = location.hash.slice(1).split('?')[0] === 'reset-password'
  var screen = localStorage.getItem('finance-screen')
  var showsApp =
    !resetRoute &&
    (localStorage.getItem('finance_storage_mode') === 'serverless' ||
      screen === 'app' ||
      (screen === null && localStorage.getItem('currentProfileId') !== null))
  if (saved === 'light' || saved === 'dark') {
    stampTheme(saved)
  } else if (
    showsApp &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  ) {
    stampTheme('light')
  } else {
    stampTheme('dark')
  }
} catch (e) {
  stampTheme('dark')
}
