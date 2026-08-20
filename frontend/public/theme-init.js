// Stamp the theme before first paint so the boot loader (and the app behind
// it) never flashes the wrong theme. Resolution order:
//   1. Explicit user choice in localStorage
//   2. System prefers-color-scheme media query
//   3. Default: dark
// Kept as an external file — not inline — because the self-hosted Express
// deployment enforces `script-src 'self'` (helmet CSP), which blocks inline
// scripts.
try {
  var saved = localStorage.getItem('finance-theme')
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.setAttribute('data-theme', saved)
  } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    document.documentElement.setAttribute('data-theme', 'light')
  } else {
    document.documentElement.setAttribute('data-theme', 'dark')
  }
} catch (e) {
  document.documentElement.setAttribute('data-theme', 'dark')
}
