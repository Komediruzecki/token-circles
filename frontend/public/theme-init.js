// Stamp the saved theme before first paint so the boot loader (and the app
// behind it) never flashes the wrong theme. Mirrors core/theme.ts: dark is the
// default; 'light' is the only stored alternative. Kept as an external file —
// not inline — because the self-hosted Express deployment enforces
// `script-src 'self'` (helmet CSP), which blocks inline scripts.
try {
  document.documentElement.setAttribute(
    'data-theme',
    localStorage.getItem('finance-theme') === 'light' ? 'light' : 'dark'
  )
} catch (e) {
  document.documentElement.setAttribute('data-theme', 'dark')
}
