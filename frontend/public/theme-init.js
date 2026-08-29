// Stamp the theme before first paint so the boot loader (and the app behind
// it) never flashes the wrong theme. Resolution order:
//   1. Explicit user choice in localStorage
//   2. System prefers-color-scheme media query
//   3. Default: dark
// Kept as an external file — not inline — because the self-hosted Express
// deployment enforces `script-src 'self'` (helmet CSP), which blocks inline
// scripts.
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

try {
  var saved = localStorage.getItem('finance-theme')
  if (saved === 'light' || saved === 'dark') {
    stampTheme(saved)
  } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    stampTheme('light')
  } else {
    stampTheme('dark')
  }
} catch (e) {
  stampTheme('dark')
}
